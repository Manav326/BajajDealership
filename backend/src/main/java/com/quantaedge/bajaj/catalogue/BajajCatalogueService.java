package com.quantaedge.bajaj.catalogue;

import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Anonymous, read-only Bajaj product catalogue joined to private stock as a safe aggregate. */
@Service
public class BajajCatalogueService {
  private final JdbcTemplate jdbc;
  private final String configuredPublicDealershipCode;

  public BajajCatalogueService(
      JdbcTemplate jdbc,
      @Value("${app.dealership.public-code:}") String configuredPublicDealershipCode) {
    this.jdbc = jdbc;
    this.configuredPublicDealershipCode = configuredPublicDealershipCode == null
        ? "" : configuredPublicDealershipCode.trim();
  }

  private static final RowMapper<BikeView> BIKE_ROW = (rs, rowNum) -> new BikeView(
      rs.getString("manufacturer"),
      rs.getString("model_code"),
      rs.getString("model_name"),
      rs.getString("family"),
      rs.getString("category"),
      rs.getBigDecimal("engine_cc"),
      rs.getString("max_power"),
      rs.getString("max_torque"),
      rs.getString("gearbox"),
      rs.getString("braking"),
      rs.getString("front_suspension"),
      rs.getString("rear_suspension"),
      nullableDecimal(rs, "fuel_tank_l"),
      nullableInteger(rs, "ground_clearance_mm"),
      nullableDecimal(rs, "kerb_weight_kg"),
      rs.getString("ride_character"),
      stringArray(rs, "highlights"),
      rs.getString("hero_image_url"),
      rs.getString("official_model_url"),
      rs.getString("official_specs_url"),
      rs.getBigDecimal("ex_showroom_price"),
      rs.getString("price_city"),
      rs.getString("price_source_url"),
      nullableDate(rs, "price_verified_at"),
      (java.util.UUID) rs.getObject("inventory_model_public_id"),
      rs.getInt("available_units"),
      rs.getInt("expected_units"),
      rs.getInt("reserved_units"));

  public CatalogueView listPublicBikes() {
    DealershipView dealership = resolveDealership();
    Long dealershipId = dealership == null ? null : dealership.id();
    List<BikeView> bikes = jdbc.query("""
        select c.manufacturer, c.model_code, c.model_name, c.family, c.category, c.engine_cc,
          c.max_power, c.max_torque, c.gearbox, c.braking, c.front_suspension, c.rear_suspension,
          c.fuel_tank_l, c.ground_clearance_mm, c.kerb_weight_kg, c.ride_character, c.highlights,
          c.hero_image_url, c.official_model_url, c.official_specs_url, c.ex_showroom_price,
          c.price_city, c.price_source_url, c.price_verified_at,
          inventory.inventory_model_public_id,
          coalesce(inventory.available_units, 0)::int as available_units,
          coalesce(inventory.expected_units, 0)::int as expected_units,
          coalesce(inventory.reserved_units, 0)::int as reserved_units
        from bajaj_catalogue_model c
        left join lateral (
          select (array_agg(vm.public_id order by vm.id))[1] as inventory_model_public_id,
            coalesce(count(distinct vu.id) filter (where vu.stock_status = 'AVAILABLE'), 0)::int as available_units,
            coalesce(count(distinct vu.id) filter (where vu.stock_status = 'EXPECTED'), 0)::int as expected_units,
            coalesce(count(distinct vu.id) filter (where vu.stock_status = 'RESERVED'), 0)::int as reserved_units
          from vehicle_model vm
          left join vehicle_unit vu on vu.dealership_id = vm.dealership_id
            and vu.vehicle_model_id = vm.id
          where vm.dealership_id = ? and vm.model_code = c.model_code and vm.active = true
        ) inventory on true
        where c.active = true and c.manufacturer = 'BAJAJ'
        order by c.featured_rank, lower(c.model_name)
        """, BIKE_ROW, dealershipId);

    return new CatalogueView("BAJAJ",
        dealership == null ? null : dealership.code(),
        dealership == null ? null : dealership.name(),
        "New Delhi",
        LocalDate.now(),
        bikes);
  }

  private DealershipView resolveDealership() {
    List<Map<String, Object>> rows;
    if (!configuredPublicDealershipCode.isBlank()) {
      rows = jdbc.queryForList("""
          select id, code, name from dealership
          where code = ? and status = 'ACTIVE'
          """, configuredPublicDealershipCode.toUpperCase(java.util.Locale.ROOT));
      if (rows.isEmpty()) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND,
            "The configured public dealership is not active or does not exist.");
      }
    } else {
      rows = jdbc.queryForList("""
          select id, code, name from dealership
          where status = 'ACTIVE' order by id limit 2
          """);
      if (rows.size() > 1) {
        throw new ResponseStatusException(HttpStatus.CONFLICT,
            "Configure app.dealership.public-code before serving a public catalogue for multiple dealerships.");
      }
    }
    if (rows.isEmpty()) return null;
    Map<String, Object> row = rows.getFirst();
    return new DealershipView(((Number) row.get("id")).longValue(),
        String.valueOf(row.get("code")), String.valueOf(row.get("name")));
  }

  private static BigDecimal nullableDecimal(ResultSet rs, String column) throws SQLException {
    return (BigDecimal) rs.getObject(column);
  }

  private static Integer nullableInteger(ResultSet rs, String column) throws SQLException {
    return (Integer) rs.getObject(column);
  }

  private static LocalDate nullableDate(ResultSet rs, String column) throws SQLException {
    java.sql.Date value = rs.getDate(column);
    return value == null ? null : value.toLocalDate();
  }

  private static List<String> stringArray(ResultSet rs, String column) throws SQLException {
    Array array = rs.getArray(column);
    if (array == null) return List.of();
    try {
      Object value = array.getArray();
      if (value instanceof Object[] values) {
        return Arrays.stream(values).map(String::valueOf).toList();
      }
      return List.of();
    } finally {
      array.free();
    }
  }

  private record DealershipView(long id, String code, String name) {}

  public record CatalogueView(
      String manufacturer,
      String dealershipCode,
      String dealershipName,
      String priceReferenceCity,
      LocalDate servedAt,
      List<BikeView> bikes) {}

  public record BikeView(
      String manufacturer,
      String modelCode,
      String modelName,
      String family,
      String category,
      BigDecimal engineCc,
      String maxPower,
      String maxTorque,
      String gearbox,
      String braking,
      String frontSuspension,
      String rearSuspension,
      BigDecimal fuelTankLitres,
      Integer groundClearanceMm,
      BigDecimal kerbWeightKg,
      String rideCharacter,
      List<String> highlights,
      String heroImageUrl,
      String officialModelUrl,
      String officialSpecsUrl,
      BigDecimal exShowroomPrice,
      String priceCity,
      String priceSourceUrl,
      LocalDate priceVerifiedAt,
      java.util.UUID inventoryModelPublicId,
      int availableUnits,
      int expectedUnits,
      int reservedUnits) {}
}
