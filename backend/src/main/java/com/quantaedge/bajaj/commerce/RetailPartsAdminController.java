package com.quantaedge.bajaj.commerce;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
@RequestMapping("/api/v1/admin")
public class RetailPartsAdminController {
  private final RetailPartsService retail;

  public RetailPartsAdminController(RetailPartsService retail) {
    this.retail = retail;
  }

  @GetMapping("/retail-parts")
  @PreAuthorize("hasAuthority('parts.read')")
  public List<RetailPartsService.AdminPartView> settings(
      @AuthenticationPrincipal StaffPrincipal principal) {
    return retail.listRetailSettings(principal);
  }

  @PutMapping("/retail-parts/{partPublicId}")
  @PreAuthorize("hasAuthority('parts.manage')")
  public RetailPartsService.AdminPartView updateSettings(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID partPublicId,
      @Valid @RequestBody RetailSettingsRequest request) {
    return retail.updateRetailSettings(principal, partPublicId, new RetailPartsService.RetailSettingsRequest(
        request.retailEnabled(), request.retailPrice(), request.retailDescription(),
        request.fitmentModelCodes(), request.imageUrl()));
  }

  @GetMapping("/retail-part-orders")
  @PreAuthorize("hasAuthority('parts.read')")
  public List<RetailPartsService.RetailOrderView> orders(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
      @RequestParam(required = false) @Size(max = 20) String status) {
    return retail.listOrdersForStaff(principal, limit, status);
  }

  @PostMapping("/retail-part-orders/{publicId}/fulfill")
  @PreAuthorize("hasAuthority('parts.manage')")
  public RetailPartsService.RetailOrderView fulfill(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody FulfillRequest request) {
    return retail.fulfillOrder(principal, publicId, new RetailPartsService.FulfillRequest(
        request.collectionMethod(), request.externalReference(), request.idempotencyKey(), request.note()));
  }

  public record RetailSettingsRequest(
      @NotNull Boolean retailEnabled,
      BigDecimal retailPrice,
      @Size(max = 1000) String retailDescription,
      @Size(max = 40) List<@NotBlank @Size(max = 60) String> fitmentModelCodes,
      @Size(max = 1000) String imageUrl) {}

  public record FulfillRequest(
      @NotBlank @Size(max = 24) String collectionMethod,
      @Size(max = 160) String externalReference,
      @NotBlank @Size(max = 120) String idempotencyKey,
      @Size(max = 1000) String note) {}
}
