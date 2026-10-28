package com.quantaedge.bajaj.security;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/staff")
public class StaffAccessManagementController {
  private final StaffAccessManagementService access;

  public StaffAccessManagementController(StaffAccessManagementService access) {
    this.access = access;
  }

  @GetMapping("/roles")
  @PreAuthorize("hasAuthority('staff.manage')")
  public List<StaffAccessManagementService.RoleOption> roleOptions(
      @AuthenticationPrincipal StaffPrincipal actor) {
    return access.roleOptions(actor);
  }

  @PostMapping("/invitations")
  @PreAuthorize("hasAuthority('staff.manage')")
  public StaffAccessManagementService.InvitationResult invite(
      @AuthenticationPrincipal StaffPrincipal actor, @Valid @RequestBody InvitationRequest request) {
    return access.invite(actor, request.fullName(), request.email(), request.phone(),
        request.roleCodes(), request.reason());
  }

  @PutMapping("/{staffPublicId}/roles")
  @PreAuthorize("hasAuthority('staff.manage')")
  public StaffAccessManagementService.RoleAssignmentResult changeRoles(
      @AuthenticationPrincipal StaffPrincipal actor,
      @PathVariable UUID staffPublicId,
      @Valid @RequestBody RoleChangeRequest request) {
    return access.changeRoles(actor, staffPublicId, request.roleCodes(), request.reason());
  }

  @PutMapping("/{staffPublicId}/status")
  @PreAuthorize("hasAuthority('staff.manage')")
  public StaffAccessManagementService.StaffStatusResult changeStatus(
      @AuthenticationPrincipal StaffPrincipal actor,
      @PathVariable UUID staffPublicId,
      @Valid @RequestBody StatusChangeRequest request) {
    return access.changeStatus(actor, staffPublicId, request.status(), request.reason());
  }

  public record InvitationRequest(
      @NotBlank @Size(max = 160) String fullName,
      @Email @Size(max = 320) String email,
      @Size(max = 32) String phone,
      @NotEmpty @Size(max = 8) List<@NotBlank @Size(max = 60) String> roleCodes,
      @NotBlank @Size(min = 4, max = 500) String reason) {}

  public record RoleChangeRequest(
      @NotEmpty @Size(max = 8) List<@NotBlank @Size(max = 60) String> roleCodes,
      @NotBlank @Size(min = 4, max = 500) String reason) {}

  public record StatusChangeRequest(
      @NotBlank @Pattern(regexp = "ACTIVE|DISABLED") String status,
      @NotBlank @Size(min = 4, max = 500) String reason) {}
}
