package com.quantaedge.bajaj.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.customers.CustomerPortalService;
import com.quantaedge.bajaj.customers.CustomerService;
import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
class CustomerSalesRequestServiceIntegrationTest {
  private static final String MODEL_CODE = "BAJAJ_PULSAR_NS200";

  @Autowired private JdbcTemplate jdbc;
  @Autowired private CustomerService customers;
  @Autowired private CustomerPortalService portal;
  @Autowired private CustomerSalesRequestService requests;
  @Autowired private SalesOperationsService sales;
  @Autowired private SalesTransactionService transactions;

  @Test
  void preferredTestRideTimeIsPersistedAndReturnedToCustomerAndStaffQueue() {
    Fixture fixture = createFixture();
    Instant preferredAt = Instant.now().plus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MICROS);

    var created = requests.create(fixture.customer(), new CustomerSalesRequestService.CreateRequest(
        "TEST_RIDE", MODEL_CODE, preferredAt, "Please call before confirming.", "ride-" + UUID.randomUUID()));

    assertThat(created.status()).isEqualTo("REQUESTED");
    assertThat(created.requestType()).isEqualTo("TEST_RIDE");
    assertThat(created.preferredAt()).isEqualTo(preferredAt);
    var journey = requests.listForCustomer(fixture.customer()).getFirst();
    assertThat(journey.preferredAt()).isEqualTo(preferredAt);
    assertThat(journey.enquiryCode()).isNull();
    assertThat(journey.enquiryStatus()).isNull();
    assertThat(journey.testRideStatus()).isNull();
    assertThat(journey.bookingStatus()).isNull();
    assertThat(journey.invoiceStatus()).isNull();
    assertThat(journey.invoiceTotal()).isNull();
    assertThat(journey.paidAmount()).isEqualByComparingTo("0.00");
    assertThat(journey.creditedAmount()).isNull();
    assertThat(journey.balanceDue()).isNull();
    assertThat(journey.deliveredAt()).isNull();
  }

  @Test
  void customerJourneyReflectsRealTestRideBookingInvoicePaymentAndHandoverRecords() {
    Fixture fixture = createFixture();
    Instant preferredAt = Instant.now().plus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MICROS);
    var request = requests.create(fixture.customer(), new CustomerSalesRequestService.CreateRequest(
        "TEST_RIDE", MODEL_CODE, preferredAt,
        "Synthetic full journey integration test.", "full-journey-" + UUID.randomUUID()));

    var converted = requests.convertToEnquiry(fixture.owner(), request.publicId());
    assertThat(converted.convertedEnquiryPublicId()).isNotNull();

    Instant rideStart = preferredAt;
    var ride = sales.scheduleTestRide(fixture.owner(), converted.convertedEnquiryPublicId(),
        new SalesOperationsService.TestRideRequest(fixture.vehicleUnitPublicId(), rideStart,
            rideStart.plus(1, ChronoUnit.HOURS), "Synthetic acceptance test only"));
    sales.checkOutTestRide(fixture.owner(), ride.publicId(), "Synthetic test checkout");
    sales.completeTestRide(fixture.owner(), ride.publicId(), "Synthetic test completion");

    var booking = sales.createBooking(fixture.owner(), converted.convertedEnquiryPublicId(),
        new SalesOperationsService.BookingRequest(fixture.vehicleUnitPublicId(), "Synthetic full journey test"));
    var draft = transactions.createDraftInvoice(fixture.owner(), booking.publicId(),
        new SalesTransactionService.SaleInvoiceRequest("journey-invoice-" + UUID.randomUUID(),
            new BigDecimal("150000.00"), BigDecimal.ZERO.setScale(2), "Synthetic test only.", java.util.List.of()));
    var issued = transactions.issueInvoice(fixture.owner(), draft.publicId());
    assertThat(issued.status()).isEqualTo("ISSUED");

    transactions.recordPayment(fixture.owner(), issued.publicId(),
        new SalesTransactionService.SalePaymentRequest("journey-payment-" + UUID.randomUUID(),
            "UPI", new BigDecimal("150000.00"), "SYNTHETIC-NO-REAL-PAYMENT", "Integration fixture only"));
    transactions.deliverBooking(fixture.owner(), booking.publicId(),
        new SalesTransactionService.HandoverRequest(fixture.customer().fullName(), true,
            "WRITTEN_MESSAGE", "SYNTHETIC-HANDOVER-ACK", "Integration fixture only"));

    var journey = requests.listForCustomer(fixture.customer()).getFirst();
    assertThat(journey.enquiryCode()).isNotBlank();
    assertThat(journey.enquiryStatus()).isEqualTo("BOOKED");
    assertThat(journey.testRideCode()).isEqualTo(ride.testRideCode());
    assertThat(journey.testRideStatus()).isEqualTo("COMPLETED");
    assertThat(journey.testRideScheduledStart()).isEqualTo(rideStart);
    assertThat(journey.bookingCode()).isEqualTo(booking.bookingCode());
    assertThat(journey.bookingStatus()).isEqualTo("CONVERTED_TO_SALE");
    assertThat(journey.invoiceNumber()).isEqualTo(issued.invoiceNumber());
    assertThat(journey.invoiceStatus()).isEqualTo("ISSUED");
    assertThat(journey.invoiceTotal()).isEqualByComparingTo("150000.00");
    assertThat(journey.paidAmount()).isEqualByComparingTo("150000.00");
    assertThat(journey.creditedAmount()).isEqualByComparingTo("0.00");
    assertThat(journey.balanceDue()).isEqualByComparingTo("0.00");
    assertThat(journey.deliveredAt()).isNotNull();
  }

  @Test
  void preferredTimeMustBeFutureAndCanOnlyBeUsedForTestRideRequests() {
    Fixture fixture = createFixture();

    assertThatThrownBy(() -> requests.create(fixture.customer(), new CustomerSalesRequestService.CreateRequest(
        "TEST_RIDE", MODEL_CODE, Instant.now().minusSeconds(60), null, "past-" + UUID.randomUUID())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    assertThatThrownBy(() -> requests.create(fixture.customer(), new CustomerSalesRequestService.CreateRequest(
        "PURCHASE", MODEL_CODE, Instant.now().plus(2, ChronoUnit.DAYS), null, "purchase-" + UUID.randomUUID())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    assertThatThrownBy(() -> requests.create(fixture.customer(), new CustomerSalesRequestService.CreateRequest(
        "TEST_RIDE", MODEL_CODE, Instant.now().plus(181, ChronoUnit.DAYS), null, "far-" + UUID.randomUUID())))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  private Fixture createFixture() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    String dealershipCode = "SALES-" + suffix;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Sales Request Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Sales Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "sales-owner-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code = 'OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?", UUID.class, dealershipId, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Sales Test Owner", Set.of("OWNER"),
        Set.of("customer.read", "customer.create", "customer.update", "sales.read", "sales.manage", "sales.deliver", "finance.read", "finance.invoice", "finance.payment"));

    Long vehicleModelId = jdbc.queryForObject("""
        insert into vehicle_model(dealership_id, model_code, model_name, active)
        values (?, ?, 'Pulsar NS200', true)
        returning id
        """, Long.class, dealershipId, MODEL_CODE);
    UUID vehicleUnitPublicId = jdbc.queryForObject("""
        insert into vehicle_unit(dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status)
        values (?, ?, ?, ?, 'AVAILABLE')
        returning public_id
        """, UUID.class, dealershipId, vehicleModelId,
        "CHASSIS-" + suffix, "ENGINE-" + suffix);
    jdbc.update("""
        insert into bajaj_catalogue_dealership_model(dealership_id, model_code, is_published)
        values (?, ?, true)
        on conflict (dealership_id, model_code) do update set is_published = true
        """, dealershipId, MODEL_CODE);

    CustomerService.CustomerView customer = customers.create(owner,
        new CustomerService.CustomerRequest(
            "Sales Test Customer " + suffix,
            "9199" + String.format("%06d", Math.abs(UUID.randomUUID().hashCode()) % 1_000_000),
            null, "sales-customer-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test",
            "en", false, null, "Created for sales request integration test."));
    var invitation = portal.issueInvitation(owner, customer.publicId());
    var session = portal.activate(
        new CustomerPortalService.ActivationRequest(invitation.activationToken(), "Strong-Customer-Password-123"),
        "203.0.113.40", "sales-request-test-agent");
    return new Fixture(principalForToken(session.accessToken()), owner, vehicleUnitPublicId);
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

  private record Fixture(CustomerPrincipal customer, StaffPrincipal owner, UUID vehicleUnitPublicId) {}
}
