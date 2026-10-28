package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin")
public class VehicleInventoryController {
  private final VehicleInventoryService inventory;

  public VehicleInventoryController(VehicleInventoryService inventory) {
    this.inventory = inventory;
  }

  @GetMapping("/vehicle-models")
  @PreAuthorize("hasAuthority('vehicle.read')")
  public VehicleInventoryService.Page<VehicleInventoryService.VehicleModelView> listModels(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return inventory.listModels(principal, page, pageSize, q);
  }

  @PostMapping("/vehicle-models")
  @PreAuthorize("hasAuthority('vehicle.manage')")
  public VehicleInventoryService.VehicleModelView createModel(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody VehicleModelRequest request) {
    return inventory.createModel(principal,
        new VehicleInventoryService.VehicleModelRequest(
            request.modelCode(), request.modelName(), request.variantName(), request.colourName(), request.modelYear()));
  }

  @GetMapping("/vehicle-units")
  @PreAuthorize("hasAuthority('vehicle.read')")
  public VehicleInventoryService.Page<VehicleInventoryService.VehicleUnitView> listUnits(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int pageSize,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) UUID modelPublicId) {
    return inventory.listUnits(principal, page, pageSize, status, modelPublicId);
  }

  @PostMapping("/vehicle-units")
  @PreAuthorize("hasAuthority('vehicle.manage')")
  public VehicleInventoryService.VehicleUnitView registerExpectedUnit(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody VehicleUnitRequest request) {
    return inventory.registerExpectedUnit(principal,
        new VehicleInventoryService.VehicleUnitRequest(
            request.modelPublicId(), request.chassisNumber(), request.engineNumber(),
            request.supplierReference(), request.purchaseCost()));
  }

  @PostMapping("/vehicle-units/{publicId}/receive")
  @PreAuthorize("hasAuthority('vehicle.manage')")
  public VehicleInventoryService.VehicleUnitView receive(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody(required = false) ReceiveStockRequest request) {
    String receipt = request == null ? null : request.receiptReference();
    String reason = request == null ? null : request.reason();
    return inventory.receiveUnit(principal, publicId, receipt, reason);
  }

  @GetMapping("/vehicle-units/{publicId}/movements")
  @PreAuthorize("hasAuthority('vehicle.read')")
  public List<VehicleInventoryService.StockMovementView> movements(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return inventory.movements(principal, publicId);
  }

  public record VehicleModelRequest(
      @NotBlank @Size(max = 60) @Pattern(regexp = "[A-Za-z0-9][A-Za-z0-9._-]*") String modelCode,
      @NotBlank @Size(max = 160) String modelName,
      @Size(max = 120) String variantName,
      @Size(max = 80) String colourName,
      Integer modelYear) {}

  public record VehicleUnitRequest(
      @NotNull UUID modelPublicId,
      @NotBlank @Size(max = 100) String chassisNumber,
      @NotBlank @Size(max = 100) String engineNumber,
      @Size(max = 120) String supplierReference,
      @DecimalMin("0.00") BigDecimal purchaseCost) {}

  public record ReceiveStockRequest(
      @Size(max = 120) String receiptReference,
      @Size(max = 500) String reason) {}
}
