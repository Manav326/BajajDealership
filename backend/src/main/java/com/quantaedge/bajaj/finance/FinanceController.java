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
import java.time.LocalDate;
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
@RequestMapping("/api/v1/admin/finance")
@Validated
public class FinanceController {
  private final FinanceOperationsService finance;

  public FinanceController(FinanceOperationsService finance) {
    this.finance = finance;
  }

  @GetMapping("/summary")
  @PreAuthorize("hasAuthority('finance.read')")
  public FinanceOperationsService.FinanceSummary summary(@AuthenticationPrincipal StaffPrincipal actor) {
    return finance.getSummary(actor);
  }

  @GetMapping("/expenses")
  @PreAuthorize("hasAuthority('finance.read')")
  public List<FinanceOperationsService.ExpenseView> expenses(
      @AuthenticationPrincipal StaffPrincipal actor,
      @RequestParam(defaultValue = "ALL") @Size(max = 24) String status) {
    return finance.listExpenses(actor, status);
  }

  @PostMapping("/expenses")
  @PreAuthorize("hasAuthority('finance.expense')")
  public FinanceOperationsService.ExpenseView createExpense(
      @AuthenticationPrincipal StaffPrincipal actor, @Valid @RequestBody CreateExpenseRequest request) {
    return finance.createExpense(actor, new FinanceOperationsService.CreateExpenseRequest(
        request.idempotencyKey(), request.expenseDate(), request.category(), request.description(),
        request.vendorName(), request.paymentMethod(), request.paymentReference(), request.amount()));
  }

  @PostMapping("/expenses/{expensePublicId}/approve")
  @PreAuthorize("hasAuthority('finance.approve')")
  public FinanceOperationsService.ExpenseView approveExpense(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID expensePublicId) {
    return finance.approveExpense(actor, expensePublicId);
  }

  @PostMapping("/expenses/{expensePublicId}/reject")
  @PreAuthorize("hasAuthority('finance.approve')")
  public FinanceOperationsService.ExpenseView rejectExpense(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID expensePublicId,
      @Valid @RequestBody ExpenseReasonRequest request) {
    return finance.rejectExpense(actor, expensePublicId, request.reason());
  }

  @PostMapping("/expenses/{expensePublicId}/reverse")
  @PreAuthorize("hasAuthority('finance.expense.reverse')")
  public FinanceOperationsService.ExpenseView reverseExpense(
      @AuthenticationPrincipal StaffPrincipal actor, @PathVariable UUID expensePublicId,
      @Valid @RequestBody ExpenseReversalRequest request) {
    return finance.reverseExpense(actor, expensePublicId, request.reason(), request.externalReference());
  }


  @GetMapping("/daily-close/preview")
  @PreAuthorize("hasAuthority('finance.close.read')")
  public FinanceOperationsService.DailyCloseView dailyClosePreview(
      @AuthenticationPrincipal StaffPrincipal actor, @RequestParam LocalDate businessDate) {
    return finance.previewDailyClose(actor,businessDate);
  }

  @PostMapping("/daily-close")
  @PreAuthorize("hasAuthority('finance.reconcile')")
  public FinanceOperationsService.DailyCloseView closeDailyFinance(
      @AuthenticationPrincipal StaffPrincipal actor,@Valid @RequestBody DailyCloseRequest request) {
    return finance.closeBusinessDay(actor,new FinanceOperationsService.DailyCloseRequest(
      request.businessDate(),
      new FinanceOperationsService.MoneyChannels(request.openingBalances().cash(),request.openingBalances().upi(),
          request.openingBalances().bankTransfer(),request.openingBalances().card(),request.openingBalances().other()),
      new FinanceOperationsService.MoneyChannels(request.countedClosing().cash(),request.countedClosing().upi(),
          request.countedClosing().bankTransfer(),request.countedClosing().card(),request.countedClosing().other()),
      request.notes()));
  }

  @GetMapping("/reports/daily")
  @PreAuthorize("hasAuthority('report.read')")
  public List<FinanceOperationsService.DailyFinanceReport> dailyReports(
      @AuthenticationPrincipal StaffPrincipal actor,@RequestParam LocalDate fromDate,@RequestParam LocalDate toDate) {
    return finance.getDailyReports(actor,fromDate,toDate);
  }

  public record MoneyChannels(BigDecimal cash,BigDecimal upi,BigDecimal bankTransfer,BigDecimal card,BigDecimal other){}
  public record DailyCloseRequest(@NotNull LocalDate businessDate,@Valid @NotNull MoneyChannels openingBalances,
      @Valid @NotNull MoneyChannels countedClosing,@Size(max=1000) String notes){}

  public record CreateExpenseRequest(
      @NotBlank @Size(max = 120) String idempotencyKey,
      @NotNull LocalDate expenseDate,
      @NotBlank @Size(max = 64) String category,
      @NotBlank @Size(max = 500) String description,
      @Size(max = 160) String vendorName,
      @NotBlank @Pattern(regexp = "CASH|UPI|BANK_TRANSFER|CARD|OTHER") String paymentMethod,
      @Size(max = 160) String paymentReference,
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount) {}

  public record ExpenseReasonRequest(@NotBlank @Size(max = 500) String reason) {}
  public record ExpenseReversalRequest(
      @NotBlank @Size(max = 500) String reason, @Size(max = 160) String externalReference) {}
}
