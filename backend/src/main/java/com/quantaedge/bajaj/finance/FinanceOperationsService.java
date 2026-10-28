package com.quantaedge.bajaj.finance;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class FinanceOperationsService {
  private static final BigDecimal MAX_MONEY = new BigDecimal("999999999999.99");
  private static final Set<String> PAYMENT_METHODS = Set.of("CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER");
  private static final Set<String> EXPENSE_STATUSES = Set.of("PENDING_APPROVAL", "APPROVED", "REJECTED", "REVERSED");
  private static final String EXPENSE_SELECT = """
      select e.public_id, e.expense_number, e.expense_date, e.category, e.description,
        e.vendor_name, e.payment_method, e.payment_reference, e.amount, e.status,
        e.created_at, e.reviewed_at, e.review_reason, e.reversed_at,
        creator.full_name as created_by_name, reviewer.full_name as reviewed_by_name,
        reverser.full_name as reversed_by_name, reversal.reason as reversal_reason,
        reversal.external_reference as reversal_reference
      from business_expense e
      join staff_user creator on creator.dealership_id = e.dealership_id and creator.id = e.created_by_staff_user_id
      left join staff_user reviewer on reviewer.dealership_id = e.dealership_id and reviewer.id = e.reviewed_by_staff_user_id
      left join staff_user reverser on reverser.dealership_id = e.dealership_id and reverser.id = e.reversed_by_staff_user_id
      left join business_expense_reversal reversal
        on reversal.dealership_id = e.dealership_id and reversal.expense_id = e.id
      """;

  private static final RowMapper<ExpenseView> EXPENSE_ROW_MAPPER = (rs, rowNum) -> new ExpenseView(
      rs.getObject("public_id", UUID.class), rs.getString("expense_number"),
      rs.getObject("expense_date", LocalDate.class), rs.getString("category"), rs.getString("description"),
      rs.getString("vendor_name"), rs.getString("payment_method"), rs.getString("payment_reference"),
      rs.getBigDecimal("amount"), rs.getString("status"), rs.getString("created_by_name"),
      rs.getString("reviewed_by_name"), instant(rs, "created_at"), instant(rs, "reviewed_at"),
      rs.getString("review_reason"), rs.getString("reversed_by_name"), instant(rs, "reversed_at"),
      rs.getString("reversal_reason"), rs.getString("reversal_reference"));

  private final JdbcTemplate jdbc;

  public FinanceOperationsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public FinanceSummary getSummary(StaffPrincipal actor) {
    InvoiceMetric sales = jdbc.queryForObject("""
        select count(*) as invoice_count, coalesce(sum(invoice_total), 0) as invoiced
        from vehicle_sale_invoice where dealership_id = ? and status = 'ISSUED'
        """, (rs, n) -> new InvoiceMetric(rs.getLong("invoice_count"), rs.getBigDecimal("invoiced")), actor.dealershipId());
    InvoiceMetric workshop = jdbc.queryForObject("""
        select count(*) as invoice_count, coalesce(sum(invoice_total), 0) as invoiced
        from service_invoice where dealership_id = ? and status = 'ISSUED'
        """, (rs, n) -> new InvoiceMetric(rs.getLong("invoice_count"), rs.getBigDecimal("invoiced")), actor.dealershipId());
    BigDecimal salesCollected = amount("""
        select coalesce(sum(p.amount), 0)
        from vehicle_sale_payment p join vehicle_sale_invoice i
          on i.dealership_id = p.dealership_id and i.id = p.invoice_id
        where p.dealership_id = ? and p.status = 'RECORDED' and i.status = 'ISSUED'
        """, actor.dealershipId());
    BigDecimal salesOutstanding = amount("""
        select coalesce(sum(greatest(i.invoice_total - coalesce(paid.paid_amount, 0), 0)), 0)
        from vehicle_sale_invoice i
        left join (
          select dealership_id, invoice_id, sum(amount) as paid_amount
          from vehicle_sale_payment where status = 'RECORDED' group by dealership_id, invoice_id
        ) paid on paid.dealership_id = i.dealership_id and paid.invoice_id = i.id
        where i.dealership_id = ? and i.status = 'ISSUED'
        """, actor.dealershipId());
    BigDecimal workshopCollected = amount("""
        select coalesce(sum(allocation.amount), 0)
        from service_payment_allocation allocation
        join service_payment payment on payment.dealership_id = allocation.dealership_id
          and payment.id = allocation.payment_id and payment.status = 'RECORDED'
        join service_invoice invoice on invoice.dealership_id = allocation.dealership_id
          and invoice.id = allocation.invoice_id and invoice.status = 'ISSUED'
        where allocation.dealership_id = ?
        """, actor.dealershipId());
    BigDecimal workshopOutstanding = amount("""
        select coalesce(sum(greatest(i.invoice_total - coalesce(paid.paid_amount, 0), 0)), 0)
        from service_invoice i
        left join (
          select allocation.dealership_id, allocation.invoice_id, sum(allocation.amount) as paid_amount
          from service_payment_allocation allocation
          join service_payment payment on payment.dealership_id = allocation.dealership_id
            and payment.id = allocation.payment_id and payment.status = 'RECORDED'
          group by allocation.dealership_id, allocation.invoice_id
        ) paid on paid.dealership_id = i.dealership_id and paid.invoice_id = i.id
        where i.dealership_id = ? and i.status = 'ISSUED'
        """, actor.dealershipId());
    BigDecimal approvedExpenses = amount("""
        select coalesce(sum(amount), 0) from business_expense
        where dealership_id = ? and status = 'APPROVED'
        """, actor.dealershipId());
    Long pending = jdbc.queryForObject("""
        select count(*) from business_expense
        where dealership_id = ? and status = 'PENDING_APPROVAL'
        """, Long.class, actor.dealershipId());

    return new FinanceSummary(
        sales == null ? 0 : sales.count(), zeroIfNull(sales == null ? null : sales.amount()),
        salesCollected, salesOutstanding, workshop == null ? 0 : workshop.count(),
        zeroIfNull(workshop == null ? null : workshop.amount()), workshopCollected, workshopOutstanding,
        salesOutstanding.add(workshopOutstanding), approvedExpenses, pending == null ? 0 : pending);
  }

  public List<ExpenseView> listExpenses(StaffPrincipal actor, String rawStatus) {
    String status = rawStatus == null ? "ALL" : rawStatus.trim().toUpperCase(Locale.ROOT);
    if (!"ALL".equals(status) && !EXPENSE_STATUSES.contains(status)) throw badRequest("Expense status filter is not supported.");
    StringBuilder sql = new StringBuilder(EXPENSE_SELECT).append(" where e.dealership_id = ? ");
    if (!"ALL".equals(status)) sql.append(" and e.status = ? ");
    sql.append(" order by e.expense_date desc, e.created_at desc limit 200");
    if ("ALL".equals(status)) return jdbc.query(sql.toString(), EXPENSE_ROW_MAPPER, actor.dealershipId());
    return jdbc.query(sql.toString(), EXPENSE_ROW_MAPPER, actor.dealershipId(), status);
  }

  @Transactional
  public ExpenseView createExpense(StaffPrincipal actor, CreateExpenseRequest request) {
    String key = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    if (request.expenseDate() == null) throw badRequest("Expense date is required.");
    String category = requiredText(request.category(), "Category", 64);
    String description = requiredText(request.description(), "Description", 500);
    String vendor = optionalText(request.vendorName(), 160);
    String method = requiredText(request.paymentMethod(), "Payment method", 24).toUpperCase(Locale.ROOT);
    if (!PAYMENT_METHODS.contains(method)) throw badRequest("Payment method is not supported.");
    String reference = optionalText(request.paymentReference(), 160);
    BigDecimal money = normalizeMoney(request.amount());
    String fingerprint = fingerprint(request.expenseDate().toString(), category, description, vendor,
        method, reference, money.toPlainString());
    String number = "EXP-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);

    List<UUID> inserted = jdbc.query("""
        insert into business_expense(
          dealership_id, expense_number, idempotency_key, request_fingerprint, expense_date,
          category, description, vendor_name, payment_method, payment_reference, amount,
          status, created_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?)
        on conflict (dealership_id, idempotency_key) do nothing returning public_id
        """, (rs, n) -> rs.getObject(1, UUID.class), actor.dealershipId(), number, key, fingerprint,
        request.expenseDate(), category, description, vendor, method, reference, money, actor.staffUserId());

    UUID publicId;
    if (inserted.isEmpty()) {
      List<Map<String, Object>> existing = jdbc.queryForList("""
          select public_id, request_fingerprint from business_expense
          where dealership_id = ? and idempotency_key = ?
          """, actor.dealershipId(), key);
      if (existing.isEmpty()) throw conflict("The expense could not be saved. Retry with the same request key.");
      Map<String, Object> prior = existing.getFirst();
      if (!fingerprint.equals(String.valueOf(prior.get("request_fingerprint")).trim())) {
        throw conflict("This request key was already used for a different expense.");
      }
      publicId = (UUID) prior.get("public_id");
      return getExpense(actor, publicId);
    }
    publicId = inserted.getFirst();
    audit(actor, "BUSINESS_EXPENSE_SUBMITTED", publicId.toString(), null,
        "Expense " + number + " submitted for approval; amount " + money.toPlainString() + ".");
    return getExpense(actor, publicId);
  }

  @Transactional
  public ExpenseView approveExpense(StaffPrincipal actor, UUID publicId) {
    LockedExpense expense = lockExpense(actor, publicId);
    requirePending(expense);
    requireIndependentReview(actor, expense);
    int changed = jdbc.update("""
        update business_expense set status = 'APPROVED', reviewed_by_staff_user_id = ?,
          reviewed_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'PENDING_APPROVAL'
        """, actor.staffUserId(), actor.dealershipId(), expense.id());
    if (changed != 1) throw conflict("Expense status changed during approval. Reload and try again.");
    audit(actor, "BUSINESS_EXPENSE_APPROVED", publicId.toString(), null,
        "Expense approved and included in approved expense totals.");
    return getExpense(actor, publicId);
  }

  @Transactional
  public ExpenseView rejectExpense(StaffPrincipal actor, UUID publicId, String rawReason) {
    LockedExpense expense = lockExpense(actor, publicId);
    requirePending(expense);
    requireIndependentReview(actor, expense);
    String reason = requiredText(rawReason, "Rejection reason", 500);
    int changed = jdbc.update("""
        update business_expense set status = 'REJECTED', reviewed_by_staff_user_id = ?,
          reviewed_at = now(), review_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'PENDING_APPROVAL'
        """, actor.staffUserId(), reason, actor.dealershipId(), expense.id());
    if (changed != 1) throw conflict("Expense status changed during rejection. Reload and try again.");
    audit(actor, "BUSINESS_EXPENSE_REJECTED", publicId.toString(), reason,
        "Expense rejected; rejection reason is retained in the expense ledger.");
    return getExpense(actor, publicId);
  }

  @Transactional
  public ExpenseView reverseExpense(StaffPrincipal actor, UUID publicId, String rawReason, String rawReference) {
    LockedExpense expense = lockExpense(actor, publicId);
    if (!"APPROVED".equals(expense.status())) throw conflict("Only an approved expense can be reversed. History is retained.");
    String reason = requiredText(rawReason, "Reversal reason", 500);
    String reference = optionalText(rawReference, 160);
    int changed = jdbc.update("""
        update business_expense set status = 'REVERSED', reversed_by_staff_user_id = ?,
          reversed_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'APPROVED'
        """, actor.staffUserId(), actor.dealershipId(), expense.id());
    if (changed != 1) throw conflict("Expense status changed during reversal. Reload and try again.");
    jdbc.update("""
        insert into business_expense_reversal(
          dealership_id, expense_id, reason, external_reference, reversed_by_staff_user_id)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), expense.id(), reason, reference, actor.staffUserId());
    audit(actor, "BUSINESS_EXPENSE_REVERSED", publicId.toString(), reason,
        "Approved expense reversed. The original record and reversal reason are retained.");
    return getExpense(actor, publicId);
  }

  private LockedExpense lockExpense(StaffPrincipal actor, UUID publicId) {
    List<LockedExpense> rows = jdbc.query("""
        select id, status, created_by_staff_user_id from business_expense
        where dealership_id = ? and public_id = ? for update
        """, (rs, n) -> new LockedExpense(rs.getLong("id"), rs.getString("status"),
        rs.getLong("created_by_staff_user_id")), actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Expense was not found for this dealership.");
    return rows.getFirst();
  }

  private void requirePending(LockedExpense expense) {
    if (!"PENDING_APPROVAL".equals(expense.status())) throw conflict("Only an expense awaiting review can be approved or rejected.");
  }

  private void requireIndependentReview(StaffPrincipal actor, LockedExpense expense) {
    if (actor.staffUserId() == expense.createdByStaffUserId()
        && (actor.roles() == null || !actor.roles().contains("OWNER"))) {
      throw conflict("A staff member cannot review their own expense. Ask another authorised approver.");
    }
  }

  private ExpenseView getExpense(StaffPrincipal actor, UUID publicId) {
    List<ExpenseView> rows = jdbc.query(EXPENSE_SELECT + " where e.dealership_id = ? and e.public_id = ?",
        EXPENSE_ROW_MAPPER, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Expense was not found for this dealership.");
    return rows.getFirst();
  }

  private BigDecimal amount(String sql, long dealershipId) {
    return zeroIfNull(jdbc.queryForObject(sql, BigDecimal.class, dealershipId));
  }

  private void audit(StaffPrincipal actor, String action, String entityId, String reason, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, reason, details)
        values (?, 'STAFF', ?, ?, 'BUSINESS_EXPENSE', ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, entityId, reason, summary);
  }

  private static BigDecimal normalizeMoney(BigDecimal raw) {
    if (raw == null || raw.signum() <= 0 || raw.compareTo(MAX_MONEY) > 0) {
      throw badRequest("Expense amount must be greater than zero and within the supported range.");
    }
    try {
      return raw.setScale(2, RoundingMode.UNNECESSARY);
    } catch (ArithmeticException invalidScale) {
      throw badRequest("Expense amount may contain at most two decimal places.");
    }
  }

  private static String fingerprint(String... fields) {
    try {
      StringBuilder canonical = new StringBuilder();
      for (String field : fields) {
        String value = field == null ? "" : field;
        canonical.append(value.length()).append(':').append(value);
      }
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required by the Java runtime.", impossible);
    }
  }

  private static String requiredText(String raw, String label, int maxLength) {
    String value = optionalText(raw, maxLength);
    if (value == null) throw badRequest(label + " is required.");
    return value;
  }

  private static String optionalText(String raw, int maxLength) {
    if (raw == null) return null;
    String value = raw.trim();
    if (value.isEmpty()) return null;
    if (value.length() > maxLength || value.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return value;
  }

  private static BigDecimal zeroIfNull(BigDecimal value) {
    return value == null ? BigDecimal.ZERO.setScale(2) : value;
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    Timestamp value = rs.getTimestamp(column);
    return value == null ? null : value.toInstant();
  }

  private static ResponseStatusException notFound(String message) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }


  public DailyCloseView previewDailyClose(StaffPrincipal actor, LocalDate businessDate) {
    validateBusinessDate(actor, businessDate);
    List<Map<String,Object>> headers = jdbc.queryForList("""
        select c.id,c.public_id,c.notes,c.closed_at,staff.full_name as closed_by_name
        from daily_finance_close c
        join staff_user staff on staff.dealership_id=c.dealership_id and staff.id=c.closed_by_staff_user_id
        where c.dealership_id=? and c.business_date=?
        """, actor.dealershipId(), businessDate);
    if (!headers.isEmpty()) {
      Map<String,Object> header=headers.getFirst();
      long id=((Number)header.get("id")).longValue();
      List<ChannelReconciliation> snapshot=readCloseChannels(actor.dealershipId(),id);
      return closeView((UUID)header.get("public_id"),businessDate,true,instant(header.get("closed_at")),
          (String)header.get("closed_by_name"),(String)header.get("notes"),snapshot);
    }
    return closeView(null,businessDate,false,null,null,null,
        calculateChannels(actor,businessDate,zeroChannels(),zeroChannels()));
  }

  @Transactional
  public DailyCloseView closeBusinessDay(StaffPrincipal actor, DailyCloseRequest request) {
    if(request==null || request.businessDate()==null) throw badRequest("Business date is required.");
    LocalDate date=request.businessDate();
    validateBusinessDate(actor,date);
    if(!jdbc.query("select id from daily_finance_close where dealership_id=? and business_date=?",
        (rs,n)->rs.getLong(1),actor.dealershipId(),date).isEmpty()) {
      throw conflict("This business date is already closed. Saved close snapshots cannot be overwritten.");
    }
    MoneyChannels opening=normalizeChannels(request.openingBalances(),"Opening balance");
    MoneyChannels counted=normalizeChannels(request.countedClosing(),"Counted closing balance");
    String notes=optionalText(request.notes(),1000);
    List<ChannelReconciliation> channels=calculateChannels(actor,date,opening,counted);
    try {
      Map<String,Object> inserted=jdbc.queryForList("""
          insert into daily_finance_close(dealership_id,business_date,notes,closed_by_staff_user_id)
          values(?,?,?,?) returning id,public_id,closed_at
          """,actor.dealershipId(),date,notes,actor.staffUserId()).getFirst();
      long closeId=((Number)inserted.get("id")).longValue();
      UUID closePublicId=(UUID)inserted.get("public_id");
      for(ChannelReconciliation c:channels) jdbc.update("""
          insert into daily_finance_close_channel(dealership_id,close_id,payment_method,opening_balance,
            recorded_collections,payment_reversals,approved_expenses,expense_reversals,
            expected_closing,counted_closing,variance)
          values(?,?,?,?,?,?,?,?,?,?,?)
          """,actor.dealershipId(),closeId,c.paymentMethod(),c.openingBalance(),c.recordedCollections(),
          c.paymentReversals(),c.approvedExpenses(),c.expenseReversals(),c.expectedClosing(),c.countedClosing(),c.variance());
      BigDecimal netVariance=channels.stream().map(ChannelReconciliation::variance).reduce(BigDecimal.ZERO,BigDecimal::add);
      jdbc.update("""
          insert into audit_event(dealership_id,actor_kind,actor_staff_user_id,action,entity_type,entity_id,reason,details)
          values(?,'STAFF',?,'DAILY_FINANCE_CLOSED','DAILY_FINANCE_CLOSE',?,
            'Daily close saved as an immutable snapshot.',
            jsonb_build_object('businessDate',?,'netVariance',?))
          """,actor.dealershipId(),actor.staffUserId(),closePublicId.toString(),date.toString(),netVariance);
      return closeView(closePublicId,date,true,instant(inserted.get("closed_at")),actor.fullName(),notes,channels);
    } catch(org.springframework.dao.DuplicateKeyException duplicate) {
      throw conflict("Another authorised user closed this date first. Reload the saved close.");
    }
  }

  public List<DailyFinanceReport> getDailyReports(StaffPrincipal actor, LocalDate fromDate, LocalDate toDate) {
    if(fromDate==null || toDate==null || fromDate.isAfter(toDate)) throw badRequest("Enter a valid report date range.");
    if(ChronoUnit.DAYS.between(fromDate,toDate)>365) throw badRequest("Reports are limited to a 366-day range.");
    ZoneId zone=dealershipZone(actor);
    if(toDate.isAfter(LocalDate.now(zone))) throw badRequest("Reports cannot include future dates.");
    Instant start=fromDate.atStartOfDay(zone).toInstant(), end=toDate.plusDays(1).atStartOfDay(zone).toInstant();
    Map<LocalDate,MutableFinanceReport> byDate=new HashMap<>();
    for(LocalDate day=fromDate;!day.isAfter(toDate);day=day.plusDays(1)) byDate.put(day,new MutableFinanceReport(day));

    appendTimedReport(actor,zone,start,end,byDate,"SALES_INVOICED", """
      select (i.issued_at at time zone ?)::date business_date,sum(i.invoice_total) amount,count(*) event_count
      from vehicle_sale_invoice i where i.dealership_id=? and i.issued_at is not null
        and i.issued_at>=? and i.issued_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"SALES_CANCELLED", """
      select (i.cancelled_at at time zone ?)::date business_date,sum(i.invoice_total) amount,count(*) event_count
      from vehicle_sale_invoice i where i.dealership_id=? and i.cancelled_at is not null
        and i.cancelled_at>=? and i.cancelled_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"WORKSHOP_INVOICED", """
      select (i.issued_at at time zone ?)::date business_date,sum(i.invoice_total) amount,count(*) event_count
      from service_invoice i where i.dealership_id=? and i.issued_at is not null
        and i.issued_at>=? and i.issued_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"WORKSHOP_CANCELLED", """
      select (i.cancelled_at at time zone ?)::date business_date,sum(i.invoice_total) amount,count(*) event_count
      from service_invoice i where i.dealership_id=? and i.cancelled_at is not null
        and i.cancelled_at>=? and i.cancelled_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"SALES_COLLECTIONS", """
      select (p.recorded_at at time zone ?)::date business_date,sum(p.amount) amount,count(*) event_count
      from vehicle_sale_payment p where p.dealership_id=? and p.recorded_at>=? and p.recorded_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"WORKSHOP_COLLECTIONS", """
      select (p.recorded_at at time zone ?)::date business_date,sum(p.amount) amount,count(*) event_count
      from service_payment p where p.dealership_id=? and p.recorded_at>=? and p.recorded_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"SALES_REVERSALS", """
      select (r.reversed_at at time zone ?)::date business_date,sum(p.amount) amount,count(*) event_count
      from vehicle_sale_payment_reversal r join vehicle_sale_payment p
        on p.dealership_id=r.dealership_id and p.id=r.payment_id
      where r.dealership_id=? and r.reversed_at>=? and r.reversed_at<? group by 1
      """);
    appendTimedReport(actor,zone,start,end,byDate,"WORKSHOP_REVERSALS", """
      select (r.reversed_at at time zone ?)::date business_date,sum(p.amount) amount,count(*) event_count
      from service_payment_reversal r join service_payment p
        on p.dealership_id=r.dealership_id and p.id=r.payment_id
      where r.dealership_id=? and r.reversed_at>=? and r.reversed_at<? group by 1
      """);
    appendDateReport(actor,fromDate,toDate,byDate,"EXPENSES", """
      select expense_date business_date,sum(amount) amount,count(*) event_count from business_expense
      where dealership_id=? and expense_date between ? and ? and status in ('APPROVED','REVERSED') group by expense_date
      """);
    appendTimedReport(actor,zone,start,end,byDate,"EXPENSE_REVERSALS", """
      select (r.reversed_at at time zone ?)::date business_date,sum(e.amount) amount,count(*) event_count
      from business_expense_reversal r join business_expense e
        on e.dealership_id=r.dealership_id and e.id=r.expense_id
      where r.dealership_id=? and r.reversed_at>=? and r.reversed_at<? group by 1
      """);
    return byDate.values().stream().map(MutableFinanceReport::view)
        .sorted(Comparator.comparing(DailyFinanceReport::businessDate)).toList();
  }

  private void appendTimedReport(StaffPrincipal actor,ZoneId zone,Instant start,Instant end,
      Map<LocalDate,MutableFinanceReport> destination,String event,String sql) {
    List<ReportAggregate> rows=jdbc.query(sql,(rs,n)->new ReportAggregate(
        rs.getObject("business_date",LocalDate.class),rs.getBigDecimal("amount"),rs.getLong("event_count")),
        zone.getId(),actor.dealershipId(),Timestamp.from(start),Timestamp.from(end));
    addReportRows(destination,event,rows);
  }
  private void appendDateReport(StaffPrincipal actor,LocalDate from,LocalDate to,
      Map<LocalDate,MutableFinanceReport> destination,String event,String sql) {
    List<ReportAggregate> rows=jdbc.query(sql,(rs,n)->new ReportAggregate(
        rs.getObject("business_date",LocalDate.class),rs.getBigDecimal("amount"),rs.getLong("event_count")),
        actor.dealershipId(),from,to);
    addReportRows(destination,event,rows);
  }
  private void addReportRows(Map<LocalDate,MutableFinanceReport> destination,String event,List<ReportAggregate> rows) {
    for(ReportAggregate e:rows) {
      MutableFinanceReport r=destination.get(e.date()); if(r==null) continue;
      BigDecimal v=zeroIfNull(e.amount());
      switch(event) {
        case "SALES_INVOICED" -> {r.salesInvoices=r.salesInvoices.add(v);r.salesInvoiceCount+=e.count();}
        case "SALES_CANCELLED" -> r.salesCancelled=r.salesCancelled.add(v);
        case "WORKSHOP_INVOICED" -> {r.workshopInvoices=r.workshopInvoices.add(v);r.workshopInvoiceCount+=e.count();}
        case "WORKSHOP_CANCELLED" -> r.workshopCancelled=r.workshopCancelled.add(v);
        case "SALES_COLLECTIONS" -> {r.salesCollections=r.salesCollections.add(v);r.salesReceiptCount+=e.count();}
        case "WORKSHOP_COLLECTIONS" -> {r.workshopCollections=r.workshopCollections.add(v);r.workshopReceiptCount+=e.count();}
        case "SALES_REVERSALS" -> r.salesReversals=r.salesReversals.add(v);
        case "WORKSHOP_REVERSALS" -> r.workshopReversals=r.workshopReversals.add(v);
        case "EXPENSES" -> r.expenses=r.expenses.add(v);
        case "EXPENSE_REVERSALS" -> r.expenseReversals=r.expenseReversals.add(v);
        default -> throw new IllegalArgumentException("Unknown report event type.");
      }
    }
  }

  private List<ChannelReconciliation> calculateChannels(StaffPrincipal actor,LocalDate date,
      MoneyChannels openingRaw,MoneyChannels countedRaw) {
    ZoneId zone=dealershipZone(actor);
    Timestamp start=Timestamp.from(date.atStartOfDay(zone).toInstant());
    Timestamp end=Timestamp.from(date.plusDays(1).atStartOfDay(zone).toInstant());
    Map<String,BigDecimal> collection=new HashMap<>(),reverse=new HashMap<>();
    addAmounts(collection,queryChannelAmounts("""
      select payment_method,coalesce(sum(amount),0) amount from vehicle_sale_payment
      where dealership_id=? and recorded_at>=? and recorded_at<? group by payment_method
      """,actor.dealershipId(),start,end));
    addAmounts(collection,queryChannelAmounts("""
      select payment_method,coalesce(sum(amount),0) amount from service_payment
      where dealership_id=? and recorded_at>=? and recorded_at<? group by payment_method
      """,actor.dealershipId(),start,end));
    addAmounts(reverse,queryChannelAmounts("""
      select p.payment_method,coalesce(sum(p.amount),0) amount from vehicle_sale_payment_reversal r
      join vehicle_sale_payment p on p.dealership_id=r.dealership_id and p.id=r.payment_id
      where r.dealership_id=? and r.reversed_at>=? and r.reversed_at<? group by p.payment_method
      """,actor.dealershipId(),start,end));
    addAmounts(reverse,queryChannelAmounts("""
      select p.payment_method,coalesce(sum(p.amount),0) amount from service_payment_reversal r
      join service_payment p on p.dealership_id=r.dealership_id and p.id=r.payment_id
      where r.dealership_id=? and r.reversed_at>=? and r.reversed_at<? group by p.payment_method
      """,actor.dealershipId(),start,end));
    Map<String,BigDecimal> expenses=queryChannelAmounts("""
      select payment_method,coalesce(sum(amount),0) amount from business_expense
      where dealership_id=? and expense_date=? and status in ('APPROVED','REVERSED') group by payment_method
      """,actor.dealershipId(),date);
    Map<String,BigDecimal> expenseRev=queryChannelAmounts("""
      select e.payment_method,coalesce(sum(e.amount),0) amount from business_expense_reversal r
      join business_expense e on e.dealership_id=r.dealership_id and e.id=r.expense_id
      where r.dealership_id=? and r.reversed_at>=? and r.reversed_at<? group by e.payment_method
      """,actor.dealershipId(),start,end);
    MoneyChannels opening=normalizeChannels(openingRaw,"Opening balance");
    MoneyChannels counted=normalizeChannels(countedRaw,"Counted closing balance");
    List<ChannelReconciliation> result=new ArrayList<>();
    for(String method:List.of("CASH","UPI","BANK_TRANSFER","CARD","OTHER")) {
      BigDecimal o=channelValue(opening,method),c=zeroIfNull(collection.get(method));
      BigDecimal p=zeroIfNull(reverse.get(method)),e=zeroIfNull(expenses.get(method));
      BigDecimal er=zeroIfNull(expenseRev.get(method)),count=channelValue(counted,method);
      BigDecimal expected=o.add(c).subtract(p).subtract(e).add(er).setScale(2,RoundingMode.HALF_UP);
      result.add(new ChannelReconciliation(method,o,c,p,e,er,expected,count,count.subtract(expected).setScale(2,RoundingMode.HALF_UP)));
    }
    return List.copyOf(result);
  }

  private List<ChannelReconciliation> readCloseChannels(long dealershipId,long closeId) {
    return jdbc.query("""
      select payment_method,opening_balance,recorded_collections,payment_reversals,approved_expenses,
        expense_reversals,expected_closing,counted_closing,variance
      from daily_finance_close_channel where dealership_id=? and close_id=?
      order by case payment_method when 'CASH' then 1 when 'UPI' then 2 when 'BANK_TRANSFER' then 3 when 'CARD' then 4 else 5 end
      """,CHANNEL_ROW_MAPPER,dealershipId,closeId);
  }

  private Map<String,BigDecimal> queryChannelAmounts(String sql,Object... args) {
    List<ChannelAmount> rows=jdbc.query(sql,(rs,n)->new ChannelAmount(rs.getString("payment_method"),rs.getBigDecimal("amount")),args);
    Map<String,BigDecimal> values=new HashMap<>(); for(ChannelAmount row:rows) values.put(row.method(),zeroIfNull(row.amount()));
    return values;
  }
  private static void addAmounts(Map<String,BigDecimal> target,Map<String,BigDecimal> source) {
    source.forEach((key,value)->target.merge(key,zeroIfNull(value),BigDecimal::add));
  }
  private DailyCloseView closeView(UUID id,LocalDate date,boolean closed,Instant closedAt,String closedBy,
      String notes,List<ChannelReconciliation> channels) {
    BigDecimal expected=channels.stream().map(ChannelReconciliation::expectedClosing).reduce(BigDecimal.ZERO,BigDecimal::add);
    BigDecimal counted=channels.stream().map(ChannelReconciliation::countedClosing).reduce(BigDecimal.ZERO,BigDecimal::add);
    BigDecimal variance=channels.stream().map(ChannelReconciliation::variance).reduce(BigDecimal.ZERO,BigDecimal::add);
    return new DailyCloseView(id,date,closed,closedAt,closedBy,notes,channels,
      expected.setScale(2,RoundingMode.HALF_UP),counted.setScale(2,RoundingMode.HALF_UP),variance.setScale(2,RoundingMode.HALF_UP));
  }
  private void validateBusinessDate(StaffPrincipal actor,LocalDate date) {
    if(date==null) throw badRequest("Business date is required.");
    if(date.isAfter(LocalDate.now(dealershipZone(actor)))) throw badRequest("A future business date cannot be closed.");
  }
  private ZoneId dealershipZone(StaffPrincipal actor) {
    String zone=jdbc.queryForObject("select timezone from dealership where id=?",String.class,actor.dealershipId());
    try { return ZoneId.of(zone); } catch(RuntimeException error) { throw conflict("Dealership time zone is invalid."); }
  }
  private MoneyChannels normalizeChannels(MoneyChannels raw,String label) {
    MoneyChannels v=raw==null?zeroChannels():raw;
    return new MoneyChannels(normalizeBalance(v.cash(),label+" cash"),normalizeBalance(v.upi(),label+" UPI"),
      normalizeBalance(v.bankTransfer(),label+" bank transfer"),normalizeBalance(v.card(),label+" card"),
      normalizeBalance(v.other(),label+" other"));
  }
  private BigDecimal normalizeBalance(BigDecimal raw,String label) {
    BigDecimal v=raw==null?BigDecimal.ZERO:raw;
    if(v.signum()<0 || v.compareTo(MAX_MONEY)>0) throw badRequest(label+" must be non-negative and within the supported range.");
    try{return v.setScale(2,RoundingMode.UNNECESSARY);}catch(ArithmeticException e){throw badRequest(label+" may have at most two decimal places.");}
  }
  private static BigDecimal channelValue(MoneyChannels c,String method) {
    return zeroIfNull(switch(method){case "CASH"->c.cash();case "UPI"->c.upi();case "BANK_TRANSFER"->c.bankTransfer();case "CARD"->c.card();default->c.other();});
  }
  private static MoneyChannels zeroChannels(){return new MoneyChannels(BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO);}
  private static Instant instant(Object o) {
    if(o==null) return null; if(o instanceof Timestamp t) return t.toInstant();
    if(o instanceof java.time.OffsetDateTime t) return t.toInstant(); if(o instanceof Instant t) return t;
    throw new IllegalStateException("Unexpected database timestamp type.");
  }
  private static final RowMapper<ChannelReconciliation> CHANNEL_ROW_MAPPER=(rs,n)->new ChannelReconciliation(
    rs.getString("payment_method"),rs.getBigDecimal("opening_balance"),rs.getBigDecimal("recorded_collections"),
    rs.getBigDecimal("payment_reversals"),rs.getBigDecimal("approved_expenses"),rs.getBigDecimal("expense_reversals"),
    rs.getBigDecimal("expected_closing"),rs.getBigDecimal("counted_closing"),rs.getBigDecimal("variance"));
  private record ChannelAmount(String method,BigDecimal amount){}
  private record ReportAggregate(LocalDate date,BigDecimal amount,long count){}
  private static final class MutableFinanceReport {
    private final LocalDate date;
    private BigDecimal salesInvoices=BigDecimal.ZERO,salesCancelled=BigDecimal.ZERO,workshopInvoices=BigDecimal.ZERO,
      workshopCancelled=BigDecimal.ZERO,salesCollections=BigDecimal.ZERO,workshopCollections=BigDecimal.ZERO,
      salesReversals=BigDecimal.ZERO,workshopReversals=BigDecimal.ZERO,expenses=BigDecimal.ZERO,expenseReversals=BigDecimal.ZERO;
    private long salesInvoiceCount,workshopInvoiceCount,salesReceiptCount,workshopReceiptCount;
    private MutableFinanceReport(LocalDate date){this.date=date;}
    private DailyFinanceReport view(){return new DailyFinanceReport(date,salesInvoices,salesCancelled,salesInvoiceCount,
      workshopInvoices,workshopCancelled,workshopInvoiceCount,salesCollections,salesReceiptCount,workshopCollections,
      workshopReceiptCount,salesReversals,workshopReversals,expenses,expenseReversals);}
  }
  public record MoneyChannels(BigDecimal cash,BigDecimal upi,BigDecimal bankTransfer,BigDecimal card,BigDecimal other){}
  public record DailyCloseRequest(LocalDate businessDate,MoneyChannels openingBalances,MoneyChannels countedClosing,String notes){}
  public record ChannelReconciliation(String paymentMethod,BigDecimal openingBalance,BigDecimal recordedCollections,
    BigDecimal paymentReversals,BigDecimal approvedExpenses,BigDecimal expenseReversals,BigDecimal expectedClosing,
    BigDecimal countedClosing,BigDecimal variance){}
  public record DailyCloseView(UUID publicId,LocalDate businessDate,boolean closed,Instant closedAt,String closedByName,
    String notes,List<ChannelReconciliation> channels,BigDecimal expectedTotal,BigDecimal countedTotal,BigDecimal varianceTotal){}
  public record DailyFinanceReport(LocalDate businessDate,BigDecimal salesInvoiced,BigDecimal salesCancelled,
    long salesInvoiceCount,BigDecimal workshopInvoiced,BigDecimal workshopCancelled,long workshopInvoiceCount,
    BigDecimal salesCollections,long salesReceiptCount,BigDecimal workshopCollections,long workshopReceiptCount,
    BigDecimal salesPaymentReversals,BigDecimal workshopPaymentReversals,BigDecimal approvedExpenses,BigDecimal expenseReversals){}

  private record InvoiceMetric(long count, BigDecimal amount) {}
  private record LockedExpense(long id, String status, long createdByStaffUserId) {}

  public record CreateExpenseRequest(String idempotencyKey, LocalDate expenseDate, String category,
      String description, String vendorName, String paymentMethod, String paymentReference, BigDecimal amount) {}

  public record FinanceSummary(long salesInvoiceCount, BigDecimal salesInvoicedAmount,
      BigDecimal salesCollectedAmount, BigDecimal salesOutstandingAmount,
      long workshopInvoiceCount, BigDecimal workshopInvoicedAmount,
      BigDecimal workshopCollectedAmount, BigDecimal workshopOutstandingAmount,
      BigDecimal totalOutstandingAmount, BigDecimal approvedExpenseAmount, long pendingExpenseCount) {}

  public record ExpenseView(UUID publicId, String expenseNumber, LocalDate expenseDate,
      String category, String description, String vendorName, String paymentMethod,
      String paymentReference, BigDecimal amount, String status, String createdByName,
      String reviewedByName, Instant createdAt, Instant reviewedAt, String reviewReason,
      String reversedByName, Instant reversedAt, String reversalReason, String reversalReference) {}
}
