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

@RestController
@RequestMapping("/api/v1/admin/sales")
public class SalesTransactionController {
  private final SalesTransactionService transactions;

  public SalesTransactionController(SalesTransactionService transactions) {
    this.transactions = transactions;
  }

  @GetMapping("/bookings/{bookingPublicId}/invoice")
  @PreAuthorize("hasAnyAuthority('finance.read','sales.read','sales.deliver')")
  public SalesTransactionService.SaleInvoiceView invoiceForBooking(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID bookingPublicId) {
    return transactions.getInvoiceForBooking(principal, bookingPublicId);
  }

  @PostMapping("/bookings/{bookingPublicId}/invoice")
  @PreAuthorize("hasAuthority('sales.manage')")
  public SalesTransactionService.SaleInvoiceView createInvoice(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID bookingPublicId,
      @Valid @RequestBody SaleInvoiceRequest request) {
    List<SalesTransactionService.SaleInvoiceLineRequest> addOns = request.addOns() == null ? List.of()
        : request.addOns().stream().map(line -> new SalesTransactionService.SaleInvoiceLineRequest(
            line.lineType(), line.description(), line.quantity(), line.unitPrice(), line.discountAmount())).toList();
    return transactions.createDraftInvoice(principal, bookingPublicId,
        new SalesTransactionService.SaleInvoiceRequest(request.idempotencyKey(), request.vehiclePrice(),
            request.vehicleDiscount(), request.customerMessage(), addOns));
  }

  @GetMapping("/invoices/{invoicePublicId}")
  @PreAuthorize("hasAnyAuthority('finance.read','sales.read','sales.deliver')")
  public SalesTransactionService.SaleInvoiceView invoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return transactions.getInvoice(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/issue")
  @PreAuthorize("hasAuthority('finance.invoice')")
  public SalesTransactionService.SaleInvoiceView issueInvoice(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return transactions.issueInvoice(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/cancel")
  @PreAuthorize("hasAuthority('finance.invoice')")
  public SalesTransactionService.SaleInvoiceView cancelInvoice(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID invoicePublicId,
      @Valid @RequestBody CancellationRequest request) {
    return transactions.cancelInvoice(principal, invoicePublicId, request.reason());
  }

  @GetMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<SalesTransactionService.SalePaymentView> payments(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID invoicePublicId) {
    return transactions.listPayments(principal, invoicePublicId);
  }

  @PostMapping("/invoices/{invoicePublicId}/payments")
  @PreAuthorize("hasAuthority('finance.payment')")
  public SalesTransactionService.SalePaymentView recordPayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID invoicePublicId,
      @Valid @RequestBody SalePaymentRequest request) {
    return transactions.recordPayment(principal, invoicePublicId,
        new SalesTransactionService.SalePaymentRequest(request.idempotencyKey(), request.paymentMethod(),
            request.amount(), request.paymentReference(), request.note()));
  }

  @PostMapping("/payments/{paymentPublicId}/reverse")
  @PreAuthorize("hasAuthority('finance.payment')")
  public SalesTransactionService.SalePaymentView reversePayment(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID paymentPublicId,
      @Valid @RequestBody PaymentReversalRequest request) {
    return transactions.reversePayment(principal, paymentPublicId,
        new SalesTransactionService.SalePaymentReversalRequest(request.reason(), request.externalReference()));
  }

  @PostMapping("/bookings/{bookingPublicId}/deliver")
  @PreAuthorize("hasAuthority('sales.deliver')")
  public SalesTransactionService.SaleHandoverView deliver(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID bookingPublicId,
      @Valid @RequestBody HandoverRequest request) {
    return transactions.deliverBooking(principal, bookingPublicId,
        new SalesTransactionService.HandoverRequest(request.deliveredToName(), request.customerAcknowledged(),
            request.acknowledgementMethod(), request.acknowledgementReference(), request.note()));
  }

  @GetMapping("/bookings/{bookingPublicId}/handover")
  @PreAuthorize("hasAnyAuthority('finance.read','sales.read','sales.deliver')")
  public SalesTransactionService.SaleHandoverView handover(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID bookingPublicId) {
    return transactions.getHandoverForBooking(principal, bookingPublicId);
  }

  public record SaleInvoiceLineRequest(
      @NotBlank @Pattern(regexp = "ACCESSORY|OTHER") String lineType,
      @NotBlank @Size(max = 300) String description,
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity,
      @NotNull @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal unitPrice,
      @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal discountAmount) {}

  public record SaleInvoiceRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal vehiclePrice,
      @NotNull @DecimalMin(value = "0.00") @Digits(integer = 12, fraction = 2) BigDecimal vehicleDiscount,
      @Size(max = 2000) String customerMessage,
      @Size(max = 50) List<@Valid SaleInvoiceLineRequest> addOns) {}

  public record SalePaymentRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @NotBlank @Pattern(regexp = "CASH|UPI|BANK_TRANSFER|CARD|OTHER") String paymentMethod,
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @Size(max = 160) String paymentReference,
      @Size(max = 1000) String note) {}

  public record CancellationRequest(@NotBlank @Size(max = 500) String reason) {}
  public record PaymentReversalRequest(
      @NotBlank @Size(max = 500) String reason, @Size(max = 160) String externalReference) {}
  public record HandoverRequest(
      @NotBlank @Size(max = 160) String deliveredToName,
      @NotNull Boolean customerAcknowledged,
      @NotBlank @Pattern(regexp = "IN_PERSON|SIGNED_FORM|OTP_REFERENCE|WRITTEN_MESSAGE") String acknowledgementMethod,
      @Size(max = 160) String acknowledgementReference,
      @Size(max = 1000) String note) {}
}
