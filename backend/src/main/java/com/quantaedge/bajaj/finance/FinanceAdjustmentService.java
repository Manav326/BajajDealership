package com.quantaedge.bajaj.finance;

import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
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

/**
 * Immutable operational credit-note/refund workflow. This records authorisation and
 * staff-attested payout evidence; it does not create a GST credit note or move money.
 */
@Service
public class FinanceAdjustmentService {
  private static final BigDecimal MAX_AMOUNT = new BigDecimal("999999999999.99");
  private static final Set<String> TYPES = Set.of("CREDIT_NOTE", "REFUND");
  private static final Set<String> SOURCES = Set.of("SALES", "WORKSHOP");
  private static final Set<String> METHODS = Set.of("CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER");
  private static final String ACTIVE_STATES = "'PENDING_APPROVAL','APPROVED','PAID'";

  private final JdbcTemplate jdbc;

  public FinanceAdjustmentService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static final RowMapper<InvoiceCandidate> INVOICE_MAPPER = (rs, n) -> {
    BigDecimal total = rs.getBigDecimal("invoice_total");
    BigDecimal paid = zero(rs.getBigDecimal("paid_amount"));
    BigDecimal approved = zero(rs.getBigDecimal("approved_credit_amount"));
    BigDecimal reserved = zero(rs.getBigDecimal("reserved_credit_amount"));
    return new InvoiceCandidate(rs.getString("source_type"), rs.getObject("invoice_public_id", UUID.class),
        rs.getString("invoice_number"), rs.getString("customer_name"), rs.getString("customer_phone"),
        rs.getString("status"), total, paid, approved, total.subtract(reserved).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
  };

  private static final RowMapper<AdjustmentView> ADJUSTMENT_MAPPER = (rs, n) -> new AdjustmentView(
      rs.getObject("public_id", UUID.class), rs.getString("adjustment_number"), rs.getString("adjustment_type"),
      rs.getString("source_type"), rs.getObject("invoice_public_id", UUID.class), rs.getString("invoice_number"),
      rs.getString("customer_name"), rs.getObject("parent_public_id", UUID.class),
      rs.getObject("payment_public_id", UUID.class), rs.getString("payment_receipt_number"),
      rs.getBigDecimal("amount"), rs.getString("reason"), rs.getString("status"),
      rs.getString("created_by_name"), instant(rs, "created_at"), rs.getString("reviewed_by_name"),
      instantNullable(rs, "reviewed_at"), rs.getString("review_reason"), rs.getString("paid_by_name"),
      instantNullable(rs, "paid_at"), rs.getString("payment_method"), rs.getString("payment_reference"));

  public List<InvoiceCandidate> findIssuedInvoices(StaffPrincipal actor, String rawQuery) {
    String value = rawQuery == null ? "" : rawQuery.trim();
    if (value.length() > 160) throw badRequest("Invoice search text is too long.");
    String pattern = value.isEmpty() ? null : "%" + value.toLowerCase(Locale.ROOT) + "%";
    List<InvoiceCandidate> result = new ArrayList<>();
    result.addAll(jdbc.query("""
        select 'SALES' source_type, i.public_id invoice_public_id, i.invoice_number, c.full_name customer_name,
          c.phone customer_phone, i.status, i.invoice_total,
          coalesce(paid.amount,0) paid_amount, coalesce(credits.approved_amount,0) approved_credit_amount,
          coalesce(credits.reserved_amount,0) reserved_credit_amount
        from vehicle_sale_invoice i
        join sales_booking b on b.dealership_id=i.dealership_id and b.id=i.booking_id
        join customer c on c.dealership_id=b.dealership_id and c.id=b.customer_id
        left join (
          select dealership_id,invoice_id,sum(amount) amount from vehicle_sale_payment
          where status='RECORDED' group by dealership_id,invoice_id
        ) paid on paid.dealership_id=i.dealership_id and paid.invoice_id=i.id
        left join (
          select dealership_id,sales_invoice_id,
            sum(case when status='APPROVED' then amount else 0 end) approved_amount,
            sum(case when status in ('PENDING_APPROVAL','APPROVED','PAID') then amount else 0 end) reserved_amount
          from finance_invoice_adjustment where adjustment_type='CREDIT_NOTE' and source_type='SALES'
          group by dealership_id,sales_invoice_id
        ) credits on credits.dealership_id=i.dealership_id and credits.sales_invoice_id=i.id
        where i.dealership_id=? and i.status='ISSUED'
          and (?::text is null or lower(i.invoice_number) like ? or lower(c.full_name) like ?
            or lower(coalesce(c.phone,'')) like ? or lower(i.public_id::text) like ?)
        order by i.issued_at desc nulls last, i.id desc limit 25
        """, INVOICE_MAPPER, actor.dealershipId(), pattern, pattern, pattern, pattern, pattern));
    result.addAll(jdbc.query("""
        select 'WORKSHOP' source_type, i.public_id invoice_public_id, i.invoice_number, c.full_name customer_name,
          c.phone customer_phone, i.status, i.invoice_total,
          coalesce(paid.amount,0) paid_amount, coalesce(credits.approved_amount,0) approved_credit_amount,
          coalesce(credits.reserved_amount,0) reserved_credit_amount
        from service_invoice i
        join service_job_card job on job.dealership_id=i.dealership_id and job.id=i.job_card_id
        join customer c on c.dealership_id=job.dealership_id and c.id=job.customer_id
        left join (
          select a.dealership_id,a.invoice_id,sum(a.amount) amount
          from service_payment_allocation a join service_payment p
            on p.dealership_id=a.dealership_id and p.id=a.payment_id and p.status='RECORDED'
          group by a.dealership_id,a.invoice_id
        ) paid on paid.dealership_id=i.dealership_id and paid.invoice_id=i.id
        left join (
          select dealership_id,service_invoice_id,
            sum(case when status='APPROVED' then amount else 0 end) approved_amount,
            sum(case when status in ('PENDING_APPROVAL','APPROVED','PAID') then amount else 0 end) reserved_amount
          from finance_invoice_adjustment where adjustment_type='CREDIT_NOTE' and source_type='WORKSHOP'
          group by dealership_id,service_invoice_id
        ) credits on credits.dealership_id=i.dealership_id and credits.service_invoice_id=i.id
        where i.dealership_id=? and i.status='ISSUED'
          and (?::text is null or lower(i.invoice_number) like ? or lower(c.full_name) like ?
            or lower(coalesce(c.phone,'')) like ? or lower(i.public_id::text) like ?)
        order by i.issued_at desc nulls last, i.id desc limit 25
        """, INVOICE_MAPPER, actor.dealershipId(), pattern, pattern, pattern, pattern, pattern));
    result.sort(Comparator.comparing(InvoiceCandidate::invoiceNumber).reversed());
    return List.copyOf(result);
  }

  @Transactional
  public AdjustmentView create(StaffPrincipal actor, CreateAdjustmentRequest request) {
    if (request == null) throw badRequest("Adjustment details are required.");
    String type = choice(request.adjustmentType(), "adjustment type", TYPES);
    String reason = required(request.reason(), "Reason", 500);
    String key = required(request.idempotencyKey(), "Idempotency key", 120);
    BigDecimal amount = money(request.amount());
    String source = null;
    Long salesInvoiceId = null, serviceInvoiceId = null, parentId = null, salesPaymentId = null, servicePaymentId = null;
    UUID invoicePublicId = request.invoicePublicId();
    UUID parentPublicId = request.parentAdjustmentPublicId();
    UUID paymentPublicId = request.paymentPublicId();
    if ("CREDIT_NOTE".equals(type)) {
      source = choice(request.sourceType(), "invoice type", SOURCES);
      if (invoicePublicId == null || parentPublicId != null || paymentPublicId != null) {
        throw badRequest("Choose one issued invoice for a credit adjustment.");
      }
    } else {
      if (invoicePublicId != null || parentPublicId == null || paymentPublicId == null) {
        throw badRequest("A refund must reference an approved credit adjustment and a recorded payment.");
      }
    }
    String fingerprint = TokenDigests.sha256(String.join("|", type, String.valueOf(source),
        String.valueOf(invoicePublicId), String.valueOf(parentPublicId), String.valueOf(paymentPublicId),
        amount.toPlainString(), reason));
    List<Map<String,Object>> prior = jdbc.queryForList("""
        select public_id,request_fingerprint from finance_invoice_adjustment
        where dealership_id=? and idempotency_key=?
        """, actor.dealershipId(), key);
    if (!prior.isEmpty()) return replay(actor, prior.getFirst(), fingerprint);

    if ("CREDIT_NOTE".equals(type)) {
      InvoiceReference invoice = lockInvoice(actor, source, invoicePublicId);
      BigDecimal reserved = creditNoteReservation(actor.dealershipId(), source, invoice.id());
      BigDecimal remaining = invoice.total().subtract(reserved).setScale(2, RoundingMode.HALF_UP);
      if (amount.compareTo(remaining) > 0) {
        throw conflict("Credit amount exceeds the invoice's unadjusted amount of " + remaining + ".");
      }
      salesInvoiceId = invoice.salesInvoiceId();
      serviceInvoiceId = invoice.serviceInvoiceId();
    } else {
      Map<String,Object> parent = lockCreditNote(actor, parentPublicId);
      source = String.valueOf(parent.get("source_type"));
      if (!"APPROVED".equals(String.valueOf(parent.get("status")))) {
        throw conflict("Approve the credit adjustment before requesting a refund.");
      }
      parentId = number(parent.get("id"));
      salesInvoiceId = nullableNumber(parent.get("sales_invoice_id"));
      serviceInvoiceId = nullableNumber(parent.get("service_invoice_id"));
      if (amount.compareTo((BigDecimal) parent.get("amount")) > 0) {
        throw conflict("Refund amount cannot exceed the approved credit adjustment.");
      }
      PaymentReference payment = lockRecordedPayment(actor, source, paymentPublicId, salesInvoiceId, serviceInvoiceId);
      salesPaymentId = payment.salesPaymentId();
      servicePaymentId = payment.servicePaymentId();
      BigDecimal usedByParent = refundAmountByParent(actor.dealershipId(), parentId);
      BigDecimal parentRemaining = ((BigDecimal) parent.get("amount")).subtract(usedByParent);
      BigDecimal usedByPayment = refundAmountByPayment(actor.dealershipId(), source,
          salesInvoiceId, serviceInvoiceId, salesPaymentId, servicePaymentId);
      BigDecimal paymentRemaining = payment.allocatedAmount().subtract(usedByPayment);
      BigDecimal available = parentRemaining.min(paymentRemaining).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
      if (amount.compareTo(available) > 0) {
        throw conflict("Refund exceeds the remaining approved credit or payment amount of " + available + ".");
      }
    }

    String adjustmentNumber = "ADJ-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    List<Map<String,Object>> inserted = jdbc.queryForList("""
        insert into finance_invoice_adjustment(
          dealership_id,adjustment_number,adjustment_type,source_type,sales_invoice_id,service_invoice_id,
          parent_adjustment_id,sales_payment_id,service_payment_id,idempotency_key,request_fingerprint,
          amount,reason,status,created_by_staff_user_id)
        values (?,?,?,?,?,?,?,?,?,?,?, ?,?,'PENDING_APPROVAL',?)
        on conflict (dealership_id,idempotency_key) do nothing
        returning id,public_id,status
        """, actor.dealershipId(), adjustmentNumber, type, source, salesInvoiceId, serviceInvoiceId,
        parentId, salesPaymentId, servicePaymentId, key, fingerprint, amount, reason, actor.staffUserId());
    if (inserted.isEmpty()) {
      List<Map<String,Object>> raced = jdbc.queryForList("""
          select public_id,request_fingerprint from finance_invoice_adjustment
          where dealership_id=? and idempotency_key=?
          """, actor.dealershipId(), key);
      if (raced.isEmpty()) throw conflict("Adjustment could not be saved. Reload and retry.");
      return replay(actor, raced.getFirst(), fingerprint);
    }
    long id = number(inserted.getFirst().get("id"));
    UUID publicId = (UUID) inserted.getFirst().get("public_id");
    addEvent(actor, id, "CREATED", null, "PENDING_APPROVAL", reason, null);
    audit(actor, "FINANCE_ADJUSTMENT_CREATED", publicId, type + " requested for " + source + " invoice; amount=" + amount + "; reason=" + reason);
    return get(actor, publicId);
  }

  public List<AdjustmentView> list(StaffPrincipal actor, String rawStatus) {
    String status = rawStatus == null ? "ALL" : rawStatus.trim().toUpperCase(Locale.ROOT);
    if (!Set.of("ALL", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID").contains(status)) {
      throw badRequest("Choose a supported adjustment status filter.");
    }
    List<UUID> ids = jdbc.query("""
        select public_id from finance_invoice_adjustment
        where dealership_id=? and (?='ALL' or status=?)
        order by created_at desc,id desc limit 200
        """, (rs,n)->rs.getObject(1,UUID.class), actor.dealershipId(), status, status);
    return ids.stream().map(id -> get(actor,id)).toList();
  }

  public AdjustmentView get(StaffPrincipal actor, UUID publicId) {
    List<AdjustmentView> rows = jdbc.query("""
        select a.public_id,a.adjustment_number,a.adjustment_type,a.source_type,
          coalesce(si.public_id,wi.public_id) invoice_public_id,
          coalesce(si.invoice_number,wi.invoice_number) invoice_number,
          coalesce(sc.full_name,wc.full_name) customer_name,parent.public_id parent_public_id,
          coalesce(sp.public_id,wp.public_id) payment_public_id,
          coalesce(sp.receipt_number,wp.receipt_number) payment_receipt_number,
          a.amount,a.reason,a.status,creator.full_name created_by_name,a.created_at,
          reviewer.full_name reviewed_by_name,a.reviewed_at,a.review_reason,
          payer.full_name paid_by_name,a.paid_at,a.payment_method,a.payment_reference
        from finance_invoice_adjustment a
        left join vehicle_sale_invoice si on a.source_type='SALES' and si.dealership_id=a.dealership_id and si.id=a.sales_invoice_id
        left join sales_booking sb on sb.dealership_id=si.dealership_id and sb.id=si.booking_id
        left join customer sc on sc.dealership_id=sb.dealership_id and sc.id=sb.customer_id
        left join service_invoice wi on a.source_type='WORKSHOP' and wi.dealership_id=a.dealership_id and wi.id=a.service_invoice_id
        left join service_job_card job on job.dealership_id=wi.dealership_id and job.id=wi.job_card_id
        left join customer wc on wc.dealership_id=job.dealership_id and wc.id=job.customer_id
        left join finance_invoice_adjustment parent on parent.dealership_id=a.dealership_id and parent.id=a.parent_adjustment_id
        left join vehicle_sale_payment sp on sp.dealership_id=a.dealership_id and sp.id=a.sales_payment_id
        left join service_payment wp on wp.dealership_id=a.dealership_id and wp.id=a.service_payment_id
        join staff_user creator on creator.dealership_id=a.dealership_id and creator.id=a.created_by_staff_user_id
        left join staff_user reviewer on reviewer.dealership_id=a.dealership_id and reviewer.id=a.reviewed_by_staff_user_id
        left join staff_user payer on payer.dealership_id=a.dealership_id and payer.id=a.paid_by_staff_user_id
        where a.dealership_id=? and a.public_id=?
        """, ADJUSTMENT_MAPPER, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Financial adjustment was not found for this dealership.");
    return rows.getFirst();
  }

  public List<PaymentOption> paymentOptions(StaffPrincipal actor, UUID creditNotePublicId) {
    Map<String,Object> note = lockCreditNoteRead(actor, creditNotePublicId);
    if (!"APPROVED".equals(String.valueOf(note.get("status")))) {
      throw conflict("Payment options are available only for an approved credit adjustment.");
    }
    String source = String.valueOf(note.get("source_type"));
    Long salesInvoiceId = nullableNumber(note.get("sales_invoice_id"));
    Long serviceInvoiceId = nullableNumber(note.get("service_invoice_id"));
    long parentId = number(note.get("id"));
    BigDecimal parentRemaining = ((BigDecimal) note.get("amount")).subtract(refundAmountByParent(actor.dealershipId(), parentId));
    List<PaymentOption> result;
    if ("SALES".equals(source)) {
      result = jdbc.query("""
          select p.public_id,p.receipt_number,p.payment_method,p.amount recorded_amount,
            p.amount-coalesce(reserved.amount,0) payment_remaining,p.recorded_at
          from vehicle_sale_payment p
          left join (
            select sales_payment_id,sum(amount) amount from finance_invoice_adjustment
            where dealership_id=? and sales_invoice_id=? and adjustment_type='REFUND'
              and status in ('PENDING_APPROVAL','APPROVED','PAID') group by sales_payment_id
          ) reserved on reserved.sales_payment_id=p.id
          where p.dealership_id=? and p.invoice_id=? and p.status='RECORDED'
          order by p.recorded_at desc,p.id desc
          """, (rs,n)->new PaymentOption(rs.getObject("public_id",UUID.class),rs.getString("receipt_number"),
              rs.getString("payment_method"), rs.getBigDecimal("recorded_amount"),
              rs.getBigDecimal("payment_remaining").min(parentRemaining).max(BigDecimal.ZERO),
              instant(rs,"recorded_at")), actor.dealershipId(), salesInvoiceId, actor.dealershipId(), salesInvoiceId);
    } else {
      result = jdbc.query("""
          select p.public_id,p.receipt_number,p.payment_method,a.amount recorded_amount,
            a.amount-coalesce(reserved.amount,0) payment_remaining,p.recorded_at
          from service_payment_allocation a
          join service_payment p on p.dealership_id=a.dealership_id and p.id=a.payment_id
          left join (
            select service_payment_id,sum(amount) amount from finance_invoice_adjustment
            where dealership_id=? and service_invoice_id=? and adjustment_type='REFUND'
              and status in ('PENDING_APPROVAL','APPROVED','PAID') group by service_payment_id
          ) reserved on reserved.service_payment_id=p.id
          where a.dealership_id=? and a.invoice_id=? and p.status='RECORDED'
          order by p.recorded_at desc,p.id desc
          """, (rs,n)->new PaymentOption(rs.getObject("public_id",UUID.class),rs.getString("receipt_number"),
              rs.getString("payment_method"), rs.getBigDecimal("recorded_amount"),
              rs.getBigDecimal("payment_remaining").min(parentRemaining).max(BigDecimal.ZERO),
              instant(rs,"recorded_at")), actor.dealershipId(), serviceInvoiceId, actor.dealershipId(), serviceInvoiceId);
    }
    return result.stream().filter(p -> p.refundableRemaining().signum() > 0).toList();
  }

  public List<AdjustmentEvent> history(StaffPrincipal actor, UUID publicId) {
    Map<String,Object> adjustment = lockByPublicId(actor, publicId, false);
    long id = number(adjustment.get("id"));
    return jdbc.query("""
        select e.event_type,e.from_status,e.to_status,e.reason,e.external_reference,e.created_at,
          staff.full_name actor_name
        from finance_invoice_adjustment_event e
        join staff_user staff on staff.dealership_id=e.dealership_id and staff.id=e.actor_staff_user_id
        where e.dealership_id=? and e.adjustment_id=? order by e.created_at,e.id
        """, (rs,n)->new AdjustmentEvent(rs.getString("event_type"),rs.getString("from_status"),
            rs.getString("to_status"),rs.getString("reason"),rs.getString("external_reference"),
            rs.getString("actor_name"),instant(rs,"created_at")), actor.dealershipId(), id);
  }

  @Transactional
  public AdjustmentView approve(StaffPrincipal actor, UUID publicId) {
    Map<String,Object> row = lockByPublicId(actor, publicId, true);
    if (!"PENDING_APPROVAL".equals(String.valueOf(row.get("status")))) throw conflict("Only a pending adjustment can be approved.");
    requireIndependentReviewer(actor, row);
    String type = String.valueOf(row.get("adjustment_type"));
    if ("CREDIT_NOTE".equals(type)) {
      validateIssuedSourceInvoice(actor, String.valueOf(row.get("source_type")),
          nullableNumber(row.get("sales_invoice_id")), nullableNumber(row.get("service_invoice_id")));
    } else {
      validateRefundReferences(actor, row);
    }
    long id = number(row.get("id"));
    jdbc.update("""
        update finance_invoice_adjustment set status='APPROVED',reviewed_by_staff_user_id=?,reviewed_at=now(),updated_at=now()
        where dealership_id=? and id=? and status='PENDING_APPROVAL'
        """, actor.staffUserId(), actor.dealershipId(), id);
    addEvent(actor,id,"APPROVED","PENDING_APPROVAL","APPROVED","Approved after independent review.",null);
    audit(actor,"FINANCE_ADJUSTMENT_APPROVED",publicId,"Approved " + type + " adjustment for " + row.get("amount") + ".");
    return get(actor,publicId);
  }

  @Transactional
  public AdjustmentView reject(StaffPrincipal actor, UUID publicId, String rawReason) {
    String reason = required(rawReason, "Rejection reason", 500);
    Map<String,Object> row = lockByPublicId(actor, publicId, true);
    if (!"PENDING_APPROVAL".equals(String.valueOf(row.get("status")))) throw conflict("Only a pending adjustment can be rejected.");
    requireIndependentReviewer(actor, row);
    long id = number(row.get("id"));
    jdbc.update("""
        update finance_invoice_adjustment set status='REJECTED',reviewed_by_staff_user_id=?,reviewed_at=now(),
          review_reason=?,updated_at=now()
        where dealership_id=? and id=? and status='PENDING_APPROVAL'
        """, actor.staffUserId(), reason, actor.dealershipId(), id);
    addEvent(actor,id,"REJECTED","PENDING_APPROVAL","REJECTED",reason,null);
    audit(actor,"FINANCE_ADJUSTMENT_REJECTED",publicId,"Rejected adjustment. Reason: " + reason);
    return get(actor,publicId);
  }

  @Transactional
  public AdjustmentView markRefundPaid(StaffPrincipal actor, UUID publicId, PayoutRequest request) {
    if (request == null) throw badRequest("Refund payout details are required.");
    String method = choice(request.paymentMethod(), "payout method", METHODS);
    String reference = optional(request.paymentReference(), 160);
    if (Set.of("UPI","BANK_TRANSFER","CARD").contains(method) && reference == null) {
      throw badRequest("A payout reference is required for UPI, bank-transfer and card refunds.");
    }
    Map<String,Object> row = lockByPublicId(actor, publicId, true);
    if (!"REFUND".equals(String.valueOf(row.get("adjustment_type")))) throw conflict("Only a refund request can be marked paid.");
    if (!"APPROVED".equals(String.valueOf(row.get("status")))) throw conflict("Approve the refund request before recording payout.");
    if (number(row.get("created_by_staff_user_id")) == actor.staffUserId()) {
      throw conflict("The staff member who requested a refund cannot attest to its payout.");
    }
    validateRefundReferences(actor, row);
    long id = number(row.get("id"));
    jdbc.update("""
        update finance_invoice_adjustment set status='PAID',paid_by_staff_user_id=?,paid_at=now(),
          payment_method=?,payment_reference=?,updated_at=now()
        where dealership_id=? and id=? and status='APPROVED'
        """, actor.staffUserId(), method, reference, actor.dealershipId(), id);
    addEvent(actor,id,"PAID","APPROVED","PAID","Refund payout recorded by staff; not independently provider-verified.",reference);
    audit(actor,"FINANCE_REFUND_PAYOUT_RECORDED",publicId,
        "Staff-attested refund payout recorded; method=" + method + (reference == null ? "" : "; reference=" + reference)
            + ". This does not mean a payment provider confirmed the money movement.");
    return get(actor,publicId);
  }

  private InvoiceReference lockInvoice(StaffPrincipal actor, String source, UUID publicId) {
    String table = "SALES".equals(source) ? "vehicle_sale_invoice" : "service_invoice";
    List<Map<String,Object>> rows = jdbc.queryForList(
        "select id,status,invoice_total from " + table + " where dealership_id=? and public_id=? for update",
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Issued invoice was not found for this dealership.");
    Map<String,Object> row = rows.getFirst();
    if (!"ISSUED".equals(String.valueOf(row.get("status")))) throw conflict("Credit adjustments require an issued invoice.");
    long id = number(row.get("id"));
    return new InvoiceReference(id, source, publicId, String.valueOf(row.get("status")),
        (BigDecimal) row.get("invoice_total"), "SALES".equals(source) ? id : null,
        "WORKSHOP".equals(source) ? id : null);
  }

  private BigDecimal creditNoteReservation(long dealershipId, String source, long invoiceId) {
    String field = "SALES".equals(source) ? "sales_invoice_id" : "service_invoice_id";
    String sql = "select coalesce(sum(amount),0) from finance_invoice_adjustment "
        + "where dealership_id=? and source_type=? and adjustment_type='CREDIT_NOTE' and "
        + field + " = ? and status in ('PENDING_APPROVAL','APPROVED','PAID')";
    BigDecimal sum = jdbc.queryForObject(sql, BigDecimal.class, dealershipId, source, invoiceId);
    return zero(sum);
  }

  private Map<String,Object> lockCreditNote(StaffPrincipal actor, UUID publicId) {
    List<Map<String,Object>> rows = jdbc.queryForList("""
        select id,public_id,source_type,sales_invoice_id,service_invoice_id,amount,status,adjustment_type
        from finance_invoice_adjustment
        where dealership_id=? and public_id=? and adjustment_type='CREDIT_NOTE' for update
        """, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Credit adjustment was not found.");
    return rows.getFirst();
  }

  private Map<String,Object> lockCreditNoteRead(StaffPrincipal actor, UUID publicId) {
    return lockCreditNote(actor, publicId);
  }

  private PaymentReference lockRecordedPayment(StaffPrincipal actor, String source, UUID publicId,
      Long salesInvoiceId, Long serviceInvoiceId) {
    if ("SALES".equals(source)) {
      List<Map<String,Object>> rows = jdbc.queryForList("""
          select p.id,p.status,p.amount,p.invoice_id from vehicle_sale_payment p
          where p.dealership_id=? and p.public_id=? for update
          """, actor.dealershipId(), publicId);
      if (rows.isEmpty()) throw notFound("Recorded payment was not found for this invoice.");
      Map<String,Object> p = rows.getFirst();
      if (!"RECORDED".equals(String.valueOf(p.get("status"))) || number(p.get("invoice_id")) != salesInvoiceId) {
        throw conflict("Choose a recorded payment belonging to the credit-adjustment invoice.");
      }
      return new PaymentReference(number(p.get("id")), number(p.get("id")), (BigDecimal) p.get("amount"),
          (BigDecimal) p.get("amount"), null);
    }
    List<Map<String,Object>> rows = jdbc.queryForList("""
        select p.id,p.status,p.amount,a.amount allocated_amount,a.invoice_id
        from service_payment p join service_payment_allocation a
          on a.dealership_id=p.dealership_id and a.payment_id=p.id
        where p.dealership_id=? and p.public_id=? and a.invoice_id=? for update of p
        """, actor.dealershipId(), publicId, serviceInvoiceId);
    if (rows.isEmpty()) throw notFound("Recorded payment was not found for this workshop invoice.");
    Map<String,Object> p = rows.getFirst();
    if (!"RECORDED".equals(String.valueOf(p.get("status")))) throw conflict("Only a recorded payment can be refunded.");
    return new PaymentReference(number(p.get("id")), null, (BigDecimal) p.get("amount"),
        (BigDecimal) p.get("allocated_amount"), number(p.get("id")));
  }

  private BigDecimal refundAmountByParent(long dealershipId, long parentId) {
    return zero(jdbc.queryForObject("""
        select coalesce(sum(amount),0) from finance_invoice_adjustment
        where dealership_id=? and adjustment_type='REFUND' and parent_adjustment_id=?
          and status in ('PENDING_APPROVAL','APPROVED','PAID')
        """, BigDecimal.class, dealershipId, parentId));
  }

  private BigDecimal refundAmountByPayment(long dealershipId, String source, Long salesInvoiceId,
      Long serviceInvoiceId, Long salesPaymentId, Long servicePaymentId) {
    String paymentField = "SALES".equals(source) ? "sales_payment_id" : "service_payment_id";
    String invoiceField = "SALES".equals(source) ? "sales_invoice_id" : "service_invoice_id";
    long invoiceId = "SALES".equals(source) ? salesInvoiceId : serviceInvoiceId;
    long paymentId = "SALES".equals(source) ? salesPaymentId : servicePaymentId;
    String sql = "select coalesce(sum(amount),0) from finance_invoice_adjustment "
        + "where dealership_id=? and adjustment_type='REFUND' and source_type=? and "
        + invoiceField + " = ? and " + paymentField + " = ? "
        + "and status in ('PENDING_APPROVAL','APPROVED','PAID')";
    return zero(jdbc.queryForObject(sql, BigDecimal.class, dealershipId, source, invoiceId, paymentId));
  }

  private void validateIssuedSourceInvoice(StaffPrincipal actor, String source, Long salesId, Long serviceId) {
    String table = "SALES".equals(source) ? "vehicle_sale_invoice" : "service_invoice";
    long id = "SALES".equals(source) ? salesId : serviceId;
    List<String> statuses = jdbc.query(
        "select status from " + table + " where dealership_id=? and id=? for update",
        (rs,n)->rs.getString(1), actor.dealershipId(), id);
    if (statuses.isEmpty()) throw notFound("The source invoice was not found.");
    if (!"ISSUED".equals(statuses.getFirst())) throw conflict("The source invoice must remain issued to approve a credit adjustment.");
  }

  private void validateRefundReferences(StaffPrincipal actor, Map<String,Object> row) {
    long parentId = number(row.get("parent_adjustment_id"));
    List<Map<String,Object>> parents = jdbc.queryForList("""
        select id,status,amount from finance_invoice_adjustment
        where dealership_id=? and id=? and adjustment_type='CREDIT_NOTE' for update
        """, actor.dealershipId(), parentId);
    if (parents.isEmpty() || !"APPROVED".equals(String.valueOf(parents.getFirst().get("status")))) {
      throw conflict("A refund must remain linked to an approved credit adjustment.");
    }
    long paymentId = number("SALES".equals(String.valueOf(row.get("source_type")))
        ? row.get("sales_payment_id") : row.get("service_payment_id"));
    String source = String.valueOf(row.get("source_type"));
    String paymentTable = "SALES".equals(source) ? "vehicle_sale_payment" : "service_payment";
    List<String> states = jdbc.query(
        "select status from " + paymentTable + " where dealership_id=? and id=? for update",
        (rs,n)->rs.getString(1), actor.dealershipId(), paymentId);
    if (states.isEmpty() || !"RECORDED".equals(states.getFirst())) {
      throw conflict("The source payment is no longer recorded; refund approval/payout is blocked.");
    }
    if ("SALES".equals(source)) {
      Integer linked = jdbc.queryForObject("""
          select count(*) from vehicle_sale_payment p join finance_invoice_adjustment a
            on a.dealership_id=p.dealership_id and a.sales_invoice_id=p.invoice_id
          where a.dealership_id=? and a.id=? and p.id=?
          """, Integer.class, actor.dealershipId(), parentId, paymentId);
      if (linked == null || linked != 1) throw conflict("The refund payment does not match the approved credit adjustment.");
    } else {
      Integer linked = jdbc.queryForObject("""
          select count(*) from service_payment_allocation allocation
          join finance_invoice_adjustment a on a.dealership_id=allocation.dealership_id
            and a.service_invoice_id=allocation.invoice_id
          where a.dealership_id=? and a.id=? and allocation.payment_id=?
          """, Integer.class, actor.dealershipId(), parentId, paymentId);
      if (linked == null || linked != 1) throw conflict("The refund payment does not match the approved credit adjustment.");
    }
  }

  private void requireIndependentReviewer(StaffPrincipal actor, Map<String,Object> row) {
    if (number(row.get("created_by_staff_user_id")) == actor.staffUserId()) {
      throw conflict("The requester cannot approve or reject their own financial adjustment.");
    }
  }

  private Map<String,Object> lockByPublicId(StaffPrincipal actor, UUID publicId, boolean lock) {
    String sql = """
        select id,public_id,adjustment_type,source_type,sales_invoice_id,service_invoice_id,parent_adjustment_id,
          sales_payment_id,service_payment_id,amount,status,created_by_staff_user_id,reviewed_by_staff_user_id
        from finance_invoice_adjustment where dealership_id=? and public_id=?
        """ + (lock ? " for update" : "");
    List<Map<String,Object>> rows = jdbc.queryForList(sql, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Financial adjustment was not found for this dealership.");
    return rows.getFirst();
  }

  private AdjustmentView replay(StaffPrincipal actor, Map<String,Object> prior, String fingerprint) {
    if (!fingerprint.equals(String.valueOf(prior.get("request_fingerprint")).trim())) {
      throw conflict("This idempotency key was already used for different adjustment details.");
    }
    return get(actor, (UUID) prior.get("public_id"));
  }

  private void addEvent(StaffPrincipal actor, long adjustmentId, String type, String from, String to,
      String reason, String externalReference) {
    jdbc.update("""
        insert into finance_invoice_adjustment_event(
          dealership_id,adjustment_id,event_type,from_status,to_status,reason,external_reference,actor_staff_user_id)
        values (?,?,?,?,?,?,?,?)
        """, actor.dealershipId(), adjustmentId, type, from, to, reason, externalReference, actor.staffUserId());
  }

  private void audit(StaffPrincipal actor, String action, UUID publicId, String summary) {
    jdbc.update("""
        insert into audit_event(dealership_id,actor_kind,actor_staff_user_id,action,entity_type,entity_id,details)
        values(?,'STAFF',? ,?,'FINANCE_INVOICE_ADJUSTMENT',?,jsonb_build_object('summary',?))
        """, actor.dealershipId(), actor.staffUserId(), action, publicId.toString(), summary);
  }

  private static BigDecimal money(BigDecimal raw) {
    if (raw == null || raw.signum() <= 0 || raw.compareTo(MAX_AMOUNT) > 0) {
      throw badRequest("Adjustment amount must be positive and within the supported monetary range.");
    }
    try { return raw.setScale(2, RoundingMode.UNNECESSARY); }
    catch (ArithmeticException error) { throw badRequest("Adjustment amount may have at most two decimal places."); }
  }
  private static String choice(String raw, String label, Set<String> allowed) {
    String value = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
    if (!allowed.contains(value)) throw badRequest("Choose a supported " + label + ".");
    return value;
  }
  private static String required(String raw, String label, int max) {
    String value = optional(raw, max);
    if (value == null) throw badRequest(label + " is required.");
    return value;
  }
  private static String optional(String raw, int max) {
    if (raw == null) return null;
    String value = raw.trim();
    if (value.isEmpty()) return null;
    if (value.length() > max || value.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return value;
  }
  private static BigDecimal zero(BigDecimal value) { return value == null ? BigDecimal.ZERO.setScale(2) : value; }
  private static long number(Object value) { return ((Number) value).longValue(); }
  private static Long nullableNumber(Object value) { return value == null ? null : number(value); }
  private static Instant instant(ResultSet rs, String field) throws SQLException {
    Timestamp value = rs.getTimestamp(field);
    return value == null ? null : value.toInstant();
  }
  private static Instant instantNullable(ResultSet rs, String field) throws SQLException { return instant(rs, field); }
  private static ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
  private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  public record CreateAdjustmentRequest(String adjustmentType, String sourceType, UUID invoicePublicId,
      UUID parentAdjustmentPublicId, UUID paymentPublicId, BigDecimal amount, String reason, String idempotencyKey) {}
  public record PayoutRequest(String paymentMethod, String paymentReference) {}
  public record InvoiceCandidate(String sourceType, UUID invoicePublicId, String invoiceNumber, String customerName,
      String customerPhone, String status, BigDecimal invoiceTotal, BigDecimal paidAmount,
      BigDecimal approvedCreditAmount, BigDecimal creditableRemaining) {}
  public record AdjustmentView(UUID publicId, String adjustmentNumber, String adjustmentType, String sourceType,
      UUID invoicePublicId, String invoiceNumber, String customerName, UUID parentAdjustmentPublicId,
      UUID paymentPublicId, String paymentReceiptNumber, BigDecimal amount, String reason, String status,
      String createdByName, Instant createdAt, String reviewedByName, Instant reviewedAt, String reviewReason,
      String paidByName, Instant paidAt, String paymentMethod, String paymentReference) {}
  public record PaymentOption(UUID publicId, String receiptNumber, String paymentMethod, BigDecimal recordedAmount,
      BigDecimal refundableRemaining, Instant recordedAt) {}
  public record AdjustmentEvent(String eventType, String fromStatus, String toStatus, String reason,
      String externalReference, String actorName, Instant createdAt) {}
  private record InvoiceReference(long id, String sourceType, UUID publicId, String status, BigDecimal total,
      Long salesInvoiceId, Long serviceInvoiceId) {}
  private record PaymentReference(long id, Long salesPaymentId, BigDecimal amount,
      BigDecimal allocatedAmount, Long servicePaymentId) {}
}
