package com.quantaedge.bajaj.system;

import com.quantaedge.bajaj.security.LicenseAccessException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Central license policy. The API, not the website or executable, is the authority. */
@Service
public class DealershipLicenseService {
  private static final String LICENSE_QUERY = """
      select d.id as dealership_id, d.code as dealership_code, d.name as dealership_name,
             dl.plan_code, dl.status as license_status, dl.starts_at, dl.expires_at,
             dl.grace_period_days, dl.max_staff_seats,
             (select count(*) from staff_user su
               where su.dealership_id = d.id and su.status in ('ACTIVE', 'INVITED')) as occupied_staff_seats,
             now() as server_now
      from dealership d
      left join dealership_license dl on dl.dealership_id = d.id
      """;

  private final JdbcTemplate jdbc;
  private final String configuredAdminToken;

  public DealershipLicenseService(
      JdbcTemplate jdbc,
      @Value("$" + "{app.license.admin-token:}") String configuredAdminToken) {
    this.jdbc = jdbc;
    this.configuredAdminToken = configuredAdminToken == null ? "" : configuredAdminToken.trim();
  }

  public LicenseStatus statusFor(long dealershipId) {
    var statuses = jdbc.query(LICENSE_QUERY + " where d.id = ?", this::mapStatus, dealershipId);
    return statuses.isEmpty() ? unlicensedStatus("", "") : statuses.getFirst();
  }

  public List<LicenseStatus> listAll() {
    return jdbc.query(LICENSE_QUERY + " order by d.code", this::mapStatus);
  }

  /** Compare the vendor-only secret in constant time; never store or log the supplied token. */
  public void requireAdminToken(String suppliedToken) {
    if (configuredAdminToken.isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "License administration is not configured on the API service.");
    }
    if (suppliedToken == null || suppliedToken.isBlank()
        || !MessageDigest.isEqual(
            configuredAdminToken.getBytes(StandardCharsets.UTF_8),
            suppliedToken.trim().getBytes(StandardCharsets.UTF_8))) {
      throw new ResponseStatusException(
          HttpStatus.UNAUTHORIZED,
          "A valid license administrator token is required.");
    }
  }

  @Transactional
  public LicenseStatus updateLicense(String rawDealershipCode, LicenseUpdate update) {
    String code = cleanCode(rawDealershipCode);
    if (update.startsAt() == null || update.expiresAt() == null
        || !update.expiresAt().isAfter(update.startsAt())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "The license expiry must be later than its start date.");
    }

    String planCode = update.planCode() == null ? "" : update.planCode().trim().toUpperCase(Locale.ROOT);
    if (!planCode.matches("[A-Z0-9][A-Z0-9_-]{1,79}")) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Plan code must contain 2–80 letters, numbers, dashes or underscores.");
    }
    String status = update.status() == null ? "" : update.status().trim().toUpperCase(Locale.ROOT);
    if (!List.of("ACTIVE", "SUSPENDED", "REVOKED").contains(status)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "License status must be ACTIVE, SUSPENDED or REVOKED.");
    }
    if (update.gracePeriodDays() < 0 || update.gracePeriodDays() > 90) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Grace period must be between 0 and 90 days.");
    }
    if (update.maxStaffSeats() < 1 || update.maxStaffSeats() > 1000) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Staff-seat limit must be between 1 and 1000.");
    }
    String reason = update.reason() == null ? "" : update.reason().trim();
    if (reason.length() < 4 || reason.length() > 500) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Provide a reason between 4 and 500 characters.");
    }

    var dealershipIds = jdbc.query(
        "select id from dealership where upper(code) = ?",
        (rs, rowNum) -> rs.getLong(1),
        code);
    if (dealershipIds.size() != 1) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Dealership was not found.");
    }

    long dealershipId = dealershipIds.getFirst();
    Timestamp startsAt = Timestamp.from(update.startsAt());
    Timestamp expiresAt = Timestamp.from(update.expiresAt());
    jdbc.update("""
        insert into dealership_license(
          dealership_id, plan_code, status, starts_at, expires_at,
          grace_period_days, max_staff_seats, last_changed_reason, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, now(), now())
        on conflict (dealership_id) do update set
          plan_code = excluded.plan_code,
          status = excluded.status,
          starts_at = excluded.starts_at,
          expires_at = excluded.expires_at,
          grace_period_days = excluded.grace_period_days,
          max_staff_seats = excluded.max_staff_seats,
          last_changed_reason = excluded.last_changed_reason,
          updated_at = now()
        """,
        dealershipId, planCode, status, startsAt, expiresAt,
        update.gracePeriodDays(), update.maxStaffSeats(), reason);

    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, reason, details)
        values (?, 'SYSTEM', 'DEALERSHIP_LICENSE_UPDATED', 'DEALERSHIP_LICENSE', ?, ?,
          jsonb_build_object(
            'planCode', ?, 'status', ?, 'startsAt', ?, 'expiresAt', ?,
            'gracePeriodDays', ?, 'maxStaffSeats', ?))
        """,
        dealershipId, code, reason, planCode, status, startsAt, expiresAt,
        update.gracePeriodDays(), update.maxStaffSeats());

    return statusFor(dealershipId);
  }

  /** Reserve a seat under a row lock so concurrent invitations cannot oversubscribe the plan. */
  @Transactional
  public void requireStaffSeatAvailable(long dealershipId) {
    var seatLimits = jdbc.query(
        "select max_staff_seats from dealership_license where dealership_id = ? for update",
        (rs, rowNum) -> rs.getInt(1),
        dealershipId);
    if (seatLimits.isEmpty()) {
      throw new LicenseAccessException(
          HttpStatus.PAYMENT_REQUIRED, "LICENSE_UNAVAILABLE",
          "This dealership does not have a configured software license. Contact licensing support.");
    }

    LicenseStatus license = statusFor(dealershipId);
    if (!List.of("ACTIVE", "GRACE").contains(license.state())) {
      throw new LicenseAccessException(
          HttpStatus.PAYMENT_REQUIRED, codeFor(license.state()), messageFor(license.state()));
    }

    Integer occupied = jdbc.queryForObject("""
        select count(*) from staff_user
        where dealership_id = ? and status in ('ACTIVE', 'INVITED')
        """, Integer.class, dealershipId);
    if ((occupied == null ? 0 : occupied) >= seatLimits.getFirst()) {
      throw new LicenseAccessException(
          HttpStatus.PAYMENT_REQUIRED, "LICENSE_SEAT_LIMIT",
          "The licensed staff-seat limit has been reached. Increase the limit or deactivate an unused staff account.");
    }
  }

  /**
   * Null means allowed. An expired license permits safe reads and exports; suspended,
   * revoked, not-yet-active, or missing licenses allow only status/session recovery.
   */
  public LicenseRestriction restrictionFor(long dealershipId, String method, String path) {
    if (isLicenseOrSessionRecoveryPath(method, path)) return null;

    LicenseStatus license = statusFor(dealershipId);
    String verb = method == null ? "" : method.toUpperCase(Locale.ROOT);
    if ("ACTIVE".equals(license.state()) || "GRACE".equals(license.state())) return null;

    if ("READ_ONLY".equals(license.state())
        && List.of("GET", "HEAD", "OPTIONS").contains(verb)) {
      return null;
    }

    if ("READ_ONLY".equals(license.state())) {
      return new LicenseRestriction(
          HttpStatus.PAYMENT_REQUIRED.value(), "LICENSE_READ_ONLY", license.state(),
          "The dealership license has expired. Existing records and permitted data exports remain available, but changes are disabled.");
    }

    return new LicenseRestriction(
        HttpStatus.LOCKED.value(), codeFor(license.state()), license.state(), messageFor(license.state()));
  }

  private static boolean isLicenseOrSessionRecoveryPath(String method, String path) {
    String verb = method == null ? "" : method.toUpperCase(Locale.ROOT);
    return ("/api/v1/system/license/status".equals(path) && "GET".equals(verb))
        || ("/api/v1/auth/staff/me".equals(path) && "GET".equals(verb))
        || ("/api/v1/auth/staff/logout".equals(path) && "POST".equals(verb))
        || (path != null && path.startsWith("/api/v1/system/license/admin/"));
  }

  private LicenseStatus mapStatus(ResultSet rs, int rowNum) throws SQLException {
    String code = rs.getString("dealership_code");
    String name = rs.getString("dealership_name");
    String rawStatus = rs.getString("license_status");
    if (rawStatus == null) return unlicensedStatus(code, name);

    Instant startsAt = rs.getTimestamp("starts_at").toInstant();
    Instant expiresAt = rs.getTimestamp("expires_at").toInstant();
    Instant now = rs.getTimestamp("server_now").toInstant();
    int graceDays = rs.getInt("grace_period_days");
    int maxSeats = rs.getInt("max_staff_seats");
    int occupiedSeats = rs.getInt("occupied_staff_seats");
    Instant graceEndsAt = expiresAt.plus(Duration.ofDays(graceDays));

    String state;
    if ("SUSPENDED".equals(rawStatus)) state = "SUSPENDED";
    else if ("REVOKED".equals(rawStatus)) state = "REVOKED";
    else if (now.isBefore(startsAt)) state = "NOT_YET_ACTIVE";
    else if (!now.isAfter(expiresAt)) state = "ACTIVE";
    else if (!now.isAfter(graceEndsAt)) state = "GRACE";
    else state = "READ_ONLY";

    return new LicenseStatus(
        code, name, rs.getString("plan_code"), rawStatus, state,
        startsAt, expiresAt, graceEndsAt, graceDays, maxSeats, occupiedSeats,
        Duration.between(now, expiresAt).toDays(), messageFor(state));
  }

  private static LicenseStatus unlicensedStatus(String code, String name) {
    return new LicenseStatus(code, name, null, "UNLICENSED", "UNLICENSED",
        null, null, null, 0, 0, 0, 0,
        "No software license is configured for this dealership. Contact licensing support.");
  }

  private static String cleanCode(String value) {
    if (value == null || value.isBlank() || value.trim().length() > 40) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A valid dealership code is required.");
    }
    return value.trim().toUpperCase(Locale.ROOT);
  }

  private static String codeFor(String state) {
    return switch (state) {
      case "SUSPENDED" -> "LICENSE_SUSPENDED";
      case "REVOKED" -> "LICENSE_REVOKED";
      case "NOT_YET_ACTIVE" -> "LICENSE_NOT_YET_ACTIVE";
      default -> "LICENSE_UNAVAILABLE";
    };
  }

  private static String messageFor(String state) {
    return switch (state) {
      case "ACTIVE" -> "The dealership license is active.";
      case "GRACE" -> "The dealership license is in its renewal grace period. Renew to avoid read-only access.";
      case "READ_ONLY" -> "The dealership license has expired. Existing records and permitted data exports remain available in read-only mode.";
      case "SUSPENDED" -> "The dealership software license is suspended. Contact licensing support.";
      case "REVOKED" -> "The dealership software license has been revoked. Contact licensing support.";
      case "NOT_YET_ACTIVE" -> "The dealership software license has not reached its start date.";
      default -> "No software license is configured for this dealership. Contact licensing support.";
    };
  }

  public record LicenseStatus(
      String dealershipCode, String dealershipName, String planCode, String licenseStatus, String state,
      Instant startsAt, Instant expiresAt, Instant gracePeriodEndsAt, int gracePeriodDays,
      int maxStaffSeats, int occupiedStaffSeats, long daysUntilExpiry, String message) {}

  public record LicenseUpdate(
      String planCode, String status, Instant startsAt, Instant expiresAt,
      int gracePeriodDays, int maxStaffSeats, String reason) {}

  public record LicenseRestriction(int httpStatus, String code, String state, String message) {}
}
