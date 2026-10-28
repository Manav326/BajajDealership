package com.quantaedge.bajaj.sales;

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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Sales-specific operational invoicing and acknowledged delivery; tax/provider integrations are separate. */
@RestController
@RequestMapping("/api/v1/admin/sales")
public class SalesBillingController {
  private final SalesBillingService billing;

  public SalesBillingController(SalesBillingService billing) {
    this.billing = billing;
  }

  @GetMapping("/bookings/{bookingPublicId}/invoices")
  @PreAuthorize("hasAuthority('sales.read')")
  public List<SalesBillingService.InvoiceView> invoicesForBooking(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID bookingPublicId) {
    return billing.listInvoicesForBooking(principal, bookingPublicId);
  }

  @PostMapping("/bookings/{bookingPublicId}/invoices")
  @PreAuthorize("hasAuthority('sales.invoice')")
  public SalesBillingService.InvoiceView createInvoiceDraft(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID bookingPublicId,
      @Valid @RequestBody InvoiceDraftRequest request) {
    List<SalesBillingService.InvoiceLineInput> lines = request.lines() == null ? List.of()
        : request.lines().stream().map(line -> new SalesBillingService.InvoiceLineInput(
            line.lineType(), line.description(), line.quantity(), line.unitPrice())).toList();
    return billing.createInvoiceDraft(principal, bookingPublicId,
        new SalesBillingService.InvoiceDraftRequest(
            request.vehiclePrice(), request.discountAmount(), request.customerMessage(), lines));
  }

  @GetMapping("/invoices/{invoicePublicId}")
  @PreAuthorize("hasAuthority('sales.read')")
  public SalesBillingService.InvoiceView invoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return billing.getInvoice(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/issue")
  @PreAuthorize("hasAuthority('sales.invoice')")
  public SalesBillingService.InvoiceView issueInvoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return billing.issueInvoice(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/cancel-draft")
  @PreAuthorize("hasAuthority('sales.invoice')")
  public SalesBillingService.InvoiceView cancelDraft(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID invoicePublicId,
      @Valid @RequestBody DraftCancellationRequest request) {
    return billing.cancelInvoiceDraft(principal, invoicePublicId, request.reason());
  }

  @GetMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('sales.read')")
  public List<SalesBillingService.PaymentView> payments(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return billing.listPayments(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('sales.payment')")
  public SalesBillingService.PaymentResult recordPayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID invoicePublicId,
      @Valid @RequestBody PaymentRequest request) {
    return billing.recordPayment(principal, invoicePublicId,
        new SalesBillingService.PaymentRequest(
            request.idempotencyKey(), request.paymentMethod(), request.amount(),
            request.paymentReference(), request.note()));
  }

  @PostMapping("/payments/{paymentPublicId}/reverse")
  @PreAuthorize("hasAuthority('sales.payment.reverse')")
  public SalesBillingService.PaymentResult reversePayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID paymentPublicId,
      @Valid @RequestBody PaymentReversalRequest request) {
    return billing.reversePayment(principal, paymentPublicId,
        new SalesBillingService.PaymentReversalRequest(request.reason(), request.externalReference()));
  }

  @PostMapping("/bookings/{bookingPublicId}/deliver")
  @PreAuthorize("hasAuthority('sales.deliver')")
  public SalesBillingService.HandoverView deliver(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID bookingPublicId,
      @Valid @RequestBody HandoverRequest request) {
    return billing.deliverBooking(principal, bookingPublicId,
        new SalesBillingService.HandoverRequest(
            request.deliveredToName(), request.customerAcknowledged(), request.acknowledgementMethod(),
            request.acknowledgementReference(), request.note()));
  }

  @GetMapping("/bookings/{bookingPublicId}/handover")
  @PreAuthorize("hasAuthority('sales.read')")
  public SalesBillingService.HandoverView handover(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID bookingPublicId) {
    return billing.getHandover(principal, bookingPublicId);
  }

  public record InvoiceDraftRequest(
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal vehiclePrice,
      @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal discountAmount,
      @Size(max = 2000) String customerMessage,
      @Size(max = 50) List<@Valid InvoiceLineInput> lines) {}

  public record InvoiceLineInput(
      @NotBlank @Pattern(regexp = "ACCESSORY|OTHER") String lineType,
      @NotBlank @Size(max = 300) String description,
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity,
      @NotNull @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal unitPrice) {}

  public record DraftCancellationRequest(@NotBlank @Size(max = 500) String reason) {}

  public record PaymentRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @NotBlank @Pattern(regexp = "CASH|UPI|BANK_TRANSFER|CARD|OTHER") String paymentMethod,
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @Size(max = 160) String paymentReference,
      @Size(max = 1000) String note) {}

  public record PaymentReversalRequest(
      @NotBlank @Size(max = 500) String reason,
      @Size(max = 160) String externalReference) {}

  public record HandoverRequest(
      @NotBlank @Size(max = 160) String deliveredToName,
      @NotNull Boolean customerAcknowledged,
      @NotBlank @Pattern(regexp = "IN_PERSON|SIGNED_FORM|OTP_REFERENCE|WRITTEN_MESSAGE") String acknowledgementMethod,
      @Size(max = 160) String acknowledgementReference,
      @Size(max = 1000) String note) {}
}
