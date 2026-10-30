package com.quantaedge.bajaj.security;

import com.quantaedge.bajaj.system.DealershipLicenseService;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class StaffAuthenticationService {
  private static final int MAX_FAILED_ATTEMPTS = 8;
  private static final Duration ATTEMPT_WINDOW = Duration.ofMinutes(15);
  private static final Duration SESSION_LIFETIME = Duration.ofHours(8);
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final DealershipLicenseService licenses;
  private final SecureRandom secureRandom = new SecureRandom();
  private final String dummyPasswordHash;

  public StaffAuthenticationService(
      JdbcTemplate jdbc, PasswordEncoder passwordEncoder, DealershipLicenseService licenses) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.licenses = licenses;
    this.dummyPasswordHash = passwordEncoder.encode("unused-dummy-password-" + java.util.UUID.randomUUID());
  }

  /**
   * Preserve the service API used by browser clients and existing integration tests.
   * Only the packaged desktop client supplies an installation identity.
   */
  public IssuedSession login(
      String dealershipCode, String loginIdentifier, String password, String remoteAddress, String userAgent) {
    return login(dealershipCode, loginIdentifier, password, remoteAddress, userAgent, null, null);
  }

  public IssuedSession login(
      String dealershipCode, String loginIdentifier, String password, String remoteAddress, String userAgent,
      String desktopInstallationId, String desktopAppVersion) {
    String code = clean(dealershipCode);
    String identifier = clean(loginIdentifier);
    String normalizedLoginKey = (code + ":" + identifier.toLowerCase(java.util.Locale.ROOT));
    String loginKeyHash = TokenDigests.sha256(normalizedLoginKey);
    String remoteHash = TokenDigests.sha256(clean(remoteAddress).isEmpty() ? "unknown-remote" : remoteAddress);

    Integer failedCount = jdbc.queryForObject("""
        select count(*) from auth_login_attempt
        where succeeded = false
          and attempted_at > now() - (? * interval '1 second')
          and (login_key_hash = ? or remote_address_hash = ?)
        """, Integer.class, ATTEMPT_WINDOW.toSeconds(), loginKeyHash, remoteHash);
    if (failedCount != null && failedCount >= MAX_FAILED_ATTEMPTS) {
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
          "Too many sign-in attempts. Try again in 15 minutes.");
    }

    List<Map<String, Object>> candidates = jdbc.queryForList("""
        select u.id, u.public_id::text as public_id, u.dealership_id,
               d.public_id::text as dealership_public_id, d.code as dealership_code,
               u.full_name, u.password_hash
        from staff_user u
        join dealership d on d.id = u.dealership_id
        where upper(d.code) = upper(?) and d.status = 'ACTIVE' and u.status = 'ACTIVE'
          and (lower(u.email) = lower(?) or u.phone = ?)
        limit 2
        """, code, identifier, identifier);

    Map<String, Object> candidate = candidates.size() == 1 ? candidates.getFirst() : null;
    String storedHash = candidate == null ? dummyPasswordHash : String.valueOf(candidate.get("password_hash"));
    boolean passwordMatches = passwordEncoder.matches(password, storedHash);
    if (candidate == null || !passwordMatches) {
      recordAttempt(loginKeyHash, remoteHash, false);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid dealership or sign-in credentials.");
    }

    byte[] tokenBytes = new byte[32];
    secureRandom.nextBytes(tokenBytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
    String tokenHash = TokenDigests.sha256(token);
    Instant now = Instant.now();
    Instant expiresAt = now.plus(SESSION_LIFETIME);
    long staffId = number(candidate.get("id"));
    long dealershipId = number(candidate.get("dealership_id"));
    String desktopInstallationHash = null;
    if (desktopInstallationId != null && !desktopInstallationId.isBlank()) {
      desktopInstallationHash = licenses.activateDesktopDevice(
          dealershipId, desktopInstallationId, desktopAppVersion);
    }

    Long sessionId = jdbc.queryForObject("""
        insert into staff_session(
          dealership_id, staff_user_id, token_hash, issued_at, expires_at, last_seen_at,
          user_agent, remote_address_hash, desktop_installation_hash)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        returning id
        """, Long.class, dealershipId, staffId, tokenHash, Timestamp.from(now),
        Timestamp.from(expiresAt), Timestamp.from(now), truncate(userAgent, 300), remoteHash,
        desktopInstallationHash);
    jdbc.update("update staff_user set last_login_at = now(), updated_at = now() where id = ? and dealership_id = ?",
        staffId, dealershipId);
    recordAttempt(loginKeyHash, remoteHash, true);

    Set<String> roles = new LinkedHashSet<>(jdbc.query("""
        select r.code from staff_user_role ur join role r on r.id = ur.role_id
        where ur.staff_user_id = ? and ur.dealership_id = ? order by r.code
        """, (rs, row) -> rs.getString(1), staffId, dealershipId));
    Set<String> permissions = new LinkedHashSet<>(jdbc.query("""
        select distinct p.code from staff_user_role ur
        join role_permission rp on rp.role_id = ur.role_id
        join permission p on p.id = rp.permission_id
        where ur.staff_user_id = ? and ur.dealership_id = ? order by p.code
        """, (rs, row) -> rs.getString(1), staffId, dealershipId));

    StaffPrincipal principal = new StaffPrincipal(
        sessionId == null ? 0 : sessionId, staffId, String.valueOf(candidate.get("public_id")),
        dealershipId, String.valueOf(candidate.get("dealership_public_id")),
        String.valueOf(candidate.get("dealership_code")), String.valueOf(candidate.get("full_name")),
        Set.copyOf(roles), Set.copyOf(permissions));
    return new IssuedSession(token, expiresAt, principal);
  }

  public void revoke(StaffPrincipal principal) {
    jdbc.update("""
        update staff_session set revoked_at = now()
        where id = ? and staff_user_id = ? and dealership_id = ? and revoked_at is null
        """, principal.sessionId(), principal.staffUserId(), principal.dealershipId());
  }

  private void recordAttempt(String loginHash, String remoteHash, boolean success) {
    jdbc.update("""
        insert into auth_login_attempt(login_key_hash, remote_address_hash, succeeded)
        values (?, ?, ?)
        """, loginHash, remoteHash, success);
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static String clean(String value) {
    return value == null ? "" : value.trim();
  }

  private static String truncate(String value, int length) {
    String cleaned = clean(value);
    return cleaned.length() <= length ? cleaned : cleaned.substring(0, length);
  }

  public record IssuedSession(String accessToken, Instant expiresAt, StaffPrincipal principal) {}
}
