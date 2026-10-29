package com.quantaedge.bajaj.inventory;

import java.sql.Array;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Public Bajaj catalogue. Retail availability is joined from the dealership's real stock ledger. */
@Service
public class BajajMotorcycleCatalogueService {
  private static final String CATALOGUE_SQL = """
      select c.model_code, c.manufacturer, c.display_name, c.family, c.short_description,
        c.displacement_cc, c.max_power_ps, c.max_torque_nm, c.ex_showroom_price,
        c.price_region, c.price_verified_on, c.official_source_url, c.image_url, c.image_source_url,
        c.terrain_note, c.feature_tags,
        coalesce(stock.inventory_model_count, 0) as inventory_model_count,
        coalesce(stock.available_count, 0) as available_count,
        coalesce(stock.expected_count, 0) as expected_count
      from bajaj_motorcycle_catalog c
      left join lateral (
        select count(distinct vm.id)::int as inventory_model_count,
          count(vu.id) filter (where vu.stock_status = 'AVAILABLE')::int as available_count,
          count(vu.id) filter (where vu.stock_status = 'EXPECTED')::int as expected_count
        from vehicle_model vm
        left join vehicle_unit vu
          on vu.dealership_id = vm.dealership_id and vu.vehicle_model_id = vm.id
        where vm.dealership_id = ? and upper(vm.model_code) = c.model_code
      ) stock on true
      where c.published = true
        and (? = '' or c.family = ?)
        and (? = '' or lower(c.display_name) like ? escape '!' or lower(c.short_description) like ? escape '!')
      order by c.featured desc, c.sort_order, c.display_name
      """;

  private final JdbcTemplate jdbc;

  public BajajMotorcycleCatalogueService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public CatalogueResponse list(String rawDealershipCode, String rawFamily, String rawQuery) {
    Dealer dealer = resolveDealer(rawDealershipCode);
    String family = optional(rawFamily, 24).toUpperCase(Locale.ROOT);
    if (!family.isEmpty() && !List.of("CNG", "SPORT", "TOURING", "CRUISER", "COMMUTER").contains(family)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown motorcycle category.");
    }
    String term = optional(rawQuery, 100).toLowerCase(Locale.ROOT)
        .replace("!", "!!").replace("%", "!%").replace("_", "!_");
    String like = "%" + term + "%";
    Long dealershipId = dealer == null ? null : dealer.id();

    List<Motorcycle> items = jdbc.query(CATALOGUE_SQL, (rs, rowNum) -> {
      int inventoryModels = rs.getInt("inventory_model_count");
      int available = rs.getInt("available_count");
      int expected = rs.getInt("expected_count");
      Array sqlFeatures = rs.getArray("feature_tags");
      List<String> features = List.of();
      if (sqlFeatures != null) {
        Object raw = sqlFeatures.getArray();
        if (raw instanceof String[] values) features = List.copyOf(Arrays.asList(values));
        else if (raw instanceof Object[] values) features = Arrays.stream(values).map(String::valueOf).toList();
        sqlFeatures.free();
      }
      String availability = available > 0 ? "In stock"
          : expected > 0 ? "Incoming stock" : "Ask us to confirm availability";
      return new Motorcycle(
          rs.getString("model_code"), rs.getString("manufacturer"), rs.getString("display_name"),
          rs.getString("family"), rs.getString("short_description"),
          rs.getBigDecimal("displacement_cc"), rs.getBigDecimal("max_power_ps"),
          rs.getBigDecimal("max_torque_nm"), rs.getBigDecimal("ex_showroom_price"),
          rs.getString("price_region"), rs.getDate("price_verified_on").toLocalDate().toString(),
          rs.getString("official_source_url"), rs.getString("image_url"), rs.getString("image_source_url"),
          rs.getString("terrain_note"), features, available, expected, inventoryModels > 0, availability);
    }, dealershipId, family, family, term, like, like);

    return new CatalogueResponse(
        dealer == null ? null : dealer.code(),
        dealer == null ? null : dealer.name(),
        "Bajaj Auto public model listings; prices shown are ex-showroom Delhi references, not an on-road quote.",
        items);
  }

  public Motorcycle detail(String rawDealershipCode, String modelCode) {
    String code = optional(modelCode, 60).toUpperCase(Locale.ROOT);
    if (code.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Model code is required.");
    return list(rawDealershipCode, null, "").items().stream()
        .filter(item -> item.modelCode().equals(code))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Bajaj motorcycle model was not found."));
  }

  private Dealer resolveDealer(String rawCode) {
    String code = optional(rawCode, 40).toUpperCase(Locale.ROOT);
    if (!code.isEmpty()) {
      List<Dealer> matches = jdbc.query("""
          select id, code, name from dealership where code = ? and status = 'ACTIVE'
          """, (rs, rowNum) -> new Dealer(rs.getLong("id"), rs.getString("code"), rs.getString("name")), code);
      if (matches.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "The selected dealership is not available.");
      return matches.getFirst();
    }
    List<Dealer> active = jdbc.query("""
        select id, code, name from dealership where status = 'ACTIVE' order by id
        """, (rs, rowNum) -> new Dealer(rs.getLong("id"), rs.getString("code"), rs.getString("name")));
    if (active.size() > 1) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "A dealershipCode is required when more than one dealership is active.");
    }
    return active.isEmpty() ? null : active.getFirst();
  }

  private static String optional(String value, int maxLength) {
    if (value == null) return "";
    String cleaned = value.trim();
    if (cleaned.length() > maxLength || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One of the requested catalogue filters is invalid.");
    }
    return cleaned;
  }

  public record CatalogueResponse(
      String dealershipCode, String dealershipName, String pricingNotice, List<Motorcycle> items) {}
  public record Motorcycle(
      String modelCode, String manufacturer, String displayName, String family, String description,
      java.math.BigDecimal displacementCc, java.math.BigDecimal maxPowerPs, java.math.BigDecimal maxTorqueNm,
      java.math.BigDecimal exShowroomPrice, String priceRegion, String priceVerifiedOn,
      String officialSourceUrl, String imageUrl, String imageSourceUrl, String terrainNote, List<String> features,
      int availableCount, int expectedCount, boolean inventoryLinked, String availabilityLabel) {}
  private record Dealer(long id, String code, String name) {}
}
