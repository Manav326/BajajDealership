package com.quantaedge.bajaj.workshop;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/workshop")
public class ServiceOperationsController {
  private final ServiceOperationsService workshop;

  public ServiceOperationsController(ServiceOperationsService workshop) {
    this.workshop = workshop;
  }

  @GetMapping("/customers")
  @PreAuthorize("hasAuthority('workshop.appointment.read')")
  public List<ServiceOperationsService.WorkshopCustomerOption> customerOptions(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return workshop.listCustomerOptions(principal, q);
  }

  @GetMapping("/customers/{customerPublicId}/vehicles")
  @PreAuthorize("hasAuthority('workshop.appointment.read')")
  public List<ServiceOperationsService.WorkshopVehicleOption> customerVehicles(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID customerPublicId) {
    return workshop.listCustomerVehicles(principal, customerPublicId);
  }

  @GetMapping("/staff-options")
  @PreAuthorize("hasAuthority('workshop.jobcard.assign')")
  public List<ServiceOperationsService.StaffOption> staffOptions(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam @Pattern(regexp = "SERVICE_ADVISOR|TECHNICIAN|QUALITY_INSPECTOR") String assignmentRole,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return workshop.listAssignableStaff(principal, assignmentRole, q);
  }

  @GetMapping("/appointments")
  @PreAuthorize("hasAuthority('workshop.appointment.read')")
  public ServiceOperationsService.Page<ServiceOperationsService.AppointmentView> appointments(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return workshop.listAppointments(principal, page, pageSize, status, q);
  }

  @PostMapping("/appointments")
  @PreAuthorize("hasAuthority('workshop.appointment.manage')")
  public ServiceOperationsService.AppointmentView createAppointment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody AppointmentRequest request) {
    return workshop.createAppointment(principal, request.toServiceRequest());
  }

  @GetMapping("/appointments/{publicId}")
  @PreAuthorize("hasAuthority('workshop.appointment.read')")
  public ServiceOperationsService.AppointmentView getAppointment(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.getAppointment(principal, publicId);
  }

  @PostMapping("/appointments/{publicId}/confirm")
  @PreAuthorize("hasAuthority('workshop.appointment.manage')")
  public ServiceOperationsService.AppointmentView confirmAppointment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) NoteRequest request) {
    return workshop.confirmAppointment(principal, publicId, request == null ? null : request.note());
  }

  @PostMapping("/appointments/{publicId}/cancel")
  @PreAuthorize("hasAuthority('workshop.appointment.manage')")
  public ServiceOperationsService.AppointmentView cancelAppointment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody CancelRequest request) {
    return workshop.cancelAppointment(principal, publicId, request.reason());
  }

  @PostMapping("/appointments/{publicId}/check-in")
  @PreAuthorize("hasAuthority('workshop.jobcard.checkin')")
  public ServiceOperationsService.JobCardView checkInAppointment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) CheckInRequest request) {
    return workshop.checkInAppointment(principal, publicId,
        request == null ? null : request.toServiceRequest());
  }

  @GetMapping("/job-cards")
  @PreAuthorize("hasAuthority('workshop.read')")
  public ServiceOperationsService.Page<ServiceOperationsService.JobCardView> jobCards(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return workshop.listJobCards(principal, page, pageSize, status, q);
  }

  @GetMapping("/job-cards/{publicId}")
  @PreAuthorize("hasAuthority('workshop.read')")
  public ServiceOperationsService.JobCardView getJobCard(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.getJobCard(principal, publicId);
  }

  @GetMapping("/job-cards/{publicId}/estimates")
  @PreAuthorize("hasAuthority('workshop.read')")
  public List<ServiceOperationsService.EstimateView> estimates(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.listEstimates(principal, publicId);
  }

  @PostMapping("/job-cards/{publicId}/estimates")
  @PreAuthorize("hasAuthority('workshop.estimate.create')")
  public ServiceOperationsService.EstimateView createEstimate(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody EstimateRequest request) {
    List<ServiceOperationsService.EstimateLineInput> lines = request.lines().stream()
        .map(line -> new ServiceOperationsService.EstimateLineInput(
            line.lineType(), line.description(), line.quantity(), line.unitPrice()))
        .toList();
    return workshop.createEstimate(principal, publicId,
        new ServiceOperationsService.EstimateRequest(lines, request.discountAmount(), request.customerMessage()));
  }

  @GetMapping("/job-cards/{publicId}/estimates/{estimatePublicId}")
  @PreAuthorize("hasAuthority('workshop.read')")
  public ServiceOperationsService.EstimateView getEstimate(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @PathVariable UUID estimatePublicId) {
    return workshop.getEstimate(principal, publicId, estimatePublicId);
  }

  @PostMapping("/job-cards/{publicId}/estimates/{estimatePublicId}/decision")
  @PreAuthorize("hasAuthority('workshop.approve_estimate')")
  public ServiceOperationsService.EstimateView estimateDecision(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @PathVariable UUID estimatePublicId,
      @Valid @RequestBody EstimateDecisionRequest request) {
    return workshop.recordEstimateDecision(principal, publicId, estimatePublicId,
        new ServiceOperationsService.EstimateDecisionRequest(
            request.decision(), request.evidenceMethod(), request.evidenceReference(), request.note()));
  }

  @PostMapping("/job-cards/{publicId}/start-work")
  @PreAuthorize("hasAuthority('workshop.jobcard.work')")
  public ServiceOperationsService.JobCardView startWork(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) NoteRequest request) {
    return workshop.startWork(principal, publicId, request == null ? null : request.note());
  }

  @PostMapping("/job-cards/{publicId}/quality-check")
  @PreAuthorize("hasAuthority('workshop.quality_check')")
  public ServiceOperationsService.JobCardView qualityCheck(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody QualityCheckRequest request) {
    return workshop.recordQualityCheck(principal, publicId,
        new ServiceOperationsService.QualityCheckRequest(
            request.brakesOk(), request.lightsOk(), request.hornOk(), request.noVisibleLeaks(),
            request.roadTestOk(), request.toolsRemoved(), request.customerConcernResolved(), request.notes()));
  }

  @PostMapping("/job-cards/{publicId}/invoice")
  @PreAuthorize("hasAuthority('billing.invoice.issue')")
  public ServiceOperationsService.InvoiceView issueInvoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.createInvoice(principal, publicId);
  }

  @GetMapping("/job-cards/{publicId}/invoice")
  @PreAuthorize("hasAuthority('billing.invoice.read')")
  public ServiceOperationsService.InvoiceView invoiceForJob(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.getInvoiceForJob(principal, publicId);
  }

  @GetMapping("/invoices/{invoicePublicId}")
  @PreAuthorize("hasAuthority('billing.invoice.read')")
  public ServiceOperationsService.InvoiceView invoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return workshop.getInvoice(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('billing.payment.record')")
  public ServiceOperationsService.PaymentResult recordPayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID invoicePublicId,
      @Valid @RequestBody PaymentRequest request) {
    return workshop.recordPayment(principal, invoicePublicId,
        new ServiceOperationsService.PaymentRequest(
            request.idempotencyKey(), request.paymentMethod(), request.amount(),
            request.paymentReference(), request.note()));
  }

  @PostMapping("/payments/{paymentPublicId}/reverse")
  @PreAuthorize("hasAuthority('billing.payment.reverse')")
  public ServiceOperationsService.PaymentResult reversePayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID paymentPublicId,
      @Valid @RequestBody PaymentReversalRequest request) {
    return workshop.reversePayment(principal, paymentPublicId,
        new ServiceOperationsService.PaymentReversalRequest(request.reason(), request.externalReference()));
  }

  @PostMapping("/job-cards/{publicId}/deliver")
  @PreAuthorize("hasAuthority('workshop.jobcard.deliver')")
  public ServiceOperationsService.JobCardView deliverVehicle(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody DeliveryRequest request) {
    return workshop.deliverVehicle(principal, publicId,
        new ServiceOperationsService.DeliveryRequest(
            request.deliveredToName(), request.customerAcknowledged(), request.acknowledgementMethod(),
            request.acknowledgementReference(), request.note()));
  }

  @GetMapping("/job-cards/{publicId}/inspection")
  @PreAuthorize("hasAuthority('workshop.read')")
  public List<ServiceOperationsService.InspectionItemView> inspection(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.listInspectionItems(principal, publicId);
  }

  @PutMapping("/job-cards/{publicId}/inspection/{itemPublicId}")
  @PreAuthorize("hasAuthority('workshop.manage')")
  public ServiceOperationsService.InspectionItemView updateInspection(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @PathVariable UUID itemPublicId,
      @Valid @RequestBody InspectionUpdate request) {
    return workshop.updateInspectionItem(principal, publicId, itemPublicId,
        new ServiceOperationsService.InspectionUpdate(request.status(), request.notes()));
  }

  @PostMapping("/job-cards/{publicId}/complete-inspection")
  @PreAuthorize("hasAuthority('workshop.manage')")
  public ServiceOperationsService.JobCardView completeInspection(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) NoteRequest request) {
    return workshop.completeInspection(principal, publicId, request == null ? null : request.note());
  }

  @GetMapping("/job-cards/{publicId}/assignments")
  @PreAuthorize("hasAuthority('workshop.read')")
  public List<ServiceOperationsService.AssignmentView> assignments(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return workshop.listAssignments(principal, publicId);
  }

  @PutMapping("/job-cards/{publicId}/assignment")
  @PreAuthorize("hasAuthority('workshop.jobcard.assign')")
  public ServiceOperationsService.AssignmentView assign(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody AssignmentRequest request) {
    return workshop.assignStaff(principal, publicId,
        new ServiceOperationsService.AssignmentRequest(request.staffPublicId(), request.assignmentRole(), request.note()));
  }

  public record AppointmentRequest(
      @NotNull UUID customerPublicId,
      @NotNull UUID vehiclePublicId,
      @NotNull java.time.Instant scheduledFor,
      @Min(15) @Max(480) Integer slotMinutes,
      @NotBlank @Size(max = 3000) String customerConcern,
      @Pattern(regexp = "hi|en|hinglish") String customerLanguage,
      @Pattern(regexp = "STAFF|PHONE|WALK_IN|CUSTOMER_WEB|CUSTOMER_APP") String source,
      @Size(max = 3000) String staffNotes) {
    ServiceOperationsService.AppointmentRequest toServiceRequest() {
      return new ServiceOperationsService.AppointmentRequest(
          customerPublicId, vehiclePublicId, scheduledFor, slotMinutes, customerConcern,
          customerLanguage, source, staffNotes);
    }
  }

  public record EstimateLineRequest(
      @NotBlank @Pattern(regexp = "PART|LABOUR|OTHER") String lineType,
      @NotBlank @Size(max = 300) String description,
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity,
      @NotNull @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal unitPrice) {}
  public record EstimateRequest(
      @NotNull @Size(min = 1, max = 100) List<@Valid EstimateLineRequest> lines,
      @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal discountAmount,
      @Size(max = 2000) String customerMessage) {}
  public record EstimateDecisionRequest(
      @NotBlank @Pattern(regexp = "APPROVED|DECLINED|REVISION_REQUESTED") String decision,
      @NotBlank @Pattern(regexp = "OTP|SIGNED_FORM|IN_PERSON|PHONE_RECORD|WRITTEN_MESSAGE") String evidenceMethod,
      @Size(max = 160) String evidenceReference,
      @Size(max = 1000) String note) {}
  public record QualityCheckRequest(
      @NotNull Boolean brakesOk, @NotNull Boolean lightsOk, @NotNull Boolean hornOk,
      @NotNull Boolean noVisibleLeaks, @NotNull Boolean roadTestOk, @NotNull Boolean toolsRemoved,
      @NotNull Boolean customerConcernResolved, @Size(max = 1500) String notes) {}

  public record PaymentRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @NotBlank @Pattern(regexp = "CASH|UPI|BANK_TRANSFER|CARD|OTHER") String paymentMethod,
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @Size(max = 160) String paymentReference,
      @Size(max = 1000) String note) {}
  public record DeliveryRequest(
      @NotBlank @Size(max = 160) String deliveredToName,
      @NotNull Boolean customerAcknowledged,
      @NotBlank @Pattern(regexp = "IN_PERSON|SIGNED_FORM|OTP_REFERENCE|WRITTEN_MESSAGE") String acknowledgementMethod,
      @Size(max = 160) String acknowledgementReference,
      @Size(max = 1000) String note) {}
    public record PaymentReversalRequest(
      @NotBlank @Size(max = 500) String reason,
      @Size(max = 160) String externalReference) {}
    public record NoteRequest(@Size(max = 500) String note) {}
  public record CancelRequest(@NotBlank @Size(max = 500) String reason) {}
  public record CheckInRequest(
      @Min(0) Integer odometerKm,
      @Min(0) @Max(100) Integer fuelLevelPercent,
      @Size(max = 3000) String checkinNotes) {
    ServiceOperationsService.CheckInRequest toServiceRequest() {
      return new ServiceOperationsService.CheckInRequest(odometerKm, fuelLevelPercent, checkinNotes);
    }
  }
  public record InspectionUpdate(
      @NotBlank @Pattern(regexp = "PENDING|OK|ATTENTION|NOT_APPLICABLE") String status,
      @Size(max = 1000) String notes) {}
  public record AssignmentRequest(
      @NotNull UUID staffPublicId,
      @NotBlank @Pattern(regexp = "SERVICE_ADVISOR|TECHNICIAN|QUALITY_INSPECTOR") String assignmentRole,
      @Size(max = 500) String note) {}
}
