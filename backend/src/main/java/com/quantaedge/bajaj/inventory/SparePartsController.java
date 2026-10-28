package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
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
public class SparePartsController {
  private final SparePartsService parts;

  public SparePartsController(SparePartsService parts) {
    this.parts = parts;
  }

  @GetMapping("/parts")
  @PreAuthorize("hasAuthority('parts.read')")
  public SparePartsService.Page<SparePartsService.SparePartView> listParts(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q,
      @RequestParam(required = false) Boolean activeOnly) {
    return parts.listParts(principal, page, pageSize, q, activeOnly);
  }

  @GetMapping("/parts/{publicId}")
  @PreAuthorize("hasAuthority('parts.read')")
  public SparePartsService.SparePartView getPart(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return parts.getPart(principal, publicId);
  }

  @PostMapping("/parts")
  @PreAuthorize("hasAuthority('parts.manage')")
  public SparePartsService.SparePartView createPart(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody PartRequest request) {
    return parts.createPart(principal,
        new SparePartsService.PartRequest(
            request.skuCode(), request.partName(), request.description(), request.unitOfMeasure()));
  }

  @GetMapping("/part-suppliers")
  @PreAuthorize("hasAuthority('parts.read')")
  public SparePartsService.Page<SparePartsService.SupplierView> suppliers(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q,
      @RequestParam(required = false) Boolean activeOnly) {
    return parts.listSuppliers(principal, page, pageSize, q, activeOnly);
  }

  @PostMapping("/part-suppliers")
  @PreAuthorize("hasAuthority('parts.manage')")
  public SparePartsService.SupplierView createSupplier(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody SupplierRequest request) {
    return parts.createSupplier(principal,
        new SparePartsService.SupplierRequest(
            request.supplierCode(), request.supplierName(), request.contactName(), request.phone(),
            request.email(), request.address(), request.notes()));
  }

  @GetMapping("/part-receipts")
  @PreAuthorize("hasAuthority('parts.read')")
  public SparePartsService.Page<SparePartsService.ReceiptSummaryView> receipts(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize) {
    return parts.listReceipts(principal, page, pageSize);
  }

  @GetMapping("/part-receipts/{publicId}")
  @PreAuthorize("hasAuthority('parts.read')")
  public SparePartsService.ReceiptView receipt(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return parts.getReceipt(principal, publicId);
  }

  @PostMapping("/part-receipts")
  @PreAuthorize("hasAuthority('parts.receive')")
  public SparePartsService.ReceiptView receiveStock(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody ReceiptRequest request) {
    List<SparePartsService.ReceiptLineRequest> lines = request.lines().stream()
        .map(line -> new SparePartsService.ReceiptLineRequest(line.partPublicId(), line.quantity(), line.unitCost()))
        .toList();
    return parts.receiveStock(principal, new SparePartsService.ReceiptRequest(
        request.supplierPublicId(), request.supplierReference(), request.idempotencyKey(),
        request.notes(), lines));
  }

  @GetMapping("/parts/{publicId}/movements")
  @PreAuthorize("hasAuthority('parts.read')")
  public SparePartsService.Page<SparePartsService.StockMovementView> movements(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize) {
    return parts.listMovements(principal, publicId, page, pageSize);
  }

  @GetMapping("/job-cards/{jobCardPublicId}/part-reservations")
  @PreAuthorize("hasAuthority('parts.read')")
  public List<SparePartsService.ReservationView> reservations(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID jobCardPublicId) {
    return parts.listReservations(principal, jobCardPublicId);
  }

  @PostMapping("/job-cards/{jobCardPublicId}/part-reservations")
  @PreAuthorize("hasAuthority('parts.reserve')")
  public SparePartsService.ReservationView reserve(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID jobCardPublicId,
      @Valid @RequestBody ReservationRequest request) {
    return parts.reservePart(principal, jobCardPublicId,
        new SparePartsService.ReservationRequest(
            request.partPublicId(), request.quantity(), request.idempotencyKey(), request.notes()));
  }

  @PostMapping("/part-reservations/{reservationPublicId}/issue")
  @PreAuthorize("hasAuthority('parts.issue')")
  public SparePartsService.ReservationView issue(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID reservationPublicId,
      @Valid @RequestBody QuantityOperationRequest request) {
    return parts.issuePart(principal, reservationPublicId,
        new SparePartsService.QuantityOperationRequest(
            request.quantity(), request.idempotencyKey(), request.notes()));
  }

  @PostMapping("/part-reservations/{reservationPublicId}/return")
  @PreAuthorize("hasAuthority('parts.return')")
  public SparePartsService.ReservationView returnPart(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID reservationPublicId,
      @Valid @RequestBody QuantityOperationRequest request) {
    return parts.returnPart(principal, reservationPublicId,
        new SparePartsService.QuantityOperationRequest(
            request.quantity(), request.idempotencyKey(), request.notes()));
  }

  @PostMapping("/part-reservations/{reservationPublicId}/release")
  @PreAuthorize("hasAuthority('parts.reserve')")
  public SparePartsService.ReservationView release(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID reservationPublicId,
      @Valid @RequestBody OperationRequest request) {
    return parts.releaseReservation(principal, reservationPublicId,
        new SparePartsService.OperationRequest(request.idempotencyKey(), request.notes()));
  }

  public record PartRequest(
      @NotBlank @Size(max = 60) String skuCode,
      @NotBlank @Size(max = 200) String partName,
      @Size(max = 1000) String description,
      @Pattern(regexp = "EACH|PAIR|SET|LITRE|ML|GRAM|KG|METER") String unitOfMeasure) {}

  public record SupplierRequest(
      @NotBlank @Size(max = 48) String supplierCode,
      @NotBlank @Size(max = 180) String supplierName,
      @Size(max = 160) String contactName,
      @Size(max = 32) String phone,
      @Size(max = 320) String email,
      @Size(max = 1000) String address,
      @Size(max = 1000) String notes) {}

  public record ReceiptLineRequest(
      @NotNull UUID partPublicId,
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity,
      @NotNull @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal unitCost) {}

  public record ReceiptRequest(
      @NotNull UUID supplierPublicId,
      @Size(max = 160) String supplierReference,
      @NotBlank @Size(max = 120) String idempotencyKey,
      @Size(max = 1000) String notes,
      @NotNull @Size(min = 1, max = 100) List<@Valid ReceiptLineRequest> lines) {}

  public record ReservationRequest(
      @NotNull UUID partPublicId,
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity,
      @NotBlank @Size(max = 120) String idempotencyKey,
      @Size(max = 1000) String notes) {}

  public record QuantityOperationRequest(
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity,
      @NotBlank @Size(max = 120) String idempotencyKey,
      @Size(max = 1000) String notes) {}

  public record OperationRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @Size(max = 1000) String notes) {}
}
