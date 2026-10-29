package com.quantaedge.bajaj.customers;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/customers")
public class CustomerPortalAdminController {
  private final CustomerPortalService portal;

  public CustomerPortalAdminController(CustomerPortalService portal) {
    this.portal = portal;
  }


  @GetMapping("/{publicId}/saved-addresses")
  @PreAuthorize("hasAuthority('customer.read')")
  public java.util.List<CustomerPortalService.CustomerAddressView> savedAddresses(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return portal.addressesForStaff(principal, publicId);
  }

  @GetMapping("/{publicId}/profile-photo")
  @PreAuthorize("hasAuthority('customer.read')")
  public ResponseEntity<byte[]> profilePhoto(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    CustomerPortalService.ProfilePhoto photo = portal.readProfilePhotoForStaff(principal, publicId);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(photo.contentType()))
        .contentLength(photo.bytes().length).cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline").body(photo.bytes());
  }

  @PostMapping("/{publicId}/portal-invitation")
  @PreAuthorize("hasAuthority('customer.update')")
  public CustomerPortalService.InvitationView issueInvitation(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId) {
    return portal.issueInvitation(principal, publicId);
  }
}
