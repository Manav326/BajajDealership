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
    return jdbc.query(adminPartsSql() + """
        where (catalogue.is_global_catalogue = true or listing.dealership_id = ?)
        order by catalogue.category, lower(catalogue.part_name), catalogue.catalogue_code
        """, this::mapAdminPart, actor.dealershipId(), actor.dealershipId(), actor.dealershipId(), actor.dealershipId());
  }
  private String adminPartsSql() {
    return """
        select catalogue.id as catalogue_id, catalogue.public_id, catalogue.catalogue_code as sku_code,
          catalogue.part_name, catalogue.description, catalogue.unit_of_measure, catalogue.active,
          coalesce(listing.retail_enabled, false) as retail_enabled, listing.retail_price, listing.retail_description,
          coalesce(listing.fitment_model_codes, catalogue.fitment_model_codes, '[]'::jsonb)::text as fitment_model_codes,
          coalesce(listing.retail_image_url, catalogue.image_url) as retail_image_url,
          coalesce(balance.quantity_on_hand, 0) as quantity_on_hand, coalesce(balance.quantity_reserved, 0) as quantity_reserved,
          coalesce(balance.quantity_on_hand - balance.quantity_reserved, 0) as quantity_available,
          coalesce(balance.average_unit_cost, 0) as average_unit_cost, catalogue.category, catalogue.source_url,
          catalogue.source_verified_at::text as source_verified_at, catalogue.oem_part_number,
          coalesce(listing.fitment_verified, false) as fitment_verified, stock.public_id as stock_part_public_id, stock.sku_code as stock_sku_code
        from bajaj_spare_part_catalogue catalogue
        left join retail_part_catalogue_listing listing on listing.catalogue_product_id = catalogue.id and listing.dealership_id = ?
        left join retail_part_catalogue_stock_map stock_map on stock_map.catalogue_product_id = catalogue.id and stock_map.dealership_id = ?
        left join spare_part stock on stock.dealership_id = ? and stock.id = stock_map.stock_part_id
        left join spare_part_balance balance on balance.dealership_id = stock_map.dealership_id and balance.part_id = stock_map.stock_part_id
        """;
  }
  private AdminPartView mapAdminPart(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new AdminPartView(rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
        rs.getString("description"), rs.getString("unit_of_measure"), rs.getBoolean("active"), rs.getBoolean("retail_enabled"),
        rs.getBigDecimal("retail_price"), rs.getString("retail_description"), readStringList(rs.getString("fitment_model_codes")),
        rs.getString("retail_image_url"), rs.getBigDecimal("quantity_on_hand"), rs.getBigDecimal("quantity_reserved"),
        rs.getBigDecimal("quantity_available"), rs.getBigDecimal("average_unit_cost"), rs.getString("category"),
        rs.getString("source_url"), rs.getString("source_verified_at"), rs.getString("oem_part_number"),
        rs.getBoolean("fitment_verified"), rs.getObject("stock_part_public_id", UUID.class), rs.getString("stock_sku_code"));
  }
  @Transactional
  public AdminPartView updateRetailSettings(StaffPrincipal actor, UUID partPublicId, RetailSettingsRequest request) {
    if (request == null) throw badRequest("Retail listing settings are required.");
    boolean enabled = Boolean.TRUE.equals(request.retailEnabled()), fitmentVerified = Boolean.TRUE.equals(request.fitmentVerified());
    BigDecimal price = request.retailPrice();
    if (enabled && (price == null || price.compareTo(BigDecimal.ZERO) <= 0)) throw badRequest("A positive retail price is required before publishing a part.");
    if (enabled && !fitmentVerified) throw badRequest("Confirm exact motorcycle fitment (or genuinely universal application) before enabling ordering.");
    if (price != null) {
      if (price.compareTo(BigDecimal.ZERO) <= 0 || price.scale() > 2) throw badRequest("Retail price must be positive with no more than two decimal places.");
      price = price.setScale(2, RoundingMode.UNNECESSARY);
    }
    String description = optional(request.retailDescription(), 1000), imageUrl = normalizeImageUrl(request.imageUrl());
    List<String> fitments = normalizeFitments(actor, request.fitmentModelCodes());
    List<Long> ids = jdbc.query("""
        select catalogue.id from bajaj_spare_part_catalogue catalogue
        left join retail_part_catalogue_listing listing on listing.catalogue_product_id = catalogue.id and listing.dealership_id = ?
        where catalogue.public_id = ? and (catalogue.is_global_catalogue = true or listing.dealership_id = ?)
        for update of catalogue
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), partPublicId, actor.dealershipId());
    if (ids.isEmpty()) throw notFound("Spare-part catalogue item was not found in this dealership.");
    long catalogueId = ids.getFirst();
    jdbc.update("""
        insert into retail_part_catalogue_listing(dealership_id, catalogue_product_id, retail_enabled, retail_price,
          retail_description, fitment_model_codes, retail_image_url, fitment_verified, updated_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
        on conflict (dealership_id, catalogue_product_id) do update set retail_enabled = excluded.retail_enabled,
          retail_price = excluded.retail_price, retail_description = excluded.retail_description,
          fitment_model_codes = excluded.fitment_model_codes, retail_image_url = excluded.retail_image_url,
          fitment_verified = excluded.fitment_verified, updated_by_staff_user_id = excluded.updated_by_staff_user_id, updated_at = now()
        """, actor.dealershipId(), catalogueId, enabled, price, description, toJson(fitments), imageUrl, fitmentVerified, actor.staffUserId());
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_LISTING_UPDATED', 'BAJAJ_SPARE_PART_CATALOGUE', ?,
          jsonb_build_object('retailEnabled', ?, 'retailPrice', ?, 'fitmentCount', ?, 'fitmentVerified', ?))
        """, actor.dealershipId(), actor.staffUserId(), partPublicId.toString(), enabled, price, fitments.size(), fitmentVerified);
    return getRetailSetting(actor, partPublicId);
  }
  private AdminPartView getRetailSetting(StaffPrincipal actor, UUID partPublicId) {
    List<AdminPartView> rows = jdbc.query(adminPartsSql() + """
        where (catalogue.is_global_catalogue = true or listing.dealership_id = ?) and catalogue.public_id = ?
        order by catalogue.category, lower(catalogue.part_name), catalogue.catalogue_code
        """, this::mapAdminPart, actor.dealershipId(), actor.dealershipId(), actor.dealershipId(), actor.dealershipId(), partPublicId);
    if (rows.isEmpty()) throw notFound("Spare-part catalogue item was not found.");
    return rows.getFirst();
  }
  public List<StockOption> listRetailStockOptions(StaffPrincipal actor) {
    return jdbc.query("""
        select part.public_id, part.sku_code, part.part_name, part.unit_of_measure,
          coalesce(balance.quantity_on_hand, 0) as quantity_on_hand,
          coalesce(balance.quantity_reserved, 0) as quantity_reserved,
          coalesce(balance.quantity_on_hand - balance.quantity_reserved, 0) as quantity_available,
          mapped.public_id as mapped_catalogue_public_id, mapped.catalogue_code as mapped_catalogue_code,
          mapped.part_name as mapped_catalogue_name
        from spare_part part
        left join spare_part_balance balance
          on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        left join retail_part_catalogue_stock_map stock_map
          on stock_map.dealership_id = part.dealership_id and stock_map.stock_part_id = part.id
        left join bajaj_spare_part_catalogue mapped on mapped.id = stock_map.catalogue_product_id
        where part.dealership_id = ? and part.active = true
        order by lower(part.part_name), part.sku_code
        """, (rs, rowNum) -> new StockOption(
            rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("unit_of_measure"), rs.getBigDecimal("quantity_on_hand"),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("quantity_available"),
            rs.getObject("mapped_catalogue_public_id", UUID.class),
            rs.getString("mapped_catalogue_code"), rs.getString("mapped_catalogue_name")),
        actor.dealershipId());
  }

  @Transactional
  public AdminPartView mapRetailCatalogueStock(StaffPrincipal actor, UUID cataloguePublicId, UUID stockPartPublicId) {
    Long catalogueId = jdbc.query("""
        select catalogue.id from bajaj_spare_part_catalogue catalogue
        left join retail_part_catalogue_listing listing on listing.catalogue_product_id = catalogue.id and listing.dealership_id = ?
        where catalogue.public_id = ? and (catalogue.is_global_catalogue = true or listing.dealership_id = ?) for update of catalogue
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), cataloguePublicId, actor.dealershipId()).stream().findFirst().orElse(null);
    if (catalogueId == null) throw notFound("Spare-part catalogue item was not found.");
    if (stockPartPublicId == null) {
      jdbc.update("delete from retail_part_catalogue_stock_map where dealership_id = ? and catalogue_product_id = ?", actor.dealershipId(), catalogueId);
    } else {
      String catalogueUnit = jdbc.query("""
          select unit_of_measure from bajaj_spare_part_catalogue where id = ?
          """, (rs, rowNum) -> rs.getString(1), catalogueId).stream().findFirst().orElse(null);
      List<Map<String, Object>> stockRows = jdbc.queryForList("""
          select id, unit_of_measure from spare_part
          where dealership_id = ? and public_id = ? and active = true
          """, actor.dealershipId(), stockPartPublicId);
      if (stockRows.isEmpty()) throw notFound("Inventory SKU was not found in this dealership.");
      String stockUnit = String.valueOf(stockRows.getFirst().get("unit_of_measure"));
      if (catalogueUnit == null || !catalogueUnit.equals(stockUnit)) {
        throw conflict("Catalogue unit (" + catalogueUnit + ") does not match inventory SKU unit (" + stockUnit
            + "). Select an SKU with the matching unit or correct the inventory master first.");
      }
      Long stockId = ((Number) stockRows.getFirst().get("id")).longValue();
      try {
        jdbc.update("""
            insert into retail_part_catalogue_stock_map(dealership_id, catalogue_product_id, stock_part_id, updated_by_staff_user_id)
            values (?, ?, ?, ?) on conflict (dealership_id, catalogue_product_id) do update set stock_part_id = excluded.stock_part_id,
              updated_by_staff_user_id = excluded.updated_by_staff_user_id, updated_at = now()
            """, actor.dealershipId(), catalogueId, stockId, actor.staffUserId());
      } catch (DuplicateKeyException duplicate) {
        throw conflict("That inventory SKU is already linked to another catalogue product. Unlink the other product first.");
      }
    }
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_STOCK_LINK_UPDATED', 'BAJAJ_SPARE_PART_CATALOGUE', ?, jsonb_build_object('stockPartPublicId', ?))
        """, actor.dealershipId(), actor.staffUserId(), cataloguePublicId.toString(), stockPartPublicId == null ? null : stockPartPublicId.toString());
    return getRetailSetting(actor, cataloguePublicId);
  }
  public RetailPartFilters listCustomerFilters(CustomerPrincipal actor) {
    List<ModelFilterOption> models = jdbc.query("""
        select model.model_code, model.model_name, model.family, model.category
        from bajaj_catalogue_model model join bajaj_catalogue_dealership_model settings on settings.model_code = model.model_code and settings.dealership_id = ?
        where model.manufacturer = 'BAJAJ' and model.active = true and settings.is_published = true
        order by model.category, model.family, model.model_name
        """, (rs, rowNum) -> new ModelFilterOption(rs.getString("model_code"), rs.getString("model_name"), rs.getString("family"), rs.getString("category")),
        actor.dealershipId());
    return new RetailPartFilters(List.of("ENGINE","BRAKES","CLUTCH","TRANSMISSION","FILTERS","ELECTRICAL","LIGHTING","SUSPENSION","BODY","CONTROLS","FUEL_SYSTEM","FLUIDS","WHEELS","ACCESSORIES","OTHER"), models);
  }
  public List<RetailPartView> listCustomerCatalogue(CustomerPrincipal actor) {
    return jdbc.query("""
        select catalogue.public_id, catalogue.catalogue_code as sku_code, catalogue.part_name,
          coalesce(listing.retail_description, catalogue.description) as display_description, catalogue.unit_of_measure, listing.retail_price,
          coalesce(listing.fitment_model_codes, catalogue.fitment_model_codes, '[]'::jsonb)::text as fitment_model_codes,
          coalesce(listing.retail_image_url, catalogue.image_url) as retail_image_url,
          coalesce(balance.quantity_on_hand - balance.quantity_reserved, 0) as quantity_available,
          (stock_map.stock_part_id is not null) as stock_mapped, coalesce(stock.active, false) as stock_active,
          coalesce(listing.retail_enabled, false) as retail_enabled,
          coalesce(listing.fitment_verified, false) as fitment_verified, catalogue.category, catalogue.oem_part_number,
          catalogue.source_url, catalogue.source_verified_at::text as source_verified_at, catalogue.source_data_status
        from bajaj_spare_part_catalogue catalogue
        left join retail_part_catalogue_listing listing on listing.catalogue_product_id = catalogue.id and listing.dealership_id = ?
        left join retail_part_catalogue_stock_map stock_map on stock_map.catalogue_product_id = catalogue.id and stock_map.dealership_id = ?
        left join spare_part stock on stock.dealership_id = ? and stock.id = stock_map.stock_part_id
        left join spare_part_balance balance on balance.dealership_id = stock_map.dealership_id and balance.part_id = stock_map.stock_part_id
        where catalogue.active = true and (catalogue.is_global_catalogue = true or (listing.dealership_id = ? and listing.retail_enabled = true))
        order by catalogue.category, lower(catalogue.part_name), catalogue.catalogue_code
        """, (rs, rowNum) -> {
      BigDecimal available = rs.getBigDecimal("quantity_available");
      boolean mapped = rs.getBoolean("stock_mapped"), listed = rs.getBoolean("retail_enabled"),
          verified = rs.getBoolean("fitment_verified"), stockActive = rs.getBoolean("stock_active");
      BigDecimal price = rs.getBigDecimal("retail_price");
      boolean configured = mapped && stockActive && listed && price != null && verified;
      boolean orderable = configured && available != null && available.signum() > 0;
      String status = orderable ? "AVAILABLE" : configured ? "OUT_OF_STOCK" : "CHECK_WITH_DEALER";
      return new RetailPartView(rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
        rs.getString("display_description"), rs.getString("unit_of_measure"), price, readStringList(rs.getString("fitment_model_codes")),
        rs.getString("retail_image_url"), available, orderable, status, verified, rs.getString("category"), rs.getString("oem_part_number"),
        rs.getString("source_url"), rs.getString("source_verified_at"), rs.getString("source_data_status"));
    }, actor.dealershipId(), actor.dealershipId(), actor.dealershipId(), actor.dealershipId());
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
    String fulfillmentMethod = request.fulfillmentMethod() == null || request.fulfillmentMethod().isBlank()
        ? "PICKUP" : required(request.fulfillmentMethod(), "Fulfillment method", 16).toUpperCase(Locale.ROOT);
    if (!List.of("PICKUP", "DELIVERY").contains(fulfillmentMethod)) {
      throw badRequest("Choose pickup or delivery for this order.");
    }
    String deliveryAddress = null;
    if ("DELIVERY".equals(fulfillmentMethod)) {
      deliveryAddress = required(request.deliveryAddress(), "Delivery address", 1500);
    } else if (request.deliveryAddress() != null && !request.deliveryAddress().isBlank()) {
      throw badRequest("A delivery address is only used for a delivery request.");
    }
    String deliveryQuoteStatus = "DELIVERY".equals(fulfillmentMethod)
        ? "AWAITING_STAFF_QUOTE" : "NOT_REQUIRED";
    String paymentMethod = "DELIVERY".equals(fulfillmentMethod) ? "PAY_ON_DELIVERY" : "PAY_AT_PICKUP";
    String paymentStatus = "DELIVERY".equals(fulfillmentMethod) ? "PAY_ON_DELIVERY" : "PAY_ON_PICKUP";
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
            + "|note=" + (note == null ? "" : note)
            + "|fulfillment=" + fulfillmentMethod
            + "|deliveryAddress=" + (deliveryAddress == null ? "" : deliveryAddress));
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
      if (!part.fitmentVerified()) throw conflict("Fitment for " + part.partName() + " must be verified before ordering.");
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
            fulfillment_method, delivery_address, delivery_fee, delivery_quote_status,
            order_total, customer_note)
          values (?, ?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, 0, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), orderCode, actor.customerId(), actor.accountId(),
          key, fingerprint, paymentMethod, paymentStatus, fulfillmentMethod, deliveryAddress,
          deliveryQuoteStatus, total, note);
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
            dealership_id, order_id, part_id, catalogue_product_id, line_number, sku_code, part_name,
            unit_of_measure, quantity, unit_price, line_total)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, actor.dealershipId(), orderId, part.id(), part.catalogueId(), ++lineNumber,
          part.skuCode(), part.partName(), part.unitOfMeasure(), quantity, part.retailPrice(), lineTotal);

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
          jsonb_build_object('orderCode', ?, 'lineCount', ?, 'orderTotal', ?, 'paymentStatus', ?,
            'fulfillmentMethod', ?, 'deliveryQuoteStatus', ?))
        """, actor.dealershipId(), actor.customerId(), orderPublicId.toString(),
        orderCode, normalized.size(), total, paymentStatus, fulfillmentMethod, deliveryQuoteStatus);
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'RETAIL_PART_ORDER_PLACED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'lineCount', ?, 'orderTotal', ?, 'fulfillmentMethod', ?))
        """, actor.dealershipId(), actor.accountId(), orderPublicId, orderCode, normalized.size(), total,
        fulfillmentMethod);
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
        select id, order_code, status, fulfillment_method, delivery_quote_status
        from retail_part_order
        where dealership_id = ? and customer_id = ? and customer_portal_account_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), actor.customerId(), actor.accountId(), orderPublicId);
    if (rows.isEmpty()) throw notFound("That parts order was not found in your account.");
    Map<String, Object> row = rows.getFirst();
    // Idempotent replay: the first cancellation may have committed even if the client lost its response.
    if ("CANCELLED".equals(String.valueOf(row.get("status")))) {
      return getOrderForCustomer(actor, orderPublicId);
    }
    if (!"PLACED".equals(String.valueOf(row.get("status")))) {
      throw conflict("Only an order that has not been fulfilled can be cancelled.");
    }
    Long orderId = ((Number) row.get("id")).longValue();
    releaseOrderReservation(actor.dealershipId(), orderId, orderPublicId, null, actor.customerId());
    jdbc.update("""
        update retail_part_order
        set status = 'CANCELLED', cancelled_at = now(), updated_at = now(),
            delivery_quote_status = case when fulfillment_method = 'DELIVERY' then 'CANCELLED' else delivery_quote_status end
        where dealership_id = ? and id = ? and status = 'PLACED'
        """, actor.dealershipId(), orderId);
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_customer_id,
          action, entity_type, entity_id, details)
        values (?, 'CUSTOMER', ?, 'RETAIL_PART_ORDER_CANCELLED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'fulfillmentMethod', ?,
            'deliveryQuoteStatus', ?, 'stockReservationReleased', true))
        """, actor.dealershipId(), actor.customerId(), orderPublicId.toString(),
        String.valueOf(row.get("order_code")), String.valueOf(row.get("fulfillment_method")),
        "DELIVERY".equals(String.valueOf(row.get("fulfillment_method"))) ? "CANCELLED" : "NOT_REQUIRED");
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'RETAIL_PART_ORDER_CANCELLED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?))
        """, actor.dealershipId(), actor.accountId(), orderPublicId, String.valueOf(row.get("order_code")));
    return getOrderForCustomer(actor, orderPublicId);
  }

  private void releaseOrderReservation(long dealershipId, long orderId, UUID orderPublicId,
      Long actorStaffUserId, Long actorCustomerId) {
    List<OrderStockLine> lines = getOrderStockLines(dealershipId, orderId, true);
    for (OrderStockLine line : lines) {
      StockPart part = lockPartById(dealershipId, line.partId());
      if (part == null || part.quantityReserved().compareTo(line.quantity()) < 0) {
        throw conflict("The reserved stock no longer matches this order. Staff reconciliation is required.");
      }
      int changed = jdbc.update("""
          update spare_part_balance set quantity_reserved = quantity_reserved - ?, updated_at = now()
          where dealership_id = ? and part_id = ? and quantity_reserved >= ?
          """, line.quantity(), dealershipId, line.partId(), line.quantity());
      if (changed != 1) throw conflict("Stock changed while releasing the retail reservation. Refresh and retry.");
      BigDecimal reservedAfter = part.quantityReserved().subtract(line.quantity()).setScale(3, RoundingMode.HALF_UP);
      insertMovement(dealershipId, part, "RETAIL_ORDER_RELEASED", BigDecimal.ZERO,
          line.quantity().negate(), part.quantityOnHand(), reservedAfter, orderPublicId.toString(),
          "RET-REL:" + orderPublicId + ":" + part.publicId(),
          TokenDigests.sha256(orderPublicId + "|release|" + part.publicId()), actorStaffUserId, actorCustomerId);
    }
  }

  @Transactional
  public RetailOrderView respondToDeliveryQuote(CustomerPrincipal actor, UUID orderPublicId, boolean accept) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, order_code, status, fulfillment_method, delivery_quote_status
        from retail_part_order
        where dealership_id = ? and customer_id = ? and customer_portal_account_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), actor.customerId(), actor.accountId(), orderPublicId);
    if (rows.isEmpty()) throw notFound("That parts order was not found in your account.");
    Map<String, Object> row = rows.getFirst();
    if (!"DELIVERY".equals(String.valueOf(row.get("fulfillment_method")))) {
      throw conflict("This order does not have a delivery quote to respond to.");
    }
    String status = String.valueOf(row.get("status"));
    String quoteStatus = String.valueOf(row.get("delivery_quote_status"));
    if (accept && "PLACED".equals(status) && "ACCEPTED".equals(quoteStatus)) {
      return getOrderForCustomer(actor, orderPublicId);
    }
    if (!accept && "CANCELLED".equals(status) && "DECLINED".equals(quoteStatus)) {
      return getOrderForCustomer(actor, orderPublicId);
    }
    if (!"PLACED".equals(status) || !"AWAITING_CUSTOMER_CONFIRMATION".equals(quoteStatus)) {
      throw conflict("A current delivery quote awaiting your decision is required.");
    }
    if (accept) {
      int changed = jdbc.update("""
          update retail_part_order set delivery_quote_status = 'ACCEPTED', updated_at = now()
          where dealership_id = ? and id = ? and status = 'PLACED'
            and delivery_quote_status = 'AWAITING_CUSTOMER_CONFIRMATION'
          """, actor.dealershipId(), row.get("id"));
      if (changed != 1) throw conflict("The delivery quote changed while you were accepting it. Refresh and retry.");
      jdbc.update("""
          insert into audit_event(dealership_id, actor_kind, actor_customer_id,
            action, entity_type, entity_id, details)
          values (?, 'CUSTOMER', ?, 'RETAIL_PART_ORDER_DELIVERY_ACCEPTED', 'RETAIL_PART_ORDER', ?,
            jsonb_build_object('orderCode', ?, 'quoteStatus', 'ACCEPTED'))
          """, actor.dealershipId(), actor.customerId(), orderPublicId.toString(), String.valueOf(row.get("order_code")));
      jdbc.update("""
          insert into customer_portal_activity(dealership_id, account_id, action, entity_type, entity_public_id, details)
          values (?, ?, 'RETAIL_PART_ORDER_DELIVERY_ACCEPTED', 'RETAIL_PART_ORDER', ?, jsonb_build_object('orderCode', ?))
          """, actor.dealershipId(), actor.accountId(), orderPublicId, String.valueOf(row.get("order_code")));
      return getOrderForCustomer(actor, orderPublicId);
    }
    long orderId = ((Number) row.get("id")).longValue();
    releaseOrderReservation(actor.dealershipId(), orderId, orderPublicId, null, actor.customerId());
    int changed = jdbc.update("""
        update retail_part_order
        set status = 'CANCELLED', cancelled_at = now(), delivery_quote_status = 'DECLINED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'PLACED'
          and delivery_quote_status = 'AWAITING_CUSTOMER_CONFIRMATION'
        """, actor.dealershipId(), orderId);
    if (changed != 1) throw conflict("The delivery request changed while you were declining it. Refresh and retry.");
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_customer_id,
          action, entity_type, entity_id, details)
        values (?, 'CUSTOMER', ?, 'RETAIL_PART_ORDER_DELIVERY_DECLINED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'quoteStatus', 'DECLINED', 'reservationReleased', true))
        """, actor.dealershipId(), actor.customerId(), orderPublicId.toString(), String.valueOf(row.get("order_code")));
    jdbc.update("""
        insert into customer_portal_activity(dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, 'RETAIL_PART_ORDER_DELIVERY_DECLINED', 'RETAIL_PART_ORDER', ?, jsonb_build_object('orderCode', ?))
        """, actor.dealershipId(), actor.accountId(), orderPublicId, String.valueOf(row.get("order_code")));
    return getOrderForCustomer(actor, orderPublicId);
  }

  public List<RetailOrderView> listOrdersForStaff(StaffPrincipal actor, int requestedLimit, String rawStatus) {
    int limit = Math.max(1, Math.min(requestedLimit, 100));
    String status = optional(rawStatus, 20);
    if (status != null) {
      status = status.toUpperCase(Locale.ROOT);
      if (!List.of("PLACED", "CANCELLED", "FULFILLED", "RETURNED").contains(status)) throw badRequest("Unknown retail order status.");
    }
    List<UUID> ids = status == null
        ? jdbc.query("""
            select public_id from retail_part_order where dealership_id = ?
            order by case status when 'PLACED' then 0 when 'FULFILLED' then 1 when 'RETURNED' then 2 else 3 end, created_at desc, id desc limit ?
            """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), limit)
        : jdbc.query("""
            select public_id from retail_part_order where dealership_id = ? and status = ?
            order by created_at desc, id desc limit ?
            """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), status, limit);
    return ids.stream().map(id -> getOrderForStaff(actor, id)).toList();
  }

  @Transactional
  public RetailOrderView quoteDelivery(StaffPrincipal actor, UUID orderPublicId, DeliveryQuoteRequest request) {
    if (request == null || request.deliveryFee() == null) throw badRequest("A delivery fee quote is required.");
    BigDecimal fee = request.deliveryFee();
    if (fee.signum() < 0 || fee.compareTo(new BigDecimal("999999999999.99")) > 0) {
      throw badRequest("Delivery fee must be a non-negative amount within the supported range.");
    }
    try { fee = fee.setScale(2, RoundingMode.UNNECESSARY); }
    catch (ArithmeticException invalid) { throw badRequest("Delivery fee may have at most two decimal places."); }
    String note = optional(request.note(), 1000);
    String key = required(request.idempotencyKey(), "Delivery quote idempotency key", 120);
    String fingerprint = TokenDigests.sha256(orderPublicId + "|" + fee.toPlainString() + "|" + (note == null ? "" : note));

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, order_code, status, fulfillment_method, delivery_quote_status
        from retail_part_order where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), orderPublicId);
    if (rows.isEmpty()) throw notFound("Retail parts order was not found.");
    Map<String, Object> row = rows.getFirst();

    List<Map<String, Object>> keyRows = jdbc.queryForList("""
        select public_id, delivery_quote_fingerprint from retail_part_order
        where dealership_id = ? and delivery_quote_idempotency_key = ?
        """, actor.dealershipId(), key);
    if (!keyRows.isEmpty()) {
      Map<String, Object> previous = keyRows.getFirst();
      if (!orderPublicId.equals(previous.get("public_id"))
          || !fingerprint.equals(String.valueOf(previous.get("delivery_quote_fingerprint")).trim())) {
        throw conflict("This delivery quote key was already used for different order details.");
      }
      return getOrderForStaff(actor, orderPublicId);
    }
    if (!"DELIVERY".equals(String.valueOf(row.get("fulfillment_method")))
        || !"PLACED".equals(String.valueOf(row.get("status")))
        || !"AWAITING_STAFF_QUOTE".equals(String.valueOf(row.get("delivery_quote_status")))) {
      throw conflict("Only a delivery request awaiting its first quote can be quoted.");
    }
    int updated = jdbc.update("""
        update retail_part_order
        set delivery_fee = ?, delivery_quote_status = 'AWAITING_CUSTOMER_CONFIRMATION',
            delivery_quote_note = ?, delivery_quoted_by_staff_user_id = ?, delivery_quoted_at = now(),
            delivery_quote_idempotency_key = ?, delivery_quote_fingerprint = ?,
            order_total = order_total + ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'PLACED'
          and fulfillment_method = 'DELIVERY' and delivery_quote_status = 'AWAITING_STAFF_QUOTE'
        """, fee, note, actor.staffUserId(), key, fingerprint, fee, actor.dealershipId(), row.get("id"));
    if (updated != 1) throw conflict("The delivery request changed while its quote was being saved. Refresh and retry.");
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_ORDER_DELIVERY_QUOTED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'deliveryFee', ?, 'quoteStatus', 'AWAITING_CUSTOMER_CONFIRMATION'))
        """, actor.dealershipId(), actor.staffUserId(), orderPublicId.toString(),
        String.valueOf(row.get("order_code")), fee);
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        select dealership_id, customer_portal_account_id, 'RETAIL_PART_ORDER_DELIVERY_QUOTED',
          'RETAIL_PART_ORDER', public_id, jsonb_build_object('orderCode', ?, 'deliveryFee', ?,
            'quoteStatus', 'AWAITING_CUSTOMER_CONFIRMATION')
        from retail_part_order where dealership_id = ? and public_id = ?
        """, String.valueOf(row.get("order_code")), fee, actor.dealershipId(), orderPublicId);
    return getOrderForStaff(actor, orderPublicId);
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
        select id, order_code, status, order_total, fulfillment_method, delivery_quote_status
        from retail_part_order where dealership_id = ? and public_id = ? for update
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
    String fulfillmentMethod = String.valueOf(row.get("fulfillment_method"));
    if ("DELIVERY".equals(fulfillmentMethod)
        && !"ACCEPTED".equals(String.valueOf(row.get("delivery_quote_status")))) {
      throw conflict("The customer must accept the delivery quote before delivery and payment can be recorded.");
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
        update retail_part_order set status = 'FULFILLED', payment_status = ?,
          fulfilled_by_staff_user_id = ?, fulfilled_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'PLACED'
        """, "DELIVERY".equals(fulfillmentMethod) ? "PAID_ON_DELIVERY" : "PAID_AT_PICKUP",
        actor.staffUserId(), actor.dealershipId(), orderId);
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_ORDER_FULFILLED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'receiptNumber', ?, 'collectionMethod', ?, 'amount', ?,
            'fulfillmentMethod', ?, 'manualCollectionAttestation', true))
        """, actor.dealershipId(), actor.staffUserId(), orderPublicId.toString(),
        String.valueOf(row.get("order_code")), receiptNumber, method, total, fulfillmentMethod);
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


  /**
   * Records a full-order return after pickup collection. No automated refund is issued.
   * Stock returns to sellable quantity only when staff attest every returned line is inspected
   * and resaleable; otherwise it remains excluded from the available balance.
   */
  @Transactional
  public RetailOrderView returnOrder(StaffPrincipal actor, UUID orderPublicId, ReturnRequest request) {
    if (request == null) throw badRequest("Return details are required.");
    String reason = required(request.reason(), "Return reason", 1000);
    if (request.restockable() == null) throw badRequest("Confirm whether returned items are resaleable after inspection.");
    String key = required(request.idempotencyKey(), "Return idempotency key", 120);
    boolean restockable = request.restockable();
    String fingerprint = TokenDigests.sha256(orderPublicId + "|" + reason + "|" + restockable);

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, order_code, status, order_total from retail_part_order
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), orderPublicId);
    if (rows.isEmpty()) throw notFound("Retail parts order was not found.");
    Map<String, Object> row = rows.getFirst();
    RetailOrderView replay = findStaffReturnReplay(actor, key, fingerprint, orderPublicId);
    if (replay != null) return replay;
    if (!"FULFILLED".equals(String.valueOf(row.get("status")))) {
      throw conflict("Only a collected order can be returned once. Placed orders must be cancelled instead.");
    }

    Long orderId = ((Number) row.get("id")).longValue();
    List<OrderStockLine> lines = getOrderStockLines(actor.dealershipId(), orderId, true);
    for (OrderStockLine line : lines) {
      StockPart part = lockPartById(actor.dealershipId(), line.partId());
      if (part == null) throw conflict("A returned part could not be reconciled to this dealership's stock.");
      if (!restockable) continue;
      BigDecimal onHandAfter = part.quantityOnHand().add(line.quantity()).setScale(3, RoundingMode.HALF_UP);
      int updated = jdbc.update("""
          update spare_part_balance
          set quantity_on_hand = quantity_on_hand + ?, updated_at = now()
          where dealership_id = ? and part_id = ?
          """, line.quantity(), actor.dealershipId(), line.partId());
      if (updated != 1) throw conflict("Stock changed while recording the return. Refresh and reconcile.");
      insertMovement(actor.dealershipId(), part, "RETAIL_ORDER_RETURNED", line.quantity(),
          BigDecimal.ZERO.setScale(3, RoundingMode.UNNECESSARY), onHandAfter, part.quantityReserved(),
          orderPublicId.toString(), "RET-RET:" + orderPublicId + ":" + part.publicId(),
          TokenDigests.sha256(orderPublicId + "|return|" + part.publicId()), actor.staffUserId(), null);
    }

    String returnCode = "RPR-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    BigDecimal amountReviewRequired = (BigDecimal) row.get("order_total");
    jdbc.update("""
        insert into retail_part_order_return(
          dealership_id, order_id, return_code, idempotency_key, request_fingerprint,
          reason, restocked, amount_review_required, recorded_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), orderId, returnCode, key, fingerprint, reason,
        restockable, amountReviewRequired, actor.staffUserId());

    int updated = jdbc.update("""
        update retail_part_order
        set status = 'RETURNED', payment_status = 'REFUND_REVIEW_REQUIRED',
          returned_by_staff_user_id = ?, returned_at = now(), returned_reason = ?,
          returned_restocked = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'FULFILLED'
        """, actor.staffUserId(), reason, restockable, actor.dealershipId(), orderId);
    if (updated != 1) throw conflict("The order changed while recording the return. Refresh and retry.");

    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, 'RETAIL_PART_ORDER_RETURNED', 'RETAIL_PART_ORDER', ?,
          jsonb_build_object('orderCode', ?, 'returnCode', ?, 'restocked', ?,
            'reason', ?, 'amountReviewRequired', ?, 'automaticRefundIssued', false))
        """, actor.dealershipId(), actor.staffUserId(), orderPublicId.toString(),
        String.valueOf(row.get("order_code")), returnCode, restockable, reason, amountReviewRequired);
    return getOrderForStaff(actor, orderPublicId);
  }

  private RetailOrderView findStaffReturnReplay(
      StaffPrincipal actor, String key, String fingerprint, UUID orderPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select returns.request_fingerprint, order_record.public_id as order_public_id
        from retail_part_order_return returns
        join retail_part_order order_record
          on order_record.dealership_id = returns.dealership_id and order_record.id = returns.order_id
        where returns.dealership_id = ? and returns.idempotency_key = ?
        """, actor.dealershipId(), key);
    if (rows.isEmpty()) return null;
    Map<String, Object> row = rows.getFirst();
    if (!orderPublicId.equals(row.get("order_public_id"))
        || !fingerprint.equals(String.valueOf(row.get("request_fingerprint")).trim())) {
      throw conflict("This return key was already used for different order details.");
    }
    return getOrderForStaff(actor, orderPublicId);
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
          order_record.fulfillment_method, order_record.delivery_address, order_record.delivery_fee,
          order_record.delivery_quote_status, order_record.delivery_quote_note, order_record.delivery_quoted_at,
          order_record.customer_note, order_record.created_at, order_record.updated_at,
          order_record.cancelled_at, order_record.fulfilled_at, order_record.returned_at,
          order_record.returned_reason, order_record.returned_restocked, customer.full_name as customer_name,
          customer.customer_code, customer.phone as customer_phone
        from retail_part_order order_record
        join customer on customer.dealership_id = order_record.dealership_id and customer.id = order_record.customer_id
        """;
  }

  private RetailOrderView orderView(java.sql.ResultSet rs, List<RetailOrderLineView> lines) throws java.sql.SQLException {
    Timestamp cancelled = rs.getTimestamp("cancelled_at");
    Timestamp fulfilled = rs.getTimestamp("fulfilled_at");
    Timestamp returned = rs.getTimestamp("returned_at");
    Boolean restocked = (Boolean) rs.getObject("returned_restocked");
    Timestamp deliveryQuoted = rs.getTimestamp("delivery_quoted_at");
    return new RetailOrderView(
        rs.getObject("public_id", UUID.class), rs.getString("order_code"), rs.getString("status"),
        rs.getString("payment_method"), rs.getString("payment_status"), rs.getBigDecimal("order_total"),
        rs.getString("fulfillment_method"), rs.getString("delivery_address"), rs.getBigDecimal("delivery_fee"),
        rs.getString("delivery_quote_status"), rs.getString("delivery_quote_note"),
        deliveryQuoted == null ? null : deliveryQuoted.toInstant(),
        rs.getString("customer_note"), rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant(), cancelled == null ? null : cancelled.toInstant(),
        fulfilled == null ? null : fulfilled.toInstant(), returned == null ? null : returned.toInstant(),
        rs.getString("returned_reason"), restocked, rs.getString("customer_name"),
        rs.getString("customer_code"), rs.getString("customer_phone"), lines);
  }

  private List<RetailOrderLineView> getOrderLines(long orderId) {
    return jdbc.query("""
        select catalogue.public_id as part_public_id, line.sku_code, line.part_name, line.unit_of_measure,
          line.quantity, line.unit_price, line.line_total
        from retail_part_order_line line
        join bajaj_spare_part_catalogue catalogue on catalogue.id = line.catalogue_product_id
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
    List<Object> args = new ArrayList<>(); args.add(dealershipId); args.add(dealershipId); args.add(dealershipId); args.addAll(publicIds);
    String sql = """
        select stock.id, catalogue.id as catalogue_id, catalogue.public_id, catalogue.catalogue_code as sku_code,
          catalogue.part_name, catalogue.unit_of_measure, (catalogue.active and stock.active) as active,
          listing.retail_enabled, listing.retail_price, listing.fitment_model_codes::text as fitment_model_codes, listing.fitment_verified,
          balance.quantity_on_hand, balance.quantity_reserved, balance.average_unit_cost
        from bajaj_spare_part_catalogue catalogue
        join retail_part_catalogue_listing listing on listing.catalogue_product_id = catalogue.id and listing.dealership_id = ?
        join retail_part_catalogue_stock_map stock_map on stock_map.catalogue_product_id = catalogue.id and stock_map.dealership_id = ?
        join spare_part stock on stock.dealership_id = ? and stock.id = stock_map.stock_part_id
        join spare_part_balance balance on balance.dealership_id = stock_map.dealership_id and balance.part_id = stock_map.stock_part_id
        where catalogue.public_id in (
        """ + placeholders + """
        )
        order by stock.id
        for update of stock, balance, listing
        """;
    return jdbc.query(sql, (rs, rowNum) -> new StockPart(rs.getLong("id"), rs.getLong("catalogue_id"),
      rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"), rs.getString("unit_of_measure"),
      rs.getBoolean("active"), rs.getBoolean("retail_enabled"), rs.getBigDecimal("retail_price"), readStringList(rs.getString("fitment_model_codes")),
      rs.getBoolean("fitment_verified"), rs.getBigDecimal("quantity_on_hand"), rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("average_unit_cost")), args.toArray());
  }
  private StockPart lockPartById(long dealershipId, long partId) {
    List<StockPart> rows = jdbc.query("""
        select part.id, 0::bigint as catalogue_id, part.public_id, part.sku_code, part.part_name,
          part.unit_of_measure, part.active, part.retail_enabled, part.retail_price,
          part.fitment_model_codes::text as fitment_model_codes, true as fitment_verified,
          balance.quantity_on_hand, balance.quantity_reserved, balance.average_unit_cost
        from spare_part part join spare_part_balance balance on balance.dealership_id = part.dealership_id and balance.part_id = part.id
        where part.dealership_id = ? and part.id = ? for update of part, balance
        """, (rs, rowNum) -> new StockPart(rs.getLong("id"), rs.getLong("catalogue_id"), rs.getObject("public_id", UUID.class),
      rs.getString("sku_code"), rs.getString("part_name"), rs.getString("unit_of_measure"), rs.getBoolean("active"), rs.getBoolean("retail_enabled"),
      rs.getBigDecimal("retail_price"), readStringList(rs.getString("fitment_model_codes")), rs.getBoolean("fitment_verified"),
      rs.getBigDecimal("quantity_on_hand"), rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("average_unit_cost")), dealershipId, partId);
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

  public record RetailSettingsRequest(Boolean retailEnabled, BigDecimal retailPrice, String retailDescription, List<String> fitmentModelCodes, String imageUrl, Boolean fitmentVerified) {
    public RetailSettingsRequest(Boolean retailEnabled, BigDecimal retailPrice, String retailDescription, List<String> fitmentModelCodes, String imageUrl) { this(retailEnabled, retailPrice, retailDescription, fitmentModelCodes, imageUrl, true); }
  }
  public record AdminPartView(UUID publicId, String skuCode, String partName, String description, String unitOfMeasure, boolean active,
    boolean retailEnabled, BigDecimal retailPrice, String retailDescription, List<String> fitmentModelCodes, String imageUrl,
    BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal quantityAvailable, BigDecimal averageUnitCost,
    String category, String sourceUrl, String sourceVerifiedAt, String partNumber, boolean fitmentVerified,
    UUID stockPartPublicId, String stockSkuCode) {}
  public record RetailPartView(UUID publicId, String skuCode, String partName, String description, String unitOfMeasure,
    BigDecimal retailPrice, List<String> fitmentModelCodes, String imageUrl, BigDecimal quantityAvailable, boolean available,
    String availabilityStatus, boolean fitmentVerified, String category, String partNumber, String sourceUrl, String sourceVerifiedAt, String sourceDataStatus) {}
  public record StockOption(UUID publicId, String skuCode, String partName, String unitOfMeasure,
      BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal quantityAvailable,
      UUID mappedCataloguePublicId, String mappedCatalogueCode, String mappedCatalogueName) {}
  public record ModelFilterOption(String modelCode, String modelName, String family, String category) {}
  public record RetailPartFilters(List<String> categories, List<ModelFilterOption> motorcycleModels) {}
  public record OrderLineRequest(UUID partPublicId, BigDecimal quantity) {}
  public record PlaceOrderRequest(List<OrderLineRequest> lines, String fitmentModelCode, String customerNote, String idempotencyKey, String fulfillmentMethod, String deliveryAddress) {
    public PlaceOrderRequest(List<OrderLineRequest> lines, String fitmentModelCode, String customerNote, String idempotencyKey) { this(lines, fitmentModelCode, customerNote, idempotencyKey, "PICKUP", null); }
  }
  public record FulfillRequest(String collectionMethod, String externalReference, String idempotencyKey, String note) {}
  public record ReturnRequest(String reason, Boolean restockable, String idempotencyKey) {}
  public record DeliveryQuoteRequest(BigDecimal deliveryFee, String note, String idempotencyKey) {}
  public record RetailOrderLineView(UUID partPublicId, String skuCode, String partName, String unitOfMeasure, BigDecimal quantity, BigDecimal unitPrice, BigDecimal lineTotal) {}
  public record RetailOrderView(UUID publicId, String orderCode, String status, String paymentMethod, String paymentStatus, BigDecimal orderTotal,
    String fulfillmentMethod, String deliveryAddress, BigDecimal deliveryFee, String deliveryQuoteStatus, String deliveryQuoteNote,
    Instant deliveryQuotedAt, String customerNote, Instant createdAt, Instant updatedAt, Instant cancelledAt, Instant fulfilledAt,
    Instant returnedAt, String returnReason, Boolean restockedOnReturn, String customerName, String customerCode, String customerPhone, List<RetailOrderLineView> lines) {}
  private record OrderStockLine(long partId, BigDecimal quantity) {}
  private record StockPart(long id, long catalogueId, UUID publicId, String skuCode, String partName, String unitOfMeasure,
    boolean active, boolean retailEnabled, BigDecimal retailPrice, List<String> fitmentModelCodes, boolean fitmentVerified,
    BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal averageUnitCost) {}

}
