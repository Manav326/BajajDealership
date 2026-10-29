package com.quantaedge.bajaj.commerce;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
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
 * Customer retail ordering backed by the same part balance used by workshop reservations.
 * Checkout records a pickup order and reserves stock; the staff fulfilment action records a
 * collection receipt and decrements on-hand/reserved stock atomically. No online payment is implied.
 */
@Service
public class RetailPartsService {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};
  private final JdbcTemplate jdbc;

  public RetailPartsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public List<AdminPartView> listRetailSettings(StaffPrincipal actor) {
    return jdbc.query("""
        select part.public_id, part.sku_code, part.part_name, part.description, part.unit_of_measure,
          part.active, part.retail_enabled, part.retail_price, part.retail_description,
          part.fitment_model_codes::text as fitment_model_codes, part.retail_image_url,
          balance.quantity_on_hand, balance.quantity_reserved,
          balance.quantity_on_hand - balance.quantity_reserved as quantity_available,
          balance.average_unit_cost
        from spare_part part
        join spare_part_balance balance
          on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        where part.dealership_id = ?
        order by part.active desc, lower(part.part_name), part.id
        """, (rs, rowNum) -> new AdminPartView(
            rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("description"), rs.getString("unit_of_measure"), rs.getBoolean("active"),
            rs.getBoolean("retail_enabled"), rs.getBigDecimal("retail_price"),
            rs.getString("retail_description"), readStringList(rs.getString("fitment_model_codes")),
            rs.getString("retail_image_url"), rs.getBigDecimal("quantity_on_hand"),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("quantity_available"),
            rs.getBigDecimal("average_unit_cost")), actor.dealershipId());
  }

  @Transactional
  public AdminPartView updateRetailSettings(
      StaffPrincipal actor, UUID partPublicId, RetailSettingsRequest request) {
    if (request == null) throw badRequest("Retail listing settings are required.");
    boolean enabled = Boolean.TRUE.equals(request.retailEnabled());
    BigDecimal price = request.retailPrice();
    if (enabled && (price == null || price.compareTo(BigDecimal.ZERO) <= 0)) {
      throw badRequest("A positive retail price is required before a part can be published to customers.");
    }
    if (price != null) {
      if (price.compareTo(BigDecimal.ZERO) <= 0 || price.scale() > 2) {
        throw badRequest("Retail price must be a positive amount with no more than two decimal places.");
      }
      price = price.setScale(2, RoundingMode.UNNECESSARY);
    }
    String description = optional(request.retailDescription(), 1000);
    String imageUrl = normalizeImageUrl(request.imageUrl());
    List<String> fitments = normalizeFitments(actor, request.fitmentModelCodes());
    String fitmentJson = toJson(fitments);

    List<Long> ids = jdbc.query("""
        select id from spare_part
        where dealership_id = ? and public_id = ?
        for update
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), partPublicId);
    if (ids.isEmpty()) throw notFound("Spare-part SKU was not found in this dealership.");

    jdbc.update("""
        update spare_part
        set retail_enabled = ?, retail_price = ?, retail_description = ?,
            fitment_model_codes = ?::jsonb, retail_image_url = ?,
            retail_updated_by_staff_user_id = ?, updated_at = now()
        where dealership_id = ? and id = ?
        """, enabled, price, description, fitmentJson, imageUrl, actor.staffUserId(),
        actor.dealershipId(), ids.getFirst());
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_LISTING_UPDATED', 'SPARE_PART', ?,
          jsonb_build_object('retailEnabled', ?, 'retailPrice', ?, 'fitmentCount', ?))
        """, actor.dealershipId(), actor.staffUserId(), partPublicId.toString(),
        enabled, price, fitments.size());
    return getRetailSetting(actor, partPublicId);
  }

  /** Reload one saved listing without scanning every spare-part SKU in the dealership. */
  private AdminPartView getRetailSetting(StaffPrincipal actor, UUID partPublicId) {
    List<AdminPartView> rows = jdbc.query("""
        select part.public_id, part.sku_code, part.part_name, part.description, part.unit_of_measure,
          part.active, part.retail_enabled, part.retail_price, part.retail_description,
          part.fitment_model_codes::text as fitment_model_codes, part.retail_image_url,
          balance.quantity_on_hand, balance.quantity_reserved,
          balance.quantity_on_hand - balance.quantity_reserved as quantity_available,
          balance.average_unit_cost
        from spare_part part
        join spare_part_balance balance
          on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        where part.dealership_id = ? and part.public_id = ?
        """, (rs, rowNum) -> new AdminPartView(
            rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("description"), rs.getString("unit_of_measure"), rs.getBoolean("active"),
            rs.getBoolean("retail_enabled"), rs.getBigDecimal("retail_price"),
            rs.getString("retail_description"), readStringList(rs.getString("fitment_model_codes")),
            rs.getString("retail_image_url"), rs.getBigDecimal("quantity_on_hand"),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("quantity_available"),
            rs.getBigDecimal("average_unit_cost")), actor.dealershipId(), partPublicId);
    if (rows.isEmpty()) throw notFound("Spare-part SKU was not found in this dealership.");
    return rows.getFirst();
  }

  public List<RetailPartView> listCustomerCatalogue(CustomerPrincipal actor) {
    return jdbc.query("""
        select part.public_id, part.sku_code, part.part_name,
          coalesce(part.retail_description, part.description) as display_description,
          part.unit_of_measure, part.retail_price, part.fitment_model_codes::text as fitment_model_codes,
          part.retail_image_url,
          balance.quantity_on_hand - balance.quantity_reserved as quantity_available
        from spare_part part
        join spare_part_balance balance
          on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        where part.dealership_id = ? and part.active = true and part.retail_enabled = true
          and part.retail_price is not null
        order by lower(part.part_name), part.id
        """, (rs, rowNum) -> {
      BigDecimal available = rs.getBigDecimal("quantity_available");
      return new RetailPartView(
          rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
          rs.getString("display_description"), rs.getString("unit_of_measure"),
          rs.getBigDecimal("retail_price"), readStringList(rs.getString("fitment_model_codes")),
          rs.getString("retail_image_url"), available, available != null && available.signum() > 0);
    }, actor.dealershipId());
  }

  @Transactional
  public RetailOrderView placeOrder(CustomerPrincipal actor, PlaceOrderRequest request) {
    if (request == null || request.lines() == null || request.lines().isEmpty() || request.lines().size() > 50) {
      throw badRequest("Choose between one and fifty parts for your order.");
    }
    String key = required(request.idempotencyKey(), "Order idempotency key", 120);
    String note = optional(request.customerNote(), 1000);
    String fitmentModelCode = request.fitmentModelCode() == null || request.fitmentModelCode().isBlank()
        ? null : required(request.fitmentModelCode(), "Bajaj model code", 60).toUpperCase(Locale.ROOT);
    List<OrderLineRequest> normalized = new ArrayList<>();
    Set<UUID> uniqueParts = new LinkedHashSet<>();
    for (OrderLineRequest line : request.lines()) {
      if (line == null || line.partPublicId() == null) throw badRequest("Every order line must choose a spare part.");
      BigDecimal quantity = normalizeQuantity(line.quantity());
      if (!uniqueParts.add(line.partPublicId())) throw badRequest("Each spare part may appear only once in the cart.");
      normalized.add(new OrderLineRequest(line.partPublicId(), quantity));
    }
    normalized.sort(Comparator.comparing(line -> line.partPublicId().toString()));
    String fingerprint = TokenDigests.sha256(
        normalized.stream().map(line -> line.partPublicId() + "=" + line.quantity().toPlainString()).reduce("", (a,b) -> a + "|" + b)
            + "|fitment=" + (fitmentModelCode == null ? "" : fitmentModelCode)
            + "|note=" + (note == null ? "" : note));
    RetailOrderView replay = findOrderReplay(actor, key, fingerprint);
    if (replay != null) return replay;

    List<StockPart> lockedParts = lockParts(actor.dealershipId(), normalized.stream().map(OrderLineRequest::partPublicId).toList());
    Map<UUID, StockPart> byPublicId = new HashMap<>();
    lockedParts.forEach(part -> byPublicId.put(part.publicId(), part));
    if (byPublicId.size() != normalized.size()) throw notFound("One or more selected parts are no longer available in this dealership.");

    BigDecimal total = BigDecimal.ZERO;
    Map<UUID, BigDecimal> lineTotals = new LinkedHashMap<>();
    for (OrderLineRequest line : normalized) {
      StockPart part = byPublicId.get(line.partPublicId());
      if (!part.active() || !part.retailEnabled() || part.retailPrice() == null) {
        throw conflict("Part " + part.skuCode() + " is no longer listed for retail purchase.");
      }
      BigDecimal available = part.quantityOnHand().subtract(part.quantityReserved());
      if (line.quantity().compareTo(available) > 0) {
        throw conflict("Only " + available.toPlainString() + " " + part.unitOfMeasure()
            + " of " + part.partName() + " are available.");
      }
      if (!part.fitmentModelCodes().isEmpty()
          && (fitmentModelCode == null || !part.fitmentModelCodes().contains(fitmentModelCode))) {
        throw badRequest("Choose a supported Bajaj motorcycle for " + part.partName()
            + " before placing this order.");
      }
      BigDecimal lineTotal = line.quantity().multiply(part.retailPrice()).setScale(2, RoundingMode.HALF_UP);
      lineTotals.put(line.partPublicId(), lineTotal);
      total = total.add(lineTotal);
    }
    total = total.setScale(2, RoundingMode.HALF_UP);
    if (total.signum() <= 0) throw badRequest("The order total must be positive.");

    String orderCode = "RPO-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID orderPublicId;
    try {
      orderPublicId = jdbc.queryForObject("""
          insert into retail_part_order(
            dealership_id, order_code, customer_id, customer_portal_account_id,
            idempotency_key, request_fingerprint, status, payment_method, payment_status,
            order_total, customer_note)
          values (?, ?, ?, ?, ?, ?, 'PLACED', 'PAY_AT_PICKUP', 'PAY_ON_PICKUP', ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), orderCode, actor.customerId(), actor.accountId(),
          key, fingerprint, total, note);
    } catch (DuplicateKeyException duplicate) {
      RetailOrderView raced = findOrderReplay(actor, key, fingerprint);
      if (raced != null) return raced;
      throw conflict("This checkout key was used concurrently. Refresh your orders and retry.");
    }
    Long orderId = jdbc.queryForObject("""
        select id from retail_part_order where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), orderPublicId);
    if (orderId == null) throw conflict("The order was saved but could not be loaded.");

    int lineNumber = 0;
    for (OrderLineRequest line : normalized) {
      StockPart part = byPublicId.get(line.partPublicId());
      BigDecimal quantity = line.quantity();
      BigDecimal lineTotal = lineTotals.get(line.partPublicId());
      jdbc.update("""
          insert into retail_part_order_line(
            dealership_id, order_id, part_id, line_number, sku_code, part_name, unit_of_measure,
            quantity, unit_price, line_total)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, actor.dealershipId(), orderId, part.id(), ++lineNumber, part.skuCode(),
          part.partName(), part.unitOfMeasure(), quantity, part.retailPrice(), lineTotal);

      int changed = jdbc.update("""
          update spare_part_balance
          set quantity_reserved = quantity_reserved + ?, updated_at = now()
          where dealership_id = ? and part_id = ?
            and quantity_on_hand - quantity_reserved >= ?
          """, quantity, actor.dealershipId(), part.id(), quantity);
      if (changed != 1) throw conflict("Stock changed while the order was being placed. Refresh and try again.");
      BigDecimal reservedAfter = part.quantityReserved().add(quantity).setScale(3, RoundingMode.HALF_UP);
      insertMovement(actor.dealershipId(), part, "RETAIL_ORDER_RESERVED", BigDecimal.ZERO,
          quantity, part.quantityOnHand(), reservedAfter, orderPublicId.toString(),
          "RET-RES:" + orderPublicId + ":" + part.publicId(),
          TokenDigests.sha256(fingerprint + "|reserve|" + part.publicId()),
          null, actor.customerId());
    }
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_customer_id,
          action, entity_type, entity_id, details)
        values (?, 'CUSTOMER', ?, 'RETAIL_PART_ORDER_PLACED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'lineCount', ?, 'orderTotal', ?, 'paymentStatus', 'PAY_ON_PICKUP'))
        """, actor.dealershipId(), actor.customerId(), orderPublicId.toString(),
        orderCode, normalized.size(), total);
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'RETAIL_PART_ORDER_PLACED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'lineCount', ?, 'orderTotal', ?))
        """, actor.dealershipId(), actor.accountId(), orderPublicId, orderCode, normalized.size(), total);
    return getOrderForCustomer(actor, orderPublicId);
  }

  public List<RetailOrderView> listOrdersForCustomer(CustomerPrincipal actor) {
    List<UUID> ids = jdbc.query("""
        select public_id from retail_part_order
        where dealership_id = ? and customer_id = ? and customer_portal_account_id = ?
        order by created_at desc, id desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class),
        actor.dealershipId(), actor.customerId(), actor.accountId());
    return ids.stream().map(id -> getOrderForCustomer(actor, id)).toList();
  }

  @Transactional
  public RetailOrderView cancelOrder(CustomerPrincipal actor, UUID orderPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, order_code, status from retail_part_order
        where dealership_id = ? and customer_id = ? and customer_portal_account_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), actor.customerId(), actor.accountId(), orderPublicId);
    if (rows.isEmpty()) throw notFound("That parts order was not found in your account.");
    Map<String, Object> row = rows.getFirst();
    if (!"PLACED".equals(String.valueOf(row.get("status")))) {
      throw conflict("Only an order that has not been fulfilled can be cancelled.");
    }
    Long orderId = ((Number) row.get("id")).longValue();
    List<OrderStockLine> lines = getOrderStockLines(actor.dealershipId(), orderId, true);
    for (OrderStockLine line : lines) {
      StockPart part = lockPartById(actor.dealershipId(), line.partId());
      if (part == null || part.quantityReserved().compareTo(line.quantity()) < 0) {
        throw conflict("The reserved stock no longer matches this order. Staff reconciliation is required.");
      }
      int changed = jdbc.update("""
          update spare_part_balance
          set quantity_reserved = quantity_reserved - ?, updated_at = now()
          where dealership_id = ? and part_id = ? and quantity_reserved >= ?
          """, line.quantity(), actor.dealershipId(), line.partId(), line.quantity());
      if (changed != 1) throw conflict("Stock changed while cancelling. Refresh and try again.");
      BigDecimal reservedAfter = part.quantityReserved().subtract(line.quantity()).setScale(3, RoundingMode.HALF_UP);
      insertMovement(actor.dealershipId(), part, "RETAIL_ORDER_RELEASED", BigDecimal.ZERO,
          line.quantity().negate(), part.quantityOnHand(), reservedAfter, orderPublicId.toString(),
          "RET-REL:" + orderPublicId + ":" + part.publicId(),
          TokenDigests.sha256(orderPublicId + "|release|" + part.publicId()), null, actor.customerId());
    }
    jdbc.update("""
        update retail_part_order set status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'PLACED'
        """, actor.dealershipId(), orderId);
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'RETAIL_PART_ORDER_CANCELLED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?))
        """, actor.dealershipId(), actor.accountId(), orderPublicId, String.valueOf(row.get("order_code")));
    return getOrderForCustomer(actor, orderPublicId);
  }

  public List<RetailOrderView> listOrdersForStaff(StaffPrincipal actor, int requestedLimit, String rawStatus) {
    int limit = Math.max(1, Math.min(requestedLimit, 100));
    String status = optional(rawStatus, 20);
    if (status != null) {
      status = status.toUpperCase(Locale.ROOT);
      if (!List.of("PLACED", "CANCELLED", "FULFILLED").contains(status)) throw badRequest("Unknown retail order status.");
    }
    List<UUID> ids = status == null
        ? jdbc.query("""
            select public_id from retail_part_order where dealership_id = ?
            order by case status when 'PLACED' then 0 when 'FULFILLED' then 1 else 2 end, created_at desc, id desc limit ?
            """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), limit)
        : jdbc.query("""
            select public_id from retail_part_order where dealership_id = ? and status = ?
            order by created_at desc, id desc limit ?
            """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), status, limit);
    return ids.stream().map(id -> getOrderForStaff(actor, id)).toList();
  }

  @Transactional
  public RetailOrderView fulfillOrder(StaffPrincipal actor, UUID orderPublicId, FulfillRequest request) {
    if (request == null) throw badRequest("Collection details are required to fulfil an order.");
    String method = required(request.collectionMethod(), "Collection method", 24).toUpperCase(Locale.ROOT);
    if (!List.of("CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER").contains(method)) {
      throw badRequest("Choose a supported collection method.");
    }
    String reference = optional(request.externalReference(), 160);
    String note = optional(request.note(), 1000);
    String key = required(request.idempotencyKey(), "Collection idempotency key", 120);

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, order_code, status, order_total from retail_part_order
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), orderPublicId);
    if (rows.isEmpty()) throw notFound("Retail parts order was not found.");
    Map<String, Object> row = rows.getFirst();
    BigDecimal total = (BigDecimal) row.get("order_total");
    String fingerprint = TokenDigests.sha256(orderPublicId + "|" + method + "|" + total.toPlainString()
        + "|" + (reference == null ? "" : reference) + "|" + (note == null ? "" : note));
    RetailOrderView replay = findStaffCollectionReplay(actor, key, fingerprint, orderPublicId);
    if (replay != null) return replay;
    if (!"PLACED".equals(String.valueOf(row.get("status")))) {
      throw conflict("Only a placed order can be fulfilled and collected.");
    }
    Long orderId = ((Number) row.get("id")).longValue();
    List<OrderStockLine> lines = getOrderStockLines(actor.dealershipId(), orderId, true);
    for (OrderStockLine line : lines) {
      StockPart part = lockPartById(actor.dealershipId(), line.partId());
      if (part == null || part.quantityOnHand().compareTo(line.quantity()) < 0
          || part.quantityReserved().compareTo(line.quantity()) < 0) {
        throw conflict("Stock balance no longer covers this order. Reconcile stock before fulfilment.");
      }
      int changed = jdbc.update("""
          update spare_part_balance
          set quantity_on_hand = quantity_on_hand - ?,
              quantity_reserved = quantity_reserved - ?, updated_at = now()
          where dealership_id = ? and part_id = ? and quantity_on_hand >= ? and quantity_reserved >= ?
          """, line.quantity(), line.quantity(), actor.dealershipId(), line.partId(), line.quantity(), line.quantity());
      if (changed != 1) throw conflict("Stock changed while fulfilling the order. Refresh and try again.");
      BigDecimal onHandAfter = part.quantityOnHand().subtract(line.quantity()).setScale(3, RoundingMode.HALF_UP);
      BigDecimal reservedAfter = part.quantityReserved().subtract(line.quantity()).setScale(3, RoundingMode.HALF_UP);
      insertMovement(actor.dealershipId(), part, "RETAIL_ORDER_FULFILLED", line.quantity().negate(),
          line.quantity().negate(), onHandAfter, reservedAfter, orderPublicId.toString(),
          "RET-FUL:" + orderPublicId + ":" + part.publicId(),
          TokenDigests.sha256(orderPublicId + "|fulfil|" + part.publicId()), actor.staffUserId(), null);
    }
    String receiptNumber = "RPC-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    try {
      jdbc.update("""
          insert into retail_part_order_collection(
            dealership_id, order_id, receipt_number, idempotency_key, request_fingerprint,
            collection_method, amount, external_reference, recorded_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, actor.dealershipId(), orderId, receiptNumber, key, fingerprint,
          method, total, reference, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      RetailOrderView raced = findStaffCollectionReplay(actor, key, fingerprint, orderPublicId);
      if (raced != null) return raced;
      throw conflict("This collection key was used concurrently. Refresh and retry.");
    }
    jdbc.update("""
        update retail_part_order set status = 'FULFILLED', payment_status = 'PAID_AT_PICKUP',
          fulfilled_by_staff_user_id = ?, fulfilled_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'PLACED'
        """, actor.staffUserId(), actor.dealershipId(), orderId);
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_ORDER_FULFILLED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'receiptNumber', ?, 'collectionMethod', ?, 'amount', ?,
            'manualCollectionAttestation', true))
        """, actor.dealershipId(), actor.staffUserId(), orderPublicId.toString(),
        String.valueOf(row.get("order_code")), receiptNumber, method, total);
    return getOrderForStaff(actor, orderPublicId);
  }

  private RetailOrderView findOrderReplay(CustomerPrincipal actor, String key, String fingerprint) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select public_id, request_fingerprint from retail_part_order
        where dealership_id = ? and customer_id = ? and customer_portal_account_id = ? and idempotency_key = ?
        """, actor.dealershipId(), actor.customerId(), actor.accountId(), key);
    if (rows.isEmpty()) return null;
    if (!fingerprint.equals(String.valueOf(rows.getFirst().get("request_fingerprint")))) {
      throw conflict("This checkout key was already used for a different cart.");
    }
    return getOrderForCustomer(actor, (UUID) rows.getFirst().get("public_id"));
  }

  private RetailOrderView findStaffCollectionReplay(
      StaffPrincipal actor, String key, String fingerprint, UUID orderPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select collection.request_fingerprint, order_record.public_id
        from retail_part_order_collection collection
        join retail_part_order order_record
          on order_record.dealership_id = collection.dealership_id and order_record.id = collection.order_id
        where collection.dealership_id = ? and collection.idempotency_key = ?
        """, actor.dealershipId(), key);
    if (rows.isEmpty()) return null;
    if (!orderPublicId.equals(rows.getFirst().get("public_id"))
        || !fingerprint.equals(String.valueOf(rows.getFirst().get("request_fingerprint")))) {
      throw conflict("This collection key was already used for different order details.");
    }
    return getOrderForStaff(actor, orderPublicId);
  }

  private RetailOrderView getOrderForCustomer(CustomerPrincipal actor, UUID publicId) {
    List<RetailOrderView> rows = jdbc.query(orderHeaderSql() + """
        where order_record.dealership_id = ? and order_record.customer_id = ?
          and order_record.customer_portal_account_id = ? and order_record.public_id = ?
        """, (rs, rowNum) -> orderView(rs, getOrderLines(rs.getLong("order_id"))),
        actor.dealershipId(), actor.customerId(), actor.accountId(), publicId);
    if (rows.isEmpty()) throw notFound("Parts order was not found in your account.");
    return rows.getFirst();
  }

  private RetailOrderView getOrderForStaff(StaffPrincipal actor, UUID publicId) {
    List<RetailOrderView> rows = jdbc.query(orderHeaderSql() + """
        where order_record.dealership_id = ? and order_record.public_id = ?
        """, (rs, rowNum) -> orderView(rs, getOrderLines(rs.getLong("order_id"))),
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Retail parts order was not found.");
    return rows.getFirst();
  }

  private String orderHeaderSql() {
    return """
        select order_record.id as order_id, order_record.public_id, order_record.order_code,
          order_record.status, order_record.payment_method, order_record.payment_status, order_record.order_total,
          order_record.customer_note, order_record.created_at, order_record.updated_at,
          order_record.cancelled_at, order_record.fulfilled_at, customer.full_name as customer_name,
          customer.customer_code, customer.phone as customer_phone
        from retail_part_order order_record
        join customer on customer.dealership_id = order_record.dealership_id and customer.id = order_record.customer_id
        """;
  }

  private RetailOrderView orderView(java.sql.ResultSet rs, List<RetailOrderLineView> lines) throws java.sql.SQLException {
    Timestamp cancelled = rs.getTimestamp("cancelled_at");
    Timestamp fulfilled = rs.getTimestamp("fulfilled_at");
    return new RetailOrderView(
        rs.getObject("public_id", UUID.class), rs.getString("order_code"), rs.getString("status"),
        rs.getString("payment_method"), rs.getString("payment_status"), rs.getBigDecimal("order_total"),
        rs.getString("customer_note"), rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant(), cancelled == null ? null : cancelled.toInstant(),
        fulfilled == null ? null : fulfilled.toInstant(), rs.getString("customer_name"),
        rs.getString("customer_code"), rs.getString("customer_phone"), lines);
  }

  private List<RetailOrderLineView> getOrderLines(long orderId) {
    return jdbc.query("""
        select part.public_id as part_public_id, line.sku_code, line.part_name, line.unit_of_measure,
          line.quantity, line.unit_price, line.line_total
        from retail_part_order_line line
        join spare_part part on part.dealership_id = line.dealership_id and part.id = line.part_id
        where line.order_id = ? order by line.line_number
        """, (rs, rowNum) -> new RetailOrderLineView(
            rs.getObject("part_public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("unit_of_measure"), rs.getBigDecimal("quantity"),
            rs.getBigDecimal("unit_price"), rs.getBigDecimal("line_total")), orderId);
  }

  private List<OrderStockLine> getOrderStockLines(long dealershipId, long orderId, boolean lockLines) {
    String sql = """
        select part_id, quantity from retail_part_order_line
        where dealership_id = ? and order_id = ? order by part_id
        """ + (lockLines ? " for update" : "");
    return jdbc.query(sql, (rs, rowNum) -> new OrderStockLine(rs.getLong("part_id"), rs.getBigDecimal("quantity")),
        dealershipId, orderId);
  }

  private List<StockPart> lockParts(long dealershipId, List<UUID> publicIds) {
    if (publicIds.isEmpty()) return List.of();
    String placeholders = String.join(",", publicIds.stream().map(ignored -> "?").toList());
    List<Object> args = new ArrayList<>();
    args.add(dealershipId);
    args.addAll(publicIds);
    String sql = """
        select part.id, part.public_id, part.sku_code, part.part_name, part.unit_of_measure,
          part.active, part.retail_enabled, part.retail_price,
          part.fitment_model_codes::text as fitment_model_codes, balance.quantity_on_hand,
          balance.quantity_reserved, balance.average_unit_cost
        from spare_part part
        join spare_part_balance balance
          on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        where part.dealership_id = ? and part.public_id in (
        """ + placeholders + """
        )
        order by part.id
        for update of part, balance
        """;
    return jdbc.query(sql, (rs, rowNum) -> new StockPart(
        rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getString("sku_code"),
        rs.getString("part_name"), rs.getString("unit_of_measure"), rs.getBoolean("active"),
        rs.getBoolean("retail_enabled"), rs.getBigDecimal("retail_price"),
        readStringList(rs.getString("fitment_model_codes")), rs.getBigDecimal("quantity_on_hand"),
        rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("average_unit_cost")), args.toArray());
  }

  private StockPart lockPartById(long dealershipId, long partId) {
    List<StockPart> rows = jdbc.query("""
        select part.id, part.public_id, part.sku_code, part.part_name, part.unit_of_measure,
          part.active, part.retail_enabled, part.retail_price,
          part.fitment_model_codes::text as fitment_model_codes, balance.quantity_on_hand,
          balance.quantity_reserved, balance.average_unit_cost
        from spare_part part join spare_part_balance balance
          on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        where part.dealership_id = ? and part.id = ?
        for update of part, balance
        """, (rs, rowNum) -> new StockPart(
            rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getString("sku_code"),
            rs.getString("part_name"), rs.getString("unit_of_measure"), rs.getBoolean("active"),
            rs.getBoolean("retail_enabled"), rs.getBigDecimal("retail_price"),
            readStringList(rs.getString("fitment_model_codes")), rs.getBigDecimal("quantity_on_hand"),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("average_unit_cost")),
        dealershipId, partId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private void insertMovement(long dealershipId, StockPart part, String type,
      BigDecimal quantityDelta, BigDecimal reservedDelta, BigDecimal onHandAfter,
      BigDecimal reservedAfter, String referenceId, String operationKey, String fingerprint,
      Long staffId, Long customerId) {
    jdbc.update("""
        insert into spare_part_stock_movement(
          dealership_id, part_id, movement_type, quantity_delta, reserved_delta,
          quantity_on_hand_after, quantity_reserved_after, unit_cost, reference_type,
          reference_id, operation_key, request_fingerprint, actor_staff_user_id, actor_customer_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, 'RETAIL_PART_ORDER', ?, ?, ?, ?, ?)
        """, dealershipId, part.id(), type, quantityDelta, reservedDelta, onHandAfter, reservedAfter,
        part.averageUnitCost(), referenceId, operationKey, fingerprint, staffId, customerId);
  }

  private List<String> normalizeFitments(StaffPrincipal actor, List<String> raw) {
    if (raw == null || raw.isEmpty()) return List.of();
    LinkedHashSet<String> unique = new LinkedHashSet<>();
    for (String value : raw) {
      String code = required(value, "Fitment model code", 60).toUpperCase(Locale.ROOT);
      Integer valid = jdbc.queryForObject("""
          select count(*) from bajaj_catalogue_model model
          join bajaj_catalogue_dealership_model settings
            on settings.model_code = model.model_code and settings.dealership_id = ?
            and settings.is_published = true
          where model.model_code = ? and model.manufacturer = 'BAJAJ' and model.active = true
          """, Integer.class, actor.dealershipId(), code);
      if (valid == null || valid != 1) throw badRequest("Fitment code " + code + " is not a published Bajaj model.");
      unique.add(code);
    }
    if (unique.size() > 40) throw badRequest("A retail SKU can list at most 40 compatible Bajaj models.");
    return List.copyOf(unique);
  }

  private static String normalizeImageUrl(String raw) {
    String url = optional(raw, 1000);
    if (url == null) return null;
    URI parsed;
    try {
      parsed = URI.create(url);
    } catch (IllegalArgumentException invalid) {
      throw badRequest("Retail product image URL is invalid.");
    }
    if (!"https".equalsIgnoreCase(parsed.getScheme()) || parsed.getHost() == null
        || url.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("Retail product images must use a valid HTTPS URL.");
    }
    return url;
  }

  private static BigDecimal normalizeQuantity(BigDecimal value) {
    if (value == null || value.compareTo(BigDecimal.ZERO) <= 0) throw badRequest("Order quantity must be positive.");
    try {
      BigDecimal normalized = value.setScale(3, RoundingMode.UNNECESSARY);
      if (normalized.precision() > 12) throw badRequest("Order quantity is outside the supported range.");
      return normalized;
    } catch (ArithmeticException invalid) {
      throw badRequest("Order quantity can have at most three decimal places.");
    }
  }

  private static List<String> readStringList(String raw) {
    if (raw == null || raw.isBlank()) return List.of();
    try {
      return JSON.readValue(raw, STRING_LIST);
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Stored retail model-fitment data is invalid.", failure);
    }
  }

  private static String toJson(List<String> value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (JsonProcessingException impossible) {
      throw new IllegalArgumentException("Retail catalogue data could not be serialized.", impossible);
    }
  }

  private static String required(String raw, String label, int max) {
    if (raw == null || raw.isBlank()) throw badRequest(label + " is required.");
    String value = raw.trim();
    if (value.length() > max || value.chars().anyMatch(Character::isISOControl)) {
      throw badRequest(label + " is invalid.");
    }
    return value;
  }

  private static String optional(String raw, int max) {
    return raw == null || raw.isBlank() ? null : required(raw, "Value", max);
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

  public record RetailSettingsRequest(
      Boolean retailEnabled, BigDecimal retailPrice, String retailDescription,
      List<String> fitmentModelCodes, String imageUrl) {}
  public record AdminPartView(
      UUID publicId, String skuCode, String partName, String description, String unitOfMeasure,
      boolean active, boolean retailEnabled, BigDecimal retailPrice, String retailDescription,
      List<String> fitmentModelCodes, String imageUrl, BigDecimal quantityOnHand,
      BigDecimal quantityReserved, BigDecimal quantityAvailable, BigDecimal averageUnitCost) {}
  public record RetailPartView(
      UUID publicId, String skuCode, String partName, String description, String unitOfMeasure,
      BigDecimal retailPrice, List<String> fitmentModelCodes, String imageUrl,
      BigDecimal quantityAvailable, boolean available) {}
  public record OrderLineRequest(UUID partPublicId, BigDecimal quantity) {}
  public record PlaceOrderRequest(List<OrderLineRequest> lines, String fitmentModelCode,
      String customerNote, String idempotencyKey) {}
  public record FulfillRequest(String collectionMethod, String externalReference,
      String idempotencyKey, String note) {}
  public record RetailOrderLineView(
      UUID partPublicId, String skuCode, String partName, String unitOfMeasure,
      BigDecimal quantity, BigDecimal unitPrice, BigDecimal lineTotal) {}
  public record RetailOrderView(
      UUID publicId, String orderCode, String status, String paymentMethod, String paymentStatus,
      BigDecimal orderTotal, String customerNote, Instant createdAt, Instant updatedAt,
      Instant cancelledAt, Instant fulfilledAt, String customerName, String customerCode,
      String customerPhone, List<RetailOrderLineView> lines) {}
  private record OrderStockLine(long partId, BigDecimal quantity) {}
  private record StockPart(
      long id, UUID publicId, String skuCode, String partName, String unitOfMeasure,
      boolean active, boolean retailEnabled, BigDecimal retailPrice, List<String> fitmentModelCodes,
      BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal averageUnitCost) {}
}
