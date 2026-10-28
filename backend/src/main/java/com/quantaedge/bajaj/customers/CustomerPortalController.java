package com.quantaedge.bajaj.customers;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/customer")
public class CustomerPortalController {
  private final CustomerPortalService portal;

  public CustomerPortalController(CustomerPortalService portal) {
    this.portal = portal;
  }

  @PostMapping("/auth/activate")
  public CustomerPortalService.PortalSession activate(
      @Valid @RequestBody ActivationRequest request, HttpServletRequest httpRequest) {
    return portal.activate(new CustomerPortalService.ActivationRequest(
        request.activationToken(), request.password()), httpRequest.getRemoteAddr(), httpRequest.getHeader("User-Agent"));
  }

  @PostMapping("/auth/login")
  public CustomerPortalService.PortalSession login(
      @Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
    return portal.login(new CustomerPortalService.LoginRequest(
        request.dealershipCode(), request.customerCode(), request.password()),
        httpRequest.getRemoteAddr(), httpRequest.getHeader("User-Agent"));
  }

  @GetMapping("/auth/me")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.CustomerProfile me(@AuthenticationPrincipal CustomerPrincipal principal) {
    return portal.profile(principal);
  }

  @PostMapping("/auth/logout")
  @PreAuthorize("hasAuthority('customer.portal')")
  public OperationResult logout(@AuthenticationPrincipal CustomerPrincipal principal) {
    portal.logout(principal);
    return new OperationResult(true, "Customer portal session revoked.");
  }

  @GetMapping("/vehicles")
  @PreAuthorize("hasAuthority('customer.portal')")
  public List<CustomerPortalService.VehicleView> vehicles(@AuthenticationPrincipal CustomerPrincipal principal) {
    return portal.vehicles(principal);
  }

  @GetMapping("/service-history")
  @PreAuthorize("hasAuthority('customer.portal')")
  public List<CustomerPortalService.ServiceHistoryView> serviceHistory(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return portal.serviceHistory(principal);
  }

  @GetMapping("/notifications")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.NotificationPage notifications(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(defaultValue = "false") boolean unreadOnly) {
    return portal.notifications(principal, page, pageSize, unreadOnly);
  }

  @PostMapping("/notifications/{publicId}/read")
  @PreAuthorize("hasAuthority('customer.portal')")
  public OperationResult markNotificationRead(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId) {
    portal.markNotificationRead(principal, publicId, true);
    return new OperationResult(true, "Notification marked as read.");
  }

  @PostMapping("/notifications/{publicId}/unread")
  @PreAuthorize("hasAuthority('customer.portal')")
  public OperationResult markNotificationUnread(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId) {
    portal.markNotificationRead(principal, publicId, false);
    return new OperationResult(true, "Notification marked as unread.");
  }

  @PostMapping("/notifications/{publicId}/dismiss")
  @PreAuthorize("hasAuthority('customer.portal')")
  public OperationResult dismissNotification(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId) {
    portal.dismissNotification(principal, publicId);
    return new OperationResult(true, "Notification dismissed.");
  }

  @GetMapping("/appointments")
  @PreAuthorize("hasAuthority('customer.portal')")
  public List<CustomerPortalService.AppointmentView> appointments(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return portal.appointments(principal);
  }

  @PostMapping("/appointments")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.AppointmentView createAppointment(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @Valid @RequestBody AppointmentRequest request) {
    return portal.createAppointment(principal, new CustomerPortalService.CustomerAppointmentRequest(
        request.vehiclePublicId(), request.scheduledFor(), request.slotMinutes(),
        request.customerConcern(), request.customerLanguage()));
  }

  @PostMapping("/appointments/{publicId}/cancel")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.AppointmentView cancelAppointment(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody CancelAppointmentRequest request) {
    return portal.cancelAppointment(principal, publicId, request.reason());
  }

  public record ActivationRequest(
      @NotBlank @Size(min = 32, max = 128) String activationToken,
      @NotBlank @Size(min = 12, max = 128) String password) {}

  public record LoginRequest(
      @NotBlank @Size(max = 40) String dealershipCode,
      @NotBlank @Size(max = 40) String customerCode,
      @NotBlank @Size(max = 128) String password) {}

  public record AppointmentRequest(
      @NotNull UUID vehiclePublicId,
      @NotNull Instant scheduledFor,
      @NotNull @Min(15) @Max(480) Integer slotMinutes,
      @NotBlank @Size(max = 3000) String customerConcern,
      @Pattern(regexp = "hi|en|hinglish") String customerLanguage) {}

  public record CancelAppointmentRequest(@NotBlank @Size(max = 500) String reason) {}
  public record OperationResult(boolean success, String message) {}
}
