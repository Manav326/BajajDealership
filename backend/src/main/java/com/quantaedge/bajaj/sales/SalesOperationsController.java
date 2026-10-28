package com.quantaedge.bajaj.sales;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/sales")
public class SalesOperationsController {
  private final SalesOperationsService sales;

  public SalesOperationsController(SalesOperationsService sales) {
    this.sales = sales;
  }

  @GetMapping("/enquiries")
  @PreAuthorize("hasAuthority('sales.read')")
  public SalesOperationsService.Page<SalesOperationsService.EnquiryView> enquiries(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q,
      @RequestParam(required = false) String status) {
    return sales.listEnquiries(principal, page, pageSize, q, status);
  }

  @PostMapping("/enquiries")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.EnquiryView createEnquiry(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody EnquiryRequest request) {
    return sales.createEnquiry(principal, new SalesOperationsService.EnquiryRequest(
        request.customerPublicId(), request.interestedModelPublicId(), request.assignedStaffPublicId(),
        request.leadSource(), request.contactPreference(), request.nextFollowUpAt(), request.note()));
  }

  @GetMapping("/enquiries/{publicId}")
  @PreAuthorize("hasAuthority('sales.read')")
  public SalesOperationsService.EnquiryDetailView enquiryDetail(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return sales.getEnquiryDetail(principal, publicId);
  }

  @PostMapping("/enquiries/{publicId}/status")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.EnquiryView status(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody StatusRequest request) {
    return sales.changeStatus(principal, publicId,
        new SalesOperationsService.StatusRequest(request.status(), request.note()));
  }

  @PostMapping("/enquiries/{publicId}/follow-up")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.EnquiryView followUp(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody FollowUpRequest request) {
    return sales.setFollowUp(principal, publicId,
        new SalesOperationsService.FollowUpRequest(request.followUpAt(), request.note()));
  }

  @PostMapping("/enquiries/{publicId}/test-rides")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.TestRideView scheduleTestRide(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody TestRideRequest request) {
    return sales.scheduleTestRide(principal, publicId,
        new SalesOperationsService.TestRideRequest(
            request.vehicleUnitPublicId(), request.scheduledStart(), request.scheduledEnd(), request.notes()));
  }

  @PostMapping("/test-rides/{publicId}/check-out")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.TestRideView checkOutTestRide(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) NoteRequest request) {
    return sales.checkOutTestRide(principal, publicId, request == null ? null : request.note());
  }

  @PostMapping("/test-rides/{publicId}/complete")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.TestRideView completeTestRide(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) NoteRequest request) {
    return sales.completeTestRide(principal, publicId, request == null ? null : request.note());
  }

  @PostMapping("/test-rides/{publicId}/cancel")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.TestRideView cancelTestRide(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody CancellationRequest request) {
    return sales.cancelTestRide(principal, publicId, request.reason());
  }

  @GetMapping("/bookings")
  @PreAuthorize("hasAuthority('sales.read')")
  public SalesOperationsService.Page<SalesOperationsService.BookingView> bookings(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return sales.listBookings(principal, page, pageSize, q);
  }

  @GetMapping("/bookings/{publicId}")
  @PreAuthorize("hasAuthority('sales.read')")
  public SalesOperationsService.BookingView booking(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return sales.getBooking(principal, publicId);
  }

  @PostMapping("/enquiries/{publicId}/bookings")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.BookingView createBooking(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody BookingRequest request) {
    return sales.createBooking(principal, publicId,
        new SalesOperationsService.BookingRequest(request.vehicleUnitPublicId(), request.notes()));
  }

  @PostMapping("/bookings/{publicId}/cancel")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesOperationsService.BookingView cancelBooking(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody CancellationRequest request) {
    return sales.cancelBooking(principal, publicId,
        new SalesOperationsService.BookingCancelRequest(request.reason()));
  }

  public record EnquiryRequest(
      @NotNull UUID customerPublicId,
      UUID interestedModelPublicId,
      UUID assignedStaffPublicId,
      @NotBlank @Pattern(regexp = "WALK_IN|PHONE|WEBSITE|REFERRAL|CAMPAIGN|SOCIAL_MEDIA|OTHER") String leadSource,
      @Pattern(regexp = "CALL|SMS|WHATSAPP|EMAIL|IN_PERSON|NONE") String contactPreference,
      Instant nextFollowUpAt,
      @Size(max = 2000) String note) {}

  public record StatusRequest(
      @NotBlank @Pattern(regexp = "NEW|CONTACTED|QUALIFIED|TEST_RIDE_SCHEDULED|BOOKED|LOST|CLOSED") String status,
      @Size(max = 2000) String note) {}

  public record FollowUpRequest(Instant followUpAt, @Size(max = 2000) String note) {}

  public record TestRideRequest(
      @NotNull UUID vehicleUnitPublicId,
      @NotNull Instant scheduledStart,
      @NotNull Instant scheduledEnd,
      @Size(max = 1000) String notes) {}

  public record BookingRequest(@NotNull UUID vehicleUnitPublicId, @Size(max = 1000) String notes) {}

  public record NoteRequest(@Size(max = 1000) String note) {}

  public record CancellationRequest(@NotBlank @Size(max = 500) String reason) {}
}
