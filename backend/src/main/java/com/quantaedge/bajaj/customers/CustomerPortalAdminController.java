package com.quantaedge.bajaj.customers;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
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

  @PostMapping("/{publicId}/portal-invitation")
  @PreAuthorize("hasAuthority('customer.update')")
  public CustomerPortalService.InvitationView issueInvitation(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId) {
    return portal.issueInvitation(principal, publicId);
  }
}
