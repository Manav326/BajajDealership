package com.quantaedge.bajaj.sales;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Customer-originated test-ride and purchase requests.
 * Requests do not reserve physical bikes or claim a test-ride slot: staff convert
 * an approved request into the existing, audited sales-enquiry workflow.
 */
@Service
public class CustomerSalesRequestService {
  private final JdbcTemplate jdbc;
  private final SalesOperationsService sales;

  private static final RowMapper<RequestView> REQUEST_ROW = (rs, rowNum) -> {
    Timestamp preferred = rs.getTimestamp("preferred_at");
    Timestamp created = rs.getTimestamp("created_at");
    Timestamp updated = rs.getTimestamp("updated_at");
    Timestamp testRideAt = rs.getTimestamp("test_ride_scheduled_start");
    Timestamp deliveredAt = rs.getTimestamp("delivered_at");
    BigDecimal invoiceTotal = rs.getBigDecimal("invoice_total");
    BigDecimal paidAmount = rs.getBigDecimal("paid_amount");
    if (paidAmount == null) paidAmount = BigDecimal.ZERO.setScale(2);
    BigDecimal creditedAmount = invoiceTotal == null ? null : rs.getBigDecimal("credited_amount");
    if (invoiceTotal != null && creditedAmount == null) creditedAmount = BigDecimal.ZERO.setScale(2);
    BigDecimal balanceDue = invoiceTotal == null ? null
        : invoiceTotal.subtract(paidAmount).subtract(creditedAmount == null ? BigDecimal.ZERO : creditedAmount)
            .max(BigDecimal.ZERO).setScale(2, java.math.RoundingMode.HALF_UP);
    return new RequestView(
        rs.getObject("public_id", UUID.class), rs.getString("request_code"),
        rs.getString("request_type"), rs.getString("model_code"), rs.getString("model_name"),
        preferred == null ? null : preferred.toInstant(), rs.getString("notes"),
        rs.getString("status"), created.toInstant(), updated.toInstant(),
        rs.getObject("converted_enquiry_public_id", UUID.class),
        rs.getObject("customer_public_id", UUID.class), rs.getString("customer_code"),
        rs.getString("customer_name"), rs.getString("customer_phone"), rs.getString("customer_email"),
        rs.getString("enquiry_code"), rs.getString("enquiry_status"),
        rs.getString("test_ride_code"), rs.getString("test_ride_status"),
        testRideAt == null ? null : testRideAt.toInstant(),
        rs.getString("booking_code"), rs.getString("booking_status"),
        rs.getString("invoice_number"), rs.getString("invoice_status"),
        invoiceTotal, paidAmount, creditedAmount, balanceDue, deliveredAt == null ? null : deliveredAt.toInstant());
  };

  private static final String SELECT_REQUEST = """
      select request.public_id, request.request_code, request.request_type, request.model_code,
        model.model_name, request.preferred_at, request.notes, request.status, request.created_at,
        request.updated_at, enquiry.public_id as converted_enquiry_public_id,
        customer.public_id as customer_public_id, customer.customer_code, customer.full_name as customer_name,
        customer.phone as customer_phone, customer.email as customer_email,
        enquiry.enquiry_code, enquiry.status as enquiry_status,
        ride.test_ride_code, ride.status as test_ride_status, ride.scheduled_start as test_ride_scheduled_start,
        booking.booking_code, booking.status as booking_status,
        invoice.invoice_number, invoice.status as invoice_status, invoice.invoice_total,
        coalesce(payment.paid_amount, 0)::numeric(16,2) as paid_amount,
        coalesce(payment.credited_amount, 0)::numeric(16,2) as credited_amount,
        handover.delivered_at
      from customer_sales_request request
      join customer on customer.dealership_id = request.dealership_id and customer.id = request.customer_id
      join bajaj_catalogue_model model on model.model_code = request.model_code and model.manufacturer = 'BAJAJ'
      left join sales_enquiry enquiry
        on enquiry.dealership_id = request.dealership_id and enquiry.id = request.converted_enquiry_id
      left join lateral (
        select ride.test_ride_code, ride.status, ride.scheduled_start
        from sales_test_ride ride
        where enquiry.id is not null and ride.dealership_id = request.dealership_id
          and ride.enquiry_id = enquiry.id
        order by ride.created_at desc, ride.id desc
        limit 1
      ) ride on true
      left join lateral (
        select booking.id, booking.booking_code, booking.status, booking.created_at
        from sales_booking booking
        where enquiry.id is not null and booking.dealership_id = request.dealership_id
          and booking.enquiry_id = enquiry.id
        order by booking.created_at desc, booking.id desc
        limit 1
      ) booking on true
      left join lateral (
        select invoice.id, invoice.invoice_number, invoice.status, invoice.invoice_total, invoice.created_at
        from vehicle_sale_invoice invoice
        where booking.id is not null and invoice.dealership_id = request.dealership_id
          and invoice.booking_id = booking.id
        order by invoice.created_at desc, invoice.id desc
        limit 1
      ) invoice on true
      left join lateral (
        select greatest(
            coalesce(sum(receipt.amount) filter (where receipt.status = 'RECORDED'), 0)
              - coalesce((select sum(refund.amount) from finance_invoice_adjustment refund
                  where invoice.id is not null and refund.dealership_id = request.dealership_id
                    and refund.source_type = 'SALES' and refund.sales_invoice_id = invoice.id
                    and refund.adjustment_type = 'REFUND' and refund.status = 'PAID'), 0),
            0)::numeric(16,2) as paid_amount,
          coalesce((select sum(credit.amount) from finance_invoice_adjustment credit
            where invoice.id is not null and credit.dealership_id = request.dealership_id
              and credit.source_type = 'SALES' and credit.sales_invoice_id = invoice.id
              and credit.adjustment_type = 'CREDIT_NOTE' and credit.status = 'APPROVED'), 0)::numeric(16,2)
            as credited_amount
        from vehicle_sale_payment receipt
        where invoice.id is not null and receipt.dealership_id = request.dealership_id
          and receipt.invoice_id = invoice.id
      ) payment on true
      left join lateral (
        select handover.delivered_at
        from vehicle_sale_handover handover
        where booking.id is not null and handover.dealership_id = request.dealership_id
          and handover.booking_id = booking.id
        order by handover.delivered_at desc, handover.id desc
        limit 1
      ) handover on true
      """;

  public CustomerSalesRequestService(JdbcTemplate jdbc, SalesOperationsService sales) {
    this.jdbc = jdbc;
    this.sales = sales;
  }

  public List<RequestView> listForCustomer(CustomerPrincipal actor) {
    return jdbc.query(SELECT_REQUEST + """
        where request.dealership_id = ? and request.customer_id = ?
          and request.customer_portal_account_id = ?
        order by request.created_at desc, request.id desc
        """, REQUEST_ROW, actor.dealershipId(), actor.customerId(), actor.accountId());
  }

  @Transactional
  public RequestView create(CustomerPrincipal actor, CreateRequest request) {
    if (request == null) throw badRequest("A motorcycle request is required.");
    String type = required(request.requestType(), "Request type", 20).toUpperCase(Locale.ROOT);
    if (!List.of("TEST_RIDE", "PURCHASE").contains(type)) {
      throw badRequest("Choose Test ride or Purchase enquiry.");
    }
    String modelCode = required(request.modelCode(), "Bajaj model code", 60).toUpperCase(Locale.ROOT);
    String notes = optional(request.notes(), 1000);
    Instant preferredAt = request.preferredAt();
    if (preferredAt != null) {
      if (!"TEST_RIDE".equals(type)) throw badRequest("A preferred time is only available for a test-ride request.");
      Instant now = Instant.now();
      if (!preferredAt.isAfter(now) || preferredAt.isAfter(now.plus(180, ChronoUnit.DAYS))) {
        throw badRequest("Choose a future preferred time within the next six months.");
      }
    }
    String key = required(request.idempotencyKey(), "Idempotency key", 120);
    String fingerprint = TokenDigests.sha256(type + "|" + modelCode + "|"
        + (preferredAt == null ? "" : preferredAt.toString()) + "|" + (notes == null ? "" : notes));

    RequestView replay = findReplay(actor, key, fingerprint);
    if (replay != null) return replay;

    Integer eligible = jdbc.queryForObject("""
        select count(*) from bajaj_catalogue_model catalogue
        join bajaj_catalogue_dealership_model settings
          on settings.model_code = catalogue.model_code and settings.dealership_id = ?
          and settings.is_published = true
        join vehicle_model inventory_model
          on inventory_model.dealership_id = settings.dealership_id
          and upper(inventory_model.model_code) = catalogue.model_code and inventory_model.active = true
        where catalogue.manufacturer = 'BAJAJ' and catalogue.active = true
          and catalogue.model_code = ?
        """, Integer.class, actor.dealershipId(), modelCode);
    if (eligible == null || eligible < 1) {
      throw notFound("That Bajaj model is not currently published for this dealership.");
    }

    String requestCode = "WEB-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID publicId;
    try {
      publicId = jdbc.queryForObject("""
          insert into customer_sales_request(
            dealership_id, request_code, customer_id, customer_portal_account_id,
            request_type, model_code, idempotency_key, request_fingerprint,
            preferred_at, notes, status)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED')
          returning public_id
          """, UUID.class, actor.dealershipId(), requestCode, actor.customerId(), actor.accountId(),
          type, modelCode, key, fingerprint,
          preferredAt == null ? null : Timestamp.from(preferredAt), notes);
    } catch (DuplicateKeyException duplicate) {
      RequestView raced = findReplay(actor, key, fingerprint);
      if (raced != null) return raced;
      throw conflict("This request key was used concurrently. Refresh your requests and retry.");
    }

    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'SALES_REQUEST_CREATED', 'CUSTOMER_SALES_REQUEST', ?,
          jsonb_build_object('requestType', ?, 'modelCode', ?, 'requestCode', ?))
        """, actor.dealershipId(), actor.accountId(), publicId, type, modelCode, requestCode);
    return findForCustomer(actor, publicId);
  }

  @Transactional
  public RequestView cancelForCustomer(CustomerPrincipal actor, UUID publicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, request_code, request_type, status, model_code
        from customer_sales_request
        where dealership_id = ? and customer_id = ? and customer_portal_account_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), actor.customerId(), actor.accountId(), publicId);
    if (rows.isEmpty()) throw notFound("That request was not found in your account.");
    Map<String, Object> row = rows.getFirst();
    // A committed cancellation may have lost its HTTP response; replay without writing a second activity.
    if ("CANCELLED".equals(String.valueOf(row.get("status")))) {
      return findForCustomer(actor, publicId);
    }
    if (!"REQUESTED".equals(String.valueOf(row.get("status")))) {
      throw conflict("Only a request that has not yet been converted by the dealership can be cancelled here.");
    }
    jdbc.update("""
        update customer_sales_request
        set status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'REQUESTED'
        """, actor.dealershipId(), ((Number) row.get("id")).longValue());
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'SALES_REQUEST_CANCELLED', 'CUSTOMER_SALES_REQUEST', ?,
          jsonb_build_object('requestCode', ?, 'requestType', ?, 'modelCode', ?))
        """, actor.dealershipId(), actor.accountId(), publicId,
        String.valueOf(row.get("request_code")), String.valueOf(row.get("request_type")),
        String.valueOf(row.get("model_code")));
    return findForCustomer(actor, publicId);
  }

  public List<RequestView> listForStaff(StaffPrincipal actor, int requestedLimit, String rawStatus) {
    int limit = Math.max(1, Math.min(requestedLimit, 100));
    String status = optional(rawStatus, 20);
    if (status != null) {
      status = status.toUpperCase(Locale.ROOT);
      if (!List.of("REQUESTED", "CONVERTED", "CANCELLED").contains(status)) {
        throw badRequest("Unknown customer request status.");
      }
    }
    if (status == null) {
      return jdbc.query(SELECT_REQUEST + """
          where request.dealership_id = ?
          order by case request.status when 'REQUESTED' then 0 when 'CONVERTED' then 1 else 2 end,
            request.created_at desc, request.id desc limit ?
          """, REQUEST_ROW, actor.dealershipId(), limit);
    }
    return jdbc.query(SELECT_REQUEST + """
        where request.dealership_id = ? and request.status = ?
        order by request.created_at desc, request.id desc limit ?
        """, REQUEST_ROW, actor.dealershipId(), status, limit);
  }

  @Transactional
  public RequestView convertToEnquiry(StaffPrincipal actor, UUID publicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select request.id, request.request_code, request.customer_id, request.request_type,
          request.model_code, request.preferred_at, request.notes, request.status,
          customer.public_id as customer_public_id
        from customer_sales_request request
        join customer on customer.dealership_id = request.dealership_id and customer.id = request.customer_id
        where request.dealership_id = ? and request.public_id = ?
        for update of request
        """, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Customer website request was not found.");
    Map<String, Object> row = rows.getFirst();
    String status = String.valueOf(row.get("status"));
    if ("CONVERTED".equals(status)) return findForStaff(actor, publicId);
    if (!"REQUESTED".equals(status)) {
      throw conflict("Only a pending customer request can be converted into a sales enquiry.");
    }

    String modelCode = String.valueOf(row.get("model_code"));
    List<UUID> modelIds = jdbc.query("""
        select public_id from vehicle_model
        where dealership_id = ? and upper(model_code) = ? and active = true
        order by (variant_name is null) desc, (colour_name is null) desc, id
        limit 1
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), modelCode);
    if (modelIds.isEmpty()) throw conflict("The selected Bajaj model has no active inventory model record.");

    Timestamp preferred = (Timestamp) row.get("preferred_at");
    String note = "Website " + String.valueOf(row.get("request_type")) + " request "
        + String.valueOf(row.get("request_code")) + "."
        + (row.get("notes") == null ? "" : " " + String.valueOf(row.get("notes")));
    SalesOperationsService.EnquiryView enquiry = sales.createEnquiry(actor,
        new SalesOperationsService.EnquiryRequest(
            (UUID) row.get("customer_public_id"), modelIds.getFirst(), null,
            "WEBSITE", "CALL", preferred == null ? null : preferred.toInstant(), note));
    Long enquiryId = jdbc.queryForObject("""
        select id from sales_enquiry where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), enquiry.publicId());
    jdbc.update("""
        update customer_sales_request
        set status = 'CONVERTED', converted_enquiry_id = ?, converted_by_staff_user_id = ?,
            converted_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'REQUESTED'
        """, enquiryId, actor.staffUserId(), actor.dealershipId(), ((Number) row.get("id")).longValue());
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'CUSTOMER_SALES_REQUEST_CONVERTED',
          'CUSTOMER_SALES_REQUEST', ?, jsonb_build_object('requestCode', ?, 'enquiryPublicId', ?))
        """, actor.dealershipId(), actor.staffUserId(), publicId.toString(),
        String.valueOf(row.get("request_code")), enquiry.publicId().toString());
    return findForStaff(actor, publicId);
  }

  private RequestView findReplay(CustomerPrincipal actor, String key, String fingerprint) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select public_id, request_fingerprint from customer_sales_request
        where dealership_id = ? and customer_portal_account_id = ? and idempotency_key = ?
        """, actor.dealershipId(), actor.accountId(), key);
    if (rows.isEmpty()) return null;
    if (!fingerprint.equals(String.valueOf(rows.getFirst().get("request_fingerprint")))) {
      throw conflict("This request key was already used for different request details.");
    }
    return findForCustomer(actor, (UUID) rows.getFirst().get("public_id"));
  }

  private RequestView findForCustomer(CustomerPrincipal actor, UUID publicId) {
    List<RequestView> rows = jdbc.query(SELECT_REQUEST + """
        where request.dealership_id = ? and request.customer_id = ?
          and request.customer_portal_account_id = ? and request.public_id = ?
        """, REQUEST_ROW, actor.dealershipId(), actor.customerId(), actor.accountId(), publicId);
    if (rows.isEmpty()) throw notFound("Customer request was not found in your account.");
    return rows.getFirst();
  }

  private RequestView findForStaff(StaffPrincipal actor, UUID publicId) {
    List<RequestView> rows = jdbc.query(SELECT_REQUEST + """
        where request.dealership_id = ? and request.public_id = ?
        """, REQUEST_ROW, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Customer website request was not found.");
    return rows.getFirst();
  }

  private static String required(String raw, String label, int max) {
    if (raw == null || raw.isBlank()) throw badRequest(label + " is required.");
    String clean = raw.trim();
    if (clean.length() > max || clean.chars().anyMatch(Character::isISOControl)) {
      throw badRequest(label + " is invalid.");
    }
    return clean;
  }

  private static String optional(String raw, int max) {
    if (raw == null || raw.isBlank()) return null;
    return required(raw, "Value", max);
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }

  private static ResponseStatusException notFound(String message) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
  }

  public record CreateRequest(String requestType, String modelCode, Instant preferredAt,
      String notes, String idempotencyKey) {}

  public record RequestView(UUID publicId, String requestCode, String requestType,
      String modelCode, String modelName, Instant preferredAt, String notes, String status,
      Instant createdAt, Instant updatedAt, UUID convertedEnquiryPublicId,
      UUID customerPublicId, String customerCode, String customerName,
      String customerPhone, String customerEmail, String enquiryCode, String enquiryStatus,
      String testRideCode, String testRideStatus, Instant testRideScheduledStart,
      String bookingCode, String bookingStatus, String invoiceNumber, String invoiceStatus,
      BigDecimal invoiceTotal, BigDecimal paidAmount, BigDecimal creditedAmount,
      BigDecimal balanceDue, Instant deliveredAt) {}
}
