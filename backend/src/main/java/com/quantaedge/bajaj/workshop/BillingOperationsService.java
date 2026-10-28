package com.quantaedge.bajaj.workshop;

import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Manual operational workshop billing. This is not a tax invoice or a payment-gateway
 * integration: tax treatment and externally processed money movement are intentionally separate.
 */
@Service
public class BillingOperationsService {
  private static final BigDecimal MAX_MONEY = new BigDecimal("999999999999.99");
  private static final Set<String> PAYMENT_METHODS =
      Set.of("CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER");
  private static final Set<String> HANDOVER_METHODS =
      Set.of("IN_PERSON", "SIGNED_FORM", "OTP_REFERENCE", "WRITTEN_MESSAGE");

  private final JdbcTemplate jdbc;

  public BillingOperationsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional
  public InvoiceView createInvoice(StaffPrincipal actor, UUID jobCardPublicId, String customerMessage) {
    List<Map<String, Object>> jobs = jdbc.queryForList("""
        select id, public_id, job_card_code, status
        from service_job_card
        where dealership_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), jobCardPublicId);
    if (jobs.isEmpty()) throw notFound("Workshop job card was not found.");
    Map<String, Object> job = jobs.getFirst();
    long jobCardId = number(job.get("id"));
    String jobStatus = String.valueOf(job.get("status"));

    List<UUID> activeInvoices = jdbc.query("""
        select public_id from service_invoice
        where dealership_id = ? and job_card_id = ? and status in ('DRAFT', 'ISSUED')
        order by created_at desc, id desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), jobCardId);
    if (!activeInvoices.isEmpty()) return getInvoice(actor, activeInvoices.getFirst());
    if (!"READY_FOR_COLLECTION".equals(jobStatus)) {
      throw conflict("An invoice can only be created after the workshop quality check has passed.");
    }

    List<Map<String, Object>> estimates = jdbc.queryForList("""
        select id, revision, parts_subtotal, labour_subtotal, other_subtotal,
          discount_amount, estimated_total, customer_message
        from service_estimate
        where dealership_id = ? and job_card_id = ? and status = 'APPROVED'
        order by revision desc, id desc
        limit 1
        for update
        """, actor.dealershipId(), jobCardId);
    if (estimates.isEmpty()) {
      throw conflict("A customer-approved estimate is required before issuing an invoice.");
    }
    Map<String, Object> estimate = estimates.getFirst();
    long estimateId = number(estimate.get("id"));
    requireCurrentApprovedPartReservations(actor, jobCardId, estimateId);
    int revision = ((Number) estimate.get("revision")).intValue();
    String invoiceNumber = "INV-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    String message = optionalText(customerMessage, 2000);
    if (message == null) message = optionalText((String) estimate.get("customer_message"), 2000);
    BigDecimal total = (BigDecimal) estimate.get("estimated_total");
    if (total.compareTo(MAX_MONEY) > 0 || total.signum() < 0) {
      throw conflict("The approved estimate total is outside the supported invoice range.");
    }

    UUID invoicePublicId;
    try {
      invoicePublicId = jdbc.queryForObject("""
          insert into service_invoice(
            dealership_id, invoice_number, job_card_id, estimate_id, estimate_revision, status,
            parts_subtotal, labour_subtotal, other_subtotal, discount_amount, invoice_total,
            customer_message, created_by_staff_user_id)
          values (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)
          returning public_id
          """, UUID.class,
          actor.dealershipId(), invoiceNumber, jobCardId, estimateId, revision,
          estimate.get("parts_subtotal"), estimate.get("labour_subtotal"), estimate.get("other_subtotal"),
          estimate.get("discount_amount"), total, message, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      List<UUID> existing = jdbc.query("""
          select public_id from service_invoice
          where dealership_id = ? and job_card_id = ? and status in ('DRAFT', 'ISSUED')
          order by created_at desc limit 1
          """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), jobCardId);
      if (!existing.isEmpty()) return getInvoice(actor, existing.getFirst());
      throw conflict("Invoice could not be created because another billing operation changed the job.");
    }

    Long invoiceId = jdbc.queryForObject("""
        select id from service_invoice where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), invoicePublicId);
    jdbc.update("""
        insert into service_invoice_line(
          dealership_id, invoice_id, line_number, source_estimate_line_number,
          line_type, description, quantity, unit_price, line_total)
        select ?, ?, line_number, line_number, line_type, description, quantity, unit_price, line_total
        from service_estimate_line
        where dealership_id = ? and estimate_id = ?
        order by line_number
        """, actor.dealershipId(), invoiceId, actor.dealershipId(), estimateId);

    audit(actor, "SERVICE_INVOICE_DRAFT_CREATED", "SERVICE_INVOICE", invoicePublicId.toString(),
        "Created operational invoice draft from approved estimate revision " + revision
            + ". Tax treatment is not calculated by this workflow.");
    return getInvoice(actor, invoicePublicId);
  }

  private void requireCurrentApprovedPartReservations(
      StaffPrincipal actor, long jobCardId, long estimateId) {
    Integer staleCount = jdbc.queryForObject("""
        select count(*)
        from service_job_part_reservation reservation
        left join service_estimate_line line
          on line.dealership_id = reservation.dealership_id
          and line.estimate_id = ?
          and line.source_reservation_id = reservation.id
        where reservation.dealership_id = ? and reservation.job_card_id = ?
          and reservation.quantity_reserved - reservation.quantity_returned - reservation.quantity_released > 0
          and (
            line.id is null
            or line.source_quantity_reserved is distinct from reservation.quantity_reserved
            or line.source_quantity_issued is distinct from reservation.quantity_issued
            or line.source_quantity_returned is distinct from reservation.quantity_returned
            or line.source_quantity_released is distinct from reservation.quantity_released
            or line.source_unit_cost_snapshot is distinct from reservation.unit_cost_snapshot
            or line.quantity is distinct from
              (reservation.quantity_reserved - reservation.quantity_returned - reservation.quantity_released)
          )
        """, Integer.class, estimateId, actor.dealershipId(), jobCardId);
    if (staleCount != null && staleCount > 0) {
      throw conflict("An approved estimate has stale or missing part-reservation snapshots. Rebuild and approve the estimate revision before creating or issuing the invoice.");
    }
  }

  public List<InvoiceView> listInvoices(StaffPrincipal actor, UUID jobCardPublicId) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<UUID> publicIds = jdbc.query("""
        select public_id from service_invoice
        where dealership_id = ? and job_card_id = ?
        order by created_at desc, id desc
        limit 50
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), jobCardId);
    return publicIds.stream().map(id -> getInvoice(actor, id)).toList();
  }

  public InvoiceView getInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select inv.id, inv.public_id, inv.invoice_number, inv.status, inv.estimate_revision,
          inv.parts_subtotal, inv.labour_subtotal, inv.other_subtotal, inv.discount_amount, inv.invoice_total,
          inv.customer_message, inv.created_at, inv.issued_at, creator.full_name as creator_name,
          issuer.full_name as issuer_name, job.public_id as job_card_public_id, job.job_card_code,
          customer.public_id as customer_public_id, customer.full_name as customer_name, customer.phone as customer_phone,
          vehicle.public_id as vehicle_public_id, model.model_name, model.variant_name, model.colour_name,
          vehicle.chassis_number, vehicle.engine_number,
          coalesce((select sum(allocation.amount)
            from service_payment_allocation allocation
            join service_payment payment on payment.dealership_id = allocation.dealership_id
              and payment.id = allocation.payment_id and payment.status = 'RECORDED'
            where allocation.dealership_id = inv.dealership_id and allocation.invoice_id = inv.id), 0) as paid_amount
        from service_invoice inv
        join service_job_card job on job.dealership_id = inv.dealership_id and job.id = inv.job_card_id
        join customer on customer.dealership_id = job.dealership_id and customer.id = job.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = job.dealership_id and vehicle.id = job.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        join staff_user creator on creator.dealership_id = inv.dealership_id and creator.id = inv.created_by_staff_user_id
        left join staff_user issuer on issuer.dealership_id = inv.dealership_id and issuer.id = inv.issued_by_staff_user_id
        where inv.dealership_id = ? and inv.public_id = ?
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Operational invoice was not found.");
    Map<String, Object> row = rows.getFirst();
    long invoiceId = number(row.get("id"));
    BigDecimal total = (BigDecimal) row.get("invoice_total");
    BigDecimal paid = (BigDecimal) row.get("paid_amount");
    BigDecimal balanceDue = total.subtract(paid).setScale(2, RoundingMode.HALF_UP);
    List<InvoiceLineView> lines = jdbc.query("""
        select line_number, source_estimate_line_number, line_type, description, quantity, unit_price, line_total
        from service_invoice_line
        where dealership_id = ? and invoice_id = ?
        order by line_number
        """, (rs, rowNum) -> new InvoiceLineView(
            rs.getInt("line_number"), rs.getInt("source_estimate_line_number"), rs.getString("line_type"),
            rs.getString("description"), rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_price"),
            rs.getBigDecimal("line_total")), actor.dealershipId(), invoiceId);

    return new InvoiceView(
        (UUID) row.get("public_id"), String.valueOf(row.get("invoice_number")),
        (UUID) row.get("job_card_public_id"), String.valueOf(row.get("job_card_code")),
        (UUID) row.get("customer_public_id"), String.valueOf(row.get("customer_name")),
        (String) row.get("customer_phone"), (UUID) row.get("vehicle_public_id"),
        String.valueOf(row.get("model_name")), (String) row.get("variant_name"), (String) row.get("colour_name"),
        String.valueOf(row.get("chassis_number")), String.valueOf(row.get("engine_number")),
        ((Number) row.get("estimate_revision")).intValue(), String.valueOf(row.get("status")),
        (BigDecimal) row.get("parts_subtotal"), (BigDecimal) row.get("labour_subtotal"),
        (BigDecimal) row.get("other_subtotal"), (BigDecimal) row.get("discount_amount"),
        total, paid, balanceDue, (String) row.get("customer_message"),
        String.valueOf(row.get("creator_name")), (String) row.get("issuer_name"),
        ((Timestamp) row.get("created_at")).toInstant(), instantOrNull((Timestamp) row.get("issued_at")), lines);
  }

  @Transactional
  public InvoiceView issueInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    List<Long> jobIds = jdbc.query("""
        select job_card_id from service_invoice
        where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), invoicePublicId);
    if (jobIds.isEmpty()) throw notFound("Operational invoice was not found.");
    long jobCardId = jobIds.getFirst();
    List<Map<String, Object>> jobs = jdbc.queryForList("""
        select status, job_card_code, public_id from service_job_card
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (jobs.isEmpty()) throw notFound("Workshop job card was not found.");
    List<Map<String, Object>> invoices = jdbc.queryForList("""
        select id, estimate_id, status, invoice_number from service_invoice
        where dealership_id = ? and job_card_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), jobCardId, invoicePublicId);
    if (invoices.isEmpty()) throw notFound("Operational invoice was not found.");
    Map<String, Object> invoice = invoices.getFirst();
    String invoiceStatus = String.valueOf(invoice.get("status"));
    if ("ISSUED".equals(invoiceStatus)) return getInvoice(actor, invoicePublicId);
    if (!"DRAFT".equals(invoiceStatus)) throw conflict("Only a draft invoice can be issued.");
    String jobStatus = String.valueOf(jobs.getFirst().get("status"));
    if (!"READY_FOR_COLLECTION".equals(jobStatus)) {
      throw conflict("The job card must have passed quality check before invoice issue.");
    }
    requireCurrentApprovedPartReservations(
        actor, jobCardId, number(invoice.get("estimate_id")));

    int issued = jdbc.update("""
        update service_invoice set status = 'ISSUED', issued_by_staff_user_id = ?,
          issued_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'DRAFT'
        """, actor.staffUserId(), actor.dealershipId(), invoice.get("id"));
    if (issued != 1) throw conflict("Invoice state changed while issuing. Refresh and try again.");
    int jobChanged = jdbc.update("""
        update service_job_card set status = 'INVOICED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'READY_FOR_COLLECTION'
        """, actor.dealershipId(), jobCardId);
    if (jobChanged != 1) throw conflict("Job-card state changed while issuing the invoice.");

    String jobCode = String.valueOf(jobs.getFirst().get("job_card_code"));
    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason, details)
        values (?, ?, 'READY_FOR_COLLECTION', 'INVOICED', 'OPERATIONAL_INVOICE_ISSUED', ?, ?,
          jsonb_build_object('invoiceNumber', ?, 'taxInvoice', false))
        """, actor.dealershipId(), jobCardId, actor.staffUserId(),
        "Operational invoice issued for job card " + jobCode + ".", invoice.get("invoice_number"));
    audit(actor, "SERVICE_INVOICE_ISSUED", "SERVICE_INVOICE", invoicePublicId.toString(),
        "Operational invoice issued. This record is not represented as a GST tax invoice.");
    return getInvoice(actor, invoicePublicId);
  }

  @Transactional
  public PaymentView recordPayment(StaffPrincipal actor, UUID invoicePublicId, PaymentRequest request) {
    String idempotencyKey = requiredText(request.idempotencyKey(), "Payment idempotency key", 120);
    String method = request.paymentMethod() == null ? "" : request.paymentMethod().trim().toUpperCase(Locale.ROOT);
    if (!PAYMENT_METHODS.contains(method)) throw badRequest("Choose a supported payment method.");
    BigDecimal amount = normalizeMoney(request.amount(), "Payment amount");
    if (amount.signum() <= 0) throw badRequest("Payment amount must be greater than zero.");
    String reference = optionalText(request.paymentReference(), 160);
    String note = optionalText(request.note(), 1000);
    if (Set.of("UPI", "BANK_TRANSFER", "CARD").contains(method) && reference == null) {
      throw badRequest("A payment reference is required for UPI, bank-transfer or card records.");
    }

    String fingerprint = TokenDigests.sha256(String.join("|",
        invoicePublicId.toString(), method, amount.toPlainString(),
        reference == null ? "" : reference, note == null ? "" : note));
    List<Map<String, Object>> priorPayments = jdbc.queryForList("""
        select public_id, request_fingerprint from service_payment
        where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), idempotencyKey);
    if (!priorPayments.isEmpty()) {
      if (!fingerprint.equals(String.valueOf(priorPayments.getFirst().get("request_fingerprint")).trim())) {
        throw conflict("This payment idempotency key was already used for a different request.");
      }
      return getPayment(actor, (UUID) priorPayments.getFirst().get("public_id"));
    }

    List<Map<String, Object>> invoices = jdbc.queryForList("""
        select id, status, invoice_total from service_invoice
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), invoicePublicId);
    if (invoices.isEmpty()) throw notFound("Operational invoice was not found.");
    Map<String, Object> invoice = invoices.getFirst();
    if (!"ISSUED".equals(String.valueOf(invoice.get("status")))) {
      throw conflict("Only an issued invoice can receive a payment record.");
    }
    long invoiceId = number(invoice.get("id"));
    BigDecimal total = (BigDecimal) invoice.get("invoice_total");
    BigDecimal paid = currentPaidAmount(actor.dealershipId(), invoiceId);
    BigDecimal due = total.subtract(paid).setScale(2, RoundingMode.HALF_UP);
    if (due.signum() <= 0) throw conflict("This invoice has no outstanding balance.");
    if (amount.compareTo(due) > 0) throw badRequest("Payment exceeds the outstanding invoice balance.");

    String receiptNumber = "RCT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    List<Long> createdIds = jdbc.query("""
        insert into service_payment(
          dealership_id, receipt_number, idempotency_key, request_fingerprint,
          payment_method, amount, payment_reference, note, status, recorded_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, 'RECORDED', ?)
        on conflict do nothing
        returning id
        """, (rs, rowNum) -> rs.getLong(1),
        actor.dealershipId(), receiptNumber, idempotencyKey, fingerprint, method,
        amount, reference, note, actor.staffUserId());
    if (createdIds.isEmpty()) {
      List<Map<String, Object>> racedPayment = jdbc.queryForList("""
          select public_id, request_fingerprint from service_payment
          where dealership_id = ? and idempotency_key = ?
          """, actor.dealershipId(), idempotencyKey);
      if (racedPayment.isEmpty()) throw conflict("Payment could not be recorded; refresh the invoice and retry.");
      if (!fingerprint.equals(String.valueOf(racedPayment.getFirst().get("request_fingerprint")).trim())) {
        throw conflict("This payment idempotency key was already used for a different request.");
      }
      return getPayment(actor, (UUID) racedPayment.getFirst().get("public_id"));
    }

    long paymentId = createdIds.getFirst();
    jdbc.update("""
        insert into service_payment_allocation(
          dealership_id, payment_id, invoice_id, amount, allocated_by_staff_user_id)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), paymentId, invoiceId, amount, actor.staffUserId());
    UUID paymentPublicId = jdbc.queryForObject("""
        select public_id from service_payment where dealership_id = ? and id = ?
        """, UUID.class, actor.dealershipId(), paymentId);
    audit(actor, "SERVICE_PAYMENT_RECORDED", "SERVICE_PAYMENT", paymentPublicId.toString(),
        "Recorded a manual " + method + " payment entry of " + amount.toPlainString()
            + " against operational invoice " + invoicePublicId + ". This does not assert gateway verification.");
    return getPayment(actor, paymentPublicId);
  }

  public List<PaymentView> listPayments(StaffPrincipal actor, UUID invoicePublicId) {
    List<Long> invoiceIds = jdbc.query("""
        select id from service_invoice where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), invoicePublicId);
    if (invoiceIds.isEmpty()) throw notFound("Operational invoice was not found.");
    List<UUID> payments = jdbc.query("""
        select payment.public_id
        from service_payment payment
        join service_payment_allocation allocation on allocation.dealership_id = payment.dealership_id
          and allocation.payment_id = payment.id
        where payment.dealership_id = ? and allocation.invoice_id = ?
        order by payment.recorded_at desc, payment.id desc
        limit 100
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), invoiceIds.getFirst());
    return payments.stream().map(id -> getPayment(actor, id)).toList();
  }

  public PaymentView getPayment(StaffPrincipal actor, UUID paymentPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select payment.id, payment.public_id, payment.receipt_number, payment.payment_method, payment.amount,
          payment.payment_reference, payment.note, payment.status, payment.recorded_at,
          recorder.full_name as recorded_by_name, reverser.full_name as reversed_by_name,
          payment.reversed_at, reversal.reason as reversal_reason,
           reversal.external_reference as reversal_reference
        from service_payment payment
        join staff_user recorder on recorder.dealership_id = payment.dealership_id
          and recorder.id = payment.recorded_by_staff_user_id
        left join staff_user reverser on reverser.dealership_id = payment.dealership_id
          and reverser.id = payment.reversed_by_staff_user_id
        left join service_payment_reversal reversal on reversal.dealership_id = payment.dealership_id
          and reversal.payment_id = payment.id
        where payment.dealership_id = ? and payment.public_id = ?
        """, actor.dealershipId(), paymentPublicId);
    if (rows.isEmpty()) throw notFound("Payment record was not found.");
    Map<String, Object> row = rows.getFirst();
    long paymentId = number(row.get("id"));
    List<PaymentAllocationView> allocations = jdbc.query("""
        select inv.public_id as invoice_public_id, inv.invoice_number, job.job_card_code, allocation.amount
        from service_payment_allocation allocation
        join service_invoice inv on inv.dealership_id = allocation.dealership_id and inv.id = allocation.invoice_id
        join service_job_card job on job.dealership_id = inv.dealership_id and job.id = inv.job_card_id
        where allocation.dealership_id = ? and allocation.payment_id = ?
        order by allocation.id
        """, (rs, rowNum) -> new PaymentAllocationView(
            rs.getObject("invoice_public_id", UUID.class), rs.getString("invoice_number"),
            rs.getString("job_card_code"), rs.getBigDecimal("amount")), actor.dealershipId(), paymentId);
    return new PaymentView(
        (UUID) row.get("public_id"), String.valueOf(row.get("receipt_number")),
        String.valueOf(row.get("payment_method")), (BigDecimal) row.get("amount"),
        (String) row.get("payment_reference"), (String) row.get("note"), String.valueOf(row.get("status")),
        String.valueOf(row.get("recorded_by_name")), ((Timestamp) row.get("recorded_at")).toInstant(),
        (String) row.get("reversed_by_name"), instantOrNull((Timestamp) row.get("reversed_at")),
        (String) row.get("reversal_reason"), (String) row.get("reversal_reference"), allocations);
  }

  @Transactional
  public PaymentView reversePayment(StaffPrincipal actor, UUID paymentPublicId, PaymentReversalRequest request) {
    String reason = requiredText(request.reason(), "Payment reversal reason", 500);
    String externalReference = optionalText(request.externalReference(), 160);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, status, receipt_number from service_payment
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), paymentPublicId);
    if (rows.isEmpty()) throw notFound("Payment record was not found.");
    Map<String, Object> payment = rows.getFirst();
    long paymentId = number(payment.get("id"));
    if ("REVERSED".equals(String.valueOf(payment.get("status")))) {
      return getPayment(actor, paymentPublicId);
    }

    List<Long> invoiceIds = jdbc.query("""
        select invoice_id from service_payment_allocation
        where dealership_id = ? and payment_id = ? order by invoice_id
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), paymentId);
    for (Long invoiceId : invoiceIds) {
      jdbc.queryForList("""
          select id from service_invoice where dealership_id = ? and id = ? for update
          """, actor.dealershipId(), invoiceId);
    }
    Integer alreadyDelivered = jdbc.queryForObject("""
        select count(*) from service_delivery_handover handover
        join service_payment_allocation allocation on allocation.dealership_id = handover.dealership_id
          and allocation.invoice_id = handover.invoice_id
        where allocation.dealership_id = ? and allocation.payment_id = ?
        """, Integer.class, actor.dealershipId(), paymentId);
    if (alreadyDelivered != null && alreadyDelivered > 0) {
      throw conflict("A payment supporting an already-delivered vehicle cannot be reversed through this workflow.");
    }

    jdbc.update("""
        insert into service_payment_reversal(
          dealership_id, payment_id, reason, external_reference, reversed_by_staff_user_id)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), paymentId, reason, externalReference, actor.staffUserId());
    int changed = jdbc.update("""
        update service_payment set status = 'REVERSED', reversed_by_staff_user_id = ?,
          reversed_at = now()
        where dealership_id = ? and id = ? and status = 'RECORDED'
        """, actor.staffUserId(), actor.dealershipId(), paymentId);
    if (changed != 1) throw conflict("Payment state changed while recording reversal.");
    audit(actor, "SERVICE_PAYMENT_REVERSED", "SERVICE_PAYMENT", paymentPublicId.toString(),
        "Payment ledger entry reversed with recorded reason. Money movement is not initiated by this operation.");
    return getPayment(actor, paymentPublicId);
  }

  @Transactional
  public HandoverView deliverJobCard(StaffPrincipal actor, UUID jobCardPublicId, HandoverRequest request) {
    String deliveredToName = requiredText(request.deliveredToName(), "Recipient name", 160);
    String method = request.acknowledgementMethod() == null ? "" :
        request.acknowledgementMethod().trim().toUpperCase(Locale.ROOT);
    if (!HANDOVER_METHODS.contains(method)) throw badRequest("Choose a supported handover acknowledgement method.");
    String reference = optionalText(request.acknowledgementReference(), 160);
    String note = optionalText(request.note(), 1000);
    if (Set.of("SIGNED_FORM", "OTP_REFERENCE").contains(method) && reference == null) {
      throw badRequest("An acknowledgement reference is required for signed-form or OTP-reference handover.");
    }
    if (!Boolean.TRUE.equals(request.customerAcknowledged())) {
      throw badRequest("Confirm that the recipient has acknowledged receipt before completing handover.");
    }

    List<Map<String, Object>> jobRows = jdbc.queryForList("""
        select id, public_id, job_card_code, customer_id, status
        from service_job_card
        where dealership_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), jobCardPublicId);
    if (jobRows.isEmpty()) throw notFound("Workshop job card was not found.");
    Map<String, Object> job = jobRows.getFirst();
    long jobCardId = number(job.get("id"));
    if ("DELIVERED".equals(String.valueOf(job.get("status")))) {
      return getHandover(actor, jobCardPublicId);
    }
    if (!"INVOICED".equals(String.valueOf(job.get("status")))) {
      throw conflict("A job card must be invoiced before vehicle handover.");
    }

    List<Map<String, Object>> invoiceRows = jdbc.queryForList("""
        select id, public_id, invoice_number, status, invoice_total
        from service_invoice
        where dealership_id = ? and job_card_id = ? and status = 'ISSUED'
        order by issued_at desc, id desc
        limit 1
        for update
        """, actor.dealershipId(), jobCardId);
    if (invoiceRows.isEmpty()) throw conflict("An issued operational invoice is required before handover.");
    Map<String, Object> invoice = invoiceRows.getFirst();
    long invoiceId = number(invoice.get("id"));
    BigDecimal total = (BigDecimal) invoice.get("invoice_total");
    BigDecimal paid = currentPaidAmount(actor.dealershipId(), invoiceId);
    BigDecimal due = total.subtract(paid).setScale(2, RoundingMode.HALF_UP);
    if (due.signum() != 0) {
      throw conflict("The invoice must be fully settled before vehicle handover. Outstanding balance: " + due.toPlainString());
    }
    long customerId = number(job.get("customer_id"));
    Long handoverId = jdbc.queryForObject("""
        insert into service_delivery_handover(
          dealership_id, job_card_id, invoice_id, customer_id, delivered_to_name,
          customer_acknowledged, acknowledgement_method, acknowledgement_reference, note,
          delivered_by_staff_user_id)
        values (?, ?, ?, ?, ?, true, ?, ?, ?, ?)
        returning id
        """, Long.class, actor.dealershipId(), jobCardId, invoiceId, customerId, deliveredToName,
        method, reference, note, actor.staffUserId());

    int changed = jdbc.update("""
        update service_job_card set status = 'DELIVERED', delivered_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'INVOICED'
        """, actor.dealershipId(), jobCardId);
    if (changed != 1) throw conflict("Job-card state changed while completing handover.");
    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason, details)
        values (?, ?, 'INVOICED', 'DELIVERED', 'VEHICLE_HANDED_OVER', ?, ?,
          jsonb_build_object('invoiceNumber', ?, 'acknowledgementMethod', ?, 'balanceDue', 0))
        """, actor.dealershipId(), jobCardId, actor.staffUserId(),
        note == null ? "Vehicle handed over after invoice settlement." : note,
        invoice.get("invoice_number"), method);
    UUID handoverPublicId = jdbc.queryForObject("""
        select public_id from service_delivery_handover where dealership_id = ? and id = ?
        """, UUID.class, actor.dealershipId(), handoverId);
    audit(actor, "SERVICE_VEHICLE_DELIVERED", "SERVICE_JOB_CARD", jobCardPublicId.toString(),
        "Vehicle handed over to " + deliveredToName + " after invoice settlement and recorded acknowledgement.");
    return getHandoverByPublicId(actor, handoverPublicId);
  }

  public HandoverView getHandover(StaffPrincipal actor, UUID jobCardPublicId) {
    List<UUID> ids = jdbc.query("""
        select handover.public_id
        from service_delivery_handover handover
        join service_job_card job on job.dealership_id = handover.dealership_id and job.id = handover.job_card_id
        where handover.dealership_id = ? and job.public_id = ?
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), jobCardPublicId);
    if (ids.isEmpty()) throw notFound("Vehicle handover was not found for this job card.");
    return getHandoverByPublicId(actor, ids.getFirst());
  }

  private HandoverView getHandoverByPublicId(StaffPrincipal actor, UUID handoverPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select handover.public_id, job.public_id as job_card_public_id, job.job_card_code,
          invoice.public_id as invoice_public_id, invoice.invoice_number, customer.public_id as customer_public_id,
          customer.full_name as customer_name, handover.delivered_to_name, handover.customer_acknowledged,
          handover.acknowledgement_method, handover.acknowledgement_reference, handover.note,
          staff.full_name as delivered_by_name, handover.delivered_at
        from service_delivery_handover handover
        join service_job_card job on job.dealership_id = handover.dealership_id and job.id = handover.job_card_id
        join service_invoice invoice on invoice.dealership_id = handover.dealership_id and invoice.id = handover.invoice_id
        join customer on customer.dealership_id = handover.dealership_id and customer.id = handover.customer_id
        join staff_user staff on staff.dealership_id = handover.dealership_id and staff.id = handover.delivered_by_staff_user_id
        where handover.dealership_id = ? and handover.public_id = ?
        """, actor.dealershipId(), handoverPublicId);
    if (rows.isEmpty()) throw notFound("Vehicle handover was not found.");
    Map<String, Object> row = rows.getFirst();
    return new HandoverView(
        (UUID) row.get("public_id"), (UUID) row.get("job_card_public_id"), String.valueOf(row.get("job_card_code")),
        (UUID) row.get("invoice_public_id"), String.valueOf(row.get("invoice_number")),
        (UUID) row.get("customer_public_id"), String.valueOf(row.get("customer_name")),
        String.valueOf(row.get("delivered_to_name")), (Boolean) row.get("customer_acknowledged"),
        String.valueOf(row.get("acknowledgement_method")), (String) row.get("acknowledgement_reference"),
        (String) row.get("note"), String.valueOf(row.get("delivered_by_name")),
        ((Timestamp) row.get("delivered_at")).toInstant());
  }

  private long requireJobCardId(StaffPrincipal actor, UUID jobCardPublicId) {
    List<Long> ids = jdbc.query("""
        select id from service_job_card where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), jobCardPublicId);
    if (ids.isEmpty()) throw notFound("Workshop job card was not found.");
    return ids.getFirst();
  }

  private BigDecimal currentPaidAmount(long dealershipId, long invoiceId) {
    BigDecimal paid = jdbc.queryForObject("""
        select coalesce(sum(allocation.amount), 0)
        from service_payment_allocation allocation
        join service_payment payment on payment.dealership_id = allocation.dealership_id
          and payment.id = allocation.payment_id and payment.status = 'RECORDED'
        where allocation.dealership_id = ? and allocation.invoice_id = ?
        """, BigDecimal.class, dealershipId, invoiceId);
    return (paid == null ? BigDecimal.ZERO : paid).setScale(2, RoundingMode.HALF_UP);
  }

  private void audit(StaffPrincipal actor, String action, String entityType, String entityId, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, entityType, entityId, summary);
  }

  private static BigDecimal normalizeMoney(BigDecimal raw, String label) {
    if (raw == null || raw.signum() < 0 || raw.compareTo(MAX_MONEY) > 0) {
      throw badRequest(label + " is outside the supported monetary range.");
    }
    try {
      return raw.setScale(2, RoundingMode.UNNECESSARY);
    } catch (ArithmeticException invalidScale) {
      throw badRequest(label + " may contain at most two decimal places.");
    }
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static Instant instantOrNull(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toInstant();
  }

  private static String requiredText(String raw, String label, int maxLength) {
    String cleaned = optionalText(raw, maxLength);
    if (cleaned == null) throw badRequest(label + " is required.");
    return cleaned;
  }

  private static String optionalText(String raw, int maxLength) {
    if (raw == null) return null;
    String cleaned = raw.trim();
    if (cleaned.isEmpty()) return null;
    if (cleaned.length() > maxLength || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return cleaned;
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

  public record InvoiceLineView(
      int lineNumber, int sourceEstimateLineNumber, String lineType, String description,
      BigDecimal quantity, BigDecimal unitPrice, BigDecimal lineTotal) {}
  public record InvoiceView(
      UUID publicId, String invoiceNumber, UUID jobCardPublicId, String jobCardCode,
      UUID customerPublicId, String customerName, String customerPhone, UUID vehiclePublicId,
      String modelName, String variantName, String colourName, String chassisNumber, String engineNumber,
      int estimateRevision, String status, BigDecimal partsSubtotal, BigDecimal labourSubtotal,
      BigDecimal otherSubtotal, BigDecimal discountAmount, BigDecimal invoiceTotal, BigDecimal paidAmount,
      BigDecimal balanceDue, String customerMessage, String createdByName, String issuedByName,
      Instant createdAt, Instant issuedAt, List<InvoiceLineView> lines) {}
  public record PaymentRequest(String idempotencyKey, String paymentMethod, BigDecimal amount,
      String paymentReference, String note) {}
  public record PaymentReversalRequest(String reason, String externalReference) {}
  public record PaymentAllocationView(UUID invoicePublicId, String invoiceNumber, String jobCardCode, BigDecimal amount) {}
  public record PaymentView(UUID publicId, String receiptNumber, String paymentMethod, BigDecimal amount,
      String paymentReference, String note, String status, String recordedByName, Instant recordedAt,
      String reversedByName, Instant reversedAt, String reversalReason, String reversalReference,
      List<PaymentAllocationView> allocations) {}
  public record HandoverRequest(String deliveredToName, Boolean customerAcknowledged,
      String acknowledgementMethod, String acknowledgementReference, String note) {}
  public record HandoverView(UUID publicId, UUID jobCardPublicId, String jobCardCode,
      UUID invoicePublicId, String invoiceNumber, UUID customerPublicId, String customerName,
      String deliveredToName, boolean customerAcknowledged, String acknowledgementMethod,
      String acknowledgementReference, String note, String deliveredByName, Instant deliveredAt) {}
}
