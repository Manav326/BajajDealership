package com.quantaedge.bajaj.workshop;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
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

@RestController
@RequestMapping("/api/v1/admin/workshop")
public class BillingOperationsController {
  private final BillingOperationsService billing;

  public BillingOperationsController(BillingOperationsService billing) {
    this.billing = billing;
  }

  @GetMapping("/job-cards/{jobCardPublicId}/invoices")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<BillingOperationsService.InvoiceView> invoices(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID jobCardPublicId) {
    return billing.listInvoices(principal, jobCardPublicId);
  }

  @PostMapping("/job-cards/{jobCardPublicId}/invoices")
  @PreAuthorize("hasAuthority('finance.invoice')")
  public BillingOperationsService.InvoiceView createInvoice(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID jobCardPublicId,
      @Valid @RequestBody(required = false) CreateInvoiceRequest request) {
    return billing.createInvoice(principal, jobCardPublicId, request == null ? null : request.customerMessage());
  }

  @GetMapping("/invoices/{invoicePublicId}")
  @PreAuthorize("hasAuthority('finance.read')")
  public BillingOperationsService.InvoiceView invoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return billing.getInvoice(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/issue")
  @PreAuthorize("hasAuthority('finance.invoice')")
  public BillingOperationsService.InvoiceView issueInvoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return billing.issueInvoice(principal, invoicePublicId);
  }

  @GetMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<BillingOperationsService.PaymentView> payments(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return billing.listPayments(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('finance.payment')")
  public BillingOperationsService.PaymentView recordPayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID invoicePublicId,
      @Valid @RequestBody PaymentRequest request) {
    return billing.recordPayment(principal, invoicePublicId,
        new BillingOperationsService.PaymentRequest(
            request.idempotencyKey(), request.paymentMethod(), request.amount(),
            request.paymentReference(), request.note()));
  }

  @PostMapping("/payments/{paymentPublicId}/reverse")
  @PreAuthorize("hasAuthority('finance.payment.reverse')")
  public BillingOperationsService.PaymentView reversePayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID paymentPublicId,
      @Valid @RequestBody PaymentReversalRequest request) {
    return billing.reversePayment(principal, paymentPublicId,
        new BillingOperationsService.PaymentReversalRequest(request.reason(), request.externalReference()));
  }

  @PostMapping("/job-cards/{jobCardPublicId}/deliver")
  @PreAuthorize("hasAuthority('workshop.jobcard.deliver')")
  public BillingOperationsService.HandoverView deliver(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID jobCardPublicId,
      @Valid @RequestBody HandoverRequest request) {
    return billing.deliverJobCard(principal, jobCardPublicId,
        new BillingOperationsService.HandoverRequest(
            request.deliveredToName(), request.customerAcknowledged(), request.acknowledgementMethod(),
            request.acknowledgementReference(), request.note()));
  }

  public record CreateInvoiceRequest(@Size(max = 2000) String customerMessage) {}

  public record PaymentRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @NotBlank @Pattern(regexp = "CASH|UPI|BANK_TRANSFER|CARD|OTHER") String paymentMethod,
      @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @Size(max = 160) String paymentReference,
      @Size(max = 1000) String note) {}

  public record PaymentReversalRequest(
      @NotBlank @Size(max = 500) String reason,
      @Size(max = 160) String externalReference) {}

  public record HandoverRequest(
      @NotBlank @Size(max = 160) String deliveredToName,
      @NotNull @AssertTrue Boolean customerAcknowledged,
      @NotBlank @Pattern(regexp = "IN_PERSON|SIGNED_FORM|OTP_REFERENCE|WRITTEN_MESSAGE") String acknowledgementMethod,
      @Size(max = 160) String acknowledgementReference,
      @Size(max = 1000) String note) {}
}
