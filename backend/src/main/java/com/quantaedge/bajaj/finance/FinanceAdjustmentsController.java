package com.quantaedge.bajaj.finance;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/finance/adjustments")
@Validated
public class FinanceAdjustmentsController {
  private final FinanceAdjustmentService adjustments;

  public FinanceAdjustmentsController(FinanceAdjustmentService adjustments) {
    this.adjustments = adjustments;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('finance.read')")
  public List<FinanceAdjustmentService.AdjustmentView> list(
      @AuthenticationPrincipal StaffPrincipal actor,
      @RequestParam(defaultValue = "ALL") @Size(max = 24) String status) {
    return adjustments.list(actor, status);
  }

  @GetMapping("/invoices")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<FinanceAdjustmentService.InvoiceCandidate> invoices(
      @AuthenticationPrincipal StaffPrincipal actor,
      @RequestParam(required = false) @Size(max = 160) String q) {
    return adjustments.findIssuedInvoices(actor, q);
  }

  @PostMapping
  @PreAuthorize("hasAnyAuthority('finance.invoice','finance.payment')")
  public FinanceAdjustmentService.AdjustmentView create(
      @AuthenticationPrincipal StaffPrincipal actor, @Valid @RequestBody CreateAdjustmentRequest request) {
    return adjustments.create(actor, new FinanceAdjustmentService.CreateAdjustmentRequest(
        request.adjustmentType(), request.sourceType(), request.invoicePublicId(),
        request.parentAdjustmentPublicId(), request.paymentPublicId(), request.amount(),
        request.reason(), request.idempotencyKey()));
  }

  @GetMapping("/{publicId}/payment-options")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<FinanceAdjustmentService.PaymentOption> paymentOptions(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID publicId) {
    return adjustments.paymentOptions(actor, publicId);
  }

  @GetMapping("/{publicId}/history")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<FinanceAdjustmentService.AdjustmentEvent> history(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID publicId) {
    return adjustments.history(actor, publicId);
  }

  @PostMapping("/{publicId}/approve")
  @PreAuthorize("hasAuthority('finance.adjustment.approve')")
  public FinanceAdjustmentService.AdjustmentView approve(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID publicId) {
    return adjustments.approve(actor, publicId);
  }

  @PostMapping("/{publicId}/reject")
  @PreAuthorize("hasAuthority('finance.adjustment.approve')")
  public FinanceAdjustmentService.AdjustmentView reject(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID publicId,
      @Valid @RequestBody RejectionRequest request) {
    return adjustments.reject(actor, publicId, request.reason());
  }

  @PostMapping("/{publicId}/mark-paid")
  @PreAuthorize("hasAuthority('finance.payment')")
  public FinanceAdjustmentService.AdjustmentView markPaid(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID publicId,
      @Valid @RequestBody PayoutRequest request) {
    return adjustments.markRefundPaid(actor, publicId,
        new FinanceAdjustmentService.PayoutRequest(request.paymentMethod(), request.paymentReference()));
  }

  public record CreateAdjustmentRequest(
      @NotBlank @Pattern(regexp = "CREDIT_NOTE|REFUND") String adjustmentType,
      @Pattern(regexp = "SALES|WORKSHOP") String sourceType,
      UUID invoicePublicId, UUID parentAdjustmentPublicId, UUID paymentPublicId,
      @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @NotBlank @Size(max = 500) String reason,
      @NotBlank @Size(max = 120) String idempotencyKey) {}

  public record RejectionRequest(@NotBlank @Size(max = 500) String reason) {}
  public record PayoutRequest(
      @NotBlank @Pattern(regexp = "CASH|UPI|BANK_TRANSFER|CARD|OTHER") String paymentMethod,
      @Size(max = 160) String paymentReference) {}
}
