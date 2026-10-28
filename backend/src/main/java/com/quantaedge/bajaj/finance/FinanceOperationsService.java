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
