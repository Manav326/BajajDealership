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
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestPart;
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


  @PutMapping("/profile")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.CustomerProfile updateProfile(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @Valid @RequestBody ProfileUpdateRequest request) {
    return portal.updateProfile(principal, new CustomerPortalService.CustomerProfileUpdate(
        request.fullName(), request.phone(), request.alternatePhone(), request.email(), request.preferredLanguage()));
  }

  @GetMapping("/addresses")
  @PreAuthorize("hasAuthority('customer.portal')")
  public List<CustomerPortalService.CustomerAddressView> addresses(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return portal.addresses(principal);
  }

  @PostMapping("/addresses")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.CustomerAddressView createAddress(
      @AuthenticationPrincipal CustomerPrincipal principal, @Valid @RequestBody AddressRequest request) {
    return portal.createAddress(principal, request.toServiceRequest());
  }

  @PutMapping("/addresses/{publicId}")
  @PreAuthorize("hasAuthority('customer.portal')")
  public CustomerPortalService.CustomerAddressView updateAddress(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId,
      @Valid @RequestBody AddressRequest request) {
    return portal.updateAddress(principal, publicId, request.toServiceRequest());
  }

  @DeleteMapping("/addresses/{publicId}")
  @PreAuthorize("hasAuthority('customer.portal')")
  public List<CustomerPortalService.CustomerAddressView> deleteAddress(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId) {
    return portal.deleteAddress(principal, publicId);
  }

  @PostMapping(value="/profile/photo", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
  @PreAuthorize("hasAuthority('customer.portal')")
  public PhotoStatus uploadProfilePhoto(
      @AuthenticationPrincipal CustomerPrincipal principal, @RequestPart("file") MultipartFile file) {
    CustomerPortalService.ProfilePhoto photo = portal.uploadProfilePhoto(principal, file);
    return new PhotoStatus(true, photo.contentType(), photo.bytes().length);
  }

  @GetMapping("/profile/photo")
  @PreAuthorize("hasAuthority('customer.portal')")
  public ResponseEntity<byte[]> profilePhoto(@AuthenticationPrincipal CustomerPrincipal principal) {
    CustomerPortalService.ProfilePhoto photo = portal.readProfilePhoto(principal);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(photo.contentType()))
        .contentLength(photo.bytes().length).cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline").body(photo.bytes());
  }

  @DeleteMapping("/profile/photo")
  @PreAuthorize("hasAuthority('customer.portal')")
  public OperationResult deleteProfilePhoto(@AuthenticationPrincipal CustomerPrincipal principal) {
    portal.deleteProfilePhoto(principal);
    return new OperationResult(true, "Profile photo removed.");
  }

  @GetMapping("/purchase-history/motorcycles")
  @PreAuthorize("hasAuthority('customer.portal')")
  public List<CustomerPortalService.MotorcyclePurchaseView> motorcyclePurchases(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return portal.motorcyclePurchases(principal);
  }

  public record ProfileUpdateRequest(
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(min=2,max=160) String fullName,
      @jakarta.validation.constraints.Pattern(regexp="[+0-9() .-]*") @jakarta.validation.constraints.Size(max=32) String phone,
      @jakarta.validation.constraints.Pattern(regexp="[+0-9() .-]*") @jakarta.validation.constraints.Size(max=32) String alternatePhone,
      @jakarta.validation.constraints.Email @jakarta.validation.constraints.Size(max=320) String email,
      @jakarta.validation.constraints.Pattern(regexp="hi|en|hinglish") String preferredLanguage) {}

  public record AddressRequest(
      @jakarta.validation.constraints.Pattern(regexp="HOME|WORK|OTHER") String label,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=160) String recipientName,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=32) String phone,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=240) String addressLine1,
      @jakarta.validation.constraints.Size(max=240) String addressLine2,
      @jakarta.validation.constraints.Size(max=160) String landmark,
      @jakarta.validation.constraints.Size(max=160) String locality,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=120) String city,
      @jakarta.validation.constraints.Size(max=120) String district,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=120) String state,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=12) String postalCode,
      @jakarta.validation.constraints.Size(max=80) String country,
      Boolean isDefaultDelivery) {
    CustomerPortalService.AddressRequest toServiceRequest() {
      return new CustomerPortalService.AddressRequest(label, recipientName, phone, addressLine1,
          addressLine2, landmark, locality, city, district, state, postalCode, country, isDefaultDelivery);
    }
  }
  public record PhotoStatus(boolean saved, String contentType, int sizeBytes) {}

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
