package com.quantaedge.bajaj.workshop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.inventory.SparePartsService;
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
  @Autowired private BillingOperationsService billing;
  @Autowired private SparePartsService parts;

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

  @Test
  void invoiceCannotBeCreatedWhenApprovedPartSnapshotNoLongerMatchesReservation() {
    Fixture fixture = createFixture();
    var job = createInspectedJobCard(fixture);
    var initial = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "LABOUR", "Initial labour", BigDecimal.ONE, new BigDecimal("250.00"))
        ), BigDecimal.ZERO, "Initial labour estimate."));
    workshop.recordEstimateDecision(fixture.owner(), job.publicId(), initial.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "INITIAL-" + UUID.randomUUID(), "Initial estimate approved."));
    UUID mechanic = createMechanic(fixture);
    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(mechanic, "TECHNICIAN", "Assigned technician."));
    workshop.startWork(fixture.owner(), job.publicId(), "Start work.");

    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    var part = parts.createPart(fixture.owner(), new SparePartsService.PartRequest(
        "SEAL-" + suffix, "Repair seal " + suffix, "Consumable for invoice reconciliation", "EACH"));
    var supplier = parts.createSupplier(fixture.owner(), new SparePartsService.SupplierRequest(
        "SUP-" + suffix, "Invoice test supplier " + suffix, "Contact",
        "9195" + suffix.substring(0, 6), "invoice-supplier-" + suffix.toLowerCase() + "@example.test",
        null, null));
    parts.receiveStock(fixture.owner(), new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-" + suffix, "part-receipt-" + UUID.randomUUID(), null,
        List.of(new SparePartsService.ReceiptLineRequest(
            part.publicId(), new BigDecimal("5.000"), new BigDecimal("20.00")))));
    var reservation = parts.reservePart(fixture.owner(), job.publicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("2.000"), "part-reserve-" + UUID.randomUUID(), null));

    var partEstimate = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "PART", part.skuCode() + " — " + part.partName(),
                new BigDecimal("2.000"), new BigDecimal("100.00"), reservation.publicId())
        ), BigDecimal.ZERO, "Approved part estimate."));
    workshop.recordEstimateDecision(fixture.owner(), job.publicId(), partEstimate.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "PART-APPROVED-" + UUID.randomUUID(), "Part estimate approved."));

    parts.issuePart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            BigDecimal.ONE, "part-issue-" + UUID.randomUUID(), "One unit issued."));
    parts.returnPart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("0.500"), "part-return-" + UUID.randomUUID(), "Half unit returned after approval."));

    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(
            UUID.fromString(fixture.owner().staffPublicId()), "QUALITY_INSPECTOR", "Quality inspector."));
    var ready = workshop.recordQualityCheck(fixture.owner(), job.publicId(),
        new ServiceOperationsService.QualityCheckRequest(
            true, true, true, true, true, true, true, "Quality passed."));
    assertThat(ready.status()).isEqualTo("READY_FOR_COLLECTION");

    assertThatThrownBy(() -> billing.createInvoice(
        fixture.owner(), job.publicId(), "Should not invoice stale approved part quantity."))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(jdbc.queryForObject("""
        select count(*) from service_invoice
        where dealership_id = ? and job_card_id = (
          select id from service_job_card where dealership_id = ? and public_id = ?)
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), job.publicId()))
        .isZero();
  }

  @Test
  void invoicePartialPaymentsAreIdempotentAndHandoverRequiresZeroBalanceAndAcknowledgement() {
    Fixture fixture = createFixture();
    ServiceOperationsService.JobCardView readyJob = createReadyForInvoice(fixture);
    var draft = billing.createInvoice(fixture.owner(), readyJob.publicId(), "Operational service invoice.");
    assertThat(draft.status()).isEqualTo("DRAFT");
    var invoice = billing.issueInvoice(fixture.owner(), draft.publicId());

    assertThat(invoice.status()).isEqualTo("ISSUED");
    assertThat(invoice.invoiceTotal()).isEqualByComparingTo("1000.00");
    assertThat(invoice.balanceDue()).isEqualByComparingTo("1000.00");
    assertThat(invoice.lines()).hasSize(1);
    assertThat(invoice.customerName()).isEqualTo("Estimate Test Customer");

    var sameInvoice = billing.createInvoice(fixture.owner(), readyJob.publicId(), "Retry should not duplicate.");
    assertThat(sameInvoice.publicId()).isEqualTo(invoice.publicId());
    assertThat(jdbc.queryForObject("""
        select count(*) from service_invoice
        where dealership_id = ? and job_card_id = (
          select id from service_job_card where dealership_id = ? and public_id = ?)
          and status = 'ISSUED'
        """, Integer.class, fixture.owner().dealershipId(),
        fixture.owner().dealershipId(), readyJob.publicId())).isEqualTo(1);

    String firstKey = "pay-1-" + UUID.randomUUID();
    var partial = billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest(firstKey, "UPI",
            new BigDecimal("200.00"), "UPI-REF-200", "Part payment"));
    var afterPartial = billing.getInvoice(fixture.owner(), invoice.publicId());
    assertThat(afterPartial.paidAmount()).isEqualByComparingTo("200.00");
    assertThat(afterPartial.balanceDue()).isEqualByComparingTo("800.00");

    var replay = billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest(firstKey, "UPI",
            new BigDecimal("200.00"), "UPI-REF-200", "Part payment"));
    assertThat(replay.publicId()).isEqualTo(partial.publicId());
    assertThat(billing.getInvoice(fixture.owner(), invoice.publicId()).paidAmount()).isEqualByComparingTo("200.00");

    assertThatThrownBy(() -> billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest("overpay-" + UUID.randomUUID(), "CASH",
            new BigDecimal("800.01"), null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));

    var reversed = billing.reversePayment(fixture.owner(), partial.publicId(),
        new BillingOperationsService.PaymentReversalRequest("Wrong amount entered", "REV-REF-1"));
    assertThat(reversed.status()).isEqualTo("REVERSED");
    var afterReversal = billing.getInvoice(fixture.owner(), invoice.publicId());
    assertThat(afterReversal.paidAmount()).isEqualByComparingTo("0.00");
    assertThat(afterReversal.balanceDue()).isEqualByComparingTo("1000.00");
    assertThat(billing.getPayment(fixture.owner(), partial.publicId()).reversalReason()).isEqualTo("Wrong amount entered");

    var newPartial = billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest("pay-2-" + UUID.randomUUID(), "CASH",
            new BigDecimal("400.00"), null, "Cash part payment"));
    assertThat(billing.getInvoice(fixture.owner(), invoice.publicId()).balanceDue()).isEqualByComparingTo("600.00");
    assertThatThrownBy(() -> billing.deliverJobCard(fixture.owner(), readyJob.publicId(),
        new BillingOperationsService.HandoverRequest(
            "Estimate Test Customer", true, "IN_PERSON", null, "Customer received vehicle.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

    var finalPayment = billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest("pay-3-" + UUID.randomUUID(), "CARD",
            new BigDecimal("600.00"), "CARD-REF-3", "Balance settlement"));
    assertThat(billing.getInvoice(fixture.owner(), invoice.publicId()).balanceDue()).isEqualByComparingTo("0.00");

    assertThatThrownBy(() -> billing.deliverJobCard(fixture.owner(), readyJob.publicId(),
        new BillingOperationsService.HandoverRequest(
            "Estimate Test Customer", false, "IN_PERSON", null, "Customer acknowledgement missing.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));

    var delivered = billing.deliverJobCard(fixture.owner(), readyJob.publicId(),
        new BillingOperationsService.HandoverRequest(
            "Estimate Test Customer", true, "SIGNED_FORM", "HANDOVER-FORM-77", "Vehicle handed over."));
    assertThat(delivered.deliveredAt()).isNotNull();
    assertThat(workshop.getJobCard(fixture.owner(), readyJob.publicId()).status()).isEqualTo("DELIVERED");
    assertThat(jdbc.queryForObject("""
        select count(*) from service_delivery_handover
        where dealership_id = ? and job_card_id = (
          select id from service_job_card where dealership_id = ? and public_id = ?)
          and customer_acknowledged = true and acknowledgement_method = 'SIGNED_FORM'
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), readyJob.publicId()))
        .isEqualTo(1);

    var repeatedDelivery = billing.deliverJobCard(fixture.owner(), readyJob.publicId(),
        new BillingOperationsService.HandoverRequest(
            "Estimate Test Customer", true, "SIGNED_FORM", "HANDOVER-FORM-77", "Retry."));
    assertThat(repeatedDelivery.publicId()).isEqualTo(delivered.publicId());
    assertThat(jdbc.queryForObject("""
        select count(*) from service_delivery_handover
        where dealership_id = ? and job_card_id = (
          select id from service_job_card where dealership_id = ? and public_id = ?)
        """, Integer.class, fixture.owner().dealershipId(), fixture.owner().dealershipId(), readyJob.publicId()))
        .isEqualTo(1);

    assertThatThrownBy(() -> billing.reversePayment(fixture.owner(), finalPayment.publicId(),
        new BillingOperationsService.PaymentReversalRequest("Attempt post-handover reversal", "REV-AFTER")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
    assertThat(newPartial.status()).isEqualTo("RECORDED");
  }

  @Test
  void paymentIdempotencyKeyIsDealershipWideAndRejectsChangedRequestPayload() {
    Fixture fixture = createFixture();
    ServiceOperationsService.JobCardView readyJob = createReadyForInvoice(fixture);
    var draft = billing.createInvoice(fixture.owner(), readyJob.publicId(), "Idempotency test invoice.");
    var invoice = billing.issueInvoice(fixture.owner(), draft.publicId());
    String key = "dealership-wide-" + UUID.randomUUID();

    var first = billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest(key, "UPI", new BigDecimal("100.00"), "UPI-100", null));

    assertThatThrownBy(() -> billing.recordPayment(fixture.owner(), invoice.publicId(),
        new BillingOperationsService.PaymentRequest(key, "UPI", new BigDecimal("101.00"), "UPI-100", null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

    Fixture otherDealership = createFixture();
    assertThatThrownBy(() -> billing.getInvoice(otherDealership.owner(), invoice.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    assertThat(billing.listPayments(fixture.owner(), invoice.publicId()))
        .extracting(BillingOperationsService.PaymentView::publicId)
        .containsExactly(first.publicId());
  }

  private ServiceOperationsService.JobCardView createReadyForInvoice(Fixture fixture) {
    var job = createInspectedJobCard(fixture);
    var estimate = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "LABOUR", "Workshop labour", BigDecimal.ONE, new BigDecimal("1000.00"))
        ), BigDecimal.ZERO, "Operational service estimate."));
    workshop.recordEstimateDecision(fixture.owner(), job.publicId(), estimate.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "ESTIMATE-SIGN-" + UUID.randomUUID(), "Approved by customer."));
    UUID mechanic = createMechanic(fixture);
    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(mechanic, "TECHNICIAN", "Assigned technician."));
    workshop.startWork(fixture.owner(), job.publicId(), "Repair started.");
    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(
            UUID.fromString(fixture.owner().staffPublicId()), "QUALITY_INSPECTOR", "Assigned for QA."));
    return workshop.recordQualityCheck(fixture.owner(), job.publicId(),
        new ServiceOperationsService.QualityCheckRequest(
            true, true, true, true, true, true, true, "Passed."));
  }

  @Test
  void partReservationSnapshotsAreFrozenOnEstimateRevisionAndApprovalResumesWork() {
    Fixture fixture = createFixture();
    var job = createInspectedJobCard(fixture);
    var initial = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "LABOUR", "Initial labour", BigDecimal.ONE, new BigDecimal("500.00"))
        ), BigDecimal.ZERO, "Initial estimate before part reservation."));

    workshop.recordEstimateDecision(fixture.owner(), job.publicId(), initial.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "INITIAL-" + UUID.randomUUID(), "Initial estimate approved."));
    UUID mechanic = createMechanic(fixture);
    workshop.assignStaff(fixture.owner(), job.publicId(),
        new ServiceOperationsService.AssignmentRequest(mechanic, "TECHNICIAN", "Assigned to begin repair."));
    assertThat(workshop.startWork(fixture.owner(), job.publicId(), "Start initial work.").status())
        .isEqualTo("IN_PROGRESS");

    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    var part = parts.createPart(fixture.owner(), new SparePartsService.PartRequest(
        "FILTER-" + suffix, "Oil filter " + suffix, "Test consumable", "EACH"));
    var supplier = parts.createSupplier(fixture.owner(), new SparePartsService.SupplierRequest(
        "SUP-" + suffix, "Parts supplier " + suffix, "Supplier contact",
        "9196" + suffix.substring(0, 6), "supplier-" + suffix.toLowerCase() + "@example.test",
        null, null));
    parts.receiveStock(fixture.owner(), new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-" + suffix, "receipt-" + UUID.randomUUID(), "Received for revision test",
        List.of(new SparePartsService.ReceiptLineRequest(
            part.publicId(), new BigDecimal("10.000"), new BigDecimal("20.00")))));

    var reservation = parts.reservePart(fixture.owner(), job.publicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("3.000"), "reserve-" + UUID.randomUUID(), "Planned for repair"));
    var plannedRevision = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "PART", part.skuCode() + " — " + part.partName(),
                new BigDecimal("3.000"), new BigDecimal("100.00"), reservation.publicId())
        ), BigDecimal.ZERO, "Approve the planned part quantity before issue."));
    workshop.recordEstimateDecision(fixture.owner(), job.publicId(), plannedRevision.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "PLANNED-" + UUID.randomUUID(), "Planned parts approved."));
    parts.issuePart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("2.000"), "issue-" + UUID.randomUUID(), "Issued two filters to technician"));
    var afterReturn = parts.returnPart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("0.500"), "return-" + UUID.randomUUID(), "Returned one half unit in the test ledger"));

    assertThat(afterReturn.quantityReserved()).isEqualByComparingTo("3.000");
    assertThat(afterReturn.quantityIssued()).isEqualByComparingTo("2.000");
    assertThat(afterReturn.quantityReturned()).isEqualByComparingTo("0.500");
    assertThat(afterReturn.quantityReleased()).isEqualByComparingTo("0.000");

    assertThatThrownBy(() -> workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "PART", part.skuCode() + " — " + part.partName(),
                new BigDecimal("3.000"), new BigDecimal("100.00"), reservation.publicId())
        ), BigDecimal.ZERO, "This stale quantity must be rejected.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("IN_PROGRESS");

    var revision = workshop.createEstimate(fixture.owner(), job.publicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "PART", part.skuCode() + " — " + part.partName(),
                new BigDecimal("2.500"), new BigDecimal("100.00"), reservation.publicId()),
            new ServiceOperationsService.EstimateLineInput(
                "LABOUR", "Additional replacement labour", BigDecimal.ONE, new BigDecimal("150.00"))
        ), BigDecimal.ZERO, "Revision includes the reserved part line and additional labour."));

    assertThat(revision.revision()).isEqualTo(3);
    assertThat(revision.status()).isEqualTo("AWAITING_CUSTOMER");
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("AWAITING_APPROVAL");
    var partLine = revision.lines().stream()
        .filter(line -> line.sourceReservationPublicId() != null)
        .findFirst().orElseThrow();
    assertThat(partLine.sourceReservationPublicId()).isEqualTo(reservation.publicId());
    assertThat(partLine.sourceReservationCode()).isEqualTo(reservation.reservationCode());
    assertThat(partLine.quantity()).isEqualByComparingTo("2.500");
    assertThat(partLine.sourceQuantityReserved()).isEqualByComparingTo("3.000");
    assertThat(partLine.sourceQuantityIssued()).isEqualByComparingTo("2.000");
    assertThat(partLine.sourceQuantityReturned()).isEqualByComparingTo("0.500");
    assertThat(partLine.sourceQuantityReleased()).isEqualByComparingTo("0.000");
    assertThat(partLine.sourceUnitCostSnapshot()).isEqualByComparingTo("20.00");
    assertThat(partLine.sourceSnapshotAt()).isNotNull();
    assertThat(partLine.unitPrice()).isEqualByComparingTo("100.00");
    assertThat(partLine.lineTotal()).isEqualByComparingTo("250.00");

    // Reservation stock cost is a snapshot, not the customer-facing unit price.
    assertThat(partLine.sourceUnitCostSnapshot()).isNotEqualByComparingTo(partLine.unitPrice());
    var approvedRevision = workshop.recordEstimateDecision(fixture.owner(), job.publicId(), revision.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "REVISION-" + UUID.randomUUID(), "Revised estimate approved."));
    assertThat(approvedRevision.status()).isEqualTo("APPROVED");
    assertThat(workshop.getJobCard(fixture.owner(), job.publicId()).status()).isEqualTo("IN_PROGRESS");
    assertThat(workshop.listEstimates(fixture.owner(), job.publicId()))
        .filteredOn(estimate -> estimate.publicId().equals(initial.publicId())
            || estimate.publicId().equals(plannedRevision.publicId()))
        .extracting(ServiceOperationsService.EstimateView::status)
        .containsOnly("SUPERSEDED");
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
            "workshop.jobcard.assign", "parts.read", "parts.manage", "parts.receive",
            "parts.reserve", "parts.issue", "parts.return"));

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
