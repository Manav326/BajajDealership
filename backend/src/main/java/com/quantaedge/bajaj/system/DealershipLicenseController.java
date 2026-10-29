package com.quantaedge.bajaj.system;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system/license")
public class DealershipLicenseController {
  private static final String ADMIN_TOKEN_HEADER = "X-License-Admin-Token";
  private final DealershipLicenseService licenses;

  public DealershipLicenseController(DealershipLicenseService licenses) {
    this.licenses = licenses;
  }

  @GetMapping("/status")
  public DealershipLicenseService.LicenseStatus status(
      @AuthenticationPrincipal StaffPrincipal principal) {
    return licenses.statusFor(principal.dealershipId());
  }

  @GetMapping("/admin/licenses")
  public List<DealershipLicenseService.LicenseStatus> listLicenses(
      @RequestHeader(value = ADMIN_TOKEN_HEADER, required = false) String adminToken) {
    licenses.requireAdminToken(adminToken);
    return licenses.listAll();
  }

  @PutMapping("/admin/licenses/{dealershipCode}")
  public DealershipLicenseService.LicenseStatus updateLicense(
      @RequestHeader(value = ADMIN_TOKEN_HEADER, required = false) String adminToken,
      @PathVariable String dealershipCode,
      @Valid @RequestBody LicenseUpdateRequest request) {
    licenses.requireAdminToken(adminToken);
    return licenses.updateLicense(dealershipCode, new DealershipLicenseService.LicenseUpdate(
        request.planCode(), request.status(), request.startsAt(), request.expiresAt(),
        request.gracePeriodDays(), request.maxStaffSeats(), request.reason()));
  }

  public record LicenseUpdateRequest(
      @NotBlank @Size(min = 2, max = 80) @Pattern(regexp = "[A-Za-z0-9][A-Za-z0-9_-]{1,79}") String planCode,
      @NotBlank @Pattern(regexp = "ACTIVE|SUSPENDED|REVOKED") String status,
      @NotNull Instant startsAt,
      @NotNull Instant expiresAt,
      @Min(0) @Max(90) int gracePeriodDays,
      @Min(1) @Max(1000) int maxStaffSeats,
      @NotBlank @Size(min = 4, max = 500) String reason) {}
}
