package com.quantaedge.bajaj.system;

import com.quantaedge.bajaj.security.LicenseAccessException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
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
             dl.grace_period_days, dl.max_staff_seats, dl.max_desktop_devices,
             (select count(*) from dealership_license_device dev
               where dev.dealership_id = d.id and dev.status = 'ACTIVE') as active_desktop_devices,
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
    if (update.maxDesktopDevices() < 1 || update.maxDesktopDevices() > 100) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Desktop device limit must be between 1 and 100.");
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
          grace_period_days, max_staff_seats, max_desktop_devices, last_changed_reason, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
        on conflict (dealership_id) do update set
          plan_code = excluded.plan_code,
          status = excluded.status,
          starts_at = excluded.starts_at,
          expires_at = excluded.expires_at,
          grace_period_days = excluded.grace_period_days,
          max_staff_seats = excluded.max_staff_seats,
          max_desktop_devices = excluded.max_desktop_devices,
          last_changed_reason = excluded.last_changed_reason,
          updated_at = now()
        """,
        dealershipId, planCode, status, startsAt, expiresAt,
        update.gracePeriodDays(), update.maxStaffSeats(), update.maxDesktopDevices(), reason);

    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, reason, details)
        values (?, 'SYSTEM', 'DEALERSHIP_LICENSE_UPDATED', 'DEALERSHIP_LICENSE', ?, ?,
          jsonb_build_object(
            'planCode', ?, 'status', ?, 'startsAt', ?::timestamptz, 'expiresAt', ?::timestamptz,
            'gracePeriodDays', ?, 'maxStaffSeats', ?, 'maxDesktopDevices', ?))
        """,
        dealershipId, code, reason, planCode, status, startsAt, expiresAt,
        update.gracePeriodDays(), update.maxStaffSeats(), update.maxDesktopDevices());

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
    // Use path suffixes so deployments with a servlet context path and MockMvc requests
    // apply the same license/status exemptions.
    String normalizedPath = path == null ? "" : path;
    return (normalizedPath.endsWith("/api/v1/system/license/status") && "GET".equals(verb))
        || (normalizedPath.endsWith("/api/v1/auth/staff/me") && "GET".equals(verb))
        || (normalizedPath.endsWith("/api/v1/auth/staff/logout") && "POST".equals(verb))
        || normalizedPath.contains("/api/v1/system/license/admin/");
  }

  @Transactional
  public String activateDesktopDevice(long dealershipId, String rawInstallationId, String appVersion) {
    String installationId = canonicalInstallationId(rawInstallationId);
    String installationHash = sha256(installationId);
    var limits = jdbc.query(
        "select max_desktop_devices from dealership_license where dealership_id = ? for update",
        (rs, rowNum) -> rs.getInt(1), dealershipId);
    if (limits.isEmpty()) {
      throw new LicenseAccessException(HttpStatus.PAYMENT_REQUIRED, "LICENSE_UNAVAILABLE",
          "This dealership does not have a configured software license. Contact licensing support.");
    }
    LicenseStatus license = statusFor(dealershipId);
    if (List.of("SUSPENDED", "REVOKED", "NOT_YET_ACTIVE", "UNLICENSED").contains(license.state())) {
      throw new LicenseAccessException(HttpStatus.LOCKED, codeFor(license.state()), messageFor(license.state()));
    }
    var existing = jdbc.query("""
        select status from dealership_license_device
        where dealership_id = ? and installation_hash = ? for update
        """, (rs, rowNum) -> rs.getString(1), dealershipId, installationHash);
    if (!existing.isEmpty()) {
      if (!"ACTIVE".equals(existing.getFirst())) {
        throw new LicenseAccessException(HttpStatus.LOCKED, "LICENSE_DEVICE_REVOKED",
            "This desktop installation has been deactivated. Contact the licensing administrator.");
      }
      jdbc.update("""
          update dealership_license_device
          set last_seen_at = now(), app_version = coalesce(nullif(?, ''), app_version), updated_at = now()
          where dealership_id = ? and installation_hash = ? and status = 'ACTIVE'
          """, cleanVersion(appVersion), dealershipId, installationHash);
      return installationHash;
    }
    if ("READ_ONLY".equals(license.state())) {
      throw new LicenseAccessException(HttpStatus.PAYMENT_REQUIRED, "LICENSE_DEVICE_ACTIVATION_READ_ONLY",
          "The license has expired. Existing registered computers remain available in read-only mode, but new computers cannot be activated.");
    }
    Integer activeCount = jdbc.queryForObject("""
        select count(*) from dealership_license_device
        where dealership_id = ? and status = 'ACTIVE'
        """, Integer.class, dealershipId);
    if ((activeCount == null ? 0 : activeCount) >= limits.getFirst()) {
      throw new LicenseAccessException(HttpStatus.PAYMENT_REQUIRED, "LICENSE_DEVICE_LIMIT",
          "The licensed desktop device limit has been reached. Deactivate an unused computer or increase the license limit.");
    }
    jdbc.update("""
        insert into dealership_license_device(
          dealership_id, installation_hash, display_name, app_version, status,
          first_activated_at, last_seen_at, created_at, updated_at)
        values (?, ?, 'Lucky Bajaj Desktop', ?, 'ACTIVE', now(), now(), now(), now())
        """, dealershipId, installationHash, cleanVersion(appVersion));
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, reason, details)
        values (?, 'SYSTEM', 'DEALERSHIP_LICENSE_DEVICE_ACTIVATED',
          'DEALERSHIP_LICENSE_DEVICE', ?, 'Desktop installation registered',
          jsonb_build_object('appVersion', ?))
        """, dealershipId, installationId, cleanVersion(appVersion));
    return installationHash;
  }

  public List<DeviceSummary> listDesktopDevices(String rawDealershipCode) {
    long dealershipId = dealershipIdByCode(rawDealershipCode);
    return jdbc.query("""
        select public_id::text, display_name, app_version, status,
               first_activated_at, last_seen_at, revoked_at, last_changed_reason
        from dealership_license_device
        where dealership_id = ?
        order by case when status = 'ACTIVE' then 0 else 1 end, last_seen_at desc
        """, (rs, rowNum) -> new DeviceSummary(
            rs.getString("public_id"), rs.getString("display_name"), rs.getString("app_version"),
            rs.getString("status"), rs.getTimestamp("first_activated_at").toInstant(),
            rs.getTimestamp("last_seen_at").toInstant(),
            rs.getTimestamp("revoked_at") == null ? null : rs.getTimestamp("revoked_at").toInstant(),
            rs.getString("last_changed_reason")), dealershipId);
  }

  @Transactional
  public List<DeviceSummary> updateDesktopDevice(
      String rawDealershipCode, String rawDevicePublicId, String rawStatus, String rawReason) {
    long dealershipId = dealershipIdByCode(rawDealershipCode);
    UUID publicId;
    try {
      publicId = UUID.fromString(rawDevicePublicId);
    } catch (IllegalArgumentException | NullPointerException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A valid device ID is required.");
    }
    String status = rawStatus == null ? "" : rawStatus.trim().toUpperCase(Locale.ROOT);
    if (!List.of("ACTIVE", "REVOKED").contains(status)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Device status must be ACTIVE or REVOKED.");
    }
    String reason = rawReason == null ? "" : rawReason.trim();
    if (reason.length() < 4 || reason.length() > 500) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide a reason between 4 and 500 characters.");
    }
    var current = jdbc.query("""
        select status from dealership_license_device
        where dealership_id = ? and public_id = ?::uuid for update
        """, (rs, rowNum) -> rs.getString(1), dealershipId, publicId.toString());
    if (current.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Desktop device was not found.");
    }
    String priorStatus = current.getFirst();
    if ("ACTIVE".equals(status) && !"ACTIVE".equals(priorStatus)) {
      var limits = jdbc.query(
          "select max_desktop_devices from dealership_license where dealership_id = ? for update",
          (rs, rowNum) -> rs.getInt(1), dealershipId);
      if (limits.isEmpty()) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "The dealership has no software license.");
      }
      Integer activeCount = jdbc.queryForObject("""
          select count(*) from dealership_license_device
          where dealership_id = ? and status = 'ACTIVE'
          """, Integer.class, dealershipId);
      if ((activeCount == null ? 0 : activeCount) >= limits.getFirst()) {
        throw new LicenseAccessException(HttpStatus.PAYMENT_REQUIRED, "LICENSE_DEVICE_LIMIT",
            "The licensed desktop device limit has been reached. Increase the limit before reactivating this device.");
      }
    }
    jdbc.update("""
        update dealership_license_device
        set status = ?, revoked_at = case when ? = 'REVOKED' then now() else null end,
            last_changed_reason = ?, updated_at = now()
        where dealership_id = ? and public_id = ?::uuid
        """, status, status, reason, dealershipId, publicId.toString());
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, reason, details)
        values (?, 'SYSTEM', 'DEALERSHIP_LICENSE_DEVICE_STATUS_CHANGED',
          'DEALERSHIP_LICENSE_DEVICE', ?, ?,
          jsonb_build_object('priorStatus', ?, 'status', ?))
        """, dealershipId, publicId.toString(), reason, priorStatus, status);
    return listDesktopDevices(rawDealershipCode);
  }

  private long dealershipIdByCode(String rawCode) {
    String code = cleanCode(rawCode);
    var ids = jdbc.query("select id from dealership where upper(code) = ?",
        (rs, rowNum) -> rs.getLong(1), code);
    if (ids.size() != 1) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Dealership was not found.");
    }
    return ids.getFirst();
  }

  private static String canonicalInstallationId(String rawId) {
    if (rawId == null || rawId.isBlank() || rawId.trim().length() > 64) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A valid desktop installation ID is required.");
    }
    try {
      UUID parsed = UUID.fromString(rawId.trim());
      String canonical = parsed.toString();
      if (!canonical.equalsIgnoreCase(rawId.trim())) throw new IllegalArgumentException("Non-canonical UUID");
      return canonical;
    } catch (IllegalArgumentException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The desktop installation ID is invalid.");
    }
  }

  private static String sha256(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is required by the Java runtime.", exception);
    }
  }

  private static String cleanVersion(String version) {
    if (version == null) return "";
    String clean = version.trim();
    return clean.length() <= 40 ? clean : clean.substring(0, 40);
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
    int maxDevices = rs.getInt("max_desktop_devices");
    int activeDevices = rs.getInt("active_desktop_devices");
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
        startsAt, expiresAt, graceEndsAt, graceDays, maxSeats, occupiedSeats, maxDevices, activeDevices,
        Duration.between(now, expiresAt).toDays(), messageFor(state));
  }

  private static LicenseStatus unlicensedStatus(String code, String name) {
    return new LicenseStatus(code, name, null, "UNLICENSED", "UNLICENSED",
        null, null, null, 0, 0, 0, 0, 0, 0,
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
      int maxStaffSeats, int occupiedStaffSeats, int maxDesktopDevices, int activeDesktopDevices,
      long daysUntilExpiry, String message) {}

  public record LicenseUpdate(
      String planCode, String status, Instant startsAt, Instant expiresAt,
      int gracePeriodDays, int maxStaffSeats, int maxDesktopDevices, String reason) {}

  public record LicenseRestriction(int httpStatus, String code, String state, String message) {}

  public record DeviceSummary(String publicId, String displayName, String appVersion, String status,
      Instant firstActivatedAt, Instant lastSeenAt, Instant revokedAt, String lastChangedReason) {}
}
