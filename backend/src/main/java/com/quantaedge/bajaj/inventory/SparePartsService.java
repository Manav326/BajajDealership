package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
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

/** Dealership-scoped consumable parts inventory and job-card stock operations. */
@Service
public class SparePartsService {
  private static final BigDecimal MAX_QUANTITY = new BigDecimal("999999999.999");
  private static final BigDecimal MAX_UNIT_COST = new BigDecimal("999999999999.99");
  private static final Set<String> UNITS =
      Set.of("EACH", "PAIR", "SET", "LITRE", "ML", "GRAM", "KG", "METER");

  private final JdbcTemplate jdbc;

  public SparePartsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Page<SparePartView> listParts(
      StaffPrincipal actor, int requestedPage, int requestedSize, String query, Boolean activeOnly) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    String term = cleanSearch(query);
    String where = " where p.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (activeOnly != null && activeOnly) where += " and p.active = true ";
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      where += " and (lower(p.sku_code) like ? escape '!' or lower(p.part_name) like ? escape '!') ";
      args.add(like);
      args.add(like);
    }
    Long totalValue = jdbc.queryForObject("""
        select count(*) from spare_part p
        """ + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(window.size());
    args.add(window.offset());
    List<SparePartView> items = jdbc.query("""
        select p.public_id, p.sku_code, p.part_name, p.description, p.unit_of_measure, p.active,
          b.quantity_on_hand, b.quantity_reserved, b.average_unit_cost, b.low_stock_threshold, b.reorder_to_quantity, p.created_at, p.updated_at
        from spare_part p
        join spare_part_balance b on b.dealership_id = p.dealership_id and b.part_id = p.id
        """ + where + " order by lower(p.part_name), p.id limit ? offset ?",
        (rs, rowNum) -> partView(
            rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("description"), rs.getString("unit_of_measure"), rs.getBoolean("active"),
            rs.getBigDecimal("quantity_on_hand"), rs.getBigDecimal("quantity_reserved"),
            rs.getBigDecimal("average_unit_cost"), rs.getBigDecimal("low_stock_threshold"),
            rs.getBigDecimal("reorder_to_quantity"), rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant()), args.toArray());
    return new Page<>(items, window.page(), window.size(), total);
  }

  public Page<LowStockAlertView> listLowStockAlerts(
      StaffPrincipal actor, int requestedPage, int requestedSize) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    Long totalValue = jdbc.queryForObject("""
        select count(*)
        from spare_part p
        join spare_part_balance b on b.dealership_id = p.dealership_id and b.part_id = p.id
        where p.dealership_id = ? and p.active = true and b.low_stock_threshold > 0
          and b.quantity_on_hand - b.quantity_reserved <= b.low_stock_threshold
        """, Long.class, actor.dealershipId());
    long total = totalValue == null ? 0 : totalValue;
    List<LowStockAlertView> items = jdbc.query("""
        select p.public_id, p.sku_code, p.part_name, p.unit_of_measure,
          b.quantity_on_hand, b.quantity_reserved,
          (b.quantity_on_hand - b.quantity_reserved) as quantity_available,
          b.low_stock_threshold, b.reorder_to_quantity,
          greatest(b.reorder_to_quantity - (b.quantity_on_hand - b.quantity_reserved), 0) as suggested_order_quantity,
          b.updated_at
        from spare_part p
        join spare_part_balance b on b.dealership_id = p.dealership_id and b.part_id = p.id
        where p.dealership_id = ? and p.active = true and b.low_stock_threshold > 0
          and b.quantity_on_hand - b.quantity_reserved <= b.low_stock_threshold
        order by (b.quantity_on_hand - b.quantity_reserved) asc, lower(p.part_name), p.id
        limit ? offset ?
        """, (rs, rowNum) -> new LowStockAlertView(
            rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("unit_of_measure"), rs.getBigDecimal("quantity_on_hand"),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("quantity_available"),
            rs.getBigDecimal("low_stock_threshold"), rs.getBigDecimal("reorder_to_quantity"),
            rs.getBigDecimal("suggested_order_quantity"), rs.getTimestamp("updated_at").toInstant()),
        actor.dealershipId(), window.size(), window.offset());
    return new Page<>(items, window.page(), window.size(), total);
  }

  @Transactional
  public SparePartView updateReorderPolicy(
      StaffPrincipal actor, UUID publicId, ReorderPolicyRequest request) {
    if (request == null) throw badRequest("Reorder policy details are required.");
    BigDecimal threshold = normalizePolicyQuantity(request.lowStockThreshold(), "Low-stock threshold");
    BigDecimal target = normalizePolicyQuantity(request.reorderToQuantity(), "Reorder target");
    if (target.compareTo(threshold) < 0) {
      throw badRequest("Reorder target must be greater than or equal to the low-stock threshold.");
    }
    List<Long> ids = jdbc.query("""
        select p.id
        from spare_part p
        join spare_part_balance b on b.dealership_id = p.dealership_id and b.part_id = p.id
        where p.dealership_id = ? and p.public_id = ?
        for update of b
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), publicId);
    if (ids.isEmpty()) throw notFound("Spare part was not found in this dealership.");
    int changed = jdbc.update("""
        update spare_part_balance
        set low_stock_threshold = ?, reorder_to_quantity = ?, updated_at = now()
        where dealership_id = ? and part_id = ?
        """, threshold, target, actor.dealershipId(), ids.getFirst());
    if (changed != 1) throw conflict("Spare-part reorder policy could not be updated.");
    audit(actor, "SPARE_PART_REORDER_POLICY_UPDATED", "SPARE_PART", publicId.toString(),
        "Low-stock threshold set to " + threshold.toPlainString()
            + " and reorder target set to " + target.toPlainString() + ".");
    return getPart(actor, publicId);
  }

  public SparePartView getPart(StaffPrincipal actor, UUID publicId) {
    List<SparePartView> rows = jdbc.query("""
        select p.public_id, p.sku_code, p.part_name, p.description, p.unit_of_measure, p.active,
          b.quantity_on_hand, b.quantity_reserved, b.average_unit_cost, b.low_stock_threshold, b.reorder_to_quantity, p.created_at, p.updated_at
        from spare_part p
        join spare_part_balance b on b.dealership_id = p.dealership_id and b.part_id = p.id
        where p.dealership_id = ? and p.public_id = ?
        """, (rs, rowNum) -> partView(
            rs.getObject("public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
            rs.getString("description"), rs.getString("unit_of_measure"), rs.getBoolean("active"),
            rs.getBigDecimal("quantity_on_hand"), rs.getBigDecimal("quantity_reserved"),
            rs.getBigDecimal("average_unit_cost"), rs.getBigDecimal("low_stock_threshold"),
            rs.getBigDecimal("reorder_to_quantity"), rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant()), actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Spare part was not found in this dealership.");
    return rows.getFirst();
  }

  @Transactional
  public SparePartView createPart(StaffPrincipal actor, PartRequest request) {
    if (request == null) throw badRequest("Spare-part details are required.");
    String sku = requiredText(request.skuCode(), "SKU", 60).toUpperCase(Locale.ROOT);
    if (!sku.matches("[A-Z0-9][A-Z0-9._/-]{0,59}")) {
      throw badRequest("SKU may contain letters, numbers, dots, underscores, slashes and hyphens.");
    }
    String name = requiredText(request.partName(), "Part name", 200);
    String description = optionalText(request.description(), 1000);
    String unit = request.unitOfMeasure() == null
        ? "EACH" : request.unitOfMeasure().trim().toUpperCase(Locale.ROOT);
    if (!UNITS.contains(unit)) throw badRequest("Choose a supported unit of measure.");

    try {
      UUID publicId = jdbc.queryForObject("""
          insert into spare_part(
            dealership_id, sku_code, part_name, description, unit_of_measure, created_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), sku, name, description, unit, actor.staffUserId());
      Long partId = jdbc.queryForObject(
          "select id from spare_part where dealership_id = ? and public_id = ?",
          Long.class, actor.dealershipId(), publicId);
      jdbc.update("""
          insert into spare_part_balance(dealership_id, part_id)
          values (?, ?)
          """, actor.dealershipId(), partId);
      audit(actor, "SPARE_PART_CREATED", "SPARE_PART", publicId.toString(),
          "Spare-part SKU " + sku + " created with zero opening stock.");
      return getPart(actor, publicId);
    } catch (DuplicateKeyException duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "That SKU already exists in this dealership.", duplicate);
    }
  }

  public Page<SupplierView> listSuppliers(
      StaffPrincipal actor, int requestedPage, int requestedSize, String query, Boolean activeOnly) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    String term = cleanSearch(query);
    String where = " where s.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (activeOnly == null || activeOnly) where += " and s.active = true ";
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      where += " and (lower(s.supplier_code) like ? escape '!' or lower(s.supplier_name) like ? escape '!') ";
      args.add(like);
      args.add(like);
    }
    Long totalValue = jdbc.queryForObject("select count(*) from part_supplier s " + where,
        Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(window.size());
    args.add(window.offset());
    List<SupplierView> items = jdbc.query("""
        select s.public_id, s.supplier_code, s.supplier_name, s.contact_name, s.phone, s.email,
          s.address, s.notes, s.active, s.created_at, s.updated_at
        from part_supplier s
        """ + where + " order by lower(s.supplier_name), s.id limit ? offset ?",
        (rs, rowNum) -> new SupplierView(
            rs.getObject("public_id", UUID.class), rs.getString("supplier_code"), rs.getString("supplier_name"),
            rs.getString("contact_name"), rs.getString("phone"), rs.getString("email"),
            rs.getString("address"), rs.getString("notes"), rs.getBoolean("active"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()),
        args.toArray());
    return new Page<>(items, window.page(), window.size(), total);
  }

  @Transactional
  public SupplierView createSupplier(StaffPrincipal actor, SupplierRequest request) {
    if (request == null) throw badRequest("Supplier details are required.");
    String code = requiredText(request.supplierCode(), "Supplier code", 48).toUpperCase(Locale.ROOT);
    if (!code.matches("[A-Z0-9][A-Z0-9._/-]{0,47}")) {
      throw badRequest("Supplier code contains unsupported characters.");
    }
    String name = requiredText(request.supplierName(), "Supplier name", 180);
    String contact = optionalText(request.contactName(), 160);
    String phone = optionalText(request.phone(), 32);
    String email = optionalText(request.email(), 320);
    String address = optionalText(request.address(), 1000);
    String notes = optionalText(request.notes(), 1000);
    if (phone == null && email == null) throw badRequest("Enter at least a supplier phone number or email address.");
    try {
      UUID publicId = jdbc.queryForObject("""
          insert into part_supplier(
            dealership_id, supplier_code, supplier_name, contact_name, phone, email, address, notes,
            created_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), code, name, contact, phone, email, address, notes,
          actor.staffUserId());
      audit(actor, "PART_SUPPLIER_CREATED", "PART_SUPPLIER", publicId.toString(),
          "Spare-part supplier " + code + " created.");
      return getSupplier(actor, publicId);
    } catch (DuplicateKeyException duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "That supplier code already exists in this dealership.", duplicate);
    }
  }

  public SupplierView getSupplier(StaffPrincipal actor, UUID publicId) {
    List<SupplierView> rows = jdbc.query("""
        select public_id, supplier_code, supplier_name, contact_name, phone, email, address, notes,
          active, created_at, updated_at
        from part_supplier where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> new SupplierView(
            rs.getObject("public_id", UUID.class), rs.getString("supplier_code"), rs.getString("supplier_name"),
            rs.getString("contact_name"), rs.getString("phone"), rs.getString("email"),
            rs.getString("address"), rs.getString("notes"), rs.getBoolean("active"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()),
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Supplier was not found in this dealership.");
    return rows.getFirst();
  }

  @Transactional
  public ReceiptView receiveStock(StaffPrincipal actor, ReceiptRequest request) {
    if (request == null || request.supplierPublicId() == null) throw badRequest("Choose a supplier.");
    if (request.lines() == null || request.lines().isEmpty() || request.lines().size() > 100) {
      throw badRequest("A receipt must contain between 1 and 100 line items.");
    }
    String key = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    String supplierReference = optionalText(request.supplierReference(), 160);
    String notes = optionalText(request.notes(), 1000);
    List<ReceiptLineDraft> lines = normalizeReceiptLines(request.lines());
    Set<UUID> uniqueParts = new HashSet<>();
    for (ReceiptLineDraft line : lines) {
      if (!uniqueParts.add(line.partPublicId())) {
        throw badRequest("A part may appear only once on a receipt. Combine duplicate SKU lines.");
      }
    }
    String fingerprint = receiptFingerprint(request.supplierPublicId(), supplierReference, notes, lines);
    List<Map<String, Object>> existing = jdbc.queryForList("""
        select public_id, request_fingerprint from part_purchase_receipt
        where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), key);
    if (!existing.isEmpty()) {
      Map<String, Object> row = existing.getFirst();
      if (!constantTimeEquals(String.valueOf(row.get("request_fingerprint")), fingerprint)) {
        throw conflict("This receipt idempotency key was used for a different request.");
      }
      return getReceipt(actor, (UUID) row.get("public_id"));
    }

    List<Long> supplierIds = jdbc.query("""
        select id from part_supplier where dealership_id = ? and public_id = ? and active = true
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), request.supplierPublicId());
    if (supplierIds.isEmpty()) throw notFound("Active supplier was not found in this dealership.");

    List<ReceiptLineDraft> lockOrder = lines.stream()
        .sorted(Comparator.comparing(line -> line.partPublicId().toString())).toList();
    Map<UUID, PartLock> lockedParts = new java.util.LinkedHashMap<>();
    for (ReceiptLineDraft line : lockOrder) {
      lockedParts.put(line.partPublicId(), lockPart(actor, line.partPublicId(), true));
    }
    BigDecimal total = BigDecimal.ZERO.setScale(2);
    for (ReceiptLineDraft line : lines) {
      BigDecimal lineTotal = line.quantity().multiply(line.unitCost()).setScale(2, RoundingMode.HALF_UP);
      total = total.add(lineTotal).setScale(2, RoundingMode.HALF_UP);
    }
    ensureMoney(total, "Receipt total");

    String receiptNumber = "PR-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    List<Map<String, Object>> inserted = jdbc.queryForList("""
        insert into part_purchase_receipt(
          dealership_id, receipt_number, supplier_id, supplier_reference, idempotency_key,
          request_fingerprint, total_cost, notes, received_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (dealership_id, idempotency_key) do nothing
        returning id, public_id
        """, actor.dealershipId(), receiptNumber, supplierIds.getFirst(), supplierReference,
        key, fingerprint, total, notes, actor.staffUserId());
    if (inserted.isEmpty()) {
      List<Map<String, Object>> raced = jdbc.queryForList("""
          select public_id, request_fingerprint from part_purchase_receipt
          where dealership_id = ? and idempotency_key = ?
          """, actor.dealershipId(), key);
      if (raced.isEmpty()) throw conflict("Receipt was not recorded. Refresh and retry.");
      Map<String, Object> prior = raced.getFirst();
      if (!constantTimeEquals(String.valueOf(prior.get("request_fingerprint")), fingerprint)) {
        throw conflict("This receipt idempotency key was concurrently used for a different request.");
      }
      return getReceipt(actor, (UUID) prior.get("public_id"));
    }
    long receiptId = ((Number) inserted.getFirst().get("id")).longValue();
    UUID receiptPublicId = (UUID) inserted.getFirst().get("public_id");

    int lineNumber = 0;
    for (ReceiptLineDraft line : lines) {
      lineNumber++;
      PartLock part = lockedParts.get(line.partPublicId());
      BigDecimal lineTotal = line.quantity().multiply(line.unitCost()).setScale(2, RoundingMode.HALF_UP);
      jdbc.update("""
          insert into part_purchase_receipt_line(
            dealership_id, receipt_id, line_number, part_id, quantity, unit_cost, line_total)
          values (?, ?, ?, ?, ?, ?, ?)
          """, actor.dealershipId(), receiptId, lineNumber, part.id(), line.quantity(), line.unitCost(), lineTotal);

      BigDecimal newOnHand = part.quantityOnHand().add(line.quantity()).setScale(3, RoundingMode.HALF_UP);
      ensureQuantity(newOnHand, "Stock on hand");
      BigDecimal newAverageCost = weightedAverage(part.quantityOnHand(), part.averageUnitCost(),
          line.quantity(), line.unitCost());
      jdbc.update("""
          update spare_part_balance
          set quantity_on_hand = ?, average_unit_cost = ?, updated_at = now()
          where dealership_id = ? and part_id = ?
          """, newOnHand, newAverageCost, actor.dealershipId(), part.id());
      insertMovement(actor, part.id(), "PURCHASE_RECEIPT", line.quantity(), BigDecimal.ZERO,
          newOnHand, part.quantityReserved(), line.unitCost(), "PURCHASE_RECEIPT",
          receiptPublicId.toString(), "RECEIPT:" + receiptPublicId + ":" + lineNumber,
          TokenDigests.sha256(receiptPublicId + "|" + lineNumber + "|" + fingerprint));
      lockedParts.put(line.partPublicId(), new PartLock(
          part.id(), part.publicId(), part.skuCode(), part.partName(), part.unitOfMeasure(),
          part.quantityOnHand().add(line.quantity()), part.quantityReserved(), newAverageCost, part.active()));
    }

    audit(actor, "SPARE_PART_STOCK_RECEIVED", "PART_PURCHASE_RECEIPT", receiptPublicId.toString(),
        "Received " + lines.size() + " spare-part line(s) for total recorded cost " + total + ".");
    return getReceipt(actor, receiptPublicId);
  }

  public ReceiptView getReceipt(StaffPrincipal actor, UUID receiptPublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select receipt.id, receipt.public_id, receipt.receipt_number, receipt.supplier_reference,
          receipt.status, receipt.total_cost, receipt.notes, receipt.received_at,
          supplier.public_id as supplier_public_id, supplier.supplier_code, supplier.supplier_name,
          staff.full_name as received_by_name
        from part_purchase_receipt receipt
        join part_supplier supplier on supplier.dealership_id = receipt.dealership_id and supplier.id = receipt.supplier_id
        join staff_user staff on staff.dealership_id = receipt.dealership_id and staff.id = receipt.received_by_staff_user_id
        where receipt.dealership_id = ? and receipt.public_id = ?
        """, actor.dealershipId(), receiptPublicId);
    if (rows.isEmpty()) throw notFound("Spare-part purchase receipt was not found.");
    Map<String, Object> row = rows.getFirst();
    long receiptId = number(row.get("id"));
    List<ReceiptLineView> lines = jdbc.query("""
        select line.line_number, part.public_id as part_public_id, part.sku_code, part.part_name,
          part.unit_of_measure, line.quantity, line.unit_cost, line.line_total
        from part_purchase_receipt_line line
        join spare_part part on part.dealership_id = line.dealership_id and part.id = line.part_id
        where line.dealership_id = ? and line.receipt_id = ?
        order by line.line_number
        """, (rs, rowNum) -> new ReceiptLineView(
            rs.getInt("line_number"), rs.getObject("part_public_id", UUID.class),
            rs.getString("sku_code"), rs.getString("part_name"), rs.getString("unit_of_measure"),
            rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_cost"), rs.getBigDecimal("line_total")),
        actor.dealershipId(), receiptId);
    return new ReceiptView((UUID) row.get("public_id"), String.valueOf(row.get("receipt_number")),
        (UUID) row.get("supplier_public_id"), String.valueOf(row.get("supplier_code")),
        String.valueOf(row.get("supplier_name")), (String) row.get("supplier_reference"),
        String.valueOf(row.get("status")), (BigDecimal) row.get("total_cost"), (String) row.get("notes"),
        String.valueOf(row.get("received_by_name")), ((Timestamp) row.get("received_at")).toInstant(), lines);
  }

  public Page<ReceiptSummaryView> listReceipts(
      StaffPrincipal actor, int requestedPage, int requestedSize) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    Long totalValue = jdbc.queryForObject("""
        select count(*) from part_purchase_receipt where dealership_id = ?
        """, Long.class, actor.dealershipId());
    long total = totalValue == null ? 0 : totalValue;
    List<ReceiptSummaryView> items = jdbc.query("""
        select receipt.public_id, receipt.receipt_number, supplier.supplier_name,
          receipt.supplier_reference, receipt.status, receipt.total_cost, receipt.received_at,
          staff.full_name as received_by_name
        from part_purchase_receipt receipt
        join part_supplier supplier on supplier.dealership_id = receipt.dealership_id and supplier.id = receipt.supplier_id
        join staff_user staff on staff.dealership_id = receipt.dealership_id and staff.id = receipt.received_by_staff_user_id
        where receipt.dealership_id = ?
        order by receipt.received_at desc, receipt.id desc limit ? offset ?
        """, (rs, rowNum) -> new ReceiptSummaryView(
            rs.getObject("public_id", UUID.class), rs.getString("receipt_number"),
            rs.getString("supplier_name"), rs.getString("supplier_reference"), rs.getString("status"),
            rs.getBigDecimal("total_cost"), rs.getTimestamp("received_at").toInstant(),
            rs.getString("received_by_name")), actor.dealershipId(), window.size(), window.offset());
    return new Page<>(items, window.page(), window.size(), total);
  }

  public List<JobCardOption> listJobCardOptions(StaffPrincipal actor, String query) {
    String term = cleanSearch(query);
    String where = " where job.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      where += """
          and (
            lower(job.job_card_code) like ? escape '!'
            or lower(customer.full_name) like ? escape '!'
            or lower(model.model_name) like ? escape '!'
            or lower(vehicle.chassis_number) like ? escape '!'
          )
          """;
      args.add(like);
      args.add(like);
      args.add(like);
      args.add(like);
    }
    args.add(100);
    return jdbc.query("""
        select job.public_id, job.job_card_code, job.status, customer.full_name as customer_name,
          model.model_name, model.variant_name, vehicle.chassis_number
        from service_job_card job
        join customer on customer.dealership_id = job.dealership_id and customer.id = job.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = job.dealership_id and vehicle.id = job.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        """ + where + " order by job.updated_at desc, job.id desc limit ?",
        (rs, rowNum) -> new JobCardOption(
            rs.getObject("public_id", UUID.class), rs.getString("job_card_code"), rs.getString("status"),
            rs.getString("customer_name"), rs.getString("model_name"), rs.getString("variant_name"),
            rs.getString("chassis_number")), args.toArray());
  }

  public List<ReservationView> listReservations(StaffPrincipal actor, UUID jobCardPublicId) {
    long jobCardId = requireJobCard(actor, jobCardPublicId, false).id();
    List<UUID> ids = jdbc.query("""
        select public_id from service_job_part_reservation
        where dealership_id = ? and job_card_id = ?
        order by created_at desc, id desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), jobCardId);
    return ids.stream().map(id -> getReservation(actor, id)).toList();
  }

  @Transactional
  public ReservationView reservePart(
      StaffPrincipal actor, UUID jobCardPublicId, ReservationRequest request) {
    if (request == null || request.partPublicId() == null) throw badRequest("Choose a spare part.");
    BigDecimal quantity = normalizeQuantity(request.quantity(), "Reservation quantity");
    String key = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    String notes = optionalText(request.notes(), 1000);
    String fingerprint = TokenDigests.sha256(
        "RESERVE|" + jobCardPublicId + "|" + request.partPublicId() + "|" + quantity.toPlainString()
            + "|" + (notes == null ? "" : notes));
    UUID replay = existingOperation(actor, key, fingerprint, "RESERVE");
    if (replay != null) return getReservation(actor, replay);

    JobLock job = requireJobCard(actor, jobCardPublicId, true);
    PartLock part = lockPart(actor, request.partPublicId(), true);
    UUID replayAfterLock = claimOperation(actor, key, fingerprint, "RESERVE");
    if (replayAfterLock != null) return getReservation(actor, replayAfterLock);
    if (!Set.of("APPROVED", "IN_PROGRESS").contains(job.status())) {
      throw conflict("Parts can only be reserved after estimate approval and before workshop closure.");
    }
    if (!part.active()) throw conflict("Inactive spare parts cannot be reserved.");
    BigDecimal available = part.quantityOnHand().subtract(part.quantityReserved());
    if (quantity.compareTo(available) > 0) {
      throw conflict("Only " + available.toPlainString() + " " + part.unitOfMeasure()
          + " is available; this reservation requests " + quantity.toPlainString() + ".");
    }

    String reservationCode = "SPR-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID reservationPublicId;
    try {
      reservationPublicId = jdbc.queryForObject("""
          insert into service_job_part_reservation(
            dealership_id, reservation_code, job_card_id, part_id, quantity_reserved,
            unit_cost_snapshot, status, idempotency_key, request_fingerprint, notes, reserved_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), reservationCode, job.id(), part.id(), quantity,
          part.averageUnitCost(), key, fingerprint, notes, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      throw conflict("Reservation key was used concurrently. Refresh and retry.");
    }
    BigDecimal newReserved = part.quantityReserved().add(quantity).setScale(3, RoundingMode.HALF_UP);
    jdbc.update("""
        update spare_part_balance set quantity_reserved = ?, updated_at = now()
        where dealership_id = ? and part_id = ? and quantity_on_hand - quantity_reserved >= ?
        """, newReserved, actor.dealershipId(), part.id(), quantity);
    insertMovement(actor, part.id(), "RESERVATION_CREATED", BigDecimal.ZERO, quantity,
        part.quantityOnHand(), newReserved, part.averageUnitCost(), "JOB_PART_RESERVATION",
        reservationPublicId.toString(), "RESERVATION:" + reservationPublicId, fingerprint);
    completeOperation(actor, key, reservationPublicId);
    audit(actor, "SPARE_PART_RESERVED", "SERVICE_JOB_PART_RESERVATION", reservationPublicId.toString(),
        "Reserved " + quantity.toPlainString() + " " + part.unitOfMeasure() + " of SKU " + part.skuCode()
            + " for job card " + job.jobCardCode() + ".");
    return getReservation(actor, reservationPublicId);
  }

  @Transactional
  public ReservationView issuePart(
      StaffPrincipal actor, UUID reservationPublicId, QuantityOperationRequest request) {
    if (request == null) throw badRequest("Issue details are required.");
    BigDecimal quantity = normalizeQuantity(request.quantity(), "Issue quantity");
    String key = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    String notes = optionalText(request.notes(), 1000);
    String fingerprint = TokenDigests.sha256("ISSUE|" + reservationPublicId + "|" + quantity.toPlainString()
        + "|" + (notes == null ? "" : notes));
    UUID replay = existingOperation(actor, key, fingerprint, "ISSUE");
    if (replay != null) return getReservation(actor, replay);

    ReservationLock reservation = findReservationLockData(actor, reservationPublicId);
    JobLock job = requireJobCardById(actor, reservation.jobCardId(), true);
    ReservationLock locked = lockReservation(actor, reservationPublicId);
    UUID replayAfterLock = claimOperation(actor, key, fingerprint, "ISSUE");
    if (replayAfterLock != null) return getReservation(actor, replayAfterLock);
    requireWorkInProgress(job);
    requireApprovedEstimateSnapshot(actor, locked);
    if (!Set.of("OPEN", "PARTIALLY_ISSUED").contains(locked.status())) {
      throw conflict("Only an open reservation with unissued quantity can be issued.");
    }
    BigDecimal remaining = locked.quantityReserved().subtract(locked.quantityIssued()).subtract(locked.quantityReleased());
    if (quantity.compareTo(remaining) > 0) {
      throw conflict("The reservation has only " + remaining.toPlainString() + " unit(s) left to issue.");
    }
    PartLock part = lockPart(actor, locked.partPublicId(), true);
    if (part.quantityOnHand().compareTo(quantity) < 0 || part.quantityReserved().compareTo(quantity) < 0) {
      throw conflict("Stock balance no longer covers this reservation. Refresh the job card.");
    }
    BigDecimal newOnHand = part.quantityOnHand().subtract(quantity).setScale(3, RoundingMode.HALF_UP);
    BigDecimal newReserved = part.quantityReserved().subtract(quantity).setScale(3, RoundingMode.HALF_UP);
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = ?, quantity_reserved = ?, updated_at = now()
        where dealership_id = ? and part_id = ?
        """, newOnHand, newReserved, actor.dealershipId(), part.id());
    BigDecimal newIssued = locked.quantityIssued().add(quantity).setScale(3, RoundingMode.HALF_UP);
    String nextStatus = newIssued.compareTo(locked.quantityReserved()) == 0 ? "ISSUED" : "PARTIALLY_ISSUED";
    jdbc.update("""
        update service_job_part_reservation
        set quantity_issued = ?, status = ?, updated_at = now()
        where dealership_id = ? and id = ?
        """, newIssued, nextStatus, actor.dealershipId(), locked.id());
    insertMovement(actor, part.id(), "ISSUED_TO_JOB", quantity.negate(), quantity.negate(),
        newOnHand, newReserved, locked.unitCostSnapshot(), "JOB_PART_RESERVATION",
        reservationPublicId.toString(), "ISSUE:" + UUID.randomUUID(), fingerprint);
    completeOperation(actor, key, reservationPublicId);
    audit(actor, "SPARE_PART_ISSUED_TO_JOB", "SERVICE_JOB_PART_RESERVATION", reservationPublicId.toString(),
        "Issued " + quantity.toPlainString() + " " + part.unitOfMeasure() + " of SKU " + part.skuCode()
            + " to job card " + job.jobCardCode() + ".");
    return getReservation(actor, reservationPublicId);
  }

  @Transactional
  public ReservationView returnPart(
      StaffPrincipal actor, UUID reservationPublicId, QuantityOperationRequest request) {
    if (request == null) throw badRequest("Return details are required.");
    BigDecimal quantity = normalizeQuantity(request.quantity(), "Return quantity");
    String key = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    String notes = optionalText(request.notes(), 1000);
    String fingerprint = TokenDigests.sha256("RETURN|" + reservationPublicId + "|" + quantity.toPlainString()
        + "|" + (notes == null ? "" : notes));
    UUID replay = existingOperation(actor, key, fingerprint, "RETURN");
    if (replay != null) return getReservation(actor, replay);

    ReservationLock reservation = findReservationLockData(actor, reservationPublicId);
    JobLock job = requireJobCardById(actor, reservation.jobCardId(), true);
    ReservationLock locked = lockReservation(actor, reservationPublicId);
    UUID replayAfterLock = claimOperation(actor, key, fingerprint, "RETURN");
    if (replayAfterLock != null) return getReservation(actor, replayAfterLock);
    requireWorkInProgress(job);
    BigDecimal eligible = locked.quantityIssued().subtract(locked.quantityReturned());
    if (quantity.compareTo(eligible) > 0 || eligible.signum() <= 0) {
      throw conflict("Return quantity exceeds the issued amount not already returned (" + eligible.toPlainString() + ").");
    }
    PartLock part = lockPart(actor, locked.partPublicId(), true);
    BigDecimal newOnHand = part.quantityOnHand().add(quantity).setScale(3, RoundingMode.HALF_UP);
    ensureQuantity(newOnHand, "Stock on hand after return");
    BigDecimal newAverageCost = weightedAverage(part.quantityOnHand(), part.averageUnitCost(),
        quantity, locked.unitCostSnapshot());
    jdbc.update("""
        update spare_part_balance set quantity_on_hand = ?, average_unit_cost = ?, updated_at = now()
        where dealership_id = ? and part_id = ?
        """, newOnHand, newAverageCost, actor.dealershipId(), part.id());
    BigDecimal newReturned = locked.quantityReturned().add(quantity).setScale(3, RoundingMode.HALF_UP);
    jdbc.update("""
        update service_job_part_reservation set quantity_returned = ?, updated_at = now()
        where dealership_id = ? and id = ?
        """, newReturned, actor.dealershipId(), locked.id());
    insertMovement(actor, part.id(), "RETURNED_FROM_JOB", quantity, BigDecimal.ZERO,
        newOnHand, part.quantityReserved(), locked.unitCostSnapshot(), "JOB_PART_RESERVATION",
        reservationPublicId.toString(), "RETURN:" + UUID.randomUUID(), fingerprint);
    completeOperation(actor, key, reservationPublicId);
    audit(actor, "SPARE_PART_RETURNED_FROM_JOB", "SERVICE_JOB_PART_RESERVATION", reservationPublicId.toString(),
        "Returned " + quantity.toPlainString() + " " + part.unitOfMeasure() + " of SKU " + part.skuCode()
            + " from job card " + job.jobCardCode() + ". Note: " + (notes == null ? "none" : notes));
    return getReservation(actor, reservationPublicId);
  }

  @Transactional
  public ReservationView releaseReservation(
      StaffPrincipal actor, UUID reservationPublicId, OperationRequest request) {
    if (request == null) throw badRequest("Reservation-release details are required.");
    String key = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    String notes = optionalText(request.notes(), 1000);
    String fingerprint = TokenDigests.sha256("RELEASE|" + reservationPublicId + "|" + (notes == null ? "" : notes));
    UUID replay = existingOperation(actor, key, fingerprint, "RELEASE");
    if (replay != null) return getReservation(actor, replay);

    ReservationLock reservation = findReservationLockData(actor, reservationPublicId);
    JobLock job = requireJobCardById(actor, reservation.jobCardId(), true);
    ReservationLock locked = lockReservation(actor, reservationPublicId);
    UUID replayAfterLock = claimOperation(actor, key, fingerprint, "RELEASE");
    if (replayAfterLock != null) return getReservation(actor, replayAfterLock);
    if (!Set.of("APPROVED", "IN_PROGRESS").contains(job.status())) {
      throw conflict("Unused reservations can only be released before workshop closure.");
    }
    BigDecimal remaining = locked.quantityReserved()
        .subtract(locked.quantityIssued()).subtract(locked.quantityReleased());
    if (remaining.signum() <= 0 || !Set.of("OPEN", "PARTIALLY_ISSUED").contains(locked.status())) {
      throw conflict("This reservation has no unissued quantity to release.");
    }
    PartLock part = lockPart(actor, locked.partPublicId(), true);
    if (part.quantityReserved().compareTo(remaining) < 0) {
      throw conflict("Reserved-stock balance is inconsistent. Refresh and contact the administrator.");
    }
    BigDecimal newReserved = part.quantityReserved().subtract(remaining).setScale(3, RoundingMode.HALF_UP);
    jdbc.update("""
        update spare_part_balance set quantity_reserved = ?, updated_at = now()
        where dealership_id = ? and part_id = ?
        """, newReserved, actor.dealershipId(), part.id());
    String nextStatus = locked.quantityIssued().signum() == 0 ? "CANCELLED" : "PARTIALLY_CANCELLED";
    BigDecimal releasedTotal = locked.quantityReleased().add(remaining).setScale(3, RoundingMode.HALF_UP);
    jdbc.update("""
        update service_job_part_reservation
        set quantity_released = ?, status = ?, updated_at = now()
        where dealership_id = ? and id = ?
        """, releasedTotal, nextStatus, actor.dealershipId(), locked.id());
    insertMovement(actor, part.id(), "RESERVATION_RELEASED", BigDecimal.ZERO, remaining.negate(),
        part.quantityOnHand(), newReserved, locked.unitCostSnapshot(), "JOB_PART_RESERVATION",
        reservationPublicId.toString(), "RELEASE:" + UUID.randomUUID(), fingerprint);
    completeOperation(actor, key, reservationPublicId);
    audit(actor, "SPARE_PART_RESERVATION_RELEASED", "SERVICE_JOB_PART_RESERVATION", reservationPublicId.toString(),
        "Released " + remaining.toPlainString() + " unissued unit(s) from reservation. "
            + (notes == null ? "" : notes));
    return getReservation(actor, reservationPublicId);
  }

  public ReservationView getReservation(StaffPrincipal actor, UUID reservationPublicId) {
    List<ReservationView> rows = jdbc.query("""
        select reservation.public_id, reservation.reservation_code, job.public_id as job_public_id,
          job.job_card_code, part.public_id as part_public_id, part.sku_code, part.part_name,
          part.unit_of_measure, reservation.quantity_reserved, reservation.quantity_issued,
          reservation.quantity_returned, reservation.quantity_released, reservation.unit_cost_snapshot, reservation.status,
          reservation.notes, staff.full_name as reserved_by_name, reservation.created_at, reservation.updated_at
        from service_job_part_reservation reservation
        join service_job_card job on job.dealership_id = reservation.dealership_id and job.id = reservation.job_card_id
        join spare_part part on part.dealership_id = reservation.dealership_id and part.id = reservation.part_id
        join staff_user staff on staff.dealership_id = reservation.dealership_id
          and staff.id = reservation.reserved_by_staff_user_id
        where reservation.dealership_id = ? and reservation.public_id = ?
        """, (rs, rowNum) -> {
      BigDecimal reserved = rs.getBigDecimal("quantity_reserved");
      BigDecimal issued = rs.getBigDecimal("quantity_issued");
      BigDecimal released = rs.getBigDecimal("quantity_released");
      return new ReservationView(
          rs.getObject("public_id", UUID.class), rs.getString("reservation_code"),
          rs.getObject("job_public_id", UUID.class), rs.getString("job_card_code"),
          rs.getObject("part_public_id", UUID.class), rs.getString("sku_code"), rs.getString("part_name"),
          rs.getString("unit_of_measure"), reserved, issued, rs.getBigDecimal("quantity_returned"), released,
          reserved.subtract(issued).subtract(released).max(BigDecimal.ZERO), rs.getBigDecimal("unit_cost_snapshot"),
          rs.getString("status"), rs.getString("notes"), rs.getString("reserved_by_name"),
          rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }, actor.dealershipId(), reservationPublicId);
    if (rows.isEmpty()) throw notFound("Job-card part reservation was not found.");
    return rows.getFirst();
  }

  public Page<StockMovementView> listMovements(
      StaffPrincipal actor, UUID partPublicId, int requestedPage, int requestedSize) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    PartLock part = lockPart(actor, partPublicId, false);
    Long totalValue = jdbc.queryForObject("""
        select count(*) from spare_part_stock_movement
        where dealership_id = ? and part_id = ?
        """, Long.class, actor.dealershipId(), part.id());
    long total = totalValue == null ? 0 : totalValue;
    List<StockMovementView> items = jdbc.query("""
        select movement.public_id, movement.movement_type, movement.quantity_delta,
          movement.reserved_delta, movement.quantity_on_hand_after, movement.quantity_reserved_after,
          movement.unit_cost, movement.reference_type, movement.reference_id, movement.operation_key,
          movement.created_at, coalesce(staff.full_name, customer.full_name, 'Customer') as actor_name
        from spare_part_stock_movement movement
        left join staff_user staff on staff.dealership_id = movement.dealership_id
          and staff.id = movement.actor_staff_user_id
        left join customer on customer.dealership_id = movement.dealership_id
          and customer.id = movement.actor_customer_id
        where movement.dealership_id = ? and movement.part_id = ?
        order by movement.created_at desc, movement.id desc limit ? offset ?
        """, (rs, rowNum) -> new StockMovementView(
            rs.getObject("public_id", UUID.class), part.publicId(), part.skuCode(), part.partName(),
            rs.getString("movement_type"), rs.getBigDecimal("quantity_delta"), rs.getBigDecimal("reserved_delta"),
            rs.getBigDecimal("quantity_on_hand_after"), rs.getBigDecimal("quantity_reserved_after"),
            rs.getBigDecimal("unit_cost"), rs.getString("reference_type"), rs.getString("reference_id"),
            rs.getString("operation_key"), rs.getString("actor_name"), rs.getTimestamp("created_at").toInstant()),
        actor.dealershipId(), part.id(), window.size(), window.offset());
    return new Page<>(items, window.page(), window.size(), total);
  }

  private List<ReceiptLineDraft> normalizeReceiptLines(List<ReceiptLineRequest> rawLines) {
    List<ReceiptLineDraft> result = new ArrayList<>();
    for (ReceiptLineRequest line : rawLines) {
      if (line == null || line.partPublicId() == null) throw badRequest("Every receipt line must identify a part.");
      BigDecimal quantity = normalizeQuantity(line.quantity(), "Receipt quantity");
      BigDecimal unitCost = normalizeMoney(line.unitCost(), "Unit cost", true);
      result.add(new ReceiptLineDraft(line.partPublicId(), quantity, unitCost));
    }
    return List.copyOf(result);
  }

  private PartLock lockPart(StaffPrincipal actor, UUID publicId, boolean forUpdate) {
    String lockClause = forUpdate ? " for update of b " : "";
    List<PartLock> rows = jdbc.query("""
        select p.id, p.public_id, p.sku_code, p.part_name, p.unit_of_measure, p.active,
          b.quantity_on_hand, b.quantity_reserved, b.average_unit_cost
        from spare_part p
        join spare_part_balance b on b.dealership_id = p.dealership_id and b.part_id = p.id
        where p.dealership_id = ? and p.public_id = ?
        """ + lockClause,
        (rs, rowNum) -> new PartLock(
            rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getString("sku_code"),
            rs.getString("part_name"), rs.getString("unit_of_measure"), rs.getBigDecimal("quantity_on_hand"),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("average_unit_cost"), rs.getBoolean("active")),
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Spare part was not found in this dealership.");
    return rows.getFirst();
  }

  private JobLock requireJobCard(StaffPrincipal actor, UUID publicId, boolean forUpdate) {
    String lockClause = forUpdate ? " for update " : "";
    List<JobLock> rows = jdbc.query("""
        select id, public_id, job_card_code, status from service_job_card
        where dealership_id = ? and public_id = ?
        """ + lockClause,
        (rs, rowNum) -> new JobLock(rs.getLong("id"), rs.getObject("public_id", UUID.class),
            rs.getString("job_card_code"), rs.getString("status")), actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Workshop job card was not found.");
    return rows.getFirst();
  }

  private JobLock requireJobCardById(StaffPrincipal actor, long jobId, boolean forUpdate) {
    String lockClause = forUpdate ? " for update " : "";
    List<JobLock> rows = jdbc.query("""
        select id, public_id, job_card_code, status from service_job_card
        where dealership_id = ? and id = ?
        """ + lockClause,
        (rs, rowNum) -> new JobLock(rs.getLong("id"), rs.getObject("public_id", UUID.class),
            rs.getString("job_card_code"), rs.getString("status")), actor.dealershipId(), jobId);
    if (rows.isEmpty()) throw notFound("Workshop job card was not found.");
    return rows.getFirst();
  }

  private ReservationLock findReservationLockData(StaffPrincipal actor, UUID publicId) {
    List<ReservationLock> rows = queryReservationLock(actor, publicId, false);
    if (rows.isEmpty()) throw notFound("Job-card part reservation was not found.");
    return rows.getFirst();
  }

  private ReservationLock lockReservation(StaffPrincipal actor, UUID publicId) {
    List<ReservationLock> rows = queryReservationLock(actor, publicId, true);
    if (rows.isEmpty()) throw notFound("Job-card part reservation was not found.");
    return rows.getFirst();
  }

  private List<ReservationLock> queryReservationLock(StaffPrincipal actor, UUID publicId, boolean forUpdate) {
    String lockClause = forUpdate ? " for update " : "";
    return jdbc.query("""
        select reservation.id, reservation.public_id, reservation.job_card_id, reservation.part_id,
          part.public_id as part_public_id, reservation.quantity_reserved, reservation.quantity_issued,
          reservation.quantity_returned, reservation.quantity_released, reservation.unit_cost_snapshot, reservation.status
        from service_job_part_reservation reservation
        join spare_part part on part.dealership_id = reservation.dealership_id and part.id = reservation.part_id
        where reservation.dealership_id = ? and reservation.public_id = ?
        """ + lockClause.replace("for update", "for update of reservation"),
        (rs, rowNum) -> new ReservationLock(rs.getLong("id"), rs.getObject("public_id", UUID.class),
            rs.getLong("job_card_id"), rs.getLong("part_id"), rs.getObject("part_public_id", UUID.class),
            rs.getBigDecimal("quantity_reserved"), rs.getBigDecimal("quantity_issued"),
            rs.getBigDecimal("quantity_returned"), rs.getBigDecimal("quantity_released"),
            rs.getBigDecimal("unit_cost_snapshot"), rs.getString("status")),
        actor.dealershipId(), publicId);
  }

  private UUID existingOperation(StaffPrincipal actor, String key, String fingerprint, String type) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select operation_type, request_fingerprint, reservation_public_id
        from spare_part_operation where dealership_id = ? and idempotency_key = ?
        """, actor.dealershipId(), key);
    if (rows.isEmpty()) return null;
    Map<String, Object> row = rows.getFirst();
    if (!type.equals(String.valueOf(row.get("operation_type")))
        || !constantTimeEquals(String.valueOf(row.get("request_fingerprint")), fingerprint)) {
      throw conflict("This spare-part idempotency key was used for a different operation or payload.");
    }
    UUID reservationPublicId = (UUID) row.get("reservation_public_id");
    if (reservationPublicId == null) throw conflict("The prior spare-part operation has no completed reference.");
    return reservationPublicId;
  }

  /** Returns the reservation ID for a replay, or null after claiming a new key. */
  private UUID claimOperation(StaffPrincipal actor, String key, String fingerprint, String type) {
    List<Long> ids = jdbc.query("""
        insert into spare_part_operation(
          dealership_id, idempotency_key, request_fingerprint, operation_type, actor_staff_user_id)
        values (?, ?, ?, ?, ?)
        on conflict (dealership_id, idempotency_key) do nothing
        returning id
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), key, fingerprint, type, actor.staffUserId());
    if (!ids.isEmpty()) return null;
    return existingOperation(actor, key, fingerprint, type);
  }

  private void completeOperation(StaffPrincipal actor, String key, UUID reservationPublicId) {
    int updated = jdbc.update("""
        update spare_part_operation set reservation_public_id = ?
        where dealership_id = ? and idempotency_key = ? and reservation_public_id is null
        """, reservationPublicId, actor.dealershipId(), key);
    if (updated != 1) throw conflict("Spare-part operation could not be committed.");
  }

  private void requireApprovedEstimateSnapshot(StaffPrincipal actor, ReservationLock reservation) {
    BigDecimal plannedQuantity = reservation.quantityReserved()
        .subtract(reservation.quantityReturned()).subtract(reservation.quantityReleased())
        .setScale(3, RoundingMode.HALF_UP);
    Integer approvedLineCount = jdbc.queryForObject("""
        select count(*)
        from service_estimate estimate
        join service_estimate_line line on line.dealership_id = estimate.dealership_id
          and line.estimate_id = estimate.id
        where estimate.dealership_id = ? and estimate.job_card_id = ?
          and estimate.status = 'APPROVED'
          and line.source_reservation_id = ?
          and line.source_quantity_reserved = ?
          and line.source_quantity_returned = ?
          and line.source_quantity_released = ?
          and line.source_unit_cost_snapshot = ?
          and line.quantity = ?
        """, Integer.class, actor.dealershipId(), reservation.jobCardId(), reservation.id(),
        reservation.quantityReserved(), reservation.quantityReturned(), reservation.quantityReleased(),
        reservation.unitCostSnapshot(), plannedQuantity);
    if (approvedLineCount == null || approvedLineCount == 0) {
      throw conflict("This part reservation must be present in a current customer-approved estimate revision before it can be issued. If quantities changed after approval, submit and approve a new revision first.");
    }
  }

  private void requireWorkInProgress(JobLock job) {
    if (!"IN_PROGRESS".equals(job.status())) {
      throw conflict("Parts can only be issued or returned while the workshop job is in progress.");
    }
  }

  private void insertMovement(
      StaffPrincipal actor, long partId, String type, BigDecimal quantityDelta, BigDecimal reservedDelta,
      BigDecimal quantityOnHandAfter, BigDecimal quantityReservedAfter, BigDecimal unitCost,
      String referenceType, String referenceId, String operationKey, String fingerprint) {
    jdbc.update("""
        insert into spare_part_stock_movement(
          dealership_id, part_id, movement_type, quantity_delta, reserved_delta,
          quantity_on_hand_after, quantity_reserved_after, unit_cost,
          reference_type, reference_id, operation_key, request_fingerprint, actor_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), partId, type, quantityDelta, reservedDelta,
        quantityOnHandAfter, quantityReservedAfter, unitCost, referenceType, referenceId,
        operationKey, fingerprint, actor.staffUserId());
  }

  private void audit(StaffPrincipal actor, String action, String entityType, String entityId, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, entityType, entityId, summary);
  }

  private static SparePartView partView(
      UUID publicId, String sku, String name, String description, String unit, boolean active,
      BigDecimal onHand, BigDecimal reserved, BigDecimal averageCost,
      BigDecimal lowStockThreshold, BigDecimal reorderToQuantity, Instant createdAt, Instant updatedAt) {
    return new SparePartView(publicId, sku, name, description, unit, active, onHand, reserved,
        onHand.subtract(reserved).max(BigDecimal.ZERO), averageCost,
        lowStockThreshold, reorderToQuantity, createdAt, updatedAt);
  }

  private static BigDecimal weightedAverage(
      BigDecimal oldQuantity, BigDecimal oldCost, BigDecimal receivedQuantity, BigDecimal receivedCost) {
    BigDecimal totalQuantity = oldQuantity.add(receivedQuantity);
    if (totalQuantity.signum() == 0) return BigDecimal.ZERO.setScale(2);
    return oldQuantity.multiply(oldCost).add(receivedQuantity.multiply(receivedCost))
        .divide(totalQuantity, 2, RoundingMode.HALF_UP);
  }

  private static BigDecimal normalizePolicyQuantity(BigDecimal value, String label) {
    if (value == null || value.signum() < 0) {
      throw badRequest(label + " must be zero or greater.");
    }
    BigDecimal normalized = value.setScale(3, RoundingMode.HALF_UP);
    if (normalized.compareTo(MAX_QUANTITY) > 0) {
      throw badRequest(label + " exceeds the supported quantity range.");
    }
    return normalized;
  }

  private static BigDecimal normalizeQuantity(BigDecimal value, String label) {
    if (value == null || value.signum() <= 0) throw badRequest(label + " must be greater than zero.");
    BigDecimal normalized = value.setScale(3, RoundingMode.HALF_UP);
    if (normalized.signum() <= 0 || normalized.compareTo(MAX_QUANTITY) > 0) {
      throw badRequest(label + " is outside the supported quantity range.");
    }
    return normalized;
  }

  private static BigDecimal normalizeMoney(BigDecimal value, String label, boolean zeroAllowed) {
    if (value == null || value.signum() < 0 || (!zeroAllowed && value.signum() == 0)) {
      throw badRequest(label + (zeroAllowed ? " must be non-negative." : " must be positive."));
    }
    BigDecimal normalized = value.setScale(2, RoundingMode.HALF_UP);
    if (normalized.compareTo(MAX_UNIT_COST) > 0) throw badRequest(label + " exceeds the supported range.");
    return normalized;
  }

  private static void ensureMoney(BigDecimal value, String label) {
    if (value.signum() < 0 || value.compareTo(MAX_UNIT_COST) > 0) {
      throw badRequest(label + " exceeds the supported monetary range.");
    }
  }

  private static void ensureQuantity(BigDecimal value, String label) {
    if (value.signum() < 0 || value.compareTo(MAX_QUANTITY) > 0) {
      throw badRequest(label + " exceeds the supported quantity range.");
    }
  }

  private static String receiptFingerprint(
      UUID supplierPublicId, String supplierReference, String notes, List<ReceiptLineDraft> lines) {
    StringBuilder content = new StringBuilder().append(supplierPublicId).append('|')
        .append(supplierReference == null ? "" : supplierReference).append('|')
        .append(notes == null ? "" : notes);
    for (ReceiptLineDraft line : lines) {
      content.append('|').append(line.partPublicId()).append(':')
          .append(line.quantity().toPlainString()).append(':').append(line.unitCost().toPlainString());
    }
    return TokenDigests.sha256(content.toString());
  }

  private static boolean constantTimeEquals(String first, String second) {
    if (first == null || second == null) return false;
    return MessageDigest.isEqual(first.getBytes(StandardCharsets.UTF_8), second.getBytes(StandardCharsets.UTF_8));
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

  private static String cleanSearch(String raw) {
    if (raw == null || raw.isBlank()) return null;
    String value = raw.trim();
    return value.substring(0, Math.min(100, value.length()));
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  private static PageWindow pageWindow(int requestedPage, int requestedSize) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int size = Math.max(1, Math.min(requestedSize, 100));
    return new PageWindow(page, size, (long) page * size);
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
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

  public record ReorderPolicyRequest(BigDecimal lowStockThreshold, BigDecimal reorderToQuantity) {}
  public record LowStockAlertView(
      UUID publicId, String skuCode, String partName, String unitOfMeasure,
      BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal quantityAvailable,
      BigDecimal lowStockThreshold, BigDecimal reorderToQuantity, BigDecimal suggestedOrderQuantity,
      Instant updatedAt) {}
  public record PartRequest(String skuCode, String partName, String description, String unitOfMeasure) {}
  public record SupplierRequest(
      String supplierCode, String supplierName, String contactName, String phone,
      String email, String address, String notes) {}
  public record ReceiptLineRequest(UUID partPublicId, BigDecimal quantity, BigDecimal unitCost) {}
  public record ReceiptRequest(
      UUID supplierPublicId, String supplierReference, String idempotencyKey, String notes,
      List<ReceiptLineRequest> lines) {}
  public record ReservationRequest(UUID partPublicId, BigDecimal quantity, String idempotencyKey, String notes) {}
  public record QuantityOperationRequest(BigDecimal quantity, String idempotencyKey, String notes) {}
  public record OperationRequest(String idempotencyKey, String notes) {}
  public record SparePartView(
      UUID publicId, String skuCode, String partName, String description, String unitOfMeasure,
      boolean active, BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal quantityAvailable,
      BigDecimal averageUnitCost, BigDecimal lowStockThreshold, BigDecimal reorderToQuantity,
      Instant createdAt, Instant updatedAt) {}
  public record SupplierView(
      UUID publicId, String supplierCode, String supplierName, String contactName, String phone,
      String email, String address, String notes, boolean active, Instant createdAt, Instant updatedAt) {}
  public record ReceiptLineView(
      int lineNumber, UUID partPublicId, String skuCode, String partName, String unitOfMeasure,
      BigDecimal quantity, BigDecimal unitCost, BigDecimal lineTotal) {}
  public record ReceiptView(
      UUID publicId, String receiptNumber, UUID supplierPublicId, String supplierCode, String supplierName,
      String supplierReference, String status, BigDecimal totalCost, String notes, String receivedByName,
      Instant receivedAt, List<ReceiptLineView> lines) {}
  public record ReceiptSummaryView(
      UUID publicId, String receiptNumber, String supplierName, String supplierReference, String status,
      BigDecimal totalCost, Instant receivedAt, String receivedByName) {}
  public record JobCardOption(
      UUID publicId, String jobCardCode, String status, String customerName,
      String modelName, String variantName, String chassisNumber) {}
  public record ReservationView(
      UUID publicId, String reservationCode, UUID jobCardPublicId, String jobCardCode,
      UUID partPublicId, String skuCode, String partName, String unitOfMeasure,
      BigDecimal quantityReserved, BigDecimal quantityIssued, BigDecimal quantityReturned, BigDecimal quantityReleased,
      BigDecimal quantityRemainingToIssue, BigDecimal unitCostSnapshot, String status, String notes,
      String reservedByName, Instant createdAt, Instant updatedAt) {}
  public record StockMovementView(
      UUID publicId, UUID partPublicId, String skuCode, String partName, String movementType,
      BigDecimal quantityDelta, BigDecimal reservedDelta, BigDecimal quantityOnHandAfter,
      BigDecimal quantityReservedAfter, BigDecimal unitCost, String referenceType, String referenceId,
      String operationKey, String actorName, Instant createdAt) {}
  public record Page<T>(List<T> items, int page, int pageSize, long total) {}
  private record PageWindow(int page, int size, long offset) {}
  private record ReceiptLineDraft(UUID partPublicId, BigDecimal quantity, BigDecimal unitCost) {}
  private record PartLock(
      long id, UUID publicId, String skuCode, String partName, String unitOfMeasure,
      BigDecimal quantityOnHand, BigDecimal quantityReserved, BigDecimal averageUnitCost, boolean active) {}
  private record JobLock(long id, UUID publicId, String jobCardCode, String status) {}
  private record ReservationLock(
      long id, UUID publicId, long jobCardId, long partId, UUID partPublicId, BigDecimal quantityReserved,
      BigDecimal quantityIssued, BigDecimal quantityReturned, BigDecimal quantityReleased,
      BigDecimal unitCostSnapshot, String status) {}
}
