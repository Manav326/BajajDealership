package com.quantaedge.bajaj.finance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
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
