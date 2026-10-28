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

/**
 * Manual operational vehicle-sale billing. It records staff-entered payments; it does not
 * calculate statutory GST or verify money movement with an external payment provider.
 */
@Service
public class SalesBillingService {
  private static final BigDecimal MAX_MONEY = new BigDecimal("999999999999.99");
  private static final BigDecimal MAX_QUANTITY = new BigDecimal("999999999.999");
  private static final Set<String> PAYMENT_METHODS =
      Set.of("CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER");
  private static final Set<String> HANDOVER_METHODS =
      Set.of("IN_PERSON", "SIGNED_FORM", "OTP_REFERENCE", "WRITTEN_MESSAGE");

  private final JdbcTemplate jdbc;

  public SalesBillingService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional
  public InvoiceView createInvoiceDraft(StaffPrincipal actor, UUID bookingPublicId, InvoiceDraftRequest request) {
    if (request == null) throw badRequest("Sales invoice details are required.");
    BigDecimal vehiclePrice = money(request.vehiclePrice(), "Vehicle selling price", false);
    BigDecimal discount = money(request.discountAmount() == null ? BigDecimal.ZERO : request.discountAmount(),
        "Discount", true);
    String customerMessage = optional(request.customerMessage(), 2000);
    List<LineDraft> extras = normalizeLines(request.lines());
    SaleBookingContext booking = lockBookingAndUnit(actor, bookingPublicId);
    requireActiveReservedBooking(booking);
    requireNoCurrentOwner(actor, booking.vehicleUnitId());

    List<UUID> existing = jdbc.query("""
        select public_id from vehicle_sale_invoice
        where dealership_id = ? and booking_id = ? and status in ('DRAFT', 'ISSUED')
        order by created_at desc, id desc
        limit 1
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), booking.bookingId());
    List<LineDraft> normalized = new ArrayList<>();
    normalized.add(new LineDraft("VEHICLE", vehicleDescription(booking), BigDecimal.ONE.setScale(3), vehiclePrice));
    normalized.addAll(extras);
    BigDecimal subtotal = subtotal(normalized);
    if (discount.compareTo(subtotal) > 0) throw badRequest("Discount cannot exceed the invoice subtotal.");
    BigDecimal total = subtotal.subtract(discount).setScale(2, RoundingMode.HALF_UP);
    if (total.signum() <= 0) throw badRequest("Invoice total must remain greater than zero.");
    ensureMoney(total, "Invoice total");
    String fingerprint = invoiceFingerprint(bookingPublicId, normalized, discount, customerMessage);

    if (!existing.isEmpty()) {
      InvoiceView prior = getInvoice(actor, existing.getFirst());
      if (!constantTimeEquals(prior.requestFingerprint(), fingerprint)) {
        if ("DRAFT".equals(prior.status())) {
          throw conflict("This booking already has a different draft invoice. Cancel that draft before creating a corrected one.");
        }
        throw conflict("An invoice has already been issued for this booking. An issued invoice cannot be silently replaced.");
      }
      return prior;
    }

    String invoiceNumber = "SINV-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID invoicePublicId;
    try {
      invoicePublicId = jdbc.queryForObject("""
          insert into vehicle_sale_invoice(
            dealership_id, invoice_number, booking_id, customer_id, vehicle_unit_id, status,
            subtotal, discount_amount, invoice_total, request_fingerprint, customer_message,
            created_by_staff_user_id)
          values (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), invoiceNumber, booking.bookingId(),
          booking.customerId(), booking.vehicleUnitId(), subtotal, discount, total,
          fingerprint, customerMessage, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      List<UUID> raced = jdbc.query("""
          select public_id from vehicle_sale_invoice
          where dealership_id = ? and booking_id = ? and status in ('DRAFT', 'ISSUED')
          order by created_at desc, id desc limit 1
          """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), booking.bookingId());
      if (!raced.isEmpty()) {
        InvoiceView prior = getInvoice(actor, raced.getFirst());
        if (constantTimeEquals(prior.requestFingerprint(), fingerprint)) return prior;
      }
      throw conflict("An invoice draft was created concurrently. Refresh the booking before retrying.");
    }

    long invoiceId = jdbc.queryForObject("""
        select id from vehicle_sale_invoice where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), invoicePublicId);
    int lineNumber = 0;
    for (LineDraft line : normalized) {
      lineNumber++;
      BigDecimal lineTotal = line.quantity().multiply(line.unitPrice()).setScale(2, RoundingMode.HALF_UP);
      ensureMoney(lineTotal, "Invoice line total");
      jdbc.update("""
          insert into vehicle_sale_invoice_line(
            dealership_id, invoice_id, line_number, line_type, description, quantity, unit_price, line_total)
          values (?, ?, ?, ?, ?, ?, ?, ?)
          """, actor.dealershipId(), invoiceId, lineNumber, line.lineType(), line.description(),
          line.quantity(), line.unitPrice(), lineTotal);
    }
    audit(actor, "SALES_INVOICE_DRAFT_CREATED", "VEHICLE_SALE_INVOICE", invoicePublicId.toString(),
        "Created operational invoice draft " + invoiceNumber + " for booking " + booking.bookingCode()
            + ". It is not a GST tax invoice.");
    return getInvoice(actor, invoicePublicId);
  }

  @Transactional
  public InvoiceView cancelInvoiceDraft(StaffPrincipal actor, UUID invoicePublicId, String rawReason) {
    String reason = required(rawReason, "Draft cancellation reason", 500);
    InvoiceLink link = requireInvoiceLink(actor, invoicePublicId);
    SaleBookingContext booking = lockBookingAndUnit(actor, link.bookingPublicId());
    lockInvoice(actor, invoicePublicId);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, status from vehicle_sale_invoice
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Vehicle-sale invoice was not found.");
    Map<String, Object> invoice = rows.getFirst();
    if (!"DRAFT".equals(String.valueOf(invoice.get("status")))) {
      throw conflict("Only an unissued sales invoice draft can be cancelled. Issued invoices require a separate credit-note workflow.");
    }
    Integer payments = jdbc.queryForObject("""
        select count(*) from vehicle_sale_payment_allocation allocation
        join vehicle_sale_payment payment
          on payment.dealership_id = allocation.dealership_id and payment.id = allocation.payment_id
        where allocation.dealership_id = ? and allocation.invoice_id = ?
        """, Integer.class, actor.dealershipId(), number(invoice.get("id")));
    if (payments != null && payments > 0) throw conflict("A draft with payment records cannot be cancelled.");
    int updated = jdbc.update("""
        update vehicle_sale_invoice
        set status = 'CANCELLED', cancelled_by_staff_user_id = ?, cancelled_at = now(),
            cancellation_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'DRAFT'
        """, actor.staffUserId(), reason, actor.dealershipId(), number(invoice.get("id")));
    if (updated != 1) throw conflict("Invoice draft changed while cancellation was being recorded.");
    audit(actor, "SALES_INVOICE_DRAFT_CANCELLED", "VEHICLE_SALE_INVOICE", invoicePublicId.toString(),
        "Cancelled unissued sales invoice draft. Reason: " + reason + ". Booking remains reserved.");
    return getInvoice(actor, invoicePublicId);
  }

  @Transactional
  public InvoiceView issueInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    InvoiceLink link = requireInvoiceLink(actor, invoicePublicId);
    SaleBookingContext booking = lockBookingAndUnit(actor, link.bookingPublicId());
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, status from vehicle_sale_invoice
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Vehicle-sale invoice was not found.");
    Map<String, Object> invoice = rows.getFirst();
    if ("ISSUED".equals(String.valueOf(invoice.get("status")))) return getInvoice(actor, invoicePublicId);
    if (!"DRAFT".equals(String.valueOf(invoice.get("status")))) {
      throw conflict("Only a draft sales invoice can be issued.");
    }
    requireActiveReservedBooking(booking);
    requireNoCurrentOwner(actor, booking.vehicleUnitId());
    int changed = jdbc.update("""
        update vehicle_sale_invoice
        set status = 'ISSUED', issued_by_staff_user_id = ?, issued_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'DRAFT'
        """, actor.staffUserId(), actor.dealershipId(), number(invoice.get("id")));
    if (changed != 1) throw conflict("Invoice status changed while issuing.");
    audit(actor, "SALES_INVOICE_ISSUED", "VEHICLE_SALE_INVOICE", invoicePublicId.toString(),
        "Issued operational vehicle-sale invoice. Tax treatment and statutory GST fields are not included.");
    return getInvoice(actor, invoicePublicId);
  }

  public List<InvoiceView> listInvoicesForBooking(StaffPrincipal actor, UUID bookingPublicId) {
    long bookingId = requireBookingId(actor, bookingPublicId);
    List<UUID> ids = jdbc.query("""
        select public_id from vehicle_sale_invoice
        where dealership_id = ? and booking_id = ?
        order by created_at desc, id desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), bookingId);
    return ids.stream().map(id -> getInvoice(actor, id)).toList();
  }

  public InvoiceView getInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select invoice.id, invoice.public_id, invoice.invoice_number, invoice.status,
          invoice.subtotal, invoice.discount_amount, invoice.invoice_total, invoice.request_fingerprint,
          invoice.customer_message, invoice.created_at, invoice.issued_at, invoice.cancelled_at,
          invoice.cancellation_reason, invoice.booking_id, booking.public_id as booking_public_id,
          booking.booking_code, booking.status as booking_status, customer.public_id as customer_public_id,
          customer.customer_code, customer.full_name as customer_name, customer.phone as customer_phone,
          customer.email as customer_email, vehicle.public_id as vehicle_public_id, vehicle.chassis_number,
          vehicle.engine_number, vehicle.stock_status, model.model_code, model.model_name,
          model.variant_name, model.colour_name, creator.full_name as created_by_name,
          issuer.full_name as issued_by_name, canceller.full_name as cancelled_by_name,
          coalesce((select sum(allocation.amount) from vehicle_sale_payment_allocation allocation
            join vehicle_sale_payment payment on payment.dealership_id = allocation.dealership_id
              and payment.id = allocation.payment_id and payment.status = 'RECORDED'
            where allocation.dealership_id = invoice.dealership_id and allocation.invoice_id = invoice.id), 0) as paid_amount
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        join customer on customer.dealership_id = invoice.dealership_id and customer.id = invoice.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = invoice.dealership_id and vehicle.id = invoice.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        join staff_user creator on creator.dealership_id = invoice.dealership_id
          and creator.id = invoice.created_by_staff_user_id
        left join staff_user issuer on issuer.dealership_id = invoice.dealership_id
          and issuer.id = invoice.issued_by_staff_user_id
        left join staff_user canceller on canceller.dealership_id = invoice.dealership_id
          and canceller.id = invoice.cancelled_by_staff_user_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        """, actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Vehicle-sale invoice was not found in this dealership.");
    Map<String, Object> row = rows.getFirst();
    long invoiceId = number(row.get("id"));
    BigDecimal total = (BigDecimal) row.get("invoice_total");
    BigDecimal paid = (BigDecimal) row.get("paid_amount");
    BigDecimal balance = total.subtract(paid).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    List<InvoiceLineView> lines = jdbc.query("""
        select line_number, line_type, description, quantity, unit_price, line_total
        from vehicle_sale_invoice_line where dealership_id = ? and invoice_id = ?
        order by line_number
        """, (rs, rowNum) -> new InvoiceLineView(rs.getInt("line_number"), rs.getString("line_type"),
        rs.getString("description"), rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_price"),
        rs.getBigDecimal("line_total")), actor.dealershipId(), invoiceId);
    List<PaymentView> payments = listPaymentsByInvoiceId(actor, invoiceId);
    return new InvoiceView(
        (UUID) row.get("public_id"), String.valueOf(row.get("invoice_number")),
        (UUID) row.get("booking_public_id"), String.valueOf(row.get("booking_code")),
        (UUID) row.get("customer_public_id"), String.valueOf(row.get("customer_code")),
        String.valueOf(row.get("customer_name")), (String) row.get("customer_phone"),
        (String) row.get("customer_email"), (UUID) row.get("vehicle_public_id"),
        String.valueOf(row.get("model_code")), String.valueOf(row.get("model_name")),
        (String) row.get("variant_name"), (String) row.get("colour_name"),
        String.valueOf(row.get("chassis_number")), String.valueOf(row.get("engine_number")),
        String.valueOf(row.get("booking_status")), String.valueOf(row.get("stock_status")),
        String.valueOf(row.get("status")), (BigDecimal) row.get("subtotal"),
        (BigDecimal) row.get("discount_amount"), total, paid, balance,
        "Operational vehicle-sale invoice — not a GST tax invoice.",
        (String) row.get("customer_message"), String.valueOf(row.get("created_by_name")),
        (String) row.get("issued_by_name"), instantOrNull((Timestamp) row.get("created_at")),
        instantOrNull((Timestamp) row.get("issued_at")), instantOrNull((Timestamp) row.get("cancelled_at")),
        (String) row.get("cancellation_reason"), String.valueOf(row.get("request_fingerprint")), lines, payments);
  }

  @Transactional
  public PaymentResult recordPayment(StaffPrincipal actor, UUID invoicePublicId, PaymentRequest request) {
    if (request == null) throw badRequest("Payment details are required.");
    String method = normalizeChoice(request.paymentMethod(), "payment method", PAYMENT_METHODS);
    BigDecimal amount = money(request.amount(), "Payment amount", false);
    String reference = optional(request.paymentReference(), 160);
    String note = optional(request.note(), 1000);
    if (Set.of("UPI", "BANK_TRANSFER", "CARD").contains(method) && reference == null) {
      throw badRequest("A transaction or bank reference is required for UPI, bank transfer and card entries.");
    }
    String key = required(request.idempotencyKey(), "Idempotency key", 120);
    String fingerprint = TokenDigests.sha256(invoicePublicId + "|" + method + "|" + amount.toPlainString()
        + "|" + (reference == null ? "" : reference) + "|" + (note == null ? "" : note));
    InvoiceLink link = requireInvoiceLink(actor, invoicePublicId);
    SaleBookingContext booking = lockBookingAndUnit(actor, link.bookingPublicId());
    List<Map<String, Object>> invoiceRows = jdbc.queryForList("""
        select id, status, booking_id from vehicle_sale_invoice
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), invoicePublicId);
    if (invoiceRows.isEmpty()) throw notFound("Vehicle-sale invoice was not found.");
    Map<String, Object> invoiceRow = invoiceRows.getFirst();
    long invoiceId = number(invoiceRow.get("id"));

    List<Map<String, Object>> existing = jdbc.queryForList("""
        select public_id, request_fingerprint from vehicle_sale_payment
        where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), key);
    if (!existing.isEmpty()) {
      Map<String, Object> prior = existing.getFirst();
      if (!constantTimeEquals(String.valueOf(prior.get("request_fingerprint")), fingerprint)) {
        throw conflict("This payment idempotency key was already used for a different request.");
      }
      UUID paymentPublicId = (UUID) prior.get("public_id");
      InvoiceView current = getInvoice(actor, invoicePublicId);
      PaymentView payment = current.payments().stream().filter(item -> item.publicId().equals(paymentPublicId))
          .findFirst().orElseThrow(() -> conflict("The recorded payment key is not allocated to this invoice."));
      return new PaymentResult(payment, current, true);
    }

    if (!"ISSUED".equals(String.valueOf(invoiceRow.get("status")))) {
      throw conflict("Payments can only be recorded against an issued sales invoice.");
    }
    requireActiveReservedBooking(booking);
    InvoiceView current = getInvoice(actor, invoicePublicId);
    if (amount.compareTo(current.balanceDue()) > 0) {
      throw conflict("Payment exceeds the outstanding sales invoice balance.");
    }
    String receiptNumber = "S-RCP-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    List<UUID> inserted = jdbc.query("""
        insert into vehicle_sale_payment(
          dealership_id, receipt_number, idempotency_key, request_fingerprint,
          payment_method, amount, payment_reference, note, recorded_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (dealership_id, idempotency_key) do nothing
        returning public_id
        """, (rs, rowNum) -> rs.getObject(1, UUID.class),
        actor.dealershipId(), receiptNumber, key, fingerprint, method, amount, reference, note, actor.staffUserId());
    if (inserted.isEmpty()) {
      List<Map<String, Object>> raced = jdbc.queryForList("""
          select public_id, request_fingerprint from vehicle_sale_payment
          where dealership_id = ? and idempotency_key = ?
          """, actor.dealershipId(), key);
      if (raced.isEmpty()) throw conflict("Payment could not be recorded. Refresh and retry with the same key.");
      Map<String, Object> prior = raced.getFirst();
      if (!constantTimeEquals(String.valueOf(prior.get("request_fingerprint")), fingerprint)) {
        throw conflict("This payment key was concurrently used for a different request.");
      }
      UUID paymentPublicId = (UUID) prior.get("public_id");
      InvoiceView refreshed = getInvoice(actor, invoicePublicId);
      PaymentView payment = refreshed.payments().stream().filter(item -> item.publicId().equals(paymentPublicId))
          .findFirst().orElseThrow(() -> conflict("Concurrent payment is not allocated to this invoice."));
      return new PaymentResult(payment, refreshed, true);
    }
    UUID paymentPublicId = inserted.getFirst();
    long paymentId = jdbc.queryForObject("""
        select id from vehicle_sale_payment where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), paymentPublicId);
    jdbc.update("""
        insert into vehicle_sale_payment_allocation(
          dealership_id, payment_id, invoice_id, amount, allocated_by_staff_user_id)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), paymentId, invoiceId, amount, actor.staffUserId());
    audit(actor, "SALES_PAYMENT_RECORDED", "VEHICLE_SALE_PAYMENT", paymentPublicId.toString(),
        "Recorded operational receipt " + receiptNumber + " for invoice " + current.invoiceNumber()
            + "; method=" + method + "; amount=" + amount + ". Provider settlement was not verified.");
    InvoiceView updated = getInvoice(actor, invoicePublicId);
    PaymentView payment = updated.payments().stream().filter(item -> item.publicId().equals(paymentPublicId))
        .findFirst().orElseThrow(() -> conflict("Payment was recorded but its receipt could not be loaded."));
    return new PaymentResult(payment, updated, false);
  }

  @Transactional
  public PaymentResult reversePayment(StaffPrincipal actor, UUID paymentPublicId, PaymentReversalRequest request) {
    if (request == null) throw badRequest("Payment reversal details are required.");
    String reason = required(request.reason(), "Reversal reason", 500);
    String externalReference = optional(request.externalReference(), 160);
    List<Map<String, Object>> refs = jdbc.queryForList("""
        select invoice.public_id as invoice_public_id, booking.public_id as booking_public_id
        from vehicle_sale_payment payment
        join vehicle_sale_payment_allocation allocation
          on allocation.dealership_id = payment.dealership_id and allocation.payment_id = payment.id
        join vehicle_sale_invoice invoice
          on invoice.dealership_id = allocation.dealership_id and invoice.id = allocation.invoice_id
        join sales_booking booking
          on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        where payment.dealership_id = ? and payment.public_id = ?
        """, actor.dealershipId(), paymentPublicId);
    if (refs.isEmpty()) throw notFound("Vehicle-sale receipt was not found.");
    Map<String, Object> ref = refs.getFirst();
    UUID invoicePublicId = (UUID) ref.get("invoice_public_id");
    SaleBookingContext booking = lockBookingAndUnit(actor, (UUID) ref.get("booking_public_id"));
    List<Map<String, Object>> invoiceRows = jdbc.queryForList("""
        select id from vehicle_sale_invoice where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), invoicePublicId);
    if (invoiceRows.isEmpty()) throw notFound("Vehicle-sale invoice was not found.");
    long invoiceId = number(invoiceRows.getFirst().get("id"));
    List<Map<String, Object>> paymentRows = jdbc.queryForList("""
        select id, status from vehicle_sale_payment
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), paymentPublicId);
    if (paymentRows.isEmpty()) throw notFound("Vehicle-sale receipt was not found.");
    Map<String, Object> paymentRow = paymentRows.getFirst();
    if ("CONVERTED_TO_SALE".equals(booking.bookingStatus())) {
      throw conflict("A payment cannot be reversed after vehicle delivery. Use an authorised refund/credit-note workflow.");
    }
    if ("REVERSED".equals(String.valueOf(paymentRow.get("status")))) {
      InvoiceView current = getInvoice(actor, invoicePublicId);
      PaymentView payment = current.payments().stream().filter(item -> item.publicId().equals(paymentPublicId))
          .findFirst().orElseThrow(() -> notFound("Vehicle-sale receipt was not found."));
      return new PaymentResult(payment, current, true);
    }
    int changed = jdbc.update("""
        update vehicle_sale_payment
        set status = 'REVERSED', reversed_by_staff_user_id = ?, reversed_at = now()
        where dealership_id = ? and id = ? and status = 'RECORDED'
        """, actor.staffUserId(), actor.dealershipId(), number(paymentRow.get("id")));
    if (changed != 1) throw conflict("Payment status changed while reversal was being recorded.");
    jdbc.update("""
        insert into vehicle_sale_payment_reversal(
          dealership_id, payment_id, reason, external_reference, reversed_by_staff_user_id)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), number(paymentRow.get("id")), reason, externalReference, actor.staffUserId());
    audit(actor, "SALES_PAYMENT_REVERSED", "VEHICLE_SALE_PAYMENT", paymentPublicId.toString(),
        "Reversed vehicle-sale payment. Reason: " + reason
            + (externalReference == null ? "" : "; reference=" + externalReference));
    InvoiceView updated = getInvoice(actor, invoicePublicId);
    PaymentView payment = updated.payments().stream().filter(item -> item.publicId().equals(paymentPublicId))
        .findFirst().orElseThrow(() -> notFound("Reversed vehicle-sale receipt was not found."));
    return new PaymentResult(payment, updated, false);
  }

  @Transactional
  public HandoverView deliverBooking(StaffPrincipal actor, UUID bookingPublicId, HandoverRequest request) {
    if (request == null) throw badRequest("Vehicle-delivery details are required.");
    String deliveredToName = required(request.deliveredToName(), "Person receiving the bike", 160);
    if (!Boolean.TRUE.equals(request.customerAcknowledged())) {
      throw badRequest("Customer acknowledgement must be recorded before delivery.");
    }
    String method = normalizeChoice(request.acknowledgementMethod(), "acknowledgement method", HANDOVER_METHODS);
    String reference = optional(request.acknowledgementReference(), 160);
    String note = optional(request.note(), 1000);
    if (Set.of("SIGNED_FORM", "OTP_REFERENCE").contains(method) && reference == null) {
      throw badRequest("A reference is required for a signed form or OTP acknowledgement.");
    }
    if (Set.of("IN_PERSON", "WRITTEN_MESSAGE").contains(method) && reference == null && note == null) {
      throw badRequest("Enter a handover note or reference for this acknowledgement method.");
    }

    SaleBookingContext booking = lockBookingAndUnit(actor, bookingPublicId);
    if ("CONVERTED_TO_SALE".equals(booking.bookingStatus())) {
      return getHandover(actor, bookingPublicId);
    }
    requireActiveReservedBooking(booking);
    List<UUID> invoiceIds = jdbc.query("""
        select public_id from vehicle_sale_invoice
        where dealership_id = ? and booking_id = ? and status = 'ISSUED'
        order by issued_at desc, id desc limit 1
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), booking.bookingId());
    if (invoiceIds.isEmpty()) throw conflict("Issue a sales invoice before delivering the reserved bike.");
    UUID invoicePublicId = invoiceIds.getFirst();
    List<Map<String, Object>> invoiceRows = jdbc.queryForList("""
        select id from vehicle_sale_invoice where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), invoicePublicId);
    if (invoiceRows.isEmpty()) throw notFound("Sales invoice was not found.");
    InvoiceView invoice = getInvoice(actor, invoicePublicId);
    if (invoice.balanceDue().signum() != 0) {
      throw conflict("The vehicle-sale invoice must be fully paid before delivery. Outstanding balance: "
          + invoice.balanceDue() + ".");
    }
    requireNoCurrentOwner(actor, booking.vehicleUnitId());

    try {
      jdbc.update("""
          insert into vehicle_sale_handover(
            dealership_id, booking_id, invoice_id, customer_id, vehicle_unit_id,
            delivered_to_name, customer_acknowledged, acknowledgement_method,
            acknowledgement_reference, note, delivered_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?)
          """, actor.dealershipId(), booking.bookingId(), number(invoiceRows.getFirst().get("id")),
          booking.customerId(), booking.vehicleUnitId(), deliveredToName, method,
          reference, note, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      if ("CONVERTED_TO_SALE".equals(readBookingStatus(actor, bookingPublicId))) {
        return getHandover(actor, bookingPublicId);
      }
      throw conflict("A delivery record already exists or was created concurrently. Refresh before retrying.");
    }

    int unitChanged = jdbc.update("""
        update vehicle_unit set stock_status = 'SOLD', updated_at = now()
        where dealership_id = ? and id = ? and stock_status = 'RESERVED'
        """, actor.dealershipId(), booking.vehicleUnitId());
    if (unitChanged != 1) throw conflict("The bike is no longer reserved. Delivery was not completed.");
    int bookingChanged = jdbc.update("""
        update sales_booking set status = 'CONVERTED_TO_SALE', updated_at = now()
        where dealership_id = ? and id = ? and status = 'ACTIVE'
        """, actor.dealershipId(), booking.bookingId());
    if (bookingChanged != 1) throw conflict("The booking changed during delivery.");

    try {
      jdbc.update("""
          insert into customer_vehicle(
            dealership_id, customer_id, vehicle_unit_id, linked_by_staff_user_id, ownership_started_at)
          values (?, ?, ?, ?, now())
          """, actor.dealershipId(), booking.customerId(), booking.vehicleUnitId(), actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      throw conflict("The bike already has a current owner record. Delivery was rolled back; resolve ownership before retrying.");
    }

    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, 'RESERVED', 'SOLD', 'SOLD', 'SALES_BOOKING', ?, ?, ?)
        """, actor.dealershipId(), booking.vehicleUnitId(), bookingPublicId.toString(), actor.staffUserId(),
        "Vehicle delivered under invoice " + invoice.invoiceNumber() + ". " + (note == null ? "" : note));

    int enquiryUpdated = jdbc.update("""
        update sales_enquiry set status = 'CLOSED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'BOOKED'
        """, actor.dealershipId(), booking.enquiryId());
    if (enquiryUpdated == 1) {
      jdbc.update("""
          insert into sales_enquiry_activity(
            dealership_id, enquiry_id, activity_type, from_status, to_status, note,
            reference_type, reference_id, actor_staff_user_id)
          values (?, ?, 'STATUS_CHANGED', 'BOOKED', 'CLOSED', ?, 'VEHICLE_SALE_HANDOVER', ?, ?)
          """, actor.dealershipId(), booking.enquiryId(),
          "Vehicle delivered to " + deliveredToName + " under invoice " + invoice.invoiceNumber() + ".",
          bookingPublicId.toString(), actor.staffUserId());
    }
    audit(actor, "SALES_VEHICLE_DELIVERED", "VEHICLE_SALE_HANDOVER", bookingPublicId.toString(),
        "Bike marked SOLD, active customer ownership created, and acknowledgement recorded after full settlement.");
    return getHandover(actor, bookingPublicId);
  }

  public HandoverView getHandover(StaffPrincipal actor, UUID bookingPublicId) {
    List<HandoverView> rows = jdbc.query("""
        select handover.public_id, booking.public_id as booking_public_id, booking.booking_code,
          invoice.public_id as invoice_public_id, invoice.invoice_number, customer.public_id as customer_public_id,
          customer.full_name as customer_name, vehicle.public_id as vehicle_public_id,
          vehicle.chassis_number, handover.delivered_to_name, handover.customer_acknowledged,
          handover.acknowledgement_method, handover.acknowledgement_reference, handover.note,
          staff.full_name as delivered_by_name, handover.delivered_at
        from vehicle_sale_handover handover
        join sales_booking booking on booking.dealership_id = handover.dealership_id and booking.id = handover.booking_id
        join vehicle_sale_invoice invoice on invoice.dealership_id = handover.dealership_id and invoice.id = handover.invoice_id
        join customer on customer.dealership_id = handover.dealership_id and customer.id = handover.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = handover.dealership_id and vehicle.id = handover.vehicle_unit_id
        join staff_user staff on staff.dealership_id = handover.dealership_id and staff.id = handover.delivered_by_staff_user_id
        where handover.dealership_id = ? and booking.public_id = ?
        """, (rs, rowNum) -> new HandoverView(
            rs.getObject("public_id", UUID.class), rs.getObject("booking_public_id", UUID.class),
            rs.getString("booking_code"), rs.getObject("invoice_public_id", UUID.class),
            rs.getString("invoice_number"), rs.getObject("customer_public_id", UUID.class),
            rs.getString("customer_name"), rs.getObject("vehicle_public_id", UUID.class),
            rs.getString("chassis_number"), rs.getString("delivered_to_name"),
            rs.getBoolean("customer_acknowledged"), rs.getString("acknowledgement_method"),
            rs.getString("acknowledgement_reference"), rs.getString("note"), rs.getString("delivered_by_name"),
            rs.getTimestamp("delivered_at").toInstant()), actor.dealershipId(), bookingPublicId);
    if (rows.isEmpty()) throw notFound("Vehicle-sale handover record was not found.");
    return rows.getFirst();
  }

  public List<PaymentView> listPayments(StaffPrincipal actor, UUID invoicePublicId) {
    InvoiceLink link = requireInvoiceLink(actor, invoicePublicId);
    return listPaymentsByInvoiceId(actor, link.invoiceId());
  }

  private List<PaymentView> listPaymentsByInvoiceId(StaffPrincipal actor, long invoiceId) {
    return jdbc.query("""
        select payment.public_id, payment.receipt_number, payment.payment_method, payment.amount,
          payment.payment_reference, payment.note, payment.status, payment.recorded_at,
          recorder.full_name as recorded_by_name, reverser.full_name as reversed_by_name,
          payment.reversed_at, reversal.reason as reversal_reason,
          reversal.external_reference as reversal_reference
        from vehicle_sale_payment_allocation allocation
        join vehicle_sale_payment payment on payment.dealership_id = allocation.dealership_id
          and payment.id = allocation.payment_id
        join staff_user recorder on recorder.dealership_id = payment.dealership_id
          and recorder.id = payment.recorded_by_staff_user_id
        left join staff_user reverser on reverser.dealership_id = payment.dealership_id
          and reverser.id = payment.reversed_by_staff_user_id
        left join vehicle_sale_payment_reversal reversal on reversal.dealership_id = payment.dealership_id
          and reversal.payment_id = payment.id
        where allocation.dealership_id = ? and allocation.invoice_id = ?
        order by payment.recorded_at desc, payment.id desc
        """, (rs, rowNum) -> new PaymentView(
            rs.getObject("public_id", UUID.class), rs.getString("receipt_number"),
            rs.getString("payment_method"), rs.getBigDecimal("amount"), rs.getString("payment_reference"),
            rs.getString("note"), rs.getString("status"), rs.getString("recorded_by_name"),
            rs.getTimestamp("recorded_at").toInstant(), rs.getString("reversed_by_name"),
            instantOrNull(rs.getTimestamp("reversed_at")), rs.getString("reversal_reason"),
            rs.getString("reversal_reference")), actor.dealershipId(), invoiceId);
  }

  private InvoiceLink requireInvoiceLink(StaffPrincipal actor, UUID invoicePublicId) {
    List<InvoiceLink> rows = jdbc.query("""
        select invoice.id, booking.public_id as booking_public_id
        from vehicle_sale_invoice invoice
        join sales_booking booking on booking.dealership_id = invoice.dealership_id and booking.id = invoice.booking_id
        where invoice.dealership_id = ? and invoice.public_id = ?
        """, (rs, rowNum) -> new InvoiceLink(rs.getLong("id"), rs.getObject("booking_public_id", UUID.class)),
        actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Vehicle-sale invoice was not found in this dealership.");
    return rows.getFirst();
  }

  private SaleBookingContext lockBookingAndUnit(StaffPrincipal actor, UUID bookingPublicId) {
    List<SaleBookingContext> rows = jdbc.query("""
        select booking.id as booking_id, booking.public_id as booking_public_id, booking.booking_code,
          booking.enquiry_id, booking.customer_id, booking.vehicle_unit_id, booking.status as booking_status,
          customer.public_id as customer_public_id, customer.customer_code, customer.full_name as customer_name,
          customer.phone as customer_phone, customer.email as customer_email,
          vehicle.public_id as vehicle_public_id, vehicle.chassis_number, vehicle.engine_number,
          vehicle.stock_status, model.model_code, model.model_name, model.variant_name, model.colour_name
        from sales_booking booking
        join customer on customer.dealership_id = booking.dealership_id and customer.id = booking.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = booking.dealership_id and vehicle.id = booking.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        where booking.dealership_id = ? and booking.public_id = ?
        for update of booking
        """, (rs, rowNum) -> new SaleBookingContext(
            rs.getLong("booking_id"), rs.getObject("booking_public_id", UUID.class), rs.getString("booking_code"),
            rs.getLong("enquiry_id"), rs.getLong("customer_id"), rs.getLong("vehicle_unit_id"),
            rs.getString("booking_status"), rs.getObject("customer_public_id", UUID.class),
            rs.getString("customer_code"), rs.getString("customer_name"), rs.getString("customer_phone"),
            rs.getString("customer_email"), rs.getObject("vehicle_public_id", UUID.class),
            rs.getString("chassis_number"), rs.getString("engine_number"), rs.getString("stock_status"),
            rs.getString("model_code"), rs.getString("model_name"), rs.getString("variant_name"),
            rs.getString("colour_name")), actor.dealershipId(), bookingPublicId);
    if (rows.isEmpty()) throw notFound("Sales booking was not found in this dealership.");
    SaleBookingContext booking = rows.getFirst();
    List<String> currentStatus = jdbc.query("""
        select stock_status from vehicle_unit
        where dealership_id = ? and id = ? for update
        """, (rs, rowNum) -> rs.getString(1), actor.dealershipId(), booking.vehicleUnitId());
    if (currentStatus.isEmpty()) throw notFound("Reserved bike was not found.");
    return booking.withVehicleStockStatus(currentStatus.getFirst());
  }

  private String readBookingStatus(StaffPrincipal actor, UUID bookingPublicId) {
    List<String> rows = jdbc.query("""
        select status from sales_booking where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getString(1), actor.dealershipId(), bookingPublicId);
    return rows.isEmpty() ? "" : rows.getFirst();
  }

  private long requireBookingId(StaffPrincipal actor, UUID bookingPublicId) {
    List<Long> rows = jdbc.query("""
        select id from sales_booking where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), bookingPublicId);
    if (rows.isEmpty()) throw notFound("Sales booking was not found in this dealership.");
    return rows.getFirst();
  }

  private void lockInvoice(StaffPrincipal actor, UUID invoicePublicId) {
    List<UUID> rows = jdbc.query("""
        select public_id from vehicle_sale_invoice
        where dealership_id = ? and public_id = ? for update
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), invoicePublicId);
    if (rows.isEmpty()) throw notFound("Vehicle-sale invoice was not found.");
  }

  private void requireActiveReservedBooking(SaleBookingContext booking) {
    if (!"ACTIVE".equals(booking.bookingStatus())) throw conflict("Only an active sales booking can be invoiced or delivered.");
    if (!"RESERVED".equals(booking.vehicleStockStatus())) {
      throw conflict("The bike is no longer reserved by this booking. Refresh before continuing.");
    }
  }

  private void requireNoCurrentOwner(StaffPrincipal actor, long vehicleUnitId) {
    Integer owners = jdbc.queryForObject("""
        select count(*) from customer_vehicle
        where dealership_id = ? and vehicle_unit_id = ? and ownership_ended_at is null
        """, Integer.class, actor.dealershipId(), vehicleUnitId);
    if (owners != null && owners > 0) {
      throw conflict("The bike already has a current owner record. Resolve ownership before continuing.");
    }
  }

  private void audit(StaffPrincipal actor, String action, String type, String id, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, type, id, summary);
  }

  private static List<LineDraft> normalizeLines(List<InvoiceLineInput> raw) {
    if (raw == null) return List.of();
    if (raw.size() > 50) throw badRequest("An invoice may include at most 50 accessory/other lines.");
    List<LineDraft> lines = new ArrayList<>();
    for (InvoiceLineInput line : raw) {
      if (line == null) throw badRequest("Invoice line cannot be empty.");
      String type = normalizeChoice(line.lineType(), "invoice line type", Set.of("ACCESSORY", "OTHER"));
      String description = required(line.description(), "Invoice line description", 300);
      BigDecimal quantity = quantity(line.quantity(), "Invoice line quantity");
      BigDecimal price = money(line.unitPrice(), "Invoice line unit price", true);
      BigDecimal total = quantity.multiply(price).setScale(2, RoundingMode.HALF_UP);
      ensureMoney(total, "Invoice line total");
      lines.add(new LineDraft(type, description, quantity, price));
    }
    return List.copyOf(lines);
  }

  private static BigDecimal subtotal(List<LineDraft> lines) {
    BigDecimal total = BigDecimal.ZERO.setScale(2);
    for (LineDraft line : lines) {
      total = total.add(line.quantity().multiply(line.unitPrice()).setScale(2, RoundingMode.HALF_UP))
          .setScale(2, RoundingMode.HALF_UP);
      ensureMoney(total, "Invoice subtotal");
    }
    return total;
  }

  private static String vehicleDescription(SaleBookingContext booking) {
    StringBuilder text = new StringBuilder(booking.modelCode()).append(" · ").append(booking.modelName());
    if (booking.variantName() != null && !booking.variantName().isBlank()) text.append(" · ").append(booking.variantName());
    if (booking.colourName() != null && !booking.colourName().isBlank()) text.append(" · ").append(booking.colourName());
    text.append(" (Chassis ").append(booking.chassisNumber()).append(')');
    String result = text.toString();
    return result.length() <= 300 ? result : result.substring(0, 300);
  }

  private static String invoiceFingerprint(
      UUID bookingPublicId, List<LineDraft> lines, BigDecimal discount, String customerMessage) {
    StringBuilder value = new StringBuilder("SALE-INVOICE|").append(bookingPublicId)
        .append('|').append(discount.toPlainString()).append('|').append(customerMessage == null ? "" : customerMessage);
    for (LineDraft line : lines) {
      value.append('|').append(line.lineType()).append(':').append(line.description())
          .append(':').append(line.quantity().toPlainString()).append(':').append(line.unitPrice().toPlainString());
    }
    return TokenDigests.sha256(value.toString());
  }

  private static BigDecimal money(BigDecimal value, String label, boolean zeroAllowed) {
    if (value == null || value.signum() < 0 || (!zeroAllowed && value.signum() == 0)) {
      throw badRequest(label + (zeroAllowed ? " must be non-negative." : " must be positive."));
    }
    BigDecimal normalized = value.setScale(2, RoundingMode.HALF_UP);
    if (normalized.compareTo(MAX_MONEY) > 0) throw badRequest(label + " exceeds the supported range.");
    return normalized;
  }

  private static BigDecimal quantity(BigDecimal value, String label) {
    if (value == null || value.signum() <= 0) throw badRequest(label + " must be positive.");
    BigDecimal normalized = value.setScale(3, RoundingMode.HALF_UP);
    if (normalized.signum() <= 0 || normalized.compareTo(MAX_QUANTITY) > 0) {
      throw badRequest(label + " exceeds the supported quantity range.");
    }
    return normalized;
  }

  private static void ensureMoney(BigDecimal value, String label) {
    if (value.signum() < 0 || value.compareTo(MAX_MONEY) > 0) throw badRequest(label + " exceeds the supported range.");
  }

  private static String required(String raw, String label, int maxLength) {
    String value = optional(raw, maxLength);
    if (value == null) throw badRequest(label + " is required.");
    return value;
  }

  private static String optional(String raw, int maxLength) {
    if (raw == null) return null;
    String value = raw.trim();
    if (value.isEmpty()) return null;
    if (value.length() > maxLength || value.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return value;
  }

  private static String normalizeChoice(String raw, String label, Set<String> allowed) {
    String value = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
    if (!allowed.contains(value)) throw badRequest("Choose a supported " + label + ".");
    return value;
  }

  private static boolean constantTimeEquals(String left, String right) {
    if (left == null || right == null) return false;
    return java.security.MessageDigest.isEqual(left.getBytes(java.nio.charset.StandardCharsets.UTF_8),
        right.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static Instant instantOrNull(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toInstant();
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

  public record InvoiceDraftRequest(
      BigDecimal vehiclePrice, BigDecimal discountAmount, String customerMessage, List<InvoiceLineInput> lines) {}
  public record InvoiceLineInput(String lineType, String description, BigDecimal quantity, BigDecimal unitPrice) {}
  public record PaymentRequest(
      String idempotencyKey, String paymentMethod, BigDecimal amount, String paymentReference, String note) {}
  public record PaymentReversalRequest(String reason, String externalReference) {}
  public record HandoverRequest(
      String deliveredToName, Boolean customerAcknowledged, String acknowledgementMethod,
      String acknowledgementReference, String note) {}
  public record InvoiceLineView(
      int lineNumber, String lineType, String description, BigDecimal quantity, BigDecimal unitPrice, BigDecimal lineTotal) {}
  public record PaymentView(
      UUID publicId, String receiptNumber, String paymentMethod, BigDecimal amount,
      String paymentReference, String note, String status, String recordedByName, Instant recordedAt,
      String reversedByName, Instant reversedAt, String reversalReason, String reversalReference) {}
  public record InvoiceView(
      UUID publicId, String invoiceNumber, UUID bookingPublicId, String bookingCode,
      UUID customerPublicId, String customerCode, String customerName, String customerPhone, String customerEmail,
      UUID vehiclePublicId, String modelCode, String modelName, String variantName, String colourName,
      String chassisNumber, String engineNumber, String bookingStatus, String stockStatus, String status,
      BigDecimal subtotal, BigDecimal discountAmount, BigDecimal invoiceTotal, BigDecimal paidAmount,
      BigDecimal balanceDue, String documentNotice, String customerMessage, String createdByName,
      String issuedByName, Instant createdAt, Instant issuedAt, Instant cancelledAt, String cancellationReason,
      String requestFingerprint, List<InvoiceLineView> lines, List<PaymentView> payments) {}
  public record PaymentResult(PaymentView payment, InvoiceView invoice, boolean idempotentReplay) {}
  public record HandoverView(
      UUID publicId, UUID bookingPublicId, String bookingCode, UUID invoicePublicId, String invoiceNumber,
      UUID customerPublicId, String customerName, UUID vehiclePublicId, String chassisNumber,
      String deliveredToName, boolean customerAcknowledged, String acknowledgementMethod,
      String acknowledgementReference, String note, String deliveredByName, Instant deliveredAt) {}
  private record LineDraft(String lineType, String description, BigDecimal quantity, BigDecimal unitPrice) {}
  private record InvoiceLink(long invoiceId, UUID bookingPublicId) {}
  private record SaleBookingContext(
      long bookingId, UUID bookingPublicId, String bookingCode, long enquiryId, long customerId, long vehicleUnitId,
      String bookingStatus, UUID customerPublicId, String customerCode, String customerName,
      String customerPhone, String customerEmail, UUID vehiclePublicId, String chassisNumber, String engineNumber,
      String vehicleStockStatus, String modelCode, String modelName, String variantName, String colourName) {
    SaleBookingContext withVehicleStockStatus(String newStatus) {
      return new SaleBookingContext(bookingId, bookingPublicId, bookingCode, enquiryId, customerId, vehicleUnitId,
          bookingStatus, customerPublicId, customerCode, customerName, customerPhone, customerEmail,
          vehiclePublicId, chassisNumber, engineNumber, newStatus, modelCode, modelName, variantName, colourName);
    }
  }
}
