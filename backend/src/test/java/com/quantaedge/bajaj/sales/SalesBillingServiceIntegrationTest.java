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
class SalesBillingServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SalesOperationsService sales;
  @Autowired private SalesBillingService billing;

  @Test
  void saleInvoicePartialPaymentsReversalAndAcknowledgedDeliveryAreGated() {
    Fixture fixture = createFixture("FLOW");
    var enquiry = createEnquiry(fixture);
    var booking = sales.createBooking(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.BookingRequest(fixture.vehiclePublicId(), "Customer selected this bike."));

    var draftRequest = new SalesBillingService.InvoiceDraftRequest(
        new BigDecimal("100000.00"), new BigDecimal("5000.00"), "Vehicle sale quote.",
        List.of(new SalesBillingService.InvoiceLineInput(
            "ACCESSORY", "Helmet", new BigDecimal("2"), new BigDecimal("1000.00"))));
    var draft = billing.createInvoiceDraft(fixture.owner(), booking.publicId(), draftRequest);
    assertThat(draft.status()).isEqualTo("DRAFT");
    assertThat(draft.subtotal()).isEqualByComparingTo("102000.00");
    assertThat(draft.discountAmount()).isEqualByComparingTo("5000.00");
    assertThat(draft.invoiceTotal()).isEqualByComparingTo("97000.00");
    assertThat(draft.balanceDue()).isEqualByComparingTo("97000.00");
    assertThat(draft.lines()).hasSize(2);
    assertThat(draft.documentNotice()).contains("not a GST tax invoice");

    assertThat(billing.createInvoiceDraft(fixture.owner(), booking.publicId(), draftRequest).publicId())
        .isEqualTo(draft.publicId());
    assertThatThrownBy(() -> billing.createInvoiceDraft(fixture.owner(), booking.publicId(),
        new SalesBillingService.InvoiceDraftRequest(
            new BigDecimal("101000.00"), BigDecimal.ZERO, null, List.of())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var issued = billing.issueInvoice(fixture.owner(), draft.publicId());
    assertThat(issued.status()).isEqualTo("ISSUED");
    assertThat(issued.issuedAt()).isNotNull();

    String firstKey = "sale-pay-1-" + UUID.randomUUID();
    var first = billing.recordPayment(fixture.owner(), issued.publicId(),
        new SalesBillingService.PaymentRequest(firstKey, "UPI", new BigDecimal("20000.00"),
            "UPI-SALE-20000", "Booking part payment"));
    assertThat(first.invoice().paidAmount()).isEqualByComparingTo("20000.00");
    assertThat(first.invoice().balanceDue()).isEqualByComparingTo("77000.00");

    var replay = billing.recordPayment(fixture.owner(), issued.publicId(),
        new SalesBillingService.PaymentRequest(firstKey, "UPI", new BigDecimal("20000.00"),
            "UPI-SALE-20000", "Booking part payment"));
    assertThat(replay.idempotentReplay()).isTrue();
    assertThat(replay.payment().publicId()).isEqualTo(first.payment().publicId());
    assertThat(billing.getInvoice(fixture.owner(), issued.publicId()).payments()).hasSize(1);

    assertThatThrownBy(() -> billing.recordPayment(fixture.owner(), issued.publicId(),
        new SalesBillingService.PaymentRequest(firstKey, "UPI", new BigDecimal("19000.00"),
            "UPI-SALE-20000", "Changed amount")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThatThrownBy(() -> billing.recordPayment(fixture.owner(), issued.publicId(),
        new SalesBillingService.PaymentRequest("sale-overpay-" + UUID.randomUUID(), "CASH",
            new BigDecimal("77000.01"), null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var reversed = billing.reversePayment(fixture.owner(), first.payment().publicId(),
        new SalesBillingService.PaymentReversalRequest("Wrong amount entered", "SALE-REV-01"));
    assertThat(reversed.payment().status()).isEqualTo("REVERSED");
    assertThat(reversed.invoice().paidAmount()).isEqualByComparingTo("0.00");
    assertThat(reversed.invoice().balanceDue()).isEqualByComparingTo("97000.00");
    assertThat(reversed.payment().reversalReason()).isEqualTo("Wrong amount entered");

    var partial = billing.recordPayment(fixture.owner(), issued.publicId(),
        new SalesBillingService.PaymentRequest("sale-pay-2-" + UUID.randomUUID(), "CASH",
            new BigDecimal("50000.00"), null, "Cash part payment"));
    assertThat(partial.invoice().balanceDue()).isEqualByComparingTo("47000.00");

    assertThatThrownBy(() -> billing.deliverBooking(fixture.owner(), booking.publicId(),
        new SalesBillingService.HandoverRequest(
            "Sales Test Customer", true, "IN_PERSON", null, "Attempt before settlement.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var finalPayment = billing.recordPayment(fixture.owner(), issued.publicId(),
        new SalesBillingService.PaymentRequest("sale-pay-3-" + UUID.randomUUID(), "BANK_TRANSFER",
            new BigDecimal("47000.00"), "BANK-SALE-47000", "Final settlement"));
    assertThat(finalPayment.invoice().balanceDue()).isEqualByComparingTo("0.00");

    assertThatThrownBy(() -> billing.deliverBooking(fixture.owner(), booking.publicId(),
        new SalesBillingService.HandoverRequest(
            "Sales Test Customer", false, "SIGNED_FORM", "SALE-HANDOVER-1", "Acknowledgement missing.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    var handover = billing.deliverBooking(fixture.owner(), booking.publicId(),
        new SalesBillingService.HandoverRequest(
            "Sales Test Customer", true, "SIGNED_FORM", "SALE-HANDOVER-1", "Bike delivered."));
    assertThat(handover.customerAcknowledged()).isTrue();
    assertThat(handover.invoiceNumber()).isEqualTo(issued.invoiceNumber());
    assertThat(handover.deliveredAt()).isNotNull();
    assertThat(billing.getHandover(fixture.owner(), booking.publicId()).publicId()).isEqualTo(handover.publicId());

    assertThat(jdbc.queryForObject("""
        select stock_status from vehicle_unit
        where dealership_id = ? and public_id = ?
        """, String.class, fixture.dealershipId(), fixture.vehiclePublicId())).isEqualTo("SOLD");
    assertThat(jdbc.queryForObject("""
        select status from sales_booking
        where dealership_id = ? and public_id = ?
        """, String.class, fixture.dealershipId(), booking.publicId())).isEqualTo("CONVERTED_TO_SALE");
    assertThat(jdbc.queryForObject("""
        select count(*) from customer_vehicle
        where dealership_id = ? and vehicle_unit_id = (
          select id from vehicle_unit where dealership_id = ? and public_id = ?)
          and customer_id = (
          select id from customer where dealership_id = ? and public_id = ?)
          and ownership_ended_at is null
        """, Integer.class, fixture.dealershipId(), fixture.dealershipId(), fixture.vehiclePublicId(),
        fixture.dealershipId(), fixture.customerPublicId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select count(*) from vehicle_stock_movement
        where dealership_id = ? and reference_type = 'SALES_BOOKING' and reference_id = ?
          and from_status = 'RESERVED' and to_status = 'SOLD' and event_type = 'SOLD'
        """, Integer.class, fixture.dealershipId(), booking.publicId().toString())).isEqualTo(1);

    assertThatThrownBy(() -> billing.reversePayment(fixture.owner(), finalPayment.payment().publicId(),
        new SalesBillingService.PaymentReversalRequest("Try reversal after delivery", "POST-DELIVERY-REV")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(part.payment().status()).isEqualTo("RECORDED");
  }

  @Test
  void draftCanBeCancelledAndCorrectedButBookingCannotBeReleasedWithAnActiveInvoice() {
    Fixture fixture = createFixture("DRAFT");
    var enquiry = createEnquiry(fixture);
    var booking = sales.createBooking(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.BookingRequest(fixture.vehiclePublicId(), "Draft correction test."));
    var firstDraft = billing.createInvoiceDraft(fixture.owner(), booking.publicId(),
        new SalesBillingService.InvoiceDraftRequest(new BigDecimal("90000.00"), BigDecimal.ZERO, null, List.of()));

    assertThatThrownBy(() -> sales.cancelBooking(fixture.owner(), booking.publicId(),
        new SalesOperationsService.BookingCancelRequest("Customer changed mind.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var cancelledDraft = billing.cancelInvoiceDraft(fixture.owner(), firstDraft.publicId(), "Price was entered incorrectly.");
    assertThat(cancelledDraft.status()).isEqualTo("CANCELLED");
    var corrected = billing.createInvoiceDraft(fixture.owner(), booking.publicId(),
        new SalesBillingService.InvoiceDraftRequest(new BigDecimal("92000.00"), new BigDecimal("1000.00"), null, List.of()));
    assertThat(corrected.publicId()).isNotEqualTo(firstDraft.publicId());
    assertThat(corrected.invoiceTotal()).isEqualByComparingTo("91000.00");

    billing.cancelInvoiceDraft(fixture.owner(), corrected.publicId(), "Customer cancelled before issue.");
    var cancelledBooking = sales.cancelBooking(fixture.owner(), booking.publicId(),
        new SalesOperationsService.BookingCancelRequest("Customer changed mind."));
    assertThat(cancelledBooking.status()).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("""
        select stock_status from vehicle_unit
        where dealership_id = ? and public_id = ?
        """, String.class, fixture.dealershipId(), fixture.vehiclePublicId())).isEqualTo("AVAILABLE");
  }

  @Test
  void saleBillingCannotCrossDealershipBoundaries() {
    Fixture first = createFixture("ISOLATION_A");
    Fixture second = createFixture("ISOLATION_B");
    var enquiry = createEnquiry(first);
    var booking = sales.createBooking(first.owner(), enquiry.publicId(),
        new SalesOperationsService.BookingRequest(first.vehiclePublicId(), null));
    var invoice = billing.createInvoiceDraft(first.owner(), booking.publicId(),
        new SalesBillingService.InvoiceDraftRequest(new BigDecimal("50000.00"), BigDecimal.ZERO, null, List.of()));

    assertThatThrownBy(() -> billing.getInvoice(second.owner(), invoice.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
    assertThatThrownBy(() -> billing.createInvoiceDraft(second.owner(), booking.publicId(),
        new SalesBillingService.InvoiceDraftRequest(new BigDecimal("50000.00"), BigDecimal.ZERO, null, List.of())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private SalesOperationsService.EnquiryView createEnquiry(Fixture fixture) {
    return sales.createEnquiry(fixture.owner(), new SalesOperationsService.EnquiryRequest(
        fixture.customerPublicId(), fixture.modelPublicId(), null,
        "WALK_IN", "CALL", Instant.now().plusSeconds(3600), "Sales billing test enquiry."));
  }

  private Fixture createFixture(String label) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "SALEBILL-" + label.replaceAll("[^A-Z0-9]", "") + "-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Sales Billing Test " + label);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Sales Billing Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, "sales-billing-owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)",
        dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?", UUID.class, dealershipId, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(), code,
        "Sales Billing Test Owner", Set.of("OWNER"),
        Set.of("sales.read", "sales.manage", "sales.deliver", "sales.invoice", "sales.payment",
            "sales.payment.reverse", "customer.read", "vehicle.read", "vehicle.manage"));

    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Sales Test Customer', ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, "CUS-" + unique, "9195" + unique.substring(0, 6));
    UUID customerPublicId = jdbc.queryForObject(
        "select public_id from customer where dealership_id = ? and id = ?", UUID.class, dealershipId, customerId);
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(
          dealership_id, model_code, model_name, variant_name, colour_name, model_year, active)
        values (?, ?, 'Sales Test Motorcycle', 'Standard', 'Black', 2026, true) returning id
        """, Long.class, dealershipId, "MODEL-" + unique);
    UUID modelPublicId = jdbc.queryForObject(
        "select public_id from vehicle_model where dealership_id = ? and id = ?", UUID.class, dealershipId, modelId);
    UUID vehiclePublicId = jdbc.queryForObject("""
        insert into vehicle_unit(
          dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status, received_at, purchase_cost)
        values (?, ?, ?, ?, 'AVAILABLE', now(), 65000.00)
        returning public_id
        """, UUID.class, dealershipId, modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    return new Fixture(owner, dealershipId, customerPublicId, modelPublicId, vehiclePublicId);
  }

  private record Fixture(
      StaffPrincipal owner, long dealershipId, UUID customerPublicId, UUID modelPublicId, UUID vehiclePublicId) {}
}
