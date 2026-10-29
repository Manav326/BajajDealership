package com.quantaedge.bajaj.commerce;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.inventory.SparePartsService;
import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class RetailPartsServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SparePartsService spareParts;
  @Autowired private RetailPartsService retailParts;

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
