package com.quantaedge.bajaj.catalogue;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Sourced, dealership-maintained location pricing. No default rates are inferred or seeded:
 * a public estimate exists only when a current, explicit model/location profile exists.
 */
@Service
public class BajajOnRoadQuoteService {
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Kolkata");
  private static final LocalDate FAR_FUTURE = LocalDate.of(9999, 12, 31);
  private final JdbcTemplate jdbc;
  private final String configuredPublicDealershipCode;

  public BajajOnRoadQuoteService(
      JdbcTemplate jdbc,
      @Value("${app.dealership.public-code:}") String configuredPublicDealershipCode) {
    this.jdbc = jdbc;
    this.configuredPublicDealershipCode = configuredPublicDealershipCode == null
        ? "" : configuredPublicDealershipCode.trim();
  }

  public List<PriceProfileView> listProfiles(StaffPrincipal actor) {
    return jdbc.query("""
        select public_id, model_code, c.model_name, city, state, effective_from, effective_to,
          ex_showroom_price, registration_fee, road_tax_percent, insurance_fee, handling_fee,
          other_charges, other_charges_label, source_url, price_note, updated_at
        from bajaj_location_price_profile p
        join bajaj_catalogue_model c on c.model_code = p.model_code and c.manufacturer = 'BAJAJ'
        where p.dealership_id = ?
        order by lower(city), lower(state), model_code, effective_from desc, p.id desc
        limit 250
        """, (rs, rowNum) -> new PriceProfileView(
          rs.getObject("public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
          rs.getString("city"), rs.getString("state"), rs.getDate("effective_from").toLocalDate(),
          rs.getDate("effective_to") == null ? null : rs.getDate("effective_to").toLocalDate(),
          rs.getBigDecimal("ex_showroom_price"), rs.getBigDecimal("registration_fee"),
          rs.getBigDecimal("road_tax_percent"), rs.getBigDecimal("insurance_fee"),
          rs.getBigDecimal("handling_fee"), rs.getBigDecimal("other_charges"),
          rs.getString("other_charges_label"), rs.getString("source_url"), rs.getString("price_note"),
          rs.getTimestamp("updated_at").toInstant()), actor.dealershipId());
  }

  @Transactional
  public PriceProfileView saveProfile(StaffPrincipal actor, UUID publicId, PriceProfileRequest request) {
    if (request == null) throw badRequest("Location price profile is required.");
    String modelCode = required(request.modelCode(), "Bajaj model code", 60).toUpperCase(Locale.ROOT);
    String city = required(request.city(), "City", 80);
    String state = required(request.state(), "State", 80);
    LocalDate effectiveFrom = request.effectiveFrom();
    LocalDate effectiveTo = request.effectiveTo();
    if (effectiveFrom == null) throw badRequest("Effective-from date is required.");
    if (effectiveTo != null && effectiveTo.isBefore(effectiveFrom)) {
      throw badRequest("Effective-to date cannot be before the effective-from date.");
    }

    BigDecimal exShowroom = money(request.exShowroomPrice(), "Local ex-showroom price", true);
    BigDecimal registration = money(request.registrationFee(), "Registration fee", false);
    BigDecimal roadTax = request.roadTaxPercent();
    if (roadTax == null || roadTax.signum() < 0 || roadTax.compareTo(new BigDecimal("100")) > 0
        || roadTax.scale() > 4) {
      throw badRequest("Road-tax percentage must be between 0 and 100 with at most four decimal places.");
    }
    roadTax = roadTax.setScale(4, RoundingMode.UNNECESSARY);
    BigDecimal insurance = money(request.insuranceFee(), "Insurance estimate", false);
    BigDecimal handling = money(request.handlingFee(), "Handling fee", false);
    BigDecimal other = money(request.otherCharges(), "Other charges", false);
    String otherLabel = optional(request.otherChargesLabel(), 120);
    if (other.signum() > 0 && otherLabel == null) {
      throw badRequest("Describe other charges when their amount is greater than zero.");
    }
    String source = required(request.sourceUrl(), "Pricing source URL", 1000);
    validateHttpsUrl(source);
    String note = optional(request.priceNote(), 500);
    city = city.replaceAll("\\s+", " ");
    state = state.replaceAll("\\s+", " ");

    // Serialize profile writes per dealership before checking date-range overlap.
    // This prevents two concurrent admin writes from creating ambiguous active profiles.
    List<Long> dealershipRows = jdbc.query("""
        select id from dealership where id = ? for update
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId());
    if (dealershipRows.isEmpty()) throw notFound("Dealership was not found.");

    Integer modelExists = jdbc.queryForObject("""
        select count(*) from bajaj_catalogue_model c
        join bajaj_catalogue_dealership_model d
          on d.model_code = c.model_code and d.dealership_id = ?
        where c.model_code = ? and c.manufacturer = 'BAJAJ' and c.active = true
        """, Integer.class, actor.dealershipId(), modelCode);
    if (modelExists == null || modelExists < 1) {
      throw notFound("Choose an active Bajaj catalogue model configured for this dealership.");
    }

    Integer profileExists = publicId == null ? 0 : jdbc.queryForObject("""
        select count(*) from bajaj_location_price_profile
        where dealership_id = ? and public_id = ?
        """, Integer.class, actor.dealershipId(), publicId);
    if (publicId != null && (profileExists == null || profileExists == 0)) {
      throw notFound("Location price profile was not found in this dealership.");
    }

    Integer overlap = jdbc.queryForObject("""
        select count(*) from bajaj_location_price_profile
        where dealership_id = ? and lower(city) = lower(?) and lower(state) = lower(?)
          and model_code = ?
          and effective_from <= ?
          and coalesce(effective_to, date '9999-12-31') >= ?
          and (?::uuid is null or public_id <> ?::uuid)
        """, Integer.class, actor.dealershipId(), city, state, modelCode,
        effectiveTo == null ? FAR_FUTURE : effectiveTo, effectiveFrom, publicId, publicId);
    if (overlap != null && overlap > 0) {
      throw conflict("This model already has a price profile for an overlapping period in that city and state. Edit that period or choose non-overlapping effective dates.");
    }

    boolean creating = publicId == null;
    if (creating) {
      publicId = jdbc.queryForObject("""
          insert into bajaj_location_price_profile(
            dealership_id, model_code, city, state, effective_from, effective_to,
            ex_showroom_price, registration_fee, road_tax_percent, insurance_fee, handling_fee,
            other_charges, other_charges_label, source_url, price_note,
            created_by_staff_user_id, updated_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), modelCode, city, state, effectiveFrom, effectiveTo,
          exShowroom, registration, roadTax, insurance, handling, other, otherLabel, source, note,
          actor.staffUserId(), actor.staffUserId());
    } else {
      jdbc.update("""
          update bajaj_location_price_profile set
            model_code = ?, city = ?, state = ?, effective_from = ?, effective_to = ?,
            ex_showroom_price = ?, registration_fee = ?, road_tax_percent = ?, insurance_fee = ?,
            handling_fee = ?, other_charges = ?, other_charges_label = ?, source_url = ?,
            price_note = ?, updated_by_staff_user_id = ?, updated_at = now()
          where dealership_id = ? and public_id = ?
          """, modelCode, city, state, effectiveFrom, effectiveTo, exShowroom, registration, roadTax,
          insurance, handling, other, otherLabel, source, note, actor.staffUserId(),
          actor.dealershipId(), publicId);
    }
    audit(actor, publicId, creating ? "LOCATION_PRICE_PROFILE_CREATED" : "LOCATION_PRICE_PROFILE_SAVED",
        city, state, modelCode, effectiveFrom, effectiveTo);
    return findProfile(actor.dealershipId(), publicId);
  }

  public QuoteView quote(String rawModelCode, String rawCity, String rawState) {
    String modelCode = required(rawModelCode, "Bajaj model code", 60).toUpperCase(Locale.ROOT);
    String city = required(rawCity, "City", 80).replaceAll("\\s+", " ");
    String state = required(rawState, "State", 80).replaceAll("\\s+", " ");
    LocalDate today = LocalDate.now(BUSINESS_ZONE);
    DealershipView dealership = resolvePublicDealership();
    if (dealership == null) throw notFound("The public dealership is not configured.");

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select p.public_id, p.model_code, c.model_name, p.city, p.state,
          p.effective_from, p.effective_to, p.ex_showroom_price, p.registration_fee,
          p.road_tax_percent, p.insurance_fee, p.handling_fee, p.other_charges,
          p.other_charges_label, p.source_url, p.price_note
        from bajaj_location_price_profile p
        join bajaj_catalogue_model c on c.model_code = p.model_code
          and c.manufacturer = 'BAJAJ' and c.active = true
        join bajaj_catalogue_dealership_model d on d.dealership_id = p.dealership_id
          and d.model_code = p.model_code and d.is_published = true
        where p.dealership_id = ? and p.model_code = ?
          and lower(p.city) = lower(?) and lower(p.state) = lower(?)
          and p.effective_from <= ? and (p.effective_to is null or p.effective_to >= ?)
        order by p.effective_from desc, p.id desc
        limit 2
        """, dealership.id(), modelCode, city, state, today, today);
    if (rows.isEmpty()) {
      throw notFound("No current, sourced on-road estimate is configured for this Bajaj model and location. Please request a dealer quote.");
    }
    if (rows.size() > 1) {
      throw conflict("More than one current price profile matches this location. The dealership must correct the effective dates before a quote can be shown.");
    }

    Map<String, Object> row = rows.getFirst();
    BigDecimal exShowroom = (BigDecimal) row.get("ex_showroom_price");
    BigDecimal registration = (BigDecimal) row.get("registration_fee");
    BigDecimal roadTaxPercent = (BigDecimal) row.get("road_tax_percent");
    BigDecimal roadTax = exShowroom.multiply(roadTaxPercent).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP);
    BigDecimal insurance = (BigDecimal) row.get("insurance_fee");
    BigDecimal handling = (BigDecimal) row.get("handling_fee");
    BigDecimal other = (BigDecimal) row.get("other_charges");
    String otherLabel = (String) row.get("other_charges_label");
    BigDecimal total = exShowroom.add(registration).add(roadTax).add(insurance).add(handling).add(other)
        .setScale(2, RoundingMode.HALF_UP);
    LocalDate effectiveTo = dateValue(row.get("effective_to"));
    return new QuoteView("ESTIMATE", modelCode, (String) row.get("model_name"),
        (String) row.get("city"), (String) row.get("state"), today,
        dateValue(row.get("effective_from")), effectiveTo,
        List.of(
            new QuoteLine("Local ex-showroom price", exShowroom, "FIXED"),
            new QuoteLine("Registration fee", registration, "FIXED"),
            new QuoteLine("Road tax (" + roadTaxPercent.stripTrailingZeros().toPlainString() + "%)", roadTax, "PERCENT_OF_EX_SHOWROOM"),
            new QuoteLine("Insurance estimate", insurance, "FIXED"),
            new QuoteLine("Handling fee", handling, "FIXED"),
            new QuoteLine(otherLabel == null || other.signum() == 0 ? "Other charges" : otherLabel, other, "FIXED")),
        total, (String) row.get("source_url"), (String) row.get("price_note"),
        "Dealer-maintained estimate, not a guaranteed offer or statutory invoice. Confirm current charges and availability with Lucky Bajaj.");
  }

  private PriceProfileView findProfile(long dealershipId, UUID publicId) {
    List<PriceProfileView> rows = jdbc.query("""
        select p.public_id, p.model_code, c.model_name, p.city, p.state, p.effective_from, p.effective_to,
          p.ex_showroom_price, p.registration_fee, p.road_tax_percent, p.insurance_fee, p.handling_fee,
          p.other_charges, p.other_charges_label, p.source_url, p.price_note, p.updated_at
        from bajaj_location_price_profile p
        join bajaj_catalogue_model c on c.model_code = p.model_code and c.manufacturer = 'BAJAJ'
        where p.dealership_id = ? and p.public_id = ?
        """, (rs, rowNum) -> new PriceProfileView(
          rs.getObject("public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
          rs.getString("city"), rs.getString("state"), rs.getDate("effective_from").toLocalDate(),
          rs.getDate("effective_to") == null ? null : rs.getDate("effective_to").toLocalDate(),
          rs.getBigDecimal("ex_showroom_price"), rs.getBigDecimal("registration_fee"),
          rs.getBigDecimal("road_tax_percent"), rs.getBigDecimal("insurance_fee"),
          rs.getBigDecimal("handling_fee"), rs.getBigDecimal("other_charges"),
          rs.getString("other_charges_label"), rs.getString("source_url"), rs.getString("price_note"),
          rs.getTimestamp("updated_at").toInstant()), dealershipId, publicId);
    if (rows.isEmpty()) throw notFound("Location price profile was not found.");
    return rows.getFirst();
  }

  private DealershipView resolvePublicDealership() {
    List<Map<String, Object>> rows;
    if (!configuredPublicDealershipCode.isBlank()) {
      rows = jdbc.queryForList("""
          select id, code, name from dealership
          where code = ? and status = 'ACTIVE'
          """, configuredPublicDealershipCode.toUpperCase(Locale.ROOT));
      if (rows.isEmpty()) throw notFound("The configured public dealership is not active or does not exist.");
    } else {
      rows = jdbc.queryForList("""
          select id, code, name from dealership where status = 'ACTIVE' order by id limit 2
          """);
      if (rows.size() > 1) {
        throw conflict("Configure app.dealership.public-code before serving public price estimates for multiple dealerships.");
      }
    }
    if (rows.isEmpty()) return null;
    Map<String, Object> row = rows.getFirst();
    return new DealershipView(((Number) row.get("id")).longValue(),
        String.valueOf(row.get("code")), String.valueOf(row.get("name")));
  }

  private void audit(StaffPrincipal actor, UUID publicId, String action, String city, String state,
      String modelCode, LocalDate from, LocalDate to) {
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, 'BAJAJ_LOCATION_PRICE_PROFILE', ?,
          jsonb_build_object('city', ?, 'state', ?, 'modelCode', ?, 'effectiveFrom', ?::text,
            'effectiveTo', ?::text))
        """, actor.dealershipId(), actor.staffUserId(), action, publicId.toString(),
        city, state, modelCode, from.toString(), to == null ? null : to.toString());
  }

  private static LocalDate dateValue(Object value) {
    if (value == null) return null;
    if (value instanceof LocalDate date) return date;
    if (value instanceof java.sql.Date date) return date.toLocalDate();
    throw new IllegalStateException("Unexpected date value returned by the database.");
  }

  private static BigDecimal money(BigDecimal amount, String label, boolean positive) {
    if (amount == null || (positive ? amount.signum() <= 0 : amount.signum() < 0) || amount.scale() > 2) {
      throw badRequest(label + (positive ? " must be positive" : " must be zero or greater")
          + " and have at most two decimal places.");
    }
    return amount.setScale(2, RoundingMode.UNNECESSARY);
  }

  private static String required(String raw, String label, int max) {
    String clean = optional(raw, label, max);
    if (clean == null) throw badRequest(label + " is required.");
    return clean;
  }

  private static String optional(String raw, int max) {
    if (raw == null || raw.isBlank()) return null;
    return required(raw, "Value", max);
  }

  private static String optional(String raw, String label, int max) {
    if (raw == null || raw.isBlank()) return null;
    String clean = raw.trim();
    if (clean.length() > max || clean.chars().anyMatch(Character::isISOControl)) {
      throw badRequest(label + " is invalid.");
    }
    return clean;
  }

  private static void validateHttpsUrl(String raw) {
    try {
      URI uri = URI.create(raw);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
          || uri.getUserInfo() != null) throw new IllegalArgumentException("not a public https URL");
    } catch (IllegalArgumentException invalid) {
      throw badRequest("Pricing source must be a valid HTTPS URL.");
    }
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

  public record PriceProfileRequest(
      String modelCode, String city, String state, LocalDate effectiveFrom, LocalDate effectiveTo,
      BigDecimal exShowroomPrice, BigDecimal registrationFee, BigDecimal roadTaxPercent,
      BigDecimal insuranceFee, BigDecimal handlingFee, BigDecimal otherCharges,
      String otherChargesLabel, String sourceUrl, String priceNote) {}

  public record PriceProfileView(
      UUID publicId, String modelCode, String modelName, String city, String state,
      LocalDate effectiveFrom, LocalDate effectiveTo, BigDecimal exShowroomPrice,
      BigDecimal registrationFee, BigDecimal roadTaxPercent, BigDecimal insuranceFee,
      BigDecimal handlingFee, BigDecimal otherCharges, String otherChargesLabel,
      String sourceUrl, String priceNote, Instant updatedAt) {}

  public record QuoteLine(String label, BigDecimal amount, String calculation) {}

  public record QuoteView(
      String quoteType, String modelCode, String modelName, String city, String state,
      LocalDate calculatedFor, LocalDate effectiveFrom, LocalDate effectiveTo,
      List<QuoteLine> breakdown, BigDecimal estimatedOnRoadTotal,
      String sourceUrl, String note, String disclaimer) {}

  private record DealershipView(long id, String code, String name) {}
}
