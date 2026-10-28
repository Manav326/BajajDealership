package com.quantaedge.bajaj.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.sql.Timestamp;
import java.time.Instant;
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
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SalesOperationsServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SalesOperationsService sales;

  @Test
  void enquiryFollowUpAndStatusChangesCreateAnAuditableTimeline() {
    Fixture fixture = createFixture("TIMELINE");
    var enquiry = createEnquiry(fixture, "WEBSITE");

    assertThat(enquiry.status()).isEqualTo("NEW");
    assertThat(enquiry.customerName()).isEqualTo("Sales Test Customer");

    Instant followUpAt = Instant.now().plusSeconds(3600);
    var followedUp = sales.setFollowUp(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.FollowUpRequest(followUpAt, "Call after the customer checks the price."));
    assertThat(followedUp.nextFollowUpAt()).isNotNull();

    var contacted = sales.changeStatus(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.StatusRequest("CONTACTED", "Discussed model and financing options."));
    assertThat(contacted.status()).isEqualTo("CONTACTED");
    var qualified = sales.changeStatus(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.StatusRequest("QUALIFIED", "Customer wants a test ride."));
    assertThat(qualified.status()).isEqualTo("QUALIFIED");

    var detail = sales.getEnquiryDetail(fixture.owner(), enquiry.publicId());
    assertThat(detail.activities())
        .extracting(SalesOperationsService.ActivityView::activityType)
        .contains("ENQUIRY_CREATED", "FOLLOW_UP_SET", "STATUS_CHANGED");
    assertThat(detail.activities())
        .filteredOn(item -> "STATUS_CHANGED".equals(item.activityType()))
        .extracting(SalesOperationsService.ActivityView::toStatus)
        .contains("CONTACTED", "QUALIFIED");
    assertThatThrownBy(() -> sales.changeStatus(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.StatusRequest("BOOKED", "Cannot set booked without reserving a bike.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void testRidePreventsOverlappingUseAndCanBeCheckedOutAndCompleted() {
    Fixture fixture = createFixture("TEST-RIDE");
    var enquiry = createEnquiry(fixture, "WALK_IN");
    sales.changeStatus(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.StatusRequest("QUALIFIED", "Qualified for a test ride."));
    Instant start = Instant.now().plusSeconds(120);
    Instant end = start.plusSeconds(3600);

    var ride = sales.scheduleTestRide(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.TestRideRequest(
            fixture.vehiclePublicId(), start, end, "Customer asked for a short road test."));
    assertThat(ride.status()).isEqualTo("SCHEDULED");
    assertThat(ride.testRideCode()).startsWith("TR-");
    assertThat(sales.getEnquiry(fixture.owner(), enquiry.publicId()).status()).isEqualTo("TEST_RIDE_SCHEDULED");

    var secondEnquiry = createEnquiry(fixture, "PHONE");
    sales.changeStatus(fixture.owner(), secondEnquiry.publicId(),
        new SalesOperationsService.StatusRequest("CONTACTED", "Arranged another slot."));
    assertThatThrownBy(() -> sales.scheduleTestRide(fixture.owner(), secondEnquiry.publicId(),
        new SalesOperationsService.TestRideRequest(
            fixture.vehiclePublicId(), start.plusSeconds(300), end.plusSeconds(300), "Overlapping ride.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var checkedOut = sales.checkOutTestRide(fixture.owner(), ride.publicId(), "Keys handed to customer.");
    assertThat(checkedOut.status()).isEqualTo("CHECKED_OUT");
    assertThat(checkedOut.checkedOutAt()).isNotNull();
    var completed = sales.completeTestRide(fixture.owner(), ride.publicId(), "Bike returned; customer feedback captured.");
    assertThat(completed.status()).isEqualTo("COMPLETED");
    assertThat(completed.completedAt()).isNotNull();
    assertThat(sales.getEnquiry(fixture.owner(), enquiry.publicId()).status()).isEqualTo("QUALIFIED");
    assertThat(jdbc.queryForObject("""
        select count(*) from sales_enquiry_activity
        where dealership_id = ? and reference_type = 'SALES_TEST_RIDE' and reference_id = ?
          and activity_type in ('TEST_RIDE_SCHEDULED', 'TEST_RIDE_CHECKED_OUT', 'TEST_RIDE_COMPLETED')
        """, Integer.class, fixture.owner().dealershipId(), ride.publicId().toString())).isEqualTo(3);
  }

  @Test
  void bookingReservesOneVehicleAndCancellationReleasesOnlyThatReservation() {
    Fixture fixture = createFixture("BOOKING");
    var enquiry = createEnquiry(fixture, "REFERRAL");
    sales.changeStatus(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.StatusRequest("QUALIFIED", "Ready to reserve a specific bike."));

    var booking = sales.createBooking(fixture.owner(), enquiry.publicId(),
        new SalesOperationsService.BookingRequest(fixture.vehiclePublicId(), "Customer confirmed the selected unit."));
    assertThat(booking.status()).isEqualTo("ACTIVE");
    assertThat(booking.vehicleStockStatus()).isEqualTo("RESERVED");
    assertThat(sales.getEnquiry(fixture.owner(), enquiry.publicId()).status()).isEqualTo("BOOKED");
    assertThat(jdbc.queryForObject("""
        select count(*) from vehicle_stock_movement
        where dealership_id = ? and vehicle_unit_id = (
          select id from vehicle_unit where dealership_id = ? and public_id = ?)
          and event_type = 'RESERVED' and reference_type = 'SALES_BOOKING' and reference_id = ?
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(),
        fixture.vehiclePublicId(), booking.publicId().toString())).isEqualTo(1);

    var anotherEnquiry = createEnquiry(fixture, "WALK_IN");
    sales.changeStatus(fixture.owner(), anotherEnquiry.publicId(),
        new SalesOperationsService.StatusRequest("QUALIFIED", "Asked for this same bike."));
    assertThatThrownBy(() -> sales.createBooking(fixture.owner(), anotherEnquiry.publicId(),
        new SalesOperationsService.BookingRequest(fixture.vehiclePublicId(), "Must not double-book.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var cancelled = sales.cancelBooking(fixture.owner(), booking.publicId(),
        new SalesOperationsService.BookingCancelRequest("Customer changed the preferred model."));
    assertThat(cancelled.status()).isEqualTo("CANCELLED");
    assertThat(cancelled.vehicleStockStatus()).isEqualTo("AVAILABLE");
    assertThat(sales.getEnquiry(fixture.owner(), enquiry.publicId()).status()).isEqualTo("QUALIFIED");
    assertThatThrownBy(() -> sales.cancelBooking(fixture.owner(), booking.publicId(),
        new SalesOperationsService.BookingCancelRequest("Duplicate cancellation.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(jdbc.queryForObject("""
        select count(*) from vehicle_stock_movement
        where dealership_id = ? and vehicle_unit_id = (
          select id from vehicle_unit where dealership_id = ? and public_id = ?)
          and event_type = 'RESERVATION_RELEASED' and reference_type = 'SALES_BOOKING' and reference_id = ?
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(),
        fixture.vehiclePublicId(), booking.publicId().toString())).isEqualTo(1);
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void concurrentBookingsForTheSameBikeCannotBothSucceed() throws Exception {
    Fixture fixture = createFixture("BOOKING-RACE");
    var firstEnquiry = createEnquiry(fixture, "WEBSITE");
    var secondEnquiry = createEnquiry(fixture, "PHONE");
    sales.changeStatus(fixture.owner(), firstEnquiry.publicId(),
        new SalesOperationsService.StatusRequest("QUALIFIED", "Concurrent booking A."));
    sales.changeStatus(fixture.owner(), secondEnquiry.publicId(),
        new SalesOperationsService.StatusRequest("QUALIFIED", "Concurrent booking B."));

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<Object> first = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Booking start barrier timed out.");
        try {
          return sales.createBooking(fixture.owner(), firstEnquiry.publicId(),
              new SalesOperationsService.BookingRequest(fixture.vehiclePublicId(), "Race A."));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      Future<Object> second = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Booking start barrier timed out.");
        try {
          return sales.createBooking(fixture.owner(), secondEnquiry.publicId(),
              new SalesOperationsService.BookingRequest(fixture.vehiclePublicId(), "Race B."));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      Object a = first.get(15, TimeUnit.SECONDS);
      Object b = second.get(15, TimeUnit.SECONDS);
      assertThat(List.of(a, b).stream().filter(SalesOperationsService.BookingView.class::isInstance).count())
          .isEqualTo(1);
      assertThat(List.of(a, b).stream().filter(HttpStatus.CONFLICT::equals).count()).isEqualTo(1);
    } finally {
      start.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
    assertThat(jdbc.queryForObject("""
        select count(*) from sales_booking
        where dealership_id = ? and vehicle_unit_id = (
          select id from vehicle_unit where dealership_id = ? and public_id = ?)
          and status = 'ACTIVE'
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(),
        fixture.vehiclePublicId())).isEqualTo(1);
    assertThat(sales.getAvailableVehicleStatus(fixture.owner(), fixture.vehiclePublicId())).isEqualTo("RESERVED");
  }

  @Test
  void salesRecordsAreScopedToAuthenticatedDealership() {
    Fixture first = createFixture("ISOLATION-A");
    Fixture second = createFixture("ISOLATION-B");
    var enquiry = createEnquiry(first, "WEBSITE");

    assertThatThrownBy(() -> sales.getEnquiry(second.owner(), enquiry.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
    assertThatThrownBy(() -> sales.createBooking(second.owner(), enquiry.publicId(),
        new SalesOperationsService.BookingRequest(second.vehiclePublicId(), "Cross-dealership attempt.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private SalesOperationsService.EnquiryView createEnquiry(Fixture fixture, String source) {
    return sales.createEnquiry(fixture.owner(), new SalesOperationsService.EnquiryRequest(
        fixture.customerPublicId(), fixture.modelPublicId(), null, source, "CALL",
        Instant.now().plusSeconds(3600), "Integration test enquiry."));
  }

  private Fixture createFixture(String label) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "SALE-" + label.replaceAll("[^A-Z0-9]", "") + "-" + unique;
    Long dealershipId = jdbc.queryForObject(
        "insert into dealership(code, name) values (?, ?) returning id",
        Long.class, code, "Sales Test Dealership " + label);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Sales Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "sales-owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRole = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)",
        dealershipId, staffId, ownerRole);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?", UUID.class, dealershipId, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(), code,
        "Sales Test Owner", Set.of("OWNER"),
        Set.of("sales.read", "sales.manage", "sales.deliver", "customer.read", "vehicle.read", "vehicle.manage"));

    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Sales Test Customer', ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, "CUS-" + unique, "9196" + unique.substring(0, 6));
    UUID customerPublicId = jdbc.queryForObject(
        "select public_id from customer where dealership_id = ? and id = ?",
        UUID.class, dealershipId, customerId);
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(
          dealership_id, model_code, model_name, variant_name, colour_name, model_year, active)
        values (?, ?, 'Test Motorcycle', 'Standard', 'Black', 2026, true) returning id
        """, Long.class, dealershipId, "MODEL-" + unique);
    UUID modelPublicId = jdbc.queryForObject(
        "select public_id from vehicle_model where dealership_id = ? and id = ?",
        UUID.class, dealershipId, modelId);
    Long unitId = jdbc.queryForObject("""
        insert into vehicle_unit(
          dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status, received_at)
        values (?, ?, ?, ?, 'AVAILABLE', now()) returning id
        """, Long.class, dealershipId, modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    UUID vehiclePublicId = jdbc.queryForObject(
        "select public_id from vehicle_unit where dealership_id = ? and id = ?",
        UUID.class, dealershipId, unitId);
    jdbc.update("""
        insert into customer_vehicle(dealership_id, customer_id, vehicle_unit_id, linked_by_staff_user_id)
        values (?, ?, ?, ?)
        """, dealershipId, customerId, unitId, staffId);
    return new Fixture(owner, customerPublicId, modelPublicId, vehiclePublicId, dealershipId);
  }

  private record Fixture(
      StaffPrincipal owner, UUID customerPublicId, UUID modelPublicId, UUID vehiclePublicId, long dealershipId) {}
}
