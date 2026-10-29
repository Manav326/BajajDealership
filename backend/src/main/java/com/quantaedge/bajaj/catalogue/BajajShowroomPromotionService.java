package com.quantaedge.bajaj.catalogue;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.net.URI;
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
 * Publicly visible promotions are dealer-authored, source-backed announcements.
 * They never modify the displayed price, create a discount, or imply a guaranteed offer.
 */
@Service
public class BajajShowroomPromotionService {
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Kolkata");
  private final JdbcTemplate jdbc;
  private final String configuredPublicDealershipCode;

  public BajajShowroomPromotionService(
      JdbcTemplate jdbc,
      @Value("${app.dealership.public-code:}") String configuredPublicDealershipCode) {
    this.jdbc = jdbc;
    this.configuredPublicDealershipCode = configuredPublicDealershipCode == null
        ? "" : configuredPublicDealershipCode.trim();
  }

  public List<PromotionView> listPublicPromotions() {
    Dealership dealership = resolvePublicDealership();
    if (dealership == null) return List.of();
    LocalDate today = LocalDate.now(BUSINESS_ZONE);
    return jdbc.query("""
        select p.public_id, p.model_code, c.model_name, p.title, p.summary, p.terms,
          p.starts_on, p.ends_on, p.source_url
        from bajaj_showroom_promotion p
        left join bajaj_catalogue_model c on c.model_code = p.model_code and c.manufacturer = 'BAJAJ'
        where p.dealership_id = ? and p.is_published = true
          and p.starts_on <= ? and (p.ends_on is null or p.ends_on >= ?)
          and (p.model_code is null or (c.active = true and c.manufacturer = 'BAJAJ'))
        order by p.starts_on desc, lower(p.title), p.id desc
        limit 50
        """, (rs, rowNum) -> new PromotionView(
          rs.getObject("public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
          rs.getString("title"), rs.getString("summary"), rs.getString("terms"),
          rs.getDate("starts_on").toLocalDate(),
          rs.getDate("ends_on") == null ? null : rs.getDate("ends_on").toLocalDate(),
          rs.getString("source_url"), true,
          "Dealer-authored information only. Verify current availability and final terms with Lucky Bajaj; this announcement does not change catalogue prices automatically."),
        dealership.id());
  }

  public List<PromotionView> listStaffPromotions(StaffPrincipal actor) {
    return jdbc.query("""
        select p.public_id, p.model_code, c.model_name, p.title, p.summary, p.terms,
          p.starts_on, p.ends_on, p.source_url, p.is_published
        from bajaj_showroom_promotion p
        left join bajaj_catalogue_model c on c.model_code = p.model_code and c.manufacturer = 'BAJAJ'
        where p.dealership_id = ?
        order by p.starts_on desc, lower(p.title), p.id desc
        limit 250
        """, (rs, rowNum) -> new PromotionView(
          rs.getObject("public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
          rs.getString("title"), rs.getString("summary"), rs.getString("terms"),
          rs.getDate("starts_on").toLocalDate(),
          rs.getDate("ends_on") == null ? null : rs.getDate("ends_on").toLocalDate(),
          rs.getString("source_url"),
          rs.getBoolean("is_published"),
          "Not an automatic price adjustment; final terms must be confirmed with the dealership."),
        actor.dealershipId());
  }

  @Transactional
  public PromotionView save(StaffPrincipal actor, UUID publicId, PromotionRequest request) {
    if (request == null) throw badRequest("Promotion details are required.");
    String title = required(request.title(), "Promotion title", 120);
    String summary = required(request.summary(), "Promotion summary", 400);
    String terms = optionalMultiline(request.terms(), 2000);
    String modelCode = optional(request.modelCode(), 60);
    if (modelCode != null) modelCode = modelCode.toUpperCase(Locale.ROOT);
    if (request.startsOn() == null) throw badRequest("Promotion start date is required.");
    if (request.endsOn() != null && request.endsOn().isBefore(request.startsOn())) {
      throw badRequest("Promotion end date cannot be before its start date.");
    }
    String sourceUrl = required(request.sourceUrl(), "Promotion source URL", 1000);
    validateHttpsUrl(sourceUrl);

    List<Long> dealershipRows = jdbc.query("""
        select id from dealership where id = ? for update
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId());
    if (dealershipRows.isEmpty()) throw notFound("Dealership was not found.");

    if (modelCode != null) {
      Integer modelExists = jdbc.queryForObject("""
          select count(*) from bajaj_catalogue_model c
          join bajaj_catalogue_dealership_model d
            on d.model_code = c.model_code and d.dealership_id = ?
          where c.model_code = ? and c.manufacturer = 'BAJAJ' and c.active = true
          """, Integer.class, actor.dealershipId(), modelCode);
      if (modelExists == null || modelExists == 0) {
        throw notFound("Choose an active Bajaj catalogue model configured for this dealership.");
      }
    }

    boolean creating = publicId == null;
    if (!creating) {
      Integer exists = jdbc.queryForObject("""
          select count(*) from bajaj_showroom_promotion where dealership_id = ? and public_id = ?
          """, Integer.class, actor.dealershipId(), publicId);
      if (exists == null || exists == 0) throw notFound("Promotion was not found in this dealership.");
    }

    if (creating) {
      publicId = jdbc.queryForObject("""
          insert into bajaj_showroom_promotion(
            dealership_id, model_code, title, summary, terms, starts_on, ends_on, source_url,
            is_published, created_by_staff_user_id, updated_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), modelCode, title, summary, terms,
          request.startsOn(), request.endsOn(), sourceUrl, request.isPublished(),
          actor.staffUserId(), actor.staffUserId());
    } else {
      jdbc.update("""
          update bajaj_showroom_promotion set model_code = ?, title = ?, summary = ?, terms = ?,
            starts_on = ?, ends_on = ?, source_url = ?, is_published = ?,
            updated_by_staff_user_id = ?, updated_at = now()
          where dealership_id = ? and public_id = ?
          """, modelCode, title, summary, terms, request.startsOn(), request.endsOn(),
          sourceUrl, request.isPublished(), actor.staffUserId(), actor.dealershipId(), publicId);
    }

    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, actor_staff_user_id,
          action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, 'BAJAJ_SHOWROOM_PROMOTION', ?,
          jsonb_build_object('title', ?, 'modelCode', ?, 'startsOn', ?::text,
            'endsOn', ?::text, 'published', ?))
        """, actor.dealershipId(), actor.staffUserId(),
        creating ? "SHOWROOM_PROMOTION_CREATED" : "SHOWROOM_PROMOTION_UPDATED",
        publicId.toString(), title, modelCode, request.startsOn().toString(),
        request.endsOn() == null ? null : request.endsOn().toString(), request.isPublished());
    return findPromotion(actor.dealershipId(), publicId);
  }

  private PromotionView findPromotion(long dealershipId, UUID publicId) {
    List<PromotionView> rows = jdbc.query("""
        select p.public_id, p.model_code, c.model_name, p.title, p.summary, p.terms,
          p.starts_on, p.ends_on, p.source_url, p.is_published
        from bajaj_showroom_promotion p
        left join bajaj_catalogue_model c on c.model_code = p.model_code and c.manufacturer = 'BAJAJ'
        where p.dealership_id = ? and p.public_id = ?
        """, (rs, rowNum) -> new PromotionView(
          rs.getObject("public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
          rs.getString("title"), rs.getString("summary"), rs.getString("terms"),
          rs.getDate("starts_on").toLocalDate(),
          rs.getDate("ends_on") == null ? null : rs.getDate("ends_on").toLocalDate(),
          rs.getString("source_url"), rs.getBoolean("is_published"),
          "Not an automatic price adjustment; final terms must be confirmed with the dealership."),
        dealershipId, publicId);
    if (rows.isEmpty()) throw notFound("Promotion was not found.");
    return rows.getFirst();
  }

  private Dealership resolvePublicDealership() {
    List<Map<String, Object>> rows;
    if (!configuredPublicDealershipCode.isBlank()) {
      rows = jdbc.queryForList("select id, code from dealership where code = ? and status = 'ACTIVE'",
          configuredPublicDealershipCode.toUpperCase(Locale.ROOT));
      if (rows.isEmpty()) throw notFound("The configured public dealership is not active or does not exist.");
    } else {
      rows = jdbc.queryForList("select id, code from dealership where status = 'ACTIVE' order by id limit 2");
      if (rows.size() > 1) throw conflict(
          "Configure app.dealership.public-code before serving public promotions for multiple dealerships.");
    }
    if (rows.isEmpty()) return null;
    Map<String, Object> row = rows.getFirst();
    return new Dealership(((Number) row.get("id")).longValue(), String.valueOf(row.get("code")));
  }

  private static String required(String raw, String label, int max) {
    String value = optional(raw, label, max);
    if (value == null) throw badRequest(label + " is required.");
    return value;
  }

  private static String optional(String raw, int max) {
    return optional(raw, "Value", max);
  }

  private static String optionalMultiline(String raw, int max) {
    if (raw == null || raw.isBlank()) return null;
    String value = raw.trim();
    if (value.length() > max || value.chars().anyMatch(ch ->
        Character.isISOControl(ch) && ch != 10 && ch != 13 && ch != 9)) {
      throw badRequest("Promotion terms are invalid.");
    }
    return value;
  }

  private static String optional(String raw, String label, int max) {
    if (raw == null || raw.isBlank()) return null;
    String value = raw.trim();
    if (value.length() > max || value.chars().anyMatch(Character::isISOControl)) {
      throw badRequest(label + " is invalid.");
    }
    return value;
  }

  private static void validateHttpsUrl(String raw) {
    try {
      URI uri = URI.create(raw);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) {
        throw new IllegalArgumentException("A valid HTTPS source is required.");
      }
    } catch (IllegalArgumentException invalid) {
      throw badRequest("Promotion source must be a valid HTTPS URL.");
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

  public record PromotionRequest(
      String modelCode, String title, String summary, String terms,
      LocalDate startsOn, LocalDate endsOn, String sourceUrl, boolean isPublished) {}

  public record PromotionView(
      UUID publicId, String modelCode, String modelName, String title, String summary, String terms,
      LocalDate startsOn, LocalDate endsOn, String sourceUrl, boolean published, String disclaimer) {}

  private record Dealership(long id, String code) {}
}
