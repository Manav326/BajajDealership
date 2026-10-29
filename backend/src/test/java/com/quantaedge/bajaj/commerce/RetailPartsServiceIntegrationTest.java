package com.quantaedge.bajaj.commerce;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.customers.CustomerPortalService;
import com.quantaedge.bajaj.customers.CustomerService;
import com.quantaedge.bajaj.inventory.SparePartsService;
import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class RetailPartsServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SparePartsService spareParts;
  @Autowired private RetailPartsService retailParts;
  @Autowired private CustomerService customers;
  @Autowired private CustomerPortalService portal;

  @Test
  void updatingRetailSettingsReturnsTheSavedDealershipScopedListing() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("RETAIL-" + UUID.randomUUID().toString().substring(0, 8),
            "Front brake pad", "Genuine replacement brake pad", "EACH"));

    var saved = retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(
            true, new BigDecimal("149.00"), "Bajaj front brake pad", List.of(), null));

    assertThat(saved.publicId()).isEqualTo(part.publicId());
    assertThat(saved.retailEnabled()).isTrue();
    assertThat(saved.retailPrice()).isEqualByComparingTo("149.00");
    assertThat(saved.retailDescription()).isEqualTo("Bajaj front brake pad");
    assertThat(saved.fitmentModelCodes()).isEmpty();

    var listed = retailParts.listRetailSettings(manager).stream()
        .filter(item -> item.publicId().equals(part.publicId()))
        .findFirst()
        .orElseThrow();
    assertThat(listed.retailPrice()).isEqualByComparingTo("149.00");
    assertThat(listed.quantityAvailable()).isEqualByComparingTo(BigDecimal.ZERO);
  }

  @Test
  void retailCatalogueReportsOnlyUnreservedAvailabilityAndCheckoutCannotSpendWorkshopStock() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("RESERVE-" + UUID.randomUUID().toString().substring(0, 8),
            "Oil filter", "Engine oil filter", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(
            true, new BigDecimal("99.00"), "Bajaj-compatible oil filter", List.of(), null));

    jdbc.update("""
        update spare_part_balance
        set quantity_on_hand = 10.000, quantity_reserved = 7.000, updated_at = now()
        where dealership_id = ?
          and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());

    CustomerPrincipal customer = customerIn(manager);
    var publicPart = retailParts.listCustomerCatalogue(customer).stream()
        .filter(item -> item.publicId().equals(part.publicId()))
        .findFirst()
        .orElseThrow();

    assertThat(publicPart.quantityAvailable()).isEqualByComparingTo("3.000");
    assertThat(publicPart.available()).isTrue();

    UUID beforeOrder = part.publicId();
    assertThatThrownBy(() -> retailParts.placeOrder(customer,
        new RetailPartsService.PlaceOrderRequest(
            List.of(new RetailPartsService.OrderLineRequest(beforeOrder, new BigDecimal("4.000"))),
            null, "Must not consume workshop-reserved units", "reserve-check-" + UUID.randomUUID())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var balance = jdbc.queryForMap("""
        select quantity_on_hand, quantity_reserved from spare_part_balance
        where dealership_id = ?
          and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    assertThat((BigDecimal) balance.get("quantity_on_hand")).isEqualByComparingTo("10.000");
    assertThat((BigDecimal) balance.get("quantity_reserved")).isEqualByComparingTo("7.000");
    assertThat(jdbc.queryForObject(
        "select count(*) from retail_part_order where dealership_id = ?",
        Integer.class, manager.dealershipId())).isZero();
  }

  @Test
  void unknownOrderCannotBeCancelledByAnotherCustomerIdentity() {
    StaffPrincipal manager = createManager();
    CustomerPrincipal customer = customerIn(manager);
    CustomerPrincipal differentCustomer = new CustomerPrincipal(
        customer.sessionId(), customer.accountId() + 10, "OTHER-ACCOUNT",
        customer.customerId() + 10, "OTHER-CUSTOMER",
        customer.dealershipId(), customer.dealershipPublicId(), customer.dealershipCode(),
        customer.dealershipName(), "OTHER-CODE", "Other Customer", customer.preferredLanguage(),
        null, null);

    assertThat(retailParts.listOrdersForCustomer(customer)).isEmpty();
    assertThat(retailParts.listOrdersForCustomer(differentCustomer)).isEmpty();

    UUID unknownOrder = UUID.randomUUID();
    assertThatThrownBy(() -> retailParts.cancelOrder(differentCustomer, unknownOrder))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void retailListingCannotBeReadOrUpdatedAcrossDealerships() {
    StaffPrincipal dealershipA = createManager();
    StaffPrincipal dealershipB = createManager();
    var partB = spareParts.createPart(dealershipB,
        new SparePartsService.PartRequest("OTHER-" + UUID.randomUUID().toString().substring(0, 8),
            "Dealership B part", "Private to dealership B", "EACH"));

    assertThat(retailParts.listRetailSettings(dealershipA))
        .noneMatch(item -> item.publicId().equals(partB.publicId()));

    assertThatThrownBy(() -> retailParts.updateRetailSettings(dealershipA, partB.publicId(),
        new RetailPartsService.RetailSettingsRequest(
            true, new BigDecimal("10.00"), "Unauthorized update", List.of(), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));

    assertThat(retailParts.listRetailSettings(dealershipB))
        .anyMatch(item -> item.publicId().equals(partB.publicId()) && !item.retailEnabled());
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void concurrentOrdersCannotReserveTheSameLastUnit() throws Exception {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("RACE-" + UUID.randomUUID().toString().substring(0, 8),
            "Last-unit oil filter", "Concurrency regression part", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(
            true, new BigDecimal("119.00"), "Concurrency test listing", List.of(), null));
    jdbc.update("""
        update spare_part_balance
        set quantity_on_hand = 1.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ?
          and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());

    CustomerPrincipal customer = registeredCustomerIn(manager);
    String firstKey = "race-a-" + UUID.randomUUID();
    String secondKey = "race-b-" + UUID.randomUUID();
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
      java.util.concurrent.Callable<Boolean> firstCheckout = () -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Checkout race did not start.");
        try {
          retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
              List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
              null, "Concurrent checkout A", firstKey));
          return true;
        } catch (ResponseStatusException expected) {
          if (expected.getStatusCode() != HttpStatus.CONFLICT) throw expected;
          return false;
        }
      };
      java.util.concurrent.Callable<Boolean> secondCheckout = () -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Checkout race did not start.");
        try {
          retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
              List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
              null, "Concurrent checkout B", secondKey));
          return true;
        } catch (ResponseStatusException expected) {
          if (expected.getStatusCode() != HttpStatus.CONFLICT) throw expected;
          return false;
        }
      };
      Future<Boolean> first = executor.submit(firstCheckout);
      Future<Boolean> second = executor.submit(secondCheckout);
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(true, false);
    }

    var balance = jdbc.queryForMap("""
        select quantity_on_hand, quantity_reserved from spare_part_balance
        where dealership_id = ?
          and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    assertThat((BigDecimal) balance.get("quantity_on_hand")).isEqualByComparingTo("1.000");
    assertThat((BigDecimal) balance.get("quantity_reserved")).isEqualByComparingTo("1.000");
    assertThat(jdbc.queryForObject("""
        select count(*) from retail_part_order
        where dealership_id = ? and customer_id = ?
        """, Integer.class, manager.dealershipId(), customer.customerId())).isEqualTo(1);
  }

  @Test
  void retailCheckoutCannotSpendWorkshopReservedQuantityAndCancellationReleasesOnlyRetailShare() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("WORKSHOP-" + UUID.randomUUID().toString().substring(0, 8),
            "Workshop-held oil filter", "Workshop reservation protection regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("155.00"),
            "Retail listing with workshop stock protected", List.of(), null));
    // Four units are already reserved by workshop work; only one of five physical units is sellable.
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 5.000, quantity_reserved = 4.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);

    assertThatThrownBy(() -> retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), new BigDecimal("2.000"))),
        null, "Cannot consume workshop-reserved stock", "workshop-block-" + UUID.randomUUID())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var retailOrder = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
        null, "Only the unreserved unit can be ordered", "workshop-available-" + UUID.randomUUID()));
    assertThat(retailOrder.status()).isEqualTo("PLACED");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("5.000");

    retailParts.cancelOrder(customer, retailOrder.publicId());
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("5.000");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("4.000");
  }

  @Test
  void repeatedCheckoutWithSameKeyReturnsSameOrderAndDoesNotReserveTwice() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("REPLAY-" + UUID.randomUUID().toString().substring(0, 8),
            "Spark plug", "Replay-safe order test", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("210.00"),
            "Bajaj-compatible spark plug", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 5.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    String key = "same-checkout-" + UUID.randomUUID();
    var request = new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), new BigDecimal("2.000"))),
        null, "Idempotency regression", key);

    var first = retailParts.placeOrder(customer, request);
    var replay = retailParts.placeOrder(customer, request);

    assertThat(replay.publicId()).isEqualTo(first.publicId());
    assertThat(replay.orderTotal()).isEqualByComparingTo("420.00");
    assertThat(jdbc.queryForObject("""
        select count(*) from retail_part_order where dealership_id = ? and idempotency_key = ?
        """, Integer.class, manager.dealershipId(), key)).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("2.000");
    assertThatThrownBy(() -> retailParts.placeOrder(customer,
        new RetailPartsService.PlaceOrderRequest(
            List.of(new RetailPartsService.OrderLineRequest(part.publicId(), new BigDecimal("1.000"))),
            null, "Different payload with same key", key)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void cancellingPlacedRetailOrderReleasesItsReservationExactlyOnce() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("CANCEL-" + UUID.randomUUID().toString().substring(0, 8),
            "Air filter", "Cancellation release regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("310.00"),
            "Bajaj-compatible air filter", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 4.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), new BigDecimal("2.000"))),
        null, "Cancel stock release", "cancel-order-" + UUID.randomUUID()));

    var cancelled = retailParts.cancelOrder(customer, placed.publicId());
    assertThat(cancelled.status()).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("4.000");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("0.000");
    assertThatThrownBy(() -> retailParts.cancelOrder(customer, placed.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void collectionFulfilmentConsumesReservedStockAndRecordsPaymentOnlyAfterStaffAction() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("FULFIL-" + UUID.randomUUID().toString().substring(0, 8),
            "Brake pad set", "Collection state regression", "SET"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("599.00"),
            "Bajaj-compatible brake pad set", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 3.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
        null, "Fulfilment state", "fulfil-order-" + UUID.randomUUID()));
    assertThat(placed.paymentStatus()).isEqualTo("PAY_ON_PICKUP");

    var fulfilled = retailParts.fulfillOrder(manager, placed.publicId(),
        new RetailPartsService.FulfillRequest("UPI", "TEST-COLLECTION-REF",
            "collection-" + UUID.randomUUID(), "Synthetic test collection"));

    assertThat(fulfilled.status()).isEqualTo("FULFILLED");
    assertThat(fulfilled.paymentStatus()).isEqualTo("PAID_AT_PICKUP");
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("2.000");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("0.000");
    assertThat(jdbc.queryForObject("""
        select count(*) from retail_part_order_collection
        where dealership_id = ? and order_id = (select id from retail_part_order where dealership_id = ? and public_id = ?)
        """, Integer.class, manager.dealershipId(), manager.dealershipId(), placed.publicId())).isEqualTo(1);
  }


  @Test
  void collectedReturnRestocksOnlyAfterInspectionAndIsIdempotent() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("RETURN-" + UUID.randomUUID().toString().substring(0, 8),
            "Resealable chain lube", "Return restock regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("199.00"),
            "Bajaj-compatible chain lube", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 5.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), new BigDecimal("2.000"))),
        null, "Full order return", "return-place-" + UUID.randomUUID()));
    retailParts.fulfillOrder(manager, placed.publicId(),
        new RetailPartsService.FulfillRequest("CASH", "TEST-RETURN-COLLECTION",
            "return-collect-" + UUID.randomUUID(), "Synthetic collection before return"));

    String returnKey = "return-key-" + UUID.randomUUID();
    var request = new RetailPartsService.ReturnRequest("Customer returned unopened items", true, returnKey);
    var returned = retailParts.returnOrder(manager, placed.publicId(), request);

    assertThat(returned.status()).isEqualTo("RETURNED");
    assertThat(returned.paymentStatus()).isEqualTo("REFUND_REVIEW_REQUIRED");
    assertThat(returned.returnReason()).isEqualTo("Customer returned unopened items");
    assertThat(returned.restockedOnReturn()).isTrue();
    assertThat(returned.returnedAt()).isNotNull();
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("5.000");
    assertThat(jdbc.queryForObject("""
        select count(*) from retail_part_order_return
        where dealership_id = ? and order_id = (select id from retail_part_order where dealership_id = ? and public_id = ?)
        """, Integer.class, manager.dealershipId(), manager.dealershipId(), placed.publicId())).isEqualTo(1);

    var replay = retailParts.returnOrder(manager, placed.publicId(), request);
    assertThat(replay.status()).isEqualTo("RETURNED");
    assertThat(replay.publicId()).isEqualTo(returned.publicId());
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("5.000");
    assertThatThrownBy(() -> retailParts.returnOrder(manager, placed.publicId(),
        new RetailPartsService.ReturnRequest("Different payload", true, returnKey)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void collectedReturnWithoutResaleInspectionDoesNotIncreaseSellableStock() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("NOSALE-" + UUID.randomUUID().toString().substring(0, 8),
            "Damaged mirror", "Non-resale return regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("450.00"),
            "Replacement mirror", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 2.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
        null, "Damage in transport", "damaged-place-" + UUID.randomUUID()));
    retailParts.fulfillOrder(manager, placed.publicId(),
        new RetailPartsService.FulfillRequest("UPI", "TEST-DAMAGED-COLLECTION",
            "damaged-collect-" + UUID.randomUUID(), "Synthetic collection before return"));

    var returned = retailParts.returnOrder(manager, placed.publicId(),
        new RetailPartsService.ReturnRequest("Mirror arrived damaged", false, "damaged-return-" + UUID.randomUUID()));

    assertThat(returned.status()).isEqualTo("RETURNED");
    assertThat(returned.restockedOnReturn()).isFalse();
    assertThat(returned.paymentStatus()).isEqualTo("REFUND_REVIEW_REQUIRED");
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("1.000");
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void deliveryOrderRequiresAQuotedFeeAndCustomerAcceptanceBeforeFulfilment() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("DELIVERY-" + UUID.randomUUID().toString().substring(0, 8),
            "Chain lubricant", "Delivery quote lifecycle regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("199.00"),
            "Chain lubricant", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 5.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
        null, "Delivery request", "delivery-place-" + UUID.randomUUID(), "DELIVERY", "12 Test Road, Bettiah"));
    assertThat(placed.status()).isEqualTo("PLACED");
    assertThat(placed.fulfillmentMethod()).isEqualTo("DELIVERY");
    assertThat(placed.deliveryAddress()).isEqualTo("12 Test Road, Bettiah");
    assertThat(placed.deliveryQuoteStatus()).isEqualTo("AWAITING_STAFF_QUOTE");
    assertThat(placed.deliveryFee()).isEqualByComparingTo("0.00");
    assertThat(placed.orderTotal()).isEqualByComparingTo("199.00");
    assertThat(placed.paymentMethod()).isEqualTo("PAY_ON_DELIVERY");
    assertThat(placed.paymentStatus()).isEqualTo("PAY_ON_DELIVERY");

    assertThatThrownBy(() -> retailParts.fulfillOrder(manager, placed.publicId(),
        new RetailPartsService.FulfillRequest("UPI", "EARLY", "early-" + UUID.randomUUID(), "Must not collect yet")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

    String quoteKey = "delivery-quote-" + UUID.randomUUID();
    var quoted = retailParts.quoteDelivery(manager, placed.publicId(),
        new RetailPartsService.DeliveryQuoteRequest(new BigDecimal("50.00"), "Local delivery to the saved address", quoteKey));
    assertThat(quoted.status()).isEqualTo("PLACED");
    assertThat(quoted.deliveryQuoteStatus()).isEqualTo("AWAITING_CUSTOMER_CONFIRMATION");
    assertThat(quoted.deliveryFee()).isEqualByComparingTo("50.00");
    assertThat(quoted.orderTotal()).isEqualByComparingTo("249.00");
    assertThat(quoted.deliveryQuoteNote()).isEqualTo("Local delivery to the saved address");
    assertThat(quoted.deliveryQuotedAt()).isNotNull();
    var quoteReplay = retailParts.quoteDelivery(manager, placed.publicId(),
        new RetailPartsService.DeliveryQuoteRequest(new BigDecimal("50.00"), "Local delivery to the saved address", quoteKey));
    assertThat(quoteReplay.orderTotal()).isEqualByComparingTo("249.00");

    var accepted = retailParts.respondToDeliveryQuote(customer, placed.publicId(), true);
    assertThat(accepted.deliveryQuoteStatus()).isEqualTo("ACCEPTED");
    assertThat(retailParts.respondToDeliveryQuote(customer, placed.publicId(), true).deliveryQuoteStatus()).isEqualTo("ACCEPTED");
    var delivered = retailParts.fulfillOrder(manager, placed.publicId(),
        new RetailPartsService.FulfillRequest("UPI", "SYNTHETIC-DELIVERY-COLLECTION",
            "delivery-collect-" + UUID.randomUUID(), "Synthetic staff-attested delivery"));
    assertThat(delivered.status()).isEqualTo("FULFILLED");
    assertThat(delivered.paymentStatus()).isEqualTo("PAID_ON_DELIVERY");
    assertThat(delivered.deliveryQuoteStatus()).isEqualTo("ACCEPTED");
    assertThat(jdbc.queryForObject("""
        select amount from retail_part_order_collection
        where dealership_id = ? and order_id = (select id from retail_part_order where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), placed.publicId()))
        .isEqualByComparingTo("249.00");
    assertThat(jdbc.queryForObject("""
        select quantity_on_hand from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("4.000");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("0.000");
  }

  @Test
  void decliningADeliveryQuoteCancelsTheOrderAndReleasesStockExactlyOnce() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("DECLINE-" + UUID.randomUUID().toString().substring(0, 8),
            "Brake lever", "Delivery decline regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("75.00"), "Brake lever", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 2.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
        null, "Delivery I may decline", "delivery-decline-place-" + UUID.randomUUID(), "DELIVERY", "9 Sample Lane"));
    retailParts.quoteDelivery(manager, placed.publicId(),
        new RetailPartsService.DeliveryQuoteRequest(new BigDecimal("25.00"), "Local delivery",
            "delivery-decline-quote-" + UUID.randomUUID()));

    var declined = retailParts.respondToDeliveryQuote(customer, placed.publicId(), false);
    assertThat(declined.status()).isEqualTo("CANCELLED");
    assertThat(declined.deliveryQuoteStatus()).isEqualTo("DECLINED");
    assertThat(retailParts.respondToDeliveryQuote(customer, placed.publicId(), false).status()).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("0.000");
    assertThat(jdbc.queryForObject("""
        select count(*) from spare_part_stock_movement
        where dealership_id = ? and reference_id = ? and movement_type = 'RETAIL_ORDER_RELEASED'
        """, Integer.class, manager.dealershipId(), placed.publicId().toString())).isEqualTo(1);
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void cancellingUnquotedDeliveryMarksQuoteCancelledAuditsAndReleasesReservation() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("DEL-CANCEL-" + UUID.randomUUID().toString().substring(0, 8),
            "Clutch cable", "Delivery cancellation regression", "EACH"));
    retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(true, new BigDecimal("125.00"),
            "Clutch cable", List.of(), null));
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = 4.000, quantity_reserved = 0.000, updated_at = now()
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, manager.dealershipId(), manager.dealershipId(), part.publicId());
    CustomerPrincipal customer = registeredCustomerIn(manager);
    var placed = retailParts.placeOrder(customer, new RetailPartsService.PlaceOrderRequest(
        List.of(new RetailPartsService.OrderLineRequest(part.publicId(), BigDecimal.ONE)),
        null, "Cancel delivery before quote", "delivery-cancel-" + UUID.randomUUID(),
        "DELIVERY", "21 Demo Street, Bettiah"));

    var cancelled = retailParts.cancelOrder(customer, placed.publicId());

    assertThat(cancelled.status()).isEqualTo("CANCELLED");
    assertThat(cancelled.deliveryQuoteStatus()).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("""
        select quantity_reserved from spare_part_balance
        where dealership_id = ? and part_id = (select id from spare_part where dealership_id = ? and public_id = ?)
        """, BigDecimal.class, manager.dealershipId(), manager.dealershipId(), part.publicId()))
        .isEqualByComparingTo("0.000");
    assertThat(jdbc.queryForObject("""
        select count(*) from audit_event
        where dealership_id = ? and entity_type = 'RETAIL_PART_ORDER' and entity_id = ?
          and action = 'RETAIL_PART_ORDER_CANCELLED'
        """, Integer.class, manager.dealershipId(), placed.publicId().toString())).isEqualTo(1);
  }

  private CustomerPrincipal registeredCustomerIn(StaffPrincipal manager) {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    StaffPrincipal owner = new StaffPrincipal(
        manager.sessionId(), manager.staffUserId(), manager.staffPublicId(), manager.dealershipId(),
        manager.dealershipPublicId(), manager.dealershipCode(), manager.fullName(), Set.of("OWNER"),
        Set.of("customer.read", "customer.create", "customer.update", "parts.read", "parts.manage"));
    CustomerService.CustomerView customer = customers.create(owner,
        new CustomerService.CustomerRequest(
            "Retail Test Customer " + suffix,
            "9188" + String.format("%06d", Math.abs(UUID.randomUUID().hashCode()) % 1_000_000),
            null, "retail-customer-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test",
            "en", false, null, "Created for retail-order integration test."));
    var invitation = portal.issueInvitation(owner, customer.publicId());
    var session = portal.activate(
        new CustomerPortalService.ActivationRequest(invitation.activationToken(), "Strong-Customer-Password-123"),
        "203.0.113.41", "retail-order-test-agent");
    return principalForToken(session.accessToken());
  }

  private CustomerPrincipal principalForToken(String rawToken) {
    return jdbc.queryForObject("""
        select session.id as session_id, account.id as account_id, account.public_id as account_public_id,
          customer.id as customer_id, customer.public_id as customer_public_id,
          dealership.id as dealership_id, dealership.public_id as dealership_public_id,
          dealership.code as dealership_code, dealership.name as dealership_name,
          customer.customer_code, customer.full_name, customer.preferred_language, customer.phone, customer.email
        from customer_portal_session session
        join customer_portal_account account
          on account.dealership_id = session.dealership_id and account.id = session.account_id
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = session.dealership_id
        where session.token_hash = ?
        """, (rs, rowNum) -> new CustomerPrincipal(
            rs.getLong("session_id"), rs.getLong("account_id"), rs.getString("account_public_id"),
            rs.getLong("customer_id"), rs.getString("customer_public_id"), rs.getLong("dealership_id"),
            rs.getString("dealership_public_id"), rs.getString("dealership_code"), rs.getString("dealership_name"),
            rs.getString("customer_code"), rs.getString("full_name"), rs.getString("preferred_language"),
            rs.getString("phone"), rs.getString("email")), TokenDigests.sha256(rawToken));
  }

  private CustomerPrincipal customerIn(StaffPrincipal manager) {
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, manager.dealershipId());
    return new CustomerPrincipal(
        1, 88001, "TEST-ACCOUNT-NOT-PERSISTED", 88002, "TEST-CUSTOMER-NOT-PERSISTED",
        manager.dealershipId(), dealershipPublicId.toString(), manager.dealershipCode(),
        "Retail Parts Test Dealership", "CUST-NOT-PERSISTED", "Test Customer",
        "en", null, null);
  }

  private StaffPrincipal createManager() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    String dealershipCode = "RET-" + suffix;
    Long dealershipId = jdbc.queryForObject(
        "insert into dealership(code, name) values (?, ?) returning id",
        Long.class, dealershipCode, "Retail Parts Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Retail Parts Manager', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "retail-manager-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    Long managerRoleId = jdbc.queryForObject("select id from role where code = 'MANAGER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, managerRoleId);

    return new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Retail Parts Manager", Set.of("MANAGER"),
        Set.of("parts.read", "parts.manage"));
  }
}
