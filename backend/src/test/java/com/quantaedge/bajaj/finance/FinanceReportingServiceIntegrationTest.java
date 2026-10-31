package com.quantaedge.bajaj.finance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class FinanceReportingServiceIntegrationTest {
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Kolkata");

  @Autowired private JdbcTemplate jdbc;
  @Autowired private FinanceOperationsService finance;
  @Autowired private OperationalReportsService operations;

  @Test
  void financeAndOperationsReportsExecuteAgainstAnEmptyDealershipWithoutInventingMetrics() {
    StaffPrincipal actor = createActor();
    LocalDate reportDate = LocalDate.now(BUSINESS_ZONE).minusDays(1);

    var dailyRows = finance.getDailyReports(actor, reportDate, reportDate);
    assertThat(dailyRows).hasSize(1);
    var daily = dailyRows.getFirst();
    assertThat(daily.businessDate()).isEqualTo(reportDate);
    assertThat(daily.salesInvoiced()).isEqualByComparingTo("0");
    assertThat(daily.workshopInvoiced()).isEqualByComparingTo("0");
    assertThat(daily.salesCollections()).isEqualByComparingTo("0");
    assertThat(daily.salesCreditNotes()).isEqualByComparingTo("0");
    assertThat(daily.workshopCreditNotes()).isEqualByComparingTo("0");
    assertThat(daily.refundPayouts()).isEqualByComparingTo("0");

    var close = finance.previewDailyClose(actor, reportDate);
    assertThat(close.closed()).isFalse();
    assertThat(close.channels()).hasSize(5);
    assertThat(close.varianceTotal()).isEqualByComparingTo("0");

    var report = operations.report(actor, reportDate, reportDate);
    assertThat(report.dealershipTimeZone()).isEqualTo(BUSINESS_ZONE.getId());
    assertThat(report.enquiriesCreated()).isZero();
    assertThat(report.bookingsCreated()).isZero();
    assertThat(report.vehicleDeliveries()).isZero();
    assertThat(report.completedTestRides()).isZero();
    assertThat(report.workshopJobsCheckedIn()).isZero();
    assertThat(report.workshopInvoicesIssued()).isZero();
    assertThat(report.sparePartPurchaseReceipts()).isZero();
    assertThat(report.sparePartMovements()).isEmpty();
    assertThat(report.currentOutOfStockPartCount()).isZero();
    assertThat(report.currentLowStockPartCount()).isZero();
  }

  @Test
  void financeAndOperationsReportRejectFutureDates() {
    StaffPrincipal actor = createActor();
    LocalDate tomorrow = LocalDate.now(BUSINESS_ZONE).plusDays(1);
    assertThatThrownBy(() -> finance.getDailyReports(actor, tomorrow, tomorrow))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
    assertThatThrownBy(() -> operations.report(actor, tomorrow, tomorrow))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void expenseSubmissionIsIdempotentRequiresReviewAndReversalPreservesTheAuditTrail() {
    StaffPrincipal actor = createActor();
    LocalDate expenseDate = LocalDate.now(BUSINESS_ZONE).minusDays(1);
    var request = new FinanceOperationsService.CreateExpenseRequest(
        "expense-test-" + UUID.randomUUID(), expenseDate, "UTILITIES",
        "Workshop electricity", "Test Power Company", "BANK_TRANSFER",
        "BANK-REF-TEST-001", new BigDecimal("1250.00"));

    var created = finance.createExpense(actor, request);
    assertThat(created.status()).isEqualTo("PENDING_APPROVAL");
    assertThat(created.amount()).isEqualByComparingTo("1250.00");

    var replay = finance.createExpense(actor, request);
    assertThat(replay.publicId()).isEqualTo(created.publicId());
    assertThat(finance.listExpenses(actor, "PENDING_APPROVAL"))
        .extracting(FinanceOperationsService.ExpenseView::publicId)
        .containsExactly(created.publicId());
    assertThat(finance.getSummary(actor).pendingExpenseCount()).isEqualTo(1);

    var changedRequest = new FinanceOperationsService.CreateExpenseRequest(
        request.idempotencyKey(), expenseDate, "UTILITIES",
        "Different expense under the same key", "Test Power Company", "BANK_TRANSFER",
        "BANK-REF-TEST-001", new BigDecimal("1250.00"));
    assertThatThrownBy(() -> finance.createExpense(actor, changedRequest))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var approved = finance.approveExpense(actor, created.publicId());
    assertThat(approved.status()).isEqualTo("APPROVED");
    assertThat(approved.reviewedByName()).isEqualTo("Reporting Owner");
    assertThat(finance.getSummary(actor).approvedExpenseAmount())
        .isEqualByComparingTo("1250.00");

    var reversed = finance.reverseExpense(actor, created.publicId(),
        "Duplicate supplier claim was identified during reconciliation.", "BANK-REV-TEST-001");
    assertThat(reversed.status()).isEqualTo("REVERSED");
    assertThat(reversed.reversalReason()).contains("Duplicate supplier claim");
    assertThat(reversed.reversalReference()).isEqualTo("BANK-REV-TEST-001");
    assertThat(finance.getSummary(actor).approvedExpenseAmount())
        .isEqualByComparingTo("0.00");
    assertThat(finance.listExpenses(actor, "REVERSED"))
        .extracting(FinanceOperationsService.ExpenseView::publicId)
        .containsExactly(created.publicId());
  }

  @Test
  void dailyCloseStoresAnImmutableFiveChannelReconciliationSnapshot() {
    StaffPrincipal actor = createActor();
    LocalDate businessDate = LocalDate.now(BUSINESS_ZONE).minusDays(1);
    var zero = new FinanceOperationsService.MoneyChannels(
        BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);
    var counted = new FinanceOperationsService.MoneyChannels(
        new BigDecimal("100.00"), BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);

    var closed = finance.closeBusinessDay(actor,
        new FinanceOperationsService.DailyCloseRequest(
            businessDate, zero, counted, "Synthetic cash variance fixture"));
    assertThat(closed.closed()).isTrue();
    assertThat(closed.publicId()).isNotNull();
    assertThat(closed.channels()).hasSize(5);
    var cash = closed.channels().stream()
        .filter(channel -> "CASH".equals(channel.paymentMethod()))
        .findFirst().orElseThrow();
    assertThat(cash.openingBalance()).isEqualByComparingTo("0.00");
    assertThat(cash.countedClosing()).isEqualByComparingTo("100.00");
    assertThat(cash.variance()).isNotEqualByComparingTo("0.00");

    var reloaded = finance.previewDailyClose(actor, businessDate);
    assertThat(reloaded.closed()).isTrue();
    assertThat(reloaded.publicId()).isEqualTo(closed.publicId());
    assertThat(reloaded.channels()).isEqualTo(closed.channels());

    assertThatThrownBy(() -> finance.closeBusinessDay(actor,
        new FinanceOperationsService.DailyCloseRequest(businessDate, zero, zero, "Attempt to overwrite close")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var stillClosed = finance.previewDailyClose(actor, businessDate);
    assertThat(stillClosed.publicId()).isEqualTo(closed.publicId());
    assertThat(stillClosed.channels()).isEqualTo(closed.channels());
  }

  @Test
  void taxProfileAndTaxCodeVerificationRemainExplicitAttestationsNotAnIRPIntegration() {
    StaffPrincipal actor = createActor();
    assertThat(finance.taxReadiness(actor).status()).isEqualTo("NOT_CONFIGURED");

    var incompleteAssessment = new FinanceOperationsService.TaxProfileRequest(
        "REGULAR", "10ABCDE1234F1Z5", "Test Legal Entity", "Test Trade Name",
        "10 Test Market Road", "10", "APPLICABLE", null, null);
    assertThatThrownBy(() -> finance.saveTaxProfile(actor, incompleteAssessment))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    var profile = finance.saveTaxProfile(actor,
        new FinanceOperationsService.TaxProfileRequest(
            "REGULAR", "10ABCDE1234F1Z5", "Test Legal Entity", "Test Trade Name",
            "10 Test Market Road", "10", "APPLICABLE", "2026-27",
            "Synthetic test assessment recorded against an illustrative annual turnover review."));
    assertThat(profile.registrationType()).isEqualTo("REGULAR");
    assertThat(profile.gstin()).isEqualTo("10ABCDE1234F1Z5");
    assertThat(finance.taxReadiness(actor).status()).isEqualTo("VERIFIED_TAX_CODES_REQUIRED");

    var draft = finance.createTaxCode(actor, new FinanceOperationsService.TaxCodeRequest(
        "HSN-TEST-001", "Synthetic service parts tax reference", "123456", "GOODS",
        new BigDecimal("18.00"), BigDecimal.ZERO, LocalDate.now(BUSINESS_ZONE), null,
        "Synthetic test source reference"));
    assertThat(draft.status()).isEqualTo("DRAFT");
    assertThat(finance.taxReadiness(actor).draftTaxCodeCount()).isEqualTo(1);

    var verified = finance.verifyTaxCode(actor, draft.publicId(),
        "https://cbic.gov.in/test-fixture", "Synthetic test verification; not a live legal determination.");
    assertThat(verified.status()).isEqualTo("VERIFIED");
    assertThat(verified.verifiedByName()).isEqualTo("Reporting Owner");
    assertThat(finance.taxReadiness(actor).verifiedTaxCodeCount()).isEqualTo(1);
    assertThat(finance.taxReadiness(actor).status()).isEqualTo("IRP_INTEGRATION_NOT_CONFIGURED");

    assertThatThrownBy(() -> finance.verifyTaxCode(actor, draft.publicId(),
        "https://cbic.gov.in/test-fixture", "Attempt to rewrite a completed verification"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThat(finance.taxReadiness(actor).irpIntegrationStatus()).isEqualTo("NOT_CONNECTED");
  }

  private StaffPrincipal createActor() {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code,name) values (?,?) returning id
        """, Long.class, "REPORT-" + suffix, "Reporting Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id,full_name,email,password_hash,status)
        values (?,'Reporting Owner',?,'test-hash-not-used','ACTIVE') returning id
        """, Long.class, dealershipId, "report-" + suffix.toLowerCase() + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id=?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id=? and id=?", UUID.class, dealershipId, staffId);
    return new StaffPrincipal(1, staffId, staffPublicId.toString(), dealershipId,
        dealershipPublicId.toString(), "REPORT-" + suffix, "Reporting Owner",
        Set.of("OWNER"), Set.of("report.read", "finance.read", "finance.close.read"));
  }
}
