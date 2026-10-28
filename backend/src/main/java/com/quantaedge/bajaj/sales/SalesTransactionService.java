package com.quantaedge.bajaj.sales;

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

/** Transactional conversion of a reserved sales booking to a paid, acknowledged sale. */
@Service
public class SalesTransactionService {
  private static final BigDecimal MAX_MONEY = new BigDecimal("99999999999999.99");
  private static final BigDecimal MAX_UNIT_MONEY = new BigDecimal("999999999999.99");
  private static final BigDecimal MAX_QUANTITY = new BigDecimal("999999999.999");
  private static final Set<String> PAYMENT_METHODS = Set.of("CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER");
  private static final Set<String> ACK_METHODS = Set.of("IN_PERSON", "SIGNED_FORM", "OTP_REFERENCE", "WRITTEN_MESSAGE");

  private final JdbcTemplate jdbc;

  public SalesTransactionService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional
  public SaleInvoiceView createDraftInvoice(StaffPrincipal actor, UUID bookingPublicId, SaleInvoiceRequest request) {
    if (request == null) throw badRequest("Sales invoice details are required.");
    String key = required(request.idempotencyKey(), "Idempotency key", 120);
    BigDecimal vehiclePrice = normalizeMoney(request.vehiclePrice(), "Vehicle price", false);
    BigDecimal vehicleDiscount = normalizeMoney(request.vehicleDiscount() == null ? BigDecimal.ZERO : request.vehicleDiscount(),
        "Vehicle discount", true);
    if (vehicleDiscount.compareTo(vehiclePrice) > 0) throw badRequest("Vehicle discount cannot exceed the vehicle price.");
    String customerMessage = optional(request.customerMessage(), 2000);
    List<LineDraft> addOns = normalizeAddOns(request.addOns());
    String fingerprint = invoiceFingerprint(bookingPublicId, vehiclePrice, vehicleDiscount, customerMessage, addOns);

    List<Map<String, Object>> keyRows = jdbc.queryForList("""
        select public_id, request_fingerprint from vehicle_sale_invoice
        where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), key);
    if (!keyRows.isEmpty()) {
      Map<String, Object> prior = keyRows.getFirst();
      if (!constantTimeEquals(String.valueOf(prior.get("request_fingerprint")), fingerprint)) {
        throw conflict("This sales-invoice idempotency key was used for a different request.");
      }
      return getInvoice(actor, (UUID) prior.get("public_id"));
    }

    SaleContext context = lockSaleContext(actor, bookingPublicId);
    requireReservableBooking(actor, context);
    List<Map<String, Object>> existingInvoices = jdbc.queryForList("""
        select public_id, request_fingerprint
        from vehicle_sale_invoice
        where dealership_id = ? and booking_id = ? and status in ('DRAFT', 'ISSUED')
        for update
        """, actor.dealershipId(), context.bookingId());
    if (!existingInvoices.isEmpty()) {
      Map<String, Object> existing = existingInvoices.getFirst();
      if (!constantTimeEquals(String.valueOf(existing.get("request_fingerprint")), fingerprint)) {
        throw conflict("This booking already has a sales invoice with different pricing. Cancel it before preparing a replacement.");
      }
      return getInvoice(actor, (UUID) existing.get("public_id"));
    }

    List<UUID> created = jdbc.query("""
        insert into vehicle_sale_invoice(
          dealership_id, invoice_number, booking_id, customer_id, vehicle_unit_id,
          idempotency_key, request_fingerprint, status, invoice_total, customer_message,
          created_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
        returning public_id
        """, (rs, rowNum) -> rs.getObject(1, UUID.class),
        actor.dealershipId(), "SALE-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT),
        context.bookingId(), context.customerId(), context.vehicleUnitId(), key, fingerprint,
        invoiceTotal(vehiclePrice, vehicleDiscount, addOns), customerMessage, actor.staffUserId());
    if (created.isEmpty()) throw conflict("Sales invoice could not be created. Refresh and retry.");
    UUID invoicePublicId = created.getFirst();
    long invoiceId = jdbc.queryForObject("""
        select id from vehicle_sale_invoice where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), invoicePublicId);

    int line = 1;
    String vehicleDescription = context.modelName()
        + (context.variantName() == null ? "" : " " + context.variantName())
        + " — chassis " + context.chassisNumber();
    BigDecimal vehicleTotal = vehiclePrice.subtract(vehicleDiscount).setScale(2, RoundingMode.HALF_UP);
    insertInvoiceLine(actor, invoiceId, line++, "VEHICLE", vehicleDescription,
        BigDecimal.ONE, vehiclePrice, vehicleDiscount, vehicleTotal);
    for (LineDraft addOn : addOns) {
      insertInvoiceLine(actor, invoiceId, line++, addOn.lineType(), addOn.description(),
          addOn.quantity(), addOn.unitPrice(), addOn.discountAmount(), addOn.lineTotal());
    }

    audit(actor, "SALES_INVOICE_DRAFT_CREATED", "VEHICLE_SALE_INVOICE", invoicePublicId.toString(),
        "Draft sales invoice created against booking " + context.bookingCode()
            + ". It is an operational record, not a GST tax invoice.");
    addActivity(actor, context.enquiryId(), "SALE_INVOICE_CREATED", "BOOKED", "BOOKED",
        "Prepared sales invoice " + getInvoiceNumber(actor, invoicePublicId) + ".", "VEHICLE_SALE_INVOICE",
        invoicePublicId.toString());
    return getInvoice(actor, invoicePublicId);
  }

  @Transactional
  public SaleInvoiceView issueInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    SaleContext reference = requireInvoiceSaleContext(actor, invoicePublicId, false);
    SaleContext context = lockSaleContext(actor, reference.bookingPublicId());
    requireReservableBooking(context);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, status, invoice_number, invoice_total
        from vehicle_sale_invoice
        where dealership_id = ? and public_id = ? and booking_id = ?
        for update
        """, actor.dealershipId(), invoicePublicId, context.bookingId());
    if (rows.isEmpty()) throw notFound("Sales invoice was not found for this dealership and booking.");
    Map<String, Object> row = rows.getFirst();
    String status = String.valueOf(row.get("status"));
    if ("ISSUED".equals(status)) return getInvoice(actor, invoicePublicId);
    if (!"DRAFT".equals(status)) throw conflict("Only a draft sales invoice can be issued.");
    BigDecimal total = (BigDecimal) row.get("invoice_total");
    if (total == null || total.signum() <= 0) throw conflict("Sales invoice total must be positive.");
    int changed = jdbc.update("""
        update vehicle_sale_invoice
        set status = 'ISSUED', issued_by_staff_user_id = ?, issued_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'DRAFT'
        """, actor.staffUserId(), actor.dealershipId(), number(row.get("id")));
    if (changed != 1) throw conflict("Sales invoice status changed while issuing.");
    audit(actor, "SALES_INVOICE_ISSUED", "VEHICLE_SALE_INVOICE", invoicePublicId.toString(),
        "Issued operational sales invoice " + row.get("invoice_number") + " for " + total
            + ". GST/tax compliance is not represented by this workflow.");
    addActivity(actor, context.enquiryId(), "SALE_INVOICE_ISSUED", "BOOKED", "BOOKED",
        "Issued sales invoice " + row.get("invoice_number") + ".", "VEHICLE_SALE_INVOICE",
        invoicePublicId.toString());
    return getInvoice(actor, invoicePublicId);
  }

  @Transactional
  public SaleInvoiceView cancelInvoice(StaffPrincipal actor, UUID invoicePublicId, String rawReason) {
    String reason = required(rawReason, "Cancellation reason", 500);
    SaleContext reference = requireInvoiceSaleContext(actor, invoicePublicId, false);
    SaleContext context = lockSaleContext(actor, reference.bookingPublicId());
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select invoice.id, invoice.status, invoice.invoice_number,
          coalesce((select sum(payment.amount) from vehicle_sale_payment payment
            where payment.dealership_id = invoice.dealership_id and payment.invoice_id = invoice.id
              and payment.status = 'RECORDED'), 0) as paid_amount
        from vehicle_sale_invoice invoice
        where invoice.dealership_id = ? and invoice.public_id = ? and invoice.booking_id = ?
        for update
        """, actor.dealershipId(), invoicePublicId, context.bookingId());
    if (rows.isEmpty()) throw notFound("Sales invoice was not found.");
    Map<String, Object> row = rows.getFirst();
    if ("CANCELLED".equals(String.valueOf(row.get("status")))) return getInvoice(actor, invoicePublicId);
    if (!"ACTIVE".equals(context.bookingStatus())) throw conflict("Only an active booking's invoice may be cancelled.");
    if (((BigDecimal) row.get("paid_amount")).signum() > 0) {
      throw conflict("Reverse recorded payments before cancelling this invoice.");
    }
    int changed = jdbc.update("""
        update vehicle_sale_invoice
        set status = 'CANCELLED', cancelled_by_staff_user_id = ?, cancelled_at = now(),
            cancellation_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status in ('DRAFT', 'ISSUED')
        """, actor.staffUserId(), reason, actor.dealershipId(), number(row.get("id")));
    if (changed != 1) throw conflict("Sales invoice status changed while cancelling.");
    audit(actor, "SALES_INVOICE_CANCELLED", "VEHICLE_SALE_INVOICE", invoicePublicId.toString(),
        "Cancelled sales invoice " + row.get("invoice_number") + ". Reason: " + reason);
    return getInvoice(actor, invoicePublicId);
  }

  public SaleInvoiceView getInvoiceForBooking(StaffPrincipal actor, UUID bookingPublicId) {
    List<UUID> ids = jdbc.query("""
        select invoice.public_id from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id
          and booking.id = invoice.booking_id
        where invoice.dealership_id = ? and booking.public_id = ?
        order by invoice.created_at desc, invoice.id desc limit 1
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), bookingPublicId);
    if (ids.isEmpty()) throw notFound("No sales invoice has been created for this booking.");
    return getInvoice(actor, ids.getFirst());
  }

  public SaleInvoiceView getInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select invoice.id, invoice.public_id, invoice.invoice_number, invoice.status,
          invoice.invoice_total, invoice.customer_message, invoice.created_at, invoice.issued_at,
          invoice.cancelled_at, invoice.cancellation_reason, booking.public_id as booking_public_id,
          booking.booking_code, booking.status as booking_status, customer.public_id as customer_public_id,
          customer.customer_code, customer.full_name as customer_name, customer.phone as customer_phone,
          vehicle.public_id as vehicle_public_id, vehicle.chassis_number, vehicle.engine_number,
          model.model_code, model.model_name, model.variant_name, model.colour_name,
          creator.full_name as created_by_name, issuer.full_name as issued_by_name,
          coalesce((select sum(payment.amount) from vehicle_sale_payment payment
            where payment.dealership_id = invoice.dealership_id and payment.invoice_id = invoice.id
              and payment.status = 'RECORDED'), 0) as paid_amount
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        join customer on customer.dealership_id = invoice.dealership_id and customer.id = invoice.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = invoice.dealership_id and vehicle.id = invoice.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        join staff_user creator on creator.dealership_id = invoice.dealership_id and creator.id = invoice.created_by_staff_user_id
        left join staff_user issuer on issuer.dealership_id = invoice.dealership_id and issuer.id = invoice.issued_by_staff_user_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Sales invoice was not found in this dealership.");
    Map<String, Object> row = rows.getFirst();
    long invoiceId = number(row.get("id"));
    BigDecimal total = (BigDecimal) row.get("invoice_total");
    BigDecimal paid = (BigDecimal) row.get("paid_amount");
    List<InvoiceLineView> lines = jdbc.query("""
        select line_number, line_type, description, quantity, unit_price, discount_amount, line_total
        from vehicle_sale_invoice_line
        where dealership_id = ? and invoice_id = ?
        order by line_number
        """, (rs, rowNum) -> new InvoiceLineView(
            rs.getInt("line_number"), rs.getString("line_type"), rs.getString("description"),
            rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_price"),
            rs.getBigDecimal("discount_amount"), rs.getBigDecimal("line_total")),
        actor.dealershipId(), invoiceId);
    BigDecimal calculated = lines.stream().map(InvoiceLineView::lineTotal)
        .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);
    if (calculated.compareTo(total) != 0) throw conflict("Invoice line total does not match the saved invoice header.");
    BigDecimal balance = total.subtract(paid).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    return new SaleInvoiceView(
        (UUID) row.get("public_id"), String.valueOf(row.get("invoice_number")),
        (UUID) row.get("booking_public_id"), String.valueOf(row.get("booking_code")),
        String.valueOf(row.get("booking_status")), (UUID) row.get("customer_public_id"),
        String.valueOf(row.get("customer_code")), String.valueOf(row.get("customer_name")),
        (String) row.get("customer_phone"), (UUID) row.get("vehicle_public_id"),
        String.valueOf(row.get("model_code")), String.valueOf(row.get("model_name")),
        (String) row.get("variant_name"), (String) row.get("colour_name"),
        String.valueOf(row.get("chassis_number")), String.valueOf(row.get("engine_number")),
        String.valueOf(row.get("status")), total, paid, balance,
        "Operational sales invoice — not a GST tax invoice. Tax treatment and statutory fields are not implemented.",
        (String) row.get("customer_message"), String.valueOf(row.get("created_by_name")),
        (String) row.get("issued_by_name"), ((Timestamp) row.get("created_at")).toInstant(),
        instantOrNull((Timestamp) row.get("issued_at")), instantOrNull((Timestamp) row.get("cancelled_at")),
        (String) row.get("cancellation_reason"), lines);
  }

  @Transactional
  public SalePaymentView recordPayment(StaffPrincipal actor, UUID invoicePublicId, SalePaymentRequest request) {
    if (request == null) throw badRequest("Sales payment details are required.");
    String method = normalizeChoice(request.paymentMethod(), "Payment method", PAYMENT_METHODS);
    BigDecimal amount = normalizeMoney(request.amount(), "Payment amount", false);
    String key = required(request.idempotencyKey(), "Payment idempotency key", 120);
    String reference = optional(request.paymentReference(), 160);
    String note = optional(request.note(), 1000);
    if (Set.of("UPI", "BANK_TRANSFER", "CARD").contains(method) && reference == null) {
      throw badRequest("A payment reference is required for UPI, bank-transfer and card entries.");
    }
    String fingerprint = TokenDigests.sha256(invoicePublicId + "|" + method + "|" + amount.toPlainString()
        + "|" + (reference == null ? "" : reference) + "|" + (note == null ? "" : note));

    List<Map<String, Object>> before = jdbc.queryForList("""
        select public_id, request_fingerprint from vehicle_sale_payment
        where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), key);
    if (!before.isEmpty()) return replayPayment(actor, before.getFirst(), fingerprint, invoicePublicId);

    List<Map<String, Object>> invoiceRows = jdbc.queryForList("""
        select invoice.id, invoice.status, invoice.invoice_total, booking.status as booking_status
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        for update of invoice
        """, actor.dealershipId(), invoicePublicId);
    if (invoiceRows.isEmpty()) throw notFound("Sales invoice was not found.");
    Map<String, Object> invoiceRow = invoiceRows.getFirst();
    List<Map<String, Object>> afterLock = jdbc.queryForList("""
        select public_id, request_fingerprint from vehicle_sale_payment
        where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), key);
    if (!afterLock.isEmpty()) return replayPayment(actor, afterLock.getFirst(), fingerprint, invoicePublicId);
    if (!"ISSUED".equals(String.valueOf(invoiceRow.get("status")))) {
      throw conflict("Payments can only be recorded against an issued sales invoice.");
    }
    if (!"ACTIVE".equals(String.valueOf(invoiceRow.get("booking_status")))) {
      throw conflict("Payments are blocked after the booking has been converted or cancelled.");
    }
    BigDecimal total = (BigDecimal) invoiceRow.get("invoice_total");
    BigDecimal paid = sumRecordedPayments(actor.dealershipId(), number(invoiceRow.get("id")));
    BigDecimal balance = total.subtract(paid).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    if (amount.compareTo(balance) > 0) throw conflict("Payment exceeds the outstanding sales invoice balance of " + balance + ".");

    String receiptNumber = "SALE-RCP-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    List<UUID> inserted = jdbc.query("""
        insert into vehicle_sale_payment(
          dealership_id, invoice_id, receipt_number, idempotency_key, request_fingerprint,
          payment_method, amount, payment_reference, note, recorded_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (dealership_id, idempotency_key) do nothing
        returning public_id
        """, (rs, rowNum) -> rs.getObject(1, UUID.class),
        actor.dealershipId(), number(invoiceRow.get("id")), receiptNumber, key, fingerprint,
        method, amount, reference, note, actor.staffUserId());
    if (inserted.isEmpty()) {
      List<Map<String, Object>> raced = jdbc.queryForList("""
          select public_id, request_fingerprint from vehicle_sale_payment
          where dealership_id = ? and idempotency_key = ?
          """, actor.dealershipId(), key);
      if (raced.isEmpty()) throw conflict("Sales payment could not be recorded. Refresh and retry.");
      return replayPayment(actor, raced.getFirst(), fingerprint, invoicePublicId);
    }
    UUID paymentPublicId = inserted.getFirst();
    audit(actor, "SALES_PAYMENT_RECORDED", "VEHICLE_SALE_PAYMENT", paymentPublicId.toString(),
        "Recorded manual sales receipt " + receiptNumber + " for " + amount + " using " + method
            + ". This is not a payment-provider verification.");
    addActivityForInvoice(actor, invoicePublicId, "SALE_PAYMENT_RECORDED",
        "Recorded sales receipt " + receiptNumber + " for " + amount + ".");
    return getPayment(actor, paymentPublicId);
  }

  @Transactional
  public SalePaymentView reversePayment(StaffPrincipal actor, UUID paymentPublicId, SalePaymentReversalRequest request) {
    if (request == null) throw badRequest("A payment reversal reason is required.");
    String reason = required(request.reason(), "Reversal reason", 500);
    String externalReference = optional(request.externalReference(), 160);
    List<Map<String, Object>> refs = jdbc.queryForList("""
        select invoice.public_id from vehicle_sale_payment payment
        join vehicle_sale_invoice invoice on invoice.dealership_id = payment.dealership_id and invoice.id = payment.invoice_id
        where payment.dealership_id = ? and payment.public_id = ?
        """, actor.dealershipId(), paymentPublicId);
    if (refs.isEmpty()) throw notFound("Sales payment receipt was not found.");
    UUID invoicePublicId = (UUID) refs.getFirst().get("public_id");
    List<Map<String, Object>> invoiceRows = jdbc.queryForList("""
        select invoice.id, booking.status as booking_status
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        for update of invoice
        """, actor.dealershipId(), invoicePublicId);
    if (invoiceRows.isEmpty()) throw notFound("Sales invoice was not found.");
    if (!"ACTIVE".equals(String.valueOf(invoiceRows.getFirst().get("booking_status")))) {
      throw conflict("A payment on a converted sale cannot be reversed here. Use an authorised refund/credit workflow.");
    }

    List<Map<String, Object>> paymentRows = jdbc.queryForList("""
        select id, status from vehicle_sale_payment
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), paymentPublicId);
    if (paymentRows.isEmpty()) throw notFound("Sales payment receipt was not found.");
    Map<String, Object> payment = paymentRows.getFirst();
    if ("REVERSED".equals(String.valueOf(payment.get("status")))) return getPayment(actor, paymentPublicId);
    long paymentId = number(payment.get("id"));
    int changed = jdbc.update("""
        update vehicle_sale_payment
        set status = 'REVERSED', reversed_by_staff_user_id = ?, reversed_at = now()
        where dealership_id = ? and id = ? and status = 'RECORDED'
        """, actor.staffUserId(), actor.dealershipId(), paymentId);
    if (changed != 1) throw conflict("Sales payment status changed while recording reversal.");
    jdbc.update("""
        insert into vehicle_sale_payment_reversal(
          dealership_id, payment_id, reason, external_reference, reversed_by_staff_user_id)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), paymentId, reason, externalReference, actor.staffUserId());
    audit(actor, "SALES_PAYMENT_REVERSED", "VEHICLE_SALE_PAYMENT", paymentPublicId.toString(),
        "Reversed sales receipt. Reason: " + reason + (externalReference == null ? "" : "; reference=" + externalReference));
    addActivityForInvoice(actor, invoicePublicId, "SALE_PAYMENT_REVERSED", "Reversed sales receipt. Reason: " + reason);
    return getPayment(actor, paymentPublicId);
  }

  @Transactional
  public SaleHandoverView deliverBooking(StaffPrincipal actor, UUID bookingPublicId, HandoverRequest request) {
    if (request == null) throw badRequest("Vehicle handover details are required.");
    String receiver = required(request.deliveredToName(), "Person receiving the bike", 160);
    if (!Boolean.TRUE.equals(request.customerAcknowledged())) {
      throw badRequest("Customer acknowledgement is required before delivery.");
    }
    String method = normalizeChoice(request.acknowledgementMethod(), "Acknowledgement method", ACK_METHODS);
    String reference = optional(request.acknowledgementReference(), 160);
    String note = optional(request.note(), 1000);
    if (Set.of("SIGNED_FORM", "OTP_REFERENCE").contains(method) && reference == null) {
      throw badRequest("A reference is required for signed-form or OTP-reference acknowledgement.");
    }
    if (Set.of("IN_PERSON", "WRITTEN_MESSAGE").contains(method) && reference == null && note == null) {
      throw badRequest("Record a note or reference for the handover acknowledgement.");
    }

    SaleContext context = lockSaleContext(actor, bookingPublicId);
    if ("CONVERTED_TO_SALE".equals(context.bookingStatus())) return getHandoverForBooking(actor, bookingPublicId);
    if (!"ACTIVE".equals(context.bookingStatus())) throw conflict("Only an active bike booking can be delivered.");
    if (!"RESERVED".equals(context.stockStatus())) throw conflict("The bike is no longer reserved by this booking.");
    if (hasCurrentOwner(actor.dealershipId(), context.vehicleUnitId())) {
      throw conflict("The bike already has a current customer ownership link. Delivery is blocked.");
    }

    List<Map<String, Object>> invoices = jdbc.queryForList("""
        select id, public_id, invoice_total, invoice_number
        from vehicle_sale_invoice
        where dealership_id = ? and booking_id = ? and status = 'ISSUED'
        order by id desc limit 1 for update
        """, actor.dealershipId(), context.bookingId());
    if (invoices.isEmpty()) throw conflict("Issue a sales invoice before delivering the bike.");
    Map<String, Object> invoice = invoices.getFirst();
    long invoiceId = number(invoice.get("id"));
    BigDecimal total = (BigDecimal) invoice.get("invoice_total");
    BigDecimal paid = sumRecordedPayments(actor.dealershipId(), invoiceId);
    BigDecimal balance = total.subtract(paid).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    if (balance.signum() != 0) throw conflict("The sales invoice must be fully settled before delivery. Balance due: " + balance + ".");

    try {
      jdbc.update("""
          insert into vehicle_sale_handover(
            dealership_id, booking_id, invoice_id, customer_id, vehicle_unit_id,
            delivered_to_name, customer_acknowledged, acknowledgement_method,
            acknowledgement_reference, note, delivered_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?)
          """, actor.dealershipId(), context.bookingId(), invoiceId, context.customerId(),
          context.vehicleUnitId(), receiver, method, reference, note, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      List<Map<String, Object>> converted = jdbc.queryForList("""
          select status from sales_booking where dealership_id = ? and id = ?
          """, actor.dealershipId(), context.bookingId());
      if (!converted.isEmpty() && "CONVERTED_TO_SALE".equals(String.valueOf(converted.getFirst().get("status")))) {
        return getHandoverForBooking(actor, bookingPublicId);
      }
      throw conflict("A handover record already exists for this booking.");
    }

    jdbc.update("""
        insert into customer_vehicle(
          dealership_id, customer_id, vehicle_unit_id, ownership_started_at, linked_by_staff_user_id)
        values (?, ?, ?, now(), ?)
        """, actor.dealershipId(), context.customerId(), context.vehicleUnitId(), actor.staffUserId());
    int unitChanged = jdbc.update("""
        update vehicle_unit set stock_status = 'SOLD', updated_at = now()
        where dealership_id = ? and id = ? and stock_status = 'RESERVED'
        """, actor.dealershipId(), context.vehicleUnitId());
    if (unitChanged != 1) throw conflict("Vehicle stock changed while recording the sale.");
    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, 'RESERVED', 'SOLD', 'SOLD', 'VEHICLE_SALE_INVOICE', ?, ?, ?)
        """, actor.dealershipId(), context.vehicleUnitId(), invoice.get("public_id"), actor.staffUserId(),
        note == null ? "Bike delivered against fully paid sales invoice " + invoice.get("invoice_number") + "." : note);
    int bookingChanged = jdbc.update("""
        update sales_booking set status = 'CONVERTED_TO_SALE', updated_at = now()
        where dealership_id = ? and id = ? and status = 'ACTIVE'
        """, actor.dealershipId(), context.bookingId());
    if (bookingChanged != 1) throw conflict("Booking changed while recording vehicle delivery.");
    jdbc.update("""
        update sales_enquiry set status = 'CLOSED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'BOOKED'
        """, actor.dealershipId(), context.enquiryId());
    addActivity(actor, context.enquiryId(), "SALE_DELIVERED", "BOOKED", "CLOSED",
        "Bike delivered to " + receiver + "; invoice " + invoice.get("invoice_number") + " fully settled.",
        "VEHICLE_SALE_HANDOVER", bookingPublicId.toString());
    audit(actor, "VEHICLE_SALE_DELIVERED", "SALES_BOOKING", bookingPublicId.toString(),
        "Bike marked SOLD and customer ownership linked after full payment and acknowledged handover.");
    return getHandoverForBooking(actor, bookingPublicId);
  }

  public SaleHandoverView getHandoverForBooking(StaffPrincipal actor, UUID bookingPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select handover.public_id, booking.public_id as booking_public_id, booking.booking_code,
          invoice.public_id as invoice_public_id, invoice.invoice_number, invoice.invoice_total,
          handover.delivered_to_name, handover.customer_acknowledged, handover.acknowledgement_method,
          handover.acknowledgement_reference, handover.note, handover.delivered_at,
          staff.full_name as delivered_by_name, customer.full_name as customer_name,
          vehicle.chassis_number, vehicle.engine_number, vehicle.stock_status
        from vehicle_sale_handover handover
        join sales_booking booking on booking.dealership_id = handover.dealership_id and booking.id = handover.booking_id
        join vehicle_sale_invoice invoice on invoice.dealership_id = handover.dealership_id and invoice.id = handover.invoice_id
        join staff_user staff on staff.dealership_id = handover.dealership_id and staff.id = handover.delivered_by_staff_user_id
        join customer on customer.dealership_id = handover.dealership_id and customer.id = handover.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = handover.dealership_id and vehicle.id = handover.vehicle_unit_id
        where handover.dealership_id = ? and booking.public_id = ?
        """, actor.dealershipId(), bookingPublicId);
    if (rows.isEmpty()) throw notFound("Sales handover was not found.");
    Map<String, Object> row = rows.getFirst();
    return new SaleHandoverView(
        (UUID) row.get("public_id"), (UUID) row.get("booking_public_id"), String.valueOf(row.get("booking_code")),
        (UUID) row.get("invoice_public_id"), String.valueOf(row.get("invoice_number")),
        (String) row.get("delivered_to_name"), (Boolean) row.get("customer_acknowledged"),
        String.valueOf(row.get("acknowledgement_method")), (String) row.get("acknowledgement_reference"),
        (String) row.get("note"), ((Timestamp) row.get("delivered_at")).toInstant(),
        String.valueOf(row.get("delivered_by_name")), String.valueOf(row.get("customer_name")),
        String.valueOf(row.get("chassis_number")), String.valueOf(row.get("engine_number")),
        String.valueOf(row.get("stock_status")), (BigDecimal) row.get("invoice_total"));
  }

  public List<SalePaymentView> listPayments(StaffPrincipal actor, UUID invoicePublicId) {
    List<Long> invoiceIds = jdbc.query("""
        select id from vehicle_sale_invoice where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), invoicePublicId);
    if (invoiceIds.isEmpty()) throw notFound("Sales invoice was not found.");
    long invoiceId = invoiceIds.getFirst();
    return jdbc.query("""
        select payment.public_id, payment.receipt_number, payment.payment_method, payment.amount,
          payment.payment_reference, payment.note, payment.status, payment.recorded_at,
          recorder.full_name as recorded_by_name, payment.reversed_at,
          reverser.full_name as reversed_by_name, reversal.reason as reversal_reason,
          reversal.external_reference as reversal_reference
        from vehicle_sale_payment payment
        join staff_user recorder on recorder.dealership_id = payment.dealership_id and recorder.id = payment.recorded_by_staff_user_id
        left join staff_user reverser on reverser.dealership_id = payment.dealership_id and reverser.id = payment.reversed_by_staff_user_id
        left join vehicle_sale_payment_reversal reversal on reversal.dealership_id = payment.dealership_id and reversal.payment_id = payment.id
        where payment.dealership_id = ? and payment.invoice_id = ?
        order by payment.recorded_at desc, payment.id desc
        """, (rs, rowNum) -> new SalePaymentView(
            rs.getObject("public_id", UUID.class), rs.getString("receipt_number"), rs.getString("payment_method"),
            rs.getBigDecimal("amount"), rs.getString("payment_reference"), rs.getString("note"), rs.getString("status"),
            rs.getString("recorded_by_name"), rs.getTimestamp("recorded_at").toInstant(),
            (String) rs.getObject("reversal_reason"), (String) rs.getObject("reversal_reference"),
            (String) rs.getObject("reversed_by_name"), instantOrNull(rs.getTimestamp("reversed_at"))),
        actor.dealershipId(), invoiceId);
  }

  public SalePaymentView getPayment(StaffPrincipal actor, UUID paymentPublicId) {
    List<SalePaymentView> rows = jdbc.query("""
        select payment.public_id, payment.receipt_number, payment.payment_method, payment.amount,
          payment.payment_reference, payment.note, payment.status, payment.recorded_at,
          recorder.full_name as recorded_by_name, payment.reversed_at,
          reverser.full_name as reversed_by_name, reversal.reason as reversal_reason,
          reversal.external_reference as reversal_reference
        from vehicle_sale_payment payment
        join staff_user recorder on recorder.dealership_id = payment.dealership_id and recorder.id = payment.recorded_by_staff_user_id
        left join staff_user reverser on reverser.dealership_id = payment.dealership_id and reverser.id = payment.reversed_by_staff_user_id
        left join vehicle_sale_payment_reversal reversal on reversal.dealership_id = payment.dealership_id and reversal.payment_id = payment.id
        where payment.dealership_id = ? and payment.public_id = ?
        """, (rs, rowNum) -> new SalePaymentView(
            rs.getObject("public_id", UUID.class), rs.getString("receipt_number"), rs.getString("payment_method"),
            rs.getBigDecimal("amount"), rs.getString("payment_reference"), rs.getString("note"), rs.getString("status"),
            rs.getString("recorded_by_name"), rs.getTimestamp("recorded_at").toInstant(),
            (String) rs.getObject("reversal_reason"), (String) rs.getObject("reversal_reference"),
            (String) rs.getObject("reversed_by_name"), instantOrNull(rs.getTimestamp("reversed_at"))),
        actor.dealershipId(), paymentPublicId);
    if (rows.isEmpty()) throw notFound("Sales payment receipt was not found.");
    return rows.getFirst();
  }

  private SalePaymentView replayPayment(
      StaffPrincipal actor, Map<String, Object> prior, String fingerprint, UUID invoicePublicId) {
    if (!constantTimeEquals(String.valueOf(prior.get("request_fingerprint")), fingerprint)) {
      throw conflict("This sales-payment idempotency key was used for a different request.");
    }
    SalePaymentView payment = getPayment(actor, (UUID) prior.get("public_id"));
    if (!paymentBelongsToInvoice(actor, payment.publicId(), invoicePublicId)) {
      throw conflict("The prior receipt is not associated with this sales invoice.");
    }
    return payment;
  }

  private boolean paymentBelongsToInvoice(StaffPrincipal actor, UUID paymentPublicId, UUID invoicePublicId) {
    Integer count = jdbc.queryForObject("""
        select count(*) from vehicle_sale_payment payment
        join vehicle_sale_invoice invoice on invoice.dealership_id = payment.dealership_id and invoice.id = payment.invoice_id
        where payment.dealership_id = ? and payment.public_id = ? and invoice.public_id = ?
        """, Integer.class, actor.dealershipId(), paymentPublicId, invoicePublicId);
    return count != null && count == 1;
  }

  private SaleContext requireInvoiceSaleContext(StaffPrincipal actor, UUID invoicePublicId, boolean lockInvoice) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select booking.public_id as booking_public_id
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Sales invoice was not found.");
    return lockSaleContext(actor, (UUID) rows.getFirst().get("booking_public_id"));
  }

  private SaleContext lockSaleContext(StaffPrincipal actor, UUID bookingPublicId) {
    List<SaleContext> rows = jdbc.query("""
        select booking.id as booking_id, booking.public_id as booking_public_id, booking.booking_code,
          booking.status as booking_status, booking.customer_id, booking.vehicle_unit_id, booking.enquiry_id,
          customer.public_id as customer_public_id, customer.customer_code, customer.full_name as customer_name,
          customer.phone as customer_phone, vehicle.public_id as vehicle_public_id,
          vehicle.stock_status, vehicle.chassis_number, vehicle.engine_number,
          model.model_code, model.model_name, model.variant_name, model.colour_name,
          enquiry.status as enquiry_status
        from sales_booking booking
        join sales_enquiry enquiry on enquiry.dealership_id = booking.dealership_id and enquiry.id = booking.enquiry_id
        join customer on customer.dealership_id = booking.dealership_id and customer.id = booking.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = booking.dealership_id and vehicle.id = booking.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        where booking.dealership_id = ? and booking.public_id = ?
        for update of booking, enquiry, vehicle
        """, (rs, rowNum) -> new SaleContext(
            rs.getLong("booking_id"), rs.getObject("booking_public_id", UUID.class), rs.getString("booking_code"),
            rs.getString("booking_status"), rs.getLong("customer_id"), rs.getLong("vehicle_unit_id"),
            rs.getLong("enquiry_id"), rs.getObject("customer_public_id", UUID.class), rs.getString("customer_code"),
            rs.getString("customer_name"), rs.getString("customer_phone"), rs.getObject("vehicle_public_id", UUID.class),
            rs.getString("stock_status"), rs.getString("chassis_number"), rs.getString("engine_number"),
            rs.getString("model_code"), rs.getString("model_name"), rs.getString("variant_name"),
            rs.getString("colour_name"), rs.getString("enquiry_status")),
        actor.dealershipId(), bookingPublicId);
    if (rows.isEmpty()) throw notFound("Sales booking was not found in this dealership.");
    return rows.getFirst();
  }

  private void requireReservableBooking(StaffPrincipal actor, SaleContext context) {
    if (!"ACTIVE".equals(context.bookingStatus())) throw conflict("Only an active booking can be invoiced.");
    if (!"RESERVED".equals(context.stockStatus())) throw conflict("The bike is no longer reserved by this booking.");
    if (hasCurrentOwner(actor.dealershipId(), context.vehicleUnitId())) {
      throw conflict("The reserved bike already has a current customer owner; invoice creation is blocked.");
    }
  }

  private SaleContext lockSaleContextWithDealership(StaffPrincipal actor, UUID bookingPublicId) {
    return lockSaleContext(actor, bookingPublicId);
  }

  private boolean hasCurrentOwner(long dealershipId, long vehicleUnitId) {
    Integer count = jdbc.queryForObject("""
        select count(*) from customer_vehicle
        where dealership_id = ? and vehicle_unit_id = ? and ownership_ended_at is null
        """, Integer.class, dealershipId, vehicleUnitId);
    return count != null && count > 0;
  }

  private BigDecimal sumRecordedPayments(long dealershipId, long invoiceId) {
    BigDecimal paid = jdbc.queryForObject("""
        select coalesce(sum(amount), 0) from vehicle_sale_payment
        where dealership_id = ? and invoice_id = ? and status = 'RECORDED'
        """, BigDecimal.class, dealershipId, invoiceId);
    return paid == null ? BigDecimal.ZERO.setScale(2) : paid.setScale(2, RoundingMode.HALF_UP);
  }

  private void insertInvoiceLine(
      StaffPrincipal actor, long invoiceId, int number, String type, String description,
      BigDecimal quantity, BigDecimal unitPrice, BigDecimal discount, BigDecimal lineTotal) {
    jdbc.update("""
        insert into vehicle_sale_invoice_line(
          dealership_id, invoice_id, line_number, line_type, description,
          quantity, unit_price, discount_amount, line_total)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), invoiceId, number, type, description,
        quantity, unitPrice, discount, lineTotal);
  }

  private List<LineDraft> normalizeAddOns(List<SaleInvoiceLineRequest> requests) {
    if (requests == null || requests.isEmpty()) return List.of();
    if (requests.size() > 50) throw badRequest("A sales invoice can contain at most 50 accessory/other lines.");
    List<LineDraft> lines = new ArrayList<>();
    for (SaleInvoiceLineRequest request : requests) {
      if (request == null) throw badRequest("Sales invoice lines cannot be empty.");
      String type = normalizeChoice(request.lineType(), "Line type", Set.of("ACCESSORY", "OTHER"));
      String description = required(request.description(), "Line description", 300);
      BigDecimal quantity = normalizeQuantity(request.quantity(), "Line quantity");
      BigDecimal unitPrice = normalizeMoney(request.unitPrice(), "Line unit price", true);
      BigDecimal discount = normalizeMoney(request.discountAmount() == null ? BigDecimal.ZERO : request.discountAmount(),
          "Line discount", true);
      BigDecimal extended = quantity.multiply(unitPrice).setScale(2, RoundingMode.HALF_UP);
      if (discount.compareTo(extended) > 0) throw badRequest("A line discount cannot exceed its extended price.");
      BigDecimal lineTotal = extended.subtract(discount).setScale(2, RoundingMode.HALF_UP);
      lines.add(new LineDraft(type, description, quantity, unitPrice, discount, lineTotal));
    }
    return List.copyOf(lines);
  }

  private BigDecimal invoiceTotal(BigDecimal vehiclePrice, BigDecimal vehicleDiscount, List<LineDraft> addOns) {
    BigDecimal total = vehiclePrice.subtract(vehicleDiscount).setScale(2, RoundingMode.HALF_UP);
    for (LineDraft line : addOns) total = total.add(line.lineTotal()).setScale(2, RoundingMode.HALF_UP);
    if (total.signum() <= 0 || total.compareTo(MAX_MONEY) > 0) {
      throw badRequest("Sales invoice total must be positive and within the supported monetary range.");
    }
    return total;
  }

  private static String invoiceFingerprint(
      UUID bookingPublicId, BigDecimal vehiclePrice, BigDecimal vehicleDiscount,
      String message, List<LineDraft> addOns) {
    StringBuilder value = new StringBuilder().append(bookingPublicId).append('|')
        .append(vehiclePrice.toPlainString()).append('|').append(vehicleDiscount.toPlainString()).append('|')
        .append(message == null ? "" : message);
    for (LineDraft line : addOns) {
      value.append('|').append(line.lineType()).append(':').append(line.description()).append(':')
          .append(line.quantity().toPlainString()).append(':').append(line.unitPrice().toPlainString())
          .append(':').append(line.discountAmount().toPlainString());
    }
    return TokenDigests.sha256(value.toString());
  }

  private String getInvoiceNumber(StaffPrincipal actor, UUID publicId) {
    return jdbc.queryForObject("""
        select invoice_number from vehicle_sale_invoice where dealership_id = ? and public_id = ?
        """, String.class, actor.dealershipId(), publicId);
  }

  private void addActivityForInvoice(StaffPrincipal actor, UUID invoicePublicId, String activityType, String note) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select booking.enquiry_id, invoice.invoice_number
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Sales invoice was not found.");
    addActivity(actor, number(rows.getFirst().get("enquiry_id")), activityType, "BOOKED", "BOOKED",
        note, "VEHICLE_SALE_INVOICE", invoicePublicId.toString());
  }

  private void addActivity(
      StaffPrincipal actor, long enquiryId, String type, String from, String to, String note,
      String referenceType, String referenceId) {
    jdbc.update("""
        insert into sales_enquiry_activity(
          dealership_id, enquiry_id, activity_type, from_status, to_status, note,
          reference_type, reference_id, actor_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), enquiryId, type, from, to, note, referenceType, referenceId, actor.staffUserId());
  }

  private void audit(StaffPrincipal actor, String action, String entityType, String entityId, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, entityType, entityId, summary);
  }

  private static boolean constantTimeEquals(String left, String right) {
    if (left == null || right == null) return false;
    return java.security.MessageDigest.isEqual(left.getBytes(java.nio.charset.StandardCharsets.UTF_8),
        right.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  private static BigDecimal normalizeMoney(BigDecimal raw, String label, boolean zeroAllowed) {
    if (raw == null || raw.signum() < 0 || (!zeroAllowed && raw.signum() == 0)) {
      throw badRequest(label + (zeroAllowed ? " must be non-negative." : " must be positive."));
    }
    BigDecimal value = raw.setScale(2, RoundingMode.HALF_UP);
    if (value.compareTo(MAX_UNIT_MONEY) > 0) throw badRequest(label + " exceeds the supported monetary range.");
    return value;
  }

  private static BigDecimal normalizeQuantity(BigDecimal raw, String label) {
    if (raw == null || raw.signum() <= 0) throw badRequest(label + " must be greater than zero.");
    BigDecimal value = raw.setScale(3, RoundingMode.HALF_UP);
    if (value.signum() <= 0 || value.compareTo(MAX_QUANTITY) > 0) {
      throw badRequest(label + " exceeds the supported quantity range.");
    }
    return value;
  }

  private static String normalizeChoice(String raw, String label, Set<String> allowed) {
    String value = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
    if (!allowed.contains(value)) throw badRequest("Choose a supported " + label.toLowerCase(Locale.ROOT) + ".");
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

  private static long number(Object value) { return ((Number) value).longValue(); }
  private static Instant instantOrNull(Timestamp value) { return value == null ? null : value.toInstant(); }

  private static ResponseStatusException notFound(String message) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
  }
  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }
  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }

  public record SaleInvoiceRequest(
      String idempotencyKey, BigDecimal vehiclePrice, BigDecimal vehicleDiscount,
      String customerMessage, List<SaleInvoiceLineRequest> addOns) {}
  public record SaleInvoiceLineRequest(
      String lineType, String description, BigDecimal quantity, BigDecimal unitPrice, BigDecimal discountAmount) {}
  public record SalePaymentRequest(
      String idempotencyKey, String paymentMethod, BigDecimal amount, String paymentReference, String note) {}
  public record SalePaymentReversalRequest(String reason, String externalReference) {}
  public record HandoverRequest(
      String deliveredToName, Boolean customerAcknowledged, String acknowledgementMethod,
      String acknowledgementReference, String note) {}
  public record InvoiceLineView(
      int lineNumber, String lineType, String description, BigDecimal quantity,
      BigDecimal unitPrice, BigDecimal discountAmount, BigDecimal lineTotal) {}
  public record SaleInvoiceView(
      UUID publicId, String invoiceNumber, UUID bookingPublicId, String bookingCode, String bookingStatus,
      UUID customerPublicId, String customerCode, String customerName, String customerPhone,
      UUID vehiclePublicId, String modelCode, String modelName, String variantName, String colourName,
      String chassisNumber, String engineNumber, String status, BigDecimal invoiceTotal,
      BigDecimal paidAmount, BigDecimal balanceDue, String documentNotice, String customerMessage,
      String createdByName, String issuedByName, Instant createdAt, Instant issuedAt,
      Instant cancelledAt, String cancellationReason, List<InvoiceLineView> lines) {}
  public record SalePaymentView(
      UUID publicId, String receiptNumber, String paymentMethod, BigDecimal amount, String paymentReference,
      String note, String status, String recordedByName, Instant recordedAt, String reversalReason,
      String reversalReference, String reversedByName, Instant reversedAt) {}
  public record SaleHandoverView(
      UUID publicId, UUID bookingPublicId, String bookingCode, UUID invoicePublicId, String invoiceNumber,
      String deliveredToName, Boolean customerAcknowledged, String acknowledgementMethod,
      String acknowledgementReference, String note, Instant deliveredAt, String deliveredByName,
      String customerName, String chassisNumber, String engineNumber, String stockStatus, BigDecimal invoiceTotal) {}
  private record LineDraft(
      String lineType, String description, BigDecimal quantity, BigDecimal unitPrice,
      BigDecimal discountAmount, BigDecimal lineTotal) {}
  private record SaleContext(
      long bookingId, UUID bookingPublicId, String bookingCode, String bookingStatus,
      long customerId, long vehicleUnitId, long enquiryId, UUID customerPublicId, String customerCode,
      String customerName, String customerPhone, UUID vehiclePublicId, String stockStatus,
      String chassisNumber, String engineNumber, String modelCode, String modelName,
      String variantName, String colourName, String enquiryStatus) {
  }
}