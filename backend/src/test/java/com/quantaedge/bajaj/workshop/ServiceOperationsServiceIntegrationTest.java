package com.quantaedge.bajaj.workshop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.Instant;
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
class ServiceOperationsServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ServiceOperationsService workshop;

  @Test
  void appointmentCheckinCreatesOneJobCardWithInspectionAndIsRetrySafe() {
    Fixture fixture = createFixture("A");
    ServiceOperationsService.AppointmentView appointment = workshop.createAppointment(fixture.owner(),
        new ServiceOperationsService.AppointmentRequest(
            fixture.customerPublicId(), fixture.vehiclePublicId(), Instant.now().plusSeconds(86_400),
            60, "Engine makes a noise while accelerating", "hi", "STAFF", null));

    assertThat(appointment.status()).isEqualTo("REQUESTED");
    assertThat(appointment.customerName()).isEqualTo("Workshop Test Customer");

    assertThat(workshop.listAppointments(fixture.owner(), 0, 25, "REQUESTED", "Workshop").total()).isEqualTo(1);
    assertThat(workshop.confirmAppointment(fixture.owner(), appointment.publicId(), "Slot confirmed").status())
        .isEqualTo("CONFIRMED");

    ServiceOperationsService.JobCardView first = workshop.checkInAppointment(fixture.owner(),
        appointment.publicId(), new ServiceOperationsService.CheckInRequest(12_450, 70, "Helmet stored with vehicle."));
    ServiceOperationsService.JobCardView retried = workshop.checkInAppointment(fixture.owner(),
        appointment.publicId(), new ServiceOperationsService.CheckInRequest(12_999, 20, "Retry must not overwrite check-in."));

    assertThat(first.publicId()).isEqualTo(retried.publicId());
    assertThat(first.jobCardCode()).isEqualTo(retried.jobCardCode());
    assertThat(retried.odometerKm()).isEqualTo(12_450);
    assertThat(retried.fuelLevelPercent()).isEqualTo(70);
    assertThat(retried.status()).isEqualTo("INSPECTING");
    assertThat(retried.inspectionCount()).isEqualTo(7);
    assertThat(retried.pendingInspectionCount()).isEqualTo(7);

    assertThat(jdbc.queryForObject("""
        select count(*) from service_job_card
        where dealership_id = ? and appointment_id = (
          select id from service_appointment where dealership_id = ? and public_id = ?)
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), appointment.publicId()))
        .isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select count(*) from service_appointment_transition
        where dealership_id = ? and appointment_id = (
          select id from service_appointment where dealership_id = ? and public_id = ?)
          and to_status = 'CHECKED_IN'
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), appointment.publicId()))
        .isEqualTo(1);

    var items = workshop.listInspectionItems(fixture.owner(), first.publicId());
    items.forEach(item -> workshop.updateInspectionItem(fixture.owner(), first.publicId(), item.publicId(),
        new ServiceOperationsService.InspectionUpdate("OK", "Checked during integration test.")));
    var completed = workshop.completeInspection(fixture.owner(), first.publicId(), "Initial inspection complete.");
    assertThat(completed.status()).isEqualTo("ESTIMATE_PENDING");
    assertThat(completed.pendingInspectionCount()).isZero();
  }

  @Test
  void cannotScheduleUsingAnotherDealershipCustomerOrVehicle() {
    Fixture agencyA = createFixture("A");
    Fixture agencyB = createFixture("B");

    assertThatThrownBy(() -> workshop.createAppointment(agencyB.owner(),
        new ServiceOperationsService.AppointmentRequest(
            agencyA.customerPublicId(), agencyA.vehiclePublicId(), Instant.now().plusSeconds(3600),
            60, "Cross-dealership access attempt", "en", "STAFF", null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void cannotFinishInspectionWhileAnyChecklistItemIsPending() {
    Fixture fixture = createFixture("PENDING");
    var appointment = workshop.createAppointment(fixture.owner(),
        new ServiceOperationsService.AppointmentRequest(
            fixture.customerPublicId(), fixture.vehiclePublicId(), Instant.now().plusSeconds(7200),
            30, "Flat tyre concern", "en", "STAFF", null));
    var job = workshop.checkInAppointment(fixture.owner(), appointment.publicId(),
        new ServiceOperationsService.CheckInRequest(null, null, null));
    var oneItem = workshop.listInspectionItems(fixture.owner(), job.publicId()).getFirst();
    workshop.updateInspectionItem(fixture.owner(), job.publicId(), oneItem.publicId(),
        new ServiceOperationsService.InspectionUpdate("OK", "Only the first checklist item is complete."));

    assertThatThrownBy(() -> workshop.completeInspection(fixture.owner(), job.publicId(), null))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("INSPECTING");
  }

  @Test
  void jobCardAndAppointmentAreNotVisibleOutsideTheirDealership() {
    Fixture owner = createFixture("OWNER");
    Fixture other = createFixture("OTHER");
    var appointment = workshop.createAppointment(owner.owner(),
        new ServiceOperationsService.AppointmentRequest(owner.customerPublicId(), owner.vehiclePublicId(),
            Instant.now().plusSeconds(3600), 60, "Brake inspection", "en", "STAFF", null));
    var jobCard = workshop.checkInAppointment(owner.owner(), appointment.publicId(),
        new ServiceOperationsService.CheckInRequest(null, null, null));

    assertThatThrownBy(() -> workshop.getAppointment(other.owner(), appointment.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    assertThatThrownBy(() -> workshop.getJobCard(other.owner(), jobCard.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
  }

  private Fixture createFixture(String suffix) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "WRK-" + suffix + "-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Workshop Test Agency " + suffix);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Workshop Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        code, "Workshop Test Owner", Set.of("OWNER"), Set.of(
            "workshop.read", "workshop.appointment.read", "workshop.appointment.manage",
            "workshop.jobcard.checkin", "workshop.manage", "workshop.jobcard.assign"));

    String customerCode = "CUS-" + unique;
    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Workshop Test Customer', ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, customerCode, "9199000" + unique.substring(0, 4));
    UUID customerPublicId = jdbc.queryForObject(
        "select public_id from customer where dealership_id = ? and id = ?", UUID.class, dealershipId, customerId);

    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(dealership_id, model_code, model_name, variant_name, colour_name, model_year)
        values (?, ?, 'Test Motorcycle', 'Standard', 'Black', 2026) returning id
        """, Long.class, dealershipId, "TEST-" + unique);
    Long vehicleId = jdbc.queryForObject("""
        insert into vehicle_unit(
          dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status)
        values (?, ?, ?, ?, 'SOLD') returning id
        """, Long.class, dealershipId, modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    UUID vehiclePublicId = jdbc.queryForObject(
        "select public_id from vehicle_unit where dealership_id = ? and id = ?", UUID.class, dealershipId, vehicleId);
    jdbc.update("""
        insert into customer_vehicle(
          dealership_id, customer_id, vehicle_unit_id, linked_by_staff_user_id)
        values (?, ?, ?, ?)
        """, dealershipId, customerId, vehicleId, staffId);
    return new Fixture(owner, customerPublicId, vehiclePublicId);
  }

  private record Fixture(StaffPrincipal owner, UUID customerPublicId, UUID vehiclePublicId) {}
}
