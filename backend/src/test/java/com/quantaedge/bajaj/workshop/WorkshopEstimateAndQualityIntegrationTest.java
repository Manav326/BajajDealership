package com.quantaedge.bajaj.workshop;

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
class WorkshopEstimateAndQualityIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ServiceOperationsService workshop;

  @Test
  void estimateNeedsEvidenceAndApprovalAndAssignedStaffBeforeQualityGate() {
    Fixture fixture = createFixture();
    ServiceOperationsService.JobCardView job = createInspectedJobCard(fixture);

    var estimate = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput("PART", "Brake pads", BigDecimal.ONE, new BigDecimal("1234.56")),
            new ServiceOperationsService.EstimateLineInput("LABOUR", "Brake replacement labour", new BigDecimal("1.5"), new BigDecimal("500.00"))
        ), new BigDecimal("100.00"), "Includes parts and labour. Customer approval is required before repair."));
    assertThat(estimate.revision()).isEqualTo(1);
    assertThat(estimate.status()).isEqualTo("AWAITING_CUSTOMER");
    assertThat(estimate.partsSubtotal()).isEqualByComparingTo("1234.56");
    assertThat(estimate.labourSubtotal()).isEqualByComparingTo("750.00");
    assertThat(estimate.estimatedTotal()).isEqualByComparingTo("1884.56");
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("AWAITING_APPROVAL");

    var decision = workshop.recordEstimateDecision(fixture.owner(), job.publicId(), estimate.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "FORM-TEST-1001", "Customer signed the estimate form in person."));
    assertThat(decision.status()).isEqualTo("APPROVED");
    assertThat(decision.decisions()).hasSize(1);
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("APPROVED");

    assertThatThrownBy(() -> workshop.startWork(fixture.owner(), job.publicId(), "Attempt before technician assignment"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

    UUID mechanicPublicId = createMechanic(fixture);
    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(mechanicPublicId, "TECHNICIAN", "Assigned for repair."));
    assertThat(workshop.startWork(fixture.owner(), job.publicId(), "Approved repair started.").status())
        .isEqualTo("IN_PROGRESS");

    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(
            UUID.fromString(fixture.owner().staffPublicId()), "QUALITY_INSPECTOR", "Independent quality check."));
    var failedQuality = workshop.recordQualityCheck(fixture.owner(), job.publicId(),
        new ServiceOperationsService.QualityCheckRequest(
            false, true, true, true, true, true, true, "Brake feel needs another adjustment."));
    assertThat(failedQuality.status()).isEqualTo("IN_PROGRESS");

    var passedQuality = workshop.recordQualityCheck(fixture.owner(), job.publicId(),
        new ServiceOperationsService.QualityCheckRequest(
            true, true, true, true, true, true, true, "All quality checklist items passed."));
    assertThat(passedQuality.status()).isEqualTo("READY_FOR_COLLECTION");
    assertThat(jdbc.queryForObject("""
        select count(*) from service_quality_check
        where dealership_id = ? and job_card_id = (
          select id from service_job_card where dealership_id = ? and public_id = ?)
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), job.publicId()))
        .isEqualTo(2);
    assertThat(jdbc.queryForObject("""
        select count(*) from service_job_transition
        where dealership_id = ? and job_card_id = (
          select id from service_job_card where dealership_id = ? and public_id = ?)
          and action = 'QUALITY_CHECK_RECORDED'
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), job.publicId()))
        .isEqualTo(2);
  }

  @Test
  void revisionRequestSupersedesPreviousEstimateWithoutDeletingDecisionHistory() {
    Fixture fixture = createFixture();
    ServiceOperationsService.JobCardView job = createInspectedJobCard(fixture);
    var first = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput("OTHER", "Initial diagnostic", BigDecimal.ONE, new BigDecimal("500.00"))
        ), BigDecimal.ZERO, "Initial estimate."));

    var requestedRevision = workshop.recordEstimateDecision(fixture.owner(), job.publicId(), first.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "REVISION_REQUESTED", "WRITTEN_MESSAGE", "MSG-77", "Customer asked for an itemised estimate."));
    assertThat(requestedRevision.status()).isEqualTo("SUPERSEDED");
    assertThat(requestedRevision.decisions()).hasSize(1);
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("ESTIMATE_PENDING");

    var second = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput("PART", "Filter", BigDecimal.ONE, new BigDecimal("220.00")),
            new ServiceOperationsService.EstimateLineInput("LABOUR", "Replacement labour", BigDecimal.ONE, new BigDecimal("180.00"))
        ), BigDecimal.ZERO, "Revised itemised estimate."));
    assertThat(second.revision()).isEqualTo(2);

    var approved = workshop.recordEstimateDecision(fixture.owner(), job.publicId(), second.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "IN_PERSON", null, "Customer approved revised itemised estimate in person."));
    assertThat(approved.status()).isEqualTo("APPROVED");
    assertThat(workshop.listEstimates(fixture.owner(), job.publicId()))
        .extracting(ServiceOperationsService.EstimateView::revision)
        .containsExactly(2, 1);
  }

  @Test
  void qualityCheckRequiresAssignedInspectorAndCompleteChecklist() {
    Fixture fixture = createFixture();
    ServiceOperationsService.JobCardView job = createInspectedJobCard(fixture);
    var estimate = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput("LABOUR", "Service labour", BigDecimal.ONE, new BigDecimal("600.00"))
        ), BigDecimal.ZERO, null));
    workshop.recordEstimateDecision(fixture.owner(), job.publicId(), estimate.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "PHONE_RECORD", "CALL-10", "Customer approval recorded during the call."));
    UUID mechanicPublicId = createMechanic(fixture);
    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(mechanicPublicId, "TECHNICIAN", null));
    workshop.startWork(fixture.owner(), job.publicId(), null);

    assertThatThrownBy(() -> workshop.recordQualityCheck(fixture.owner(), job.publicId(),
        new ServiceOperationsService.QualityCheckRequest(true, true, true, true, true, true, true, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
  }

  private ServiceOperationsService.JobCardView createInspectedJobCard(Fixture fixture) {
    var appointment = workshop.createAppointment(fixture.owner(),
        new ServiceOperationsService.AppointmentRequest(
            fixture.customerPublicId(), fixture.vehiclePublicId(), Instant.now().plusSeconds(7200),
            60, "Engine noise at acceleration", "en", "STAFF", null));
    var job = workshop.checkInAppointment(fixture.owner(), appointment.publicId(),
        new ServiceOperationsService.CheckInRequest(1234, 60, "Created for estimate integration test."));
    for (var item : workshop.listInspectionItems(fixture.owner(), job.publicId())) {
      workshop.updateInspectionItem(fixture.owner(), job.publicId(), item.publicId(),
          new ServiceOperationsService.InspectionUpdate("OK", "Checked."));
    }
    return workshop.completeInspection(fixture.owner(), job.publicId(), "Inspection complete.");
  }

  private UUID createMechanic(Fixture fixture) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toLowerCase();
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Assigned Mechanic', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, fixture.owner().dealershipId(), "mechanic-" + unique + "@example.test");
    Long roleId = jdbc.queryForObject("select id from role where code='MECHANIC'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, fixture.owner().dealershipId(), staffId, roleId);
    return jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?",
        UUID.class, fixture.owner().dealershipId(), staffId);
  }

  private Fixture createFixture() {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "EST-" + unique;
    Long dealershipId = jdbc.queryForObject(
        "insert into dealership(code, name) values (?, ?) returning id",
        Long.class, code, "Estimate Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Estimate Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "estimate-owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)",
        dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject("select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject("select public_id from staff_user where id = ?", UUID.class, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        code, "Estimate Test Owner", Set.of("OWNER"), Set.of(
            "workshop.read", "workshop.appointment.read", "workshop.appointment.manage",
            "workshop.jobcard.checkin", "workshop.manage", "workshop.estimate.create",
            "workshop.approve_estimate", "workshop.jobcard.work", "workshop.quality_check",
            "workshop.jobcard.assign"));

    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Estimate Test Customer', ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, "CUS-" + unique, "919901" + unique.substring(0, 4));
    UUID customerPublicId = jdbc.queryForObject(
        "select public_id from customer where dealership_id=? and id=?", UUID.class, dealershipId, customerId);
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(dealership_id, model_code, model_name, variant_name, colour_name, model_year)
        values (?, ?, 'Test Motorcycle', 'Standard', 'Black', 2026) returning id
        """, Long.class, dealershipId, "MODEL-" + unique);
    Long vehicleId = jdbc.queryForObject("""
        insert into vehicle_unit(dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status)
        values (?, ?, ?, ?, 'SOLD') returning id
        """, Long.class, dealershipId, modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    UUID vehiclePublicId = jdbc.queryForObject(
        "select public_id from vehicle_unit where dealership_id=? and id=?", UUID.class, dealershipId, vehicleId);
    jdbc.update("""
        insert into customer_vehicle(dealership_id, customer_id, vehicle_unit_id, linked_by_staff_user_id)
        values (?, ?, ?, ?)
        """, dealershipId, customerId, vehicleId, staffId);
    return new Fixture(owner, customerPublicId, vehiclePublicId);
  }

  private record Fixture(StaffPrincipal owner, UUID customerPublicId, UUID vehiclePublicId) {}
}
