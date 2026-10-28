package com.quantaedge.bajaj.finance;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Dealership-scoped operating metrics. Event metrics use each event's timestamp in the
 * configured dealership time zone; job status and stock alerts are current snapshots.
 */
@Service
public class OperationalReportsService {
  private final JdbcTemplate jdbc;

  public OperationalReportsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public OperationalReport report(StaffPrincipal actor, LocalDate fromDate, LocalDate toDate) {
    if (fromDate == null || toDate == null || fromDate.isAfter(toDate)) {
      throw badRequest("Enter a valid operations-report date range.");
    }
    if (ChronoUnit.DAYS.between(fromDate, toDate) > 365) {
      throw badRequest("Operations reports are limited to a 366-day range.");
    }
    String timezone = jdbc.queryForObject("select timezone from dealership where id=?",
        String.class, actor.dealershipId());
    ZoneId zone;
    try { zone = ZoneId.of(timezone); }
    catch (RuntimeException error) { throw conflict("Dealership time zone is invalid."); }
    if (toDate.isAfter(LocalDate.now(zone))) throw badRequest("Reports cannot include future dates.");
    Instant startInstant = fromDate.atStartOfDay(zone).toInstant();
    Instant endInstant = toDate.plusDays(1).atStartOfDay(zone).toInstant();
    Timestamp start = Timestamp.from(startInstant);
    Timestamp end = Timestamp.from(endInstant);
    long dealershipId = actor.dealershipId();

    long enquiries = count("select count(*) from sales_enquiry where dealership_id=? and created_at>=? and created_at<?",
        dealershipId, start, end);
    long bookings = count("select count(*) from sales_booking where dealership_id=? and created_at>=? and created_at<?",
        dealershipId, start, end);
    long deliveries = count("select count(*) from vehicle_sale_handover where dealership_id=? and delivered_at>=? and delivered_at<?",
        dealershipId, start, end);
    long completedTestRides = count("""
        select count(*) from sales_test_ride where dealership_id=? and status='COMPLETED'
          and completed_at>=? and completed_at<?
        """, dealershipId, start, end);
    long checkedInJobs = count("select count(*) from service_job_card where dealership_id=? and checked_in_at>=? and checked_in_at<?",
        dealershipId, start, end);
    long workshopInvoices = count("select count(*) from service_invoice where dealership_id=? and issued_at>=? and issued_at<?",
        dealershipId, start, end);
    BigDecimal workshopInvoicedAmount = amount("""
        select coalesce(sum(invoice_total),0) from service_invoice
        where dealership_id=? and issued_at>=? and issued_at<?
        """, dealershipId, start, end);
    long partReceipts = count("select count(*) from part_purchase_receipt where dealership_id=? and received_at>=? and received_at<?",
        dealershipId, start, end);
    BigDecimal partReceiptValue = amount("""
        select coalesce(sum(total_cost),0) from part_purchase_receipt
        where dealership_id=? and received_at>=? and received_at<?
        """, dealershipId, start, end);
    BigDecimal issuedUnits = amount("""
        select coalesce(sum(abs(quantity_delta)),0) from spare_part_stock_movement
        where dealership_id=? and movement_type='ISSUED_TO_JOB' and created_at>=? and created_at<?
        """, dealershipId, start, end);
    BigDecimal returnedUnits = amount("""
        select coalesce(sum(abs(quantity_delta)),0) from spare_part_stock_movement
        where dealership_id=? and movement_type='RETURNED_FROM_JOB' and created_at>=? and created_at<?
        """, dealershipId, start, end);

    List<JobStatusCount> jobStatuses = jdbc.query("""
        select status,count(*) item_count from service_job_card
        where dealership_id=? and checked_in_at>=? and checked_in_at<?
        group by status order by status
        """, (rs, n) -> new JobStatusCount(rs.getString("status"), rs.getLong("item_count")),
        dealershipId, start, end);

    List<PartMovementCount> partMovements = jdbc.query("""
        select movement_type,count(*) movement_count,coalesce(sum(abs(quantity_delta)),0) quantity
        from spare_part_stock_movement
        where dealership_id=? and created_at>=? and created_at<?
          and movement_type in ('PURCHASE_RECEIPT','RESERVATION_CREATED','RESERVATION_RELEASED',
            'ISSUED_TO_JOB','RETURNED_FROM_JOB','STOCK_CORRECTION')
        group by movement_type order by movement_type
        """, (rs, n) -> new PartMovementCount(rs.getString("movement_type"),
            rs.getLong("movement_count"), rs.getBigDecimal("quantity")), dealershipId, start, end);

    StockAlertCount stock = jdbc.queryForObject("""
        select count(*) filter (where coalesce(balance.quantity_on_hand,0)-coalesce(balance.quantity_reserved,0)<=0) out_of_stock,
          count(*) filter (where coalesce(balance.quantity_on_hand,0)-coalesce(balance.quantity_reserved,0)>0
            and coalesce(balance.low_stock_threshold,0)>0
            and (balance.quantity_on_hand-balance.quantity_reserved)<=balance.low_stock_threshold) low_stock
        from spare_part part
        left join spare_part_balance balance
          on balance.dealership_id=part.dealership_id and balance.part_id=part.id
        where part.dealership_id=? and part.active=true
        """, (rs, n) -> new StockAlertCount(rs.getLong("out_of_stock"), rs.getLong("low_stock")), dealershipId);
    return new OperationalReport(fromDate, toDate, timezone, enquiries, bookings, deliveries, completedTestRides,
        checkedInJobs, jobStatuses, workshopInvoices, workshopInvoicedAmount, partReceipts, partReceiptValue,
        issuedUnits, returnedUnits, partMovements, stock.outOfStock(), stock.lowStock());
  }

  private long count(String sql, Object... args) {
    Long value = jdbc.queryForObject(sql, Long.class, args);
    return value == null ? 0 : value;
  }

  private BigDecimal amount(String sql, Object... args) {
    BigDecimal value = jdbc.queryForObject(sql, BigDecimal.class, args);
    return value == null ? BigDecimal.ZERO : value;
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }
  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }

  public record OperationalReport(LocalDate fromDate, LocalDate toDate, String dealershipTimeZone,
      long enquiriesCreated, long bookingsCreated, long vehicleDeliveries, long completedTestRides,
      long workshopJobsCheckedIn, List<JobStatusCount> currentJobStatusesForPeriod,
      long workshopInvoicesIssued, BigDecimal workshopInvoiceValue,
      long sparePartPurchaseReceipts, BigDecimal sparePartPurchaseValue,
      BigDecimal sparePartUnitsIssued, BigDecimal sparePartUnitsReturned,
      List<PartMovementCount> sparePartMovements, long currentOutOfStockPartCount, long currentLowStockPartCount) {}
  public record JobStatusCount(String currentStatus, long jobCount) {}
  public record PartMovementCount(String movementType, long movementCount, BigDecimal quantity) {}
  private record StockAlertCount(long outOfStock, long lowStock) {}
}
