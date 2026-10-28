package com.quantaedge.bajaj.workshop;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
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
