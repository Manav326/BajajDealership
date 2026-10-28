package com.quantaedge.bajaj.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SalesTransactionServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SalesTransactionService transactions;

  @Test
  void salesInvoicePaymentRetryReversalAndHandoverAreGatedAndAuditable() {
    Fixture fixture = createFixture("COMPLETE");
    var draft = transactions.createDraftInvoice(fixture.owner(), fixture.bookingPublicId(),
        invoiceRequest("draft-key-" + UUID.randomUUID(), "50000.00", "2000.00"));
    assertThat(draft.status()).isEqualTo("DRAFT");
    assertThat(draft.invoiceTotal()).isEqualByComparingTo("49400.00");
    assertThat(draft.lines()).hasSize(2);
    assertThat(draft.lines().get(0).lineType()).isEqualTo("VEHICLE");
    assertThat(draft.lines().get(0).description()).contains(fixture.chassisNumber());

    var replayDraft = transactions.createDraftInvoice(fixture.owner(), fixture.bookingPublicId(),
        invoiceRequest(jdbc.queryForObject("""
            select idempotency_key from vehicle_sale_invoice where dealership_id = ? and public_id = ?
            """, String.class, fixture.owner().dealershipId(), draft.publicId()), "50000.00", "2000.00"));
    assertThat(replayDraft.publicId()).isEqualTo(draft.publicId());

    var issued = transactions.issueInvoice(fixture.owner(), draft.publicId());
    assertThat(issued.status()).isEqualTo("ISSUED");
    assertThat(issued.documentNotice()).contains("not a GST tax invoice");
    assertThat(issued.balanceDue()).isEqualByComparingTo("49400.00");

    String paymentKey = "sale-payment-" + UUID.randomUUID();
    var partial = transactions.recordPayment(fixture.owner(), issued.publicId(),
        new SalesTransactionService.SalePaymentRequest(
            paymentKey, "UPI", new BigDecimal("10000.00"), "UPI-SALE-10K", "Booking payment"));
    assertThat(partial.amount()).isEqualByComparingTo("10000.00");
    var afterPartial = transactions.getInvoice(fixture.owner(), issued.publicId());
    assertThat(afterPartial.paidAmount()).isEqualByComparingTo("10000.00");
    assertThat(afterPartial.balanceDue()).isEqualByComparingTo("39400.00");

    var paymentReplay = transactions.recordPayment(fixture.owner(), issued.publicId(),
        new SalesTransactionService.SalePaymentRequest(
            paymentKey, "UPI", new BigDecimal("10000.00"), "UPI-SALE-10K", "Booking payment"));
    assertThat(paymentReplay.publicId()).isEqualTo(partial.publicId());
    assertThat(transactions.listPayments(fixture.owner(), issued.publicId())).hasSize(1);

    assertThatThrownBy(() -> transactions.recordPayment(fixture.owner(), issued.publicId(),
        new SalesTransactionService.SalePaymentRequest(
            paymentKey, "UPI", new BigDecimal("10001.00"), "UPI-SALE-10K", "Changed amount")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThatThrownBy(() -> transactions.deliverBooking(fixture.owner(), fixture.bookingPublicId(),
        new SalesTransactionService.HandoverRequest(
            "Test Customer", true, "IN_PERSON", null, "Not fully paid yet")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var reversed = transactions.reversePayment(fixture.owner(), partial.publicId(),
        new SalesTransactionService.SalePaymentReversalRequest("Incorrect payment amount", "REV-SALE-100"));
    assertThat(reversed.status()).isEqualTo("REVERSED");
    assertThat(reversed.reversalReason()).isEqualTo("Incorrect payment amount");
    assertThat(transactions.getInvoice(fixture.owner(), issued.publicId()).paidAmount()).isEqualByComparingTo("0.00");

    assertThatThrownBy(() -> transactions.deliverBooking(fixture.owner(), fixture.bookingPublicId(),
        new SalesTransactionService.HandoverRequest(
            "Test Customer", false, "IN_PERSON", null, "Acknowledgement not recorded")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    transactions.recordPayment(fixture.owner(), issued.publicId(),
        new SalesTransactionService.SalePaymentRequest(
            "sale-settlement-" + UUID.randomUUID(), "BANK_TRANSFER", new BigDecimal("49400.00"),
            "BANK-REF-49400", "Full balance settlement"));
    assertThat(transactions.getInvoice(fixture.owner(), issued.publicId()).balanceDue()).isEqualByComparingTo("0.00");

    var delivered = transactions.deliverBooking(fixture.owner(), fixture.bookingPublicId(),
        new SalesTransactionService.HandoverRequest(
            "Test Customer", true, "SIGNED_FORM", "SALE-HANDOVER-42", "Bike handed over after payment."));
    assertThat(delivered.customerAcknowledged()).isTrue();
    assertThat(delivered.acknowledgementMethod()).isEqualTo("SIGNED_FORM");
    assertThat(delivered.stockStatus()).isEqualTo("SOLD");
    assertThat(delivered.invoiceTotal()).isEqualByComparingTo("49400.00");

    var repeatDelivery = transactions.deliverBooking(fixture.owner(), fixture.bookingPublicId(),
        new SalesTransactionService.HandoverRequest(
            "Test Customer", true, "SIGNED_FORM", "SALE-HANDOVER-42", "Retry delivery request"));
    assertThat(repeatDelivery.publicId()).isEqualTo(delivered.publicId());
    assertThat(jdbc.queryForObject("""
        select count(*) from customer_vehicle
        where dealership_id = ? and vehicle_unit_id = (
          select vehicle_unit_id from sales_booking where dealership_id = ? and public_id = ?)
          and ownership_ended_at is null
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), fixture.bookingPublicId()))
        .isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select count(*) from vehicle_stock_movement
        where dealership_id = ? and reference_type = 'VEHICLE_SALE_INVOICE'
          and to_status = 'SOLD' and reference_id = ?
        """, Integer.class, fixture.owner().dealershipId(), issued.publicId().toString())).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select status from sales_booking where dealership_id = ? and public_id = ?
        """, String.class, fixture.owner().dealershipId(), fixture.bookingPublicId()))
        .isEqualTo("CONVERTED_TO_SALE");
    assertThatThrownBy(() -> transactions.reversePayment(fixture.owner(),
        transactions.listPayments(fixture.owner(), issued.publicId()).getFirst().publicId(),
        new SalesTransactionService.SalePaymentReversalRequest("Post-delivery reversal", "REV-AFTER-DELIVERY")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void cancellingAnUnpaidInvoiceAllowsAnAuditedReplacementAndDealershipIsolation() {
    Fixture fixture = createFixture("CANCEL");
    var first = transactions.createDraftInvoice(fixture.owner(), fixture.bookingPublicId(),
        invoiceRequest("cancel-key-" + UUID.randomUUID(), "60000.00", "0.00"));
    var cancelled = transactions.cancelInvoice(fixture.owner(), first.publicId(), "Customer changed variant/price.");
    assertThat(cancelled.status()).isEqualTo("CANCELLED");
    assertThat(cancelled.cancellationReason()).isEqualTo("Customer changed variant/price.");

    var second = transactions.createDraftInvoice(fixture.owner(), fixture.bookingPublicId(),
        invoiceRequest("replacement-key-" + UUID.randomUUID(), "61000.00", "1000.00"));
    assertThat(second.publicId()).isNotEqualTo(first.publicId());
    assertThat(second.invoiceTotal()).isEqualByComparingTo("61400.00");

    Fixture other = createFixture("FOREIGN");
    assertThatThrownBy(() -> transactions.getInvoice(other.owner(), second.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void issueAndPaymentRejectInvalidBookingAndExcessPayment() {
    Fixture fixture = createFixture("LIMITS");
    var invoice = transactions.createDraftInvoice(fixture.owner(), fixture.bookingPublicId(),
        invoiceRequest("limit-key-" + UUID.randomUUID(), "15000.00", "0.00"));
    assertThatThrownBy(() -> transactions.recordPayment(fixture.owner(), invoice.publicId(),
        new SalesTransactionService.SalePaymentRequest(
            "draft-payment-" + UUID.randomUUID(), "CASH", BigDecimal.ONE, null, "Before issue")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var issued = transactions.issueInvoice(fixture.owner(), invoice.publicId());
    assertThatThrownBy(() -> transactions.recordPayment(fixture.owner(), issued.publicId(),
        new SalesTransactionService.SalePaymentRequest(
            "excess-" + UUID.randomUUID(), "CASH", new BigDecimal("15001.00"), null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThatThrownBy(() -> transactions.createDraftInvoice(fixture.owner(), fixture.bookingPublicId(),
        invoiceRequest("changed-price-" + UUID.randomUUID(), "17000.00", "0.00")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  private SalesTransactionService.SaleInvoiceRequest invoiceRequest(String key, String price, String discount) {
    return new SalesTransactionService.SaleInvoiceRequest(
        key, new BigDecimal(price), new BigDecimal(discount), "Vehicle sale estimate and add-ons.",
        List.of(new SalesTransactionService.SaleInvoiceLineRequest(
            "ACCESSORY", "Helmet", new BigDecimal("2.000"), new BigDecimal("750.00"),
            new BigDecimal("100.00"))));
  }

  private Fixture createFixture(String suffix) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, "SALE-" + suffix + "-" + unique, "Sale Test Dealership " + suffix);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Sale Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "sale-owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)",
        dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?", UUID.class, dealershipId, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        "SALE-" + suffix + "-" + unique, "Sale Test Owner", Set.of("OWNER"),
        Set.of("sales.read", "sales.manage", "sales.deliver", "finance.read",
            "finance.invoice", "finance.payment", "customer.read", "vehicle.read"));

    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Test Customer', ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, "CUS-" + unique, "9196" + unique.substring(0, 6));
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(
          dealership_id, model_code, model_name, variant_name, colour_name, model_year)
        values (?, ?, 'Test Motorcycle', 'Deluxe', 'Blue', 2026) returning id
        """, Long.class, dealershipId, "MODEL-" + unique);
    Long unitId = jdbc.queryForObject("""
        insert into vehicle_unit(
          dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status, purchase_cost)
        values (?, ?, ?, ?, 'RESERVED', 40000.00) returning id
        """, Long.class, dealershipId, modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    UUID vehiclePublicId = jdbc.queryForObject(
        "select public_id from vehicle_unit where dealership_id = ? and id = ?", UUID.class, dealershipId, unitId);
    Long enquiryId = jdbc.queryForObject("""
        insert into sales_enquiry(
          dealership_id, enquiry_code, customer_id, interested_model_id, created_by_staff_user_id,
          status, lead_source, contact_preference)
        values (?, ?, ?, ?, ?, 'BOOKED', 'WALK_IN', 'CALL') returning id
        """, Long.class, dealershipId, "ENQ-" + unique, customerId, modelId, staffId);
    UUID bookingPublicId = jdbc.queryForObject("""
        insert into sales_booking(
          dealership_id, booking_code, enquiry_id, customer_id, vehicle_unit_id, status, notes, created_by_staff_user_id)
        values (?, ?, ?, ?, ?, 'ACTIVE', 'Fixture booking', ?) returning public_id
        """, UUID.class, dealershipId, "BK-" + unique, enquiryId, customerId, unitId, staffId);
    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, 'AVAILABLE', 'RESERVED', 'RESERVED', 'SALES_BOOKING', ?, ?, 'Integration fixture')
        """, dealershipId, unitId, bookingPublicId.toString(), staffId);
    return new Fixture(owner, dealershipId, bookingPublicId, vehiclePublicId, "CHASSIS-" + unique);
  }

  private record Fixture(
      StaffPrincipal owner, long dealershipId, UUID bookingPublicId, UUID vehiclePublicId, String chassisNumber) {}
}
