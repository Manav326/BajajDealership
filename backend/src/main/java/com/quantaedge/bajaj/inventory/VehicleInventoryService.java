package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
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

/** Dealership-scoped vehicle model and individual-unit inventory. */
@Service
public class VehicleInventoryService {
  private static final List<String> STOCK_STATUSES =
      List.of("EXPECTED", "AVAILABLE", "RESERVED", "SOLD", "RETURNED", "DAMAGED");

  private static final RowMapper<VehicleModelView> MODEL_ROW = (rs, rowNum) -> new VehicleModelView(
      rs.getObject("public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
      rs.getString("variant_name"), rs.getString("colour_name"),
      (Integer) rs.getObject("model_year"), rs.getBoolean("active"),
      rs.getInt("expected_count"), rs.getInt("available_count"),
      rs.getInt("reserved_count"), rs.getInt("sold_count"));

  private static final RowMapper<VehicleUnitView> UNIT_ROW = (rs, rowNum) -> new VehicleUnitView(
      rs.getObject("public_id", UUID.class),
      rs.getObject("model_public_id", UUID.class),
      rs.getString("model_code"),
      rs.getString("model_name"),
      rs.getString("variant_name"),
      rs.getString("colour_name"),
      rs.getString("chassis_number"),
      rs.getString("engine_number"),
      rs.getString("stock_status"),
      rs.getString("supplier_reference"),
      rs.getBigDecimal("purchase_cost"),
      instantOrNull(rs.getTimestamp("received_at")),
      rs.getTimestamp("created_at").toInstant());

  private static final RowMapper<StockMovementView> MOVEMENT_ROW = (rs, rowNum) -> new StockMovementView(
      rs.getObject("public_id", UUID.class),
      rs.getString("from_status"),
      rs.getString("to_status"),
      rs.getString("event_type"),
      rs.getString("reference_type"),
      rs.getString("reference_id"),
      rs.getString("reason"),
      rs.getString("actor_name"),
      rs.getTimestamp("created_at").toInstant());

  private final JdbcTemplate jdbc;

  public VehicleInventoryService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Page<VehicleModelView> listModels(StaffPrincipal principal, int requestedPage, int requestedSize, String query) {
    PageWindow window = window(requestedPage, requestedSize);
    String term = cleanSearch(query);
    String where = " where vm.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(principal.dealershipId());
    if (!term.isEmpty()) {
      where += " and (lower(vm.model_name) like ? escape '!' or lower(vm.model_code) like ? escape '!' "
          + "or lower(coalesce(vm.variant_name, '')) like ? escape '!' or lower(coalesce(vm.colour_name, '')) like ? escape '!') ";
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      args.add(like); args.add(like); args.add(like); args.add(like);
    }
    Long totalValue = jdbc.queryForObject("select count(*) from vehicle_model vm" + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(window.size()); args.add(window.offset());
    List<VehicleModelView> items = jdbc.query("""
        select vm.public_id, vm.model_code, vm.model_name, vm.variant_name, vm.colour_name, vm.model_year, vm.active,
          count(vu.id) filter (where vu.stock_status='EXPECTED')::int as expected_count,
          count(vu.id) filter (where vu.stock_status='AVAILABLE')::int as available_count,
          count(vu.id) filter (where vu.stock_status='RESERVED')::int as reserved_count,
          count(vu.id) filter (where vu.stock_status='SOLD')::int as sold_count
        from vehicle_model vm
        left join vehicle_unit vu on vu.dealership_id = vm.dealership_id and vu.vehicle_model_id = vm.id
        """ + where + """
        group by vm.id
        order by lower(vm.model_name), lower(coalesce(vm.variant_name, '')), lower(coalesce(vm.colour_name, ''))
        limit ? offset ?
        """, MODEL_ROW, args.toArray());
    return new Page<>(items, window.page(), window.size(), total);
  }

  @Transactional
  public VehicleModelView createModel(StaffPrincipal principal, VehicleModelRequest request) {
    String code = required(request.modelCode(), "Model code", 60).toUpperCase(Locale.ROOT);
    String name = required(request.modelName(), "Model name", 160);
    String variant = optional(request.variantName(), 120);
    String colour = optional(request.colourName(), 80);
    Integer modelYear = request.modelYear();
    if (modelYear != null && (modelYear < 1990 || modelYear > 2200)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Model year is outside the supported range.");
    }
    UUID publicId;
    try {
      publicId = jdbc.queryForObject("""
          insert into vehicle_model(
            dealership_id, model_code, model_name, variant_name, colour_name, model_year, active)
          values (?, ?, ?, ?, ?, ?, true)
          returning public_id
          """, UUID.class, principal.dealershipId(), code, name, variant, colour, modelYear);
    } catch (DuplicateKeyException duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "This model/variant/colour/year already exists for the dealership.", duplicate);
    }
    Long modelId = jdbc.queryForObject(
        "select id from vehicle_model where dealership_id = ? and public_id = ?",
        Long.class, principal.dealershipId(), publicId);
    jdbc.update("""
        insert into vehicle_model_change_audit(dealership_id, vehicle_model_id, actor_staff_user_id, action, details)
        values (?, ?, ?, 'MODEL_CREATED', jsonb_build_object('modelCode', ?, 'modelName', ?))
        """, principal.dealershipId(), modelId, principal.staffUserId(), code, name);
    return listModels(principal, 0, 100, code).items().stream()
        .filter(row -> row.publicId().equals(publicId))
        .findFirst()
        .orElseGet(() -> getModel(principal, publicId));
  }

  public VehicleModelView getModel(StaffPrincipal principal, UUID publicId) {
    List<VehicleModelView> rows = jdbc.query("""
        select vm.public_id, vm.model_code, vm.model_name, vm.variant_name, vm.colour_name, vm.model_year, vm.active,
          count(vu.id) filter (where vu.stock_status='EXPECTED')::int as expected_count,
          count(vu.id) filter (where vu.stock_status='AVAILABLE')::int as available_count,
          count(vu.id) filter (where vu.stock_status='RESERVED')::int as reserved_count,
          count(vu.id) filter (where vu.stock_status='SOLD')::int as sold_count
        from vehicle_model vm
        left join vehicle_unit vu on vu.dealership_id = vm.dealership_id and vu.vehicle_model_id = vm.id
        where vm.dealership_id = ? and vm.public_id = ?
        group by vm.id
        """, MODEL_ROW, principal.dealershipId(), publicId);
    if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Vehicle model was not found.");
    return rows.getFirst();
  }

  public Page<VehicleUnitView> listUnits(
      StaffPrincipal principal, int requestedPage, int requestedSize, String status, UUID modelPublicId) {
    PageWindow window = window(requestedPage, requestedSize);
    String normalizedStatus = optional(status, 24);
    if (normalizedStatus != null) {
      normalizedStatus = normalizedStatus.toUpperCase(Locale.ROOT);
      if (!STOCK_STATUSES.contains(normalizedStatus)) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown stock status.");
      }
    }

    String where = " where vu.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(principal.dealershipId());
    if (normalizedStatus != null) {
      where += " and vu.stock_status = ? ";
      args.add(normalizedStatus);
    }
    if (modelPublicId != null) {
      where += " and vm.public_id = ? ";
      args.add(modelPublicId);
    }
    Long totalValue = jdbc.queryForObject("""
        select count(*) from vehicle_unit vu join vehicle_model vm
          on vm.dealership_id = vu.dealership_id and vm.id = vu.vehicle_model_id
        """ + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(window.size()); args.add(window.offset());
    List<VehicleUnitView> items = jdbc.query("""
        select vu.public_id, vm.public_id as model_public_id, vm.model_code, vm.model_name,
          vm.variant_name, vm.colour_name, vu.chassis_number, vu.engine_number, vu.stock_status,
          vu.supplier_reference, vu.purchase_cost, vu.received_at, vu.created_at
        from vehicle_unit vu
        join vehicle_model vm on vm.dealership_id = vu.dealership_id and vm.id = vu.vehicle_model_id
        """ + where + " order by vu.created_at desc, vu.id desc limit ? offset ?",
        UNIT_ROW, args.toArray());
    return new Page<>(items, window.page(), window.size(), total);
  }

  @Transactional
  public VehicleUnitView registerExpectedUnit(StaffPrincipal principal, VehicleUnitRequest request) {
    UUID modelPublicId = request.modelPublicId();
    List<Long> modelIds = jdbc.query("""
        select id from vehicle_model where dealership_id = ? and public_id = ? and active = true
        """, (rs, rowNum) -> rs.getLong(1), principal.dealershipId(), modelPublicId);
    if (modelIds.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active vehicle model was not found.");
    }
    String chassis = required(request.chassisNumber(), "Chassis number", 100).toUpperCase(Locale.ROOT);
    String engine = required(request.engineNumber(), "Engine number", 100).toUpperCase(Locale.ROOT);
    String supplierReference = optional(request.supplierReference(), 120);
    BigDecimal purchaseCost = request.purchaseCost();
    if (purchaseCost != null && purchaseCost.signum() < 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Purchase cost cannot be negative.");
    }

    UUID publicId;
    try {
      publicId = jdbc.queryForObject("""
          insert into vehicle_unit(
            dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status,
            received_at, supplier_reference, purchase_cost)
          values (?, ?, ?, ?, 'EXPECTED', null, ?, ?)
          returning public_id
          """, UUID.class, principal.dealershipId(), modelIds.getFirst(), chassis, engine,
          supplierReference, purchaseCost);
    } catch (DuplicateKeyException duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "A vehicle with this chassis or engine number already exists in this dealership.", duplicate);
    }

    Long unitId = jdbc.queryForObject(
        "select id from vehicle_unit where dealership_id = ? and public_id = ?",
        Long.class, principal.dealershipId(), publicId);
    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, null, 'EXPECTED', 'UNIT_REGISTERED', 'STAFF', ?, ?, 'Vehicle registered as expected stock.')
        """, principal.dealershipId(), unitId, principal.staffPublicId(), principal.staffUserId());
    audit(principal, "VEHICLE_UNIT_EXPECTED", "VEHICLE_UNIT", publicId.toString(),
        "Vehicle unit registered as expected stock.");
    return getUnit(principal, publicId);
  }

  @Transactional
  public VehicleUnitView receiveUnit(StaffPrincipal principal, UUID publicId, String receiptReference, String reason) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, stock_status from vehicle_unit
        where dealership_id = ? and public_id = ?
        for update
        """, principal.dealershipId(), publicId);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Vehicle unit was not found.");
    }
    Map<String, Object> row = rows.getFirst();
    String previousStatus = String.valueOf(row.get("stock_status"));
    if (!"EXPECTED".equals(previousStatus)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "Only expected stock can be received. Current stock status: " + previousStatus + ".");
    }

    String reference = optional(receiptReference, 120);
    String safeReason = optional(reason, 500);
    long unitId = ((Number) row.get("id")).longValue();
    int updated = jdbc.update("""
        update vehicle_unit set stock_status = 'AVAILABLE', received_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and stock_status = 'EXPECTED'
        """, principal.dealershipId(), unitId);
    if (updated != 1) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Vehicle stock changed. Refresh and try again.");
    }
    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, 'EXPECTED', 'AVAILABLE', 'STOCK_RECEIVED', 'RECEIPT', ?, ?, ?)
        """, principal.dealershipId(), unitId, reference, principal.staffUserId(),
        safeReason == null ? "Vehicle received into available stock." : safeReason);
    audit(principal, "VEHICLE_STOCK_RECEIVED", "VEHICLE_UNIT", publicId.toString(),
        "Expected vehicle stock received and made available.");
    return getUnit(principal, publicId);
  }

  public VehicleUnitView getUnit(StaffPrincipal principal, UUID publicId) {
    List<VehicleUnitView> rows = jdbc.query("""
        select vu.public_id, vm.public_id as model_public_id, vm.model_code, vm.model_name,
          vm.variant_name, vm.colour_name, vu.chassis_number, vu.engine_number, vu.stock_status,
          vu.supplier_reference, vu.purchase_cost, vu.received_at, vu.created_at
        from vehicle_unit vu
        join vehicle_model vm on vm.dealership_id = vu.dealership_id and vm.id = vu.vehicle_model_id
        where vu.dealership_id = ? and vu.public_id = ?
        """, UNIT_ROW, principal.dealershipId(), publicId);
    if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Vehicle unit was not found.");
    return rows.getFirst();
  }

  public List<StockMovementView> movements(StaffPrincipal principal, UUID unitPublicId) {
    List<Long> unitIds = jdbc.query("""
        select id from vehicle_unit where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), principal.dealershipId(), unitPublicId);
    if (unitIds.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Vehicle unit was not found.");
    return jdbc.query("""
        select m.public_id, m.from_status, m.to_status, m.event_type, m.reference_type,
          m.reference_id, m.reason, u.full_name as actor_name, m.created_at
        from vehicle_stock_movement m
        left join staff_user u on u.dealership_id = m.dealership_id and u.id = m.actor_staff_user_id
        where m.dealership_id = ? and m.vehicle_unit_id = ?
        order by m.created_at desc, m.id desc
        """, MOVEMENT_ROW, principal.dealershipId(), unitIds.getFirst());
  }

  private void audit(StaffPrincipal principal, String action, String entityType, String entityId, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, principal.dealershipId(), principal.staffUserId(), action, entityType, entityId, summary);
  }

  private static PageWindow window(int requestedPage, int requestedSize) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int size = Math.max(1, Math.min(requestedSize, 100));
    return new PageWindow(page, size, (long) page * size);
  }

  private static String required(String value, String label, int maxLength) {
    String cleaned = optional(value, maxLength);
    if (cleaned == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, label + " is required.");
    }
    return cleaned;
  }

  private static String optional(String value, int maxLength) {
    if (value == null) return null;
    String cleaned = value.trim();
    if (cleaned.isEmpty()) return null;
    if (cleaned.length() > maxLength || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One of the submitted fields is invalid.");
    }
    return cleaned;
  }

  private static String cleanSearch(String value) {
    if (value == null) return "";
    String cleaned = value.trim();
    return cleaned.substring(0, Math.min(cleaned.length(), 100));
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  private static Instant instantOrNull(Timestamp value) {
    return value == null ? null : value.toInstant();
  }

  public record VehicleModelRequest(
      String modelCode, String modelName, String variantName, String colourName, Integer modelYear) {}

  public record VehicleUnitRequest(
      UUID modelPublicId, String chassisNumber, String engineNumber,
      String supplierReference, BigDecimal purchaseCost) {}

  public record VehicleModelView(
      UUID publicId, String modelCode, String modelName, String variantName, String colourName,
      Integer modelYear, boolean active, int expectedCount, int availableCount, int reservedCount, int soldCount) {}

  public record VehicleUnitView(
      UUID publicId, UUID modelPublicId, String modelCode, String modelName, String variantName,
      String colourName, String chassisNumber, String engineNumber, String stockStatus,
      String supplierReference, BigDecimal purchaseCost, Instant receivedAt, Instant createdAt) {}

  public record StockMovementView(
      UUID publicId, String fromStatus, String toStatus, String eventType,
      String referenceType, String referenceId, String reason, String actorName, Instant createdAt) {}

  public record Page<T>(List<T> items, int page, int pageSize, long total) {}
  private record PageWindow(int page, int size, long offset) {}
}
