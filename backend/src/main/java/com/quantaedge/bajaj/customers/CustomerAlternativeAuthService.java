package com.quantaedge.bajaj.customers;

import com.quantaedge.bajaj.security.CustomerPortalAttemptRecorder;
import com.quantaedge.bajaj.security.TokenDigests;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Optional customer login paths. Existing token activation and customer-code login remain
 * supported, while usernames and verified Google identities map to the same customer account.
 */
@Service
public class CustomerAlternativeAuthService {
  private static final int MAX_FAILED_ATTEMPTS = 8;
  private static final Duration ATTEMPT_WINDOW = Duration.ofMinutes(15);
  private static final Duration SESSION_LIFETIME = Duration.ofDays(30);

  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final CustomerPortalAttemptRecorder attemptRecorder;
  private final CustomerPortalService portal;
  private final SecureRandom secureRandom = new SecureRandom();
  private final String dummyPasswordHash;

  public CustomerAlternativeAuthService(
      JdbcTemplate jdbc,
      PasswordEncoder passwordEncoder,
      CustomerPortalAttemptRecorder attemptRecorder,
      CustomerPortalService portal) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.attemptRecorder = attemptRecorder;
    this.portal = portal;
    this.dummyPasswordHash = passwordEncoder.encode("customer-alternative-dummy-" + UUID.randomUUID());
  }

  /** Activation remains invitation-backed; username assignment joins the same database transaction. */
  @Transactional
  public CustomerPortalService.PortalSession activateWithUsername(
      String activationToken, String rawUsername, String password, String remoteAddress, String userAgent) {
    String username = normalizeUsername(rawUsername);
    CustomerPortalService.PortalSession session = portal.activate(
        new CustomerPortalService.ActivationRequest(activationToken, password), remoteAddress, userAgent);
    int changed;
    try {
      changed = jdbc.update("""
          update customer_portal_account account
          set username = ?, updated_at = now()
          from customer customer, dealership dealership
          where account.dealership_id = dealership.id
            and account.customer_id = customer.id
            and customer.dealership_id = dealership.id
            and upper(dealership.code) = upper(?)
            and customer.public_id = ?::uuid
            and account.status = 'ACTIVE'
          """, username, session.customer().dealershipCode(), session.customer().publicId());
    } catch (DuplicateKeyException ex) {
      throw conflict("That username is already in use. Choose another username.");
    }
    if (changed != 1) {
      throw conflict("A username could not be assigned to this account. Ask Lucky Bajaj to review the account.");
    }
    Long accountId = jdbc.queryForObject("""
        select account.id
        from customer_portal_account account
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = account.dealership_id
        where upper(dealership.code) = upper(?) and customer.public_id = ?::uuid
        """, Long.class, session.customer().dealershipCode(), session.customer().publicId());
    if (accountId != null) {
      recordActivity(session.customer().dealershipCode(), accountId, "CUSTOMER_USERNAME_SET",
          session.customer().publicId().toString(), "Customer selected a username during invitation activation.");
    }
    return session;
  }

  @Transactional
  public CustomerPortalService.PortalSession loginWithUsername(
      String rawDealershipCode, String rawUsername, String password, String remoteAddress, String userAgent) {
    String dealershipCode = required(rawDealershipCode, "Dealership code", 40).toUpperCase(Locale.ROOT);
    String username = normalizeUsername(rawUsername);
    if (password == null || password.isBlank() || password.length() > 128) {
      throw unauthorized("Invalid customer sign-in details.");
    }
    String loginKeyHash = TokenDigests.sha256(
        "customer-portal-username:" + dealershipCode + ":" + username);
    String remoteHash = remoteHash(remoteAddress);
    checkRateLimit(loginKeyHash, remoteHash);

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select account.id as account_id, account.password_hash, account.status as account_status,
          account.locked_until, customer.status as customer_status, dealership.id as dealership_id,
          dealership.status as dealership_status
        from customer_portal_account account
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = account.dealership_id
        where upper(dealership.code) = ? and lower(account.username) = ?
        limit 2
        """, dealershipCode, username);

    Map<String, Object> candidate = rows.size() == 1 ? rows.getFirst() : null;
    String hash = candidate == null ? dummyPasswordHash : String.valueOf(candidate.get("password_hash"));
    boolean passwordMatches = passwordEncoder.matches(password, hash);
    boolean locked = candidate != null && candidate.get("locked_until") != null
        && ((Timestamp) candidate.get("locked_until")).toInstant().isAfter(Instant.now());
    boolean allowed = candidate != null && "ACTIVE".equals(String.valueOf(candidate.get("account_status")))
        && "ACTIVE".equals(String.valueOf(candidate.get("customer_status")))
        && "ACTIVE".equals(String.valueOf(candidate.get("dealership_status"))) && !locked;
    if (!passwordMatches || !allowed) {
      Long accountId = candidate == null ? null : number(candidate.get("account_id"));
      attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
      throw unauthorized("Invalid customer sign-in details.");
    }

    long dealershipId = number(candidate.get("dealership_id"));
    long accountId = number(candidate.get("account_id"));
    jdbc.update("""
        update customer_portal_account set last_login_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'ACTIVE'
        """, dealershipId, accountId);
    attemptRecorder.record(loginKeyHash, remoteHash, true, accountId);
    recordActivity(dealershipId, accountId, "CUSTOMER_USERNAME_SIGNED_IN",
        customerPublicId(dealershipId, accountId), "Customer signed in with username and password.");
    return createSession(dealershipId, accountId, remoteAddress, userAgent);
  }

  @Transactional
  public CustomerPortalService.PortalSession loginWithGoogle(
      String rawDealershipCode, CustomerGoogleIdentityService.VerifiedIdentity identity,
      String remoteAddress, String userAgent) {
    if (identity == null) throw unauthorized("Google sign-in could not be verified. Please try again.");
    String dealershipCode = required(rawDealershipCode, "Dealership code", 40).toUpperCase(Locale.ROOT);
    String email = required(identity.email(), "Verified Google email", 320).toLowerCase(Locale.ROOT);
    String subject = required(identity.subject(), "Google identity", 255);
    String loginKeyHash = TokenDigests.sha256("customer-portal-google:" + dealershipCode + ":" + email);
    String remoteHash = remoteHash(remoteAddress);
    checkRateLimit(loginKeyHash, remoteHash);

    List<Map<String, Object>> agencies = jdbc.queryForList("""
        select id from dealership where upper(code) = ? and status = 'ACTIVE' limit 2
        """, dealershipCode);
    if (agencies.size() != 1) {
      attemptRecorder.record(loginKeyHash, remoteHash, false, null);
      throw unauthorized("We could not match this Google account to an active dealership.");
    }
    long dealershipId = number(agencies.getFirst().get("id"));

    List<Map<String, Object>> linked = jdbc.queryForList("""
        select account.id as account_id, account.status as account_status,
          customer.public_id::text as customer_public_id, customer.status as customer_status
        from customer_portal_account account
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        where account.dealership_id = ? and account.google_subject = ?
        for update of account, customer
        """, dealershipId, subject);

    long accountId;
    String customerPublicId;
    String activity;
    if (linked.size() > 1) {
      attemptRecorder.record(loginKeyHash, remoteHash, false, null);
      throw unauthorized("This Google identity could not be matched to one customer account.");
    }

    if (linked.size() == 1) {
      Map<String, Object> row = linked.getFirst();
      if (!"ACTIVE".equals(String.valueOf(row.get("account_status")))
          || !"ACTIVE".equals(String.valueOf(row.get("customer_status")))) {
        attemptRecorder.record(loginKeyHash, remoteHash, false, null);
        throw unauthorized("This customer account is no longer active. Contact Lucky Bajaj for support.");
      }
      accountId = number(row.get("account_id"));
      customerPublicId = String.valueOf(row.get("customer_public_id"));
      activity = "CUSTOMER_GOOGLE_SIGNED_IN";
      List<Map<String, Object>> emailConflicts = jdbc.queryForList("""
          select id from customer_portal_account
          where dealership_id = ? and id <> ? and lower(google_email) = ?
          for update
          """, dealershipId, accountId, email);
      if (!emailConflicts.isEmpty()) {
        attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
        throw unauthorized("This verified Google email is already linked to another customer account.");
      }
      jdbc.update("""
          update customer_portal_account
          set google_email = ?, updated_at = now()
          where dealership_id = ? and id = ? and status = 'ACTIVE'
          """, email, dealershipId, accountId);
    } else {
      List<Map<String, Object>> matches = jdbc.queryForList("""
          select id, public_id::text as customer_public_id
          from customer
          where dealership_id = ? and status = 'ACTIVE'
            and lower(btrim(coalesce(email, ''))) = ?
          for update
          """, dealershipId, email);
      if (matches.size() != 1) {
        attemptRecorder.record(loginKeyHash, remoteHash, false, null);
        throw unauthorized("This verified Google email must match exactly one active customer record for this dealership. Use your invitation token or ask Lucky Bajaj to verify your CRM email.");
      }

      long customerId = number(matches.getFirst().get("id"));
      customerPublicId = String.valueOf(matches.getFirst().get("customer_public_id"));
      List<Map<String, Object>> accounts = jdbc.queryForList("""
          select id, status, google_subject from customer_portal_account
          where dealership_id = ? and customer_id = ? for update
          """, dealershipId, customerId);
      if (accounts.size() > 1) {
        attemptRecorder.record(loginKeyHash, remoteHash, false, null);
        throw unauthorized("This customer account could not be resolved safely. Contact Lucky Bajaj for support.");
      }

      if (accounts.size() == 1) {
        Map<String, Object> existing = accounts.getFirst();
        accountId = number(existing.get("id"));
        if (!"ACTIVE".equals(String.valueOf(existing.get("status")))) {
          attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
          throw unauthorized("This customer account is disabled. Contact Lucky Bajaj for support.");
        }
        Object previousSubject = existing.get("google_subject");
        if (previousSubject != null && !subject.equals(String.valueOf(previousSubject))) {
          attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
          throw unauthorized("This customer account is already linked to a different Google identity.");
        }
        List<Map<String, Object>> conflicts = jdbc.queryForList("""
            select id from customer_portal_account
            where dealership_id = ? and id <> ? and (google_subject = ? or lower(google_email) = ?)
            for update
            """, dealershipId, accountId, subject, email);
        if (!conflicts.isEmpty()) {
          attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
          throw unauthorized("This Google identity is already linked to another customer account.");
        }
        try {
          jdbc.update("""
              update customer_portal_account
              set google_subject = ?, google_email = ?, google_linked_at = now(), updated_at = now()
              where dealership_id = ? and id = ? and status = 'ACTIVE' and google_subject is null
              """, subject, email, dealershipId, accountId);
        } catch (DuplicateKeyException ex) {
          attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
          throw conflict("This Google identity is already linked to another customer account.");
        }
        activity = "CUSTOMER_GOOGLE_IDENTITY_LINKED";
      } else {
        List<Map<String, Object>> conflicts = jdbc.queryForList("""
            select id from customer_portal_account
            where dealership_id = ? and (google_subject = ? or lower(google_email) = ?)
            for update
            """, dealershipId, subject, email);
        if (!conflicts.isEmpty()) {
          attemptRecorder.record(loginKeyHash, remoteHash, false, null);
          throw unauthorized("This Google identity is already linked to another customer account.");
        }
        try {
          accountId = jdbc.queryForObject("""
              insert into customer_portal_account(
                dealership_id, customer_id, password_hash, status, password_changed_at,
                google_subject, google_email, google_linked_at)
              values (?, ?, ?, 'ACTIVE', now(), ?, ?, now())
              returning id
              """, Long.class, dealershipId, customerId,
              passwordEncoder.encode(randomToken()), subject, email);
        } catch (DuplicateKeyException ex) {
          attemptRecorder.record(loginKeyHash, remoteHash, false, null);
          throw conflict("This Google identity was just linked elsewhere. Please retry sign-in.");
        }
        activity = "CUSTOMER_GOOGLE_ACCOUNT_CREATED";
      }
    }

    jdbc.update("""
        update customer_portal_account set last_login_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'ACTIVE'
        """, dealershipId, accountId);
    attemptRecorder.record(loginKeyHash, remoteHash, true, accountId);
    recordActivity(dealershipId, accountId, activity, customerPublicId,
        "Customer authenticated with a signature-verified Google identity.");
    return createSession(dealershipId, accountId, remoteAddress, userAgent);
  }

  private CustomerPortalService.PortalSession createSession(
      long dealershipId, long accountId, String remoteAddress, String userAgent) {
    String token = randomToken();
    Instant now = Instant.now();
    Instant expiresAt = now.plus(SESSION_LIFETIME);
    jdbc.queryForObject("""
        insert into customer_portal_session(
          dealership_id, account_id, token_hash, issued_at, expires_at, last_seen_at,
          user_agent, remote_address_hash)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        returning id
        """, Long.class, dealershipId, accountId, TokenDigests.sha256(token), Timestamp.from(now),
        Timestamp.from(expiresAt), Timestamp.from(now), truncate(userAgent, 300), remoteHash(remoteAddress));
    CustomerPortalService.CustomerProfile profile = jdbc.queryForObject("""
        select customer.public_id, customer.customer_code, customer.full_name, customer.phone,
          customer.alternate_phone, customer.email, customer.preferred_language,
          exists(select 1 from customer_profile_photo photo
            where photo.dealership_id = customer.dealership_id and photo.customer_id = customer.id)
            as profile_photo_available,
          dealership.code as dealership_code, dealership.name as dealership_name
        from customer_portal_account account
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = account.dealership_id
        where account.dealership_id = ? and account.id = ? and account.status = 'ACTIVE'
          and customer.status = 'ACTIVE' and dealership.status = 'ACTIVE'
        """, (rs, rowNum) -> new CustomerPortalService.CustomerProfile(
            rs.getObject("public_id", UUID.class), rs.getString("customer_code"), rs.getString("full_name"),
            rs.getString("phone"), rs.getString("alternate_phone"), rs.getString("email"),
            rs.getString("preferred_language"), rs.getBoolean("profile_photo_available"),
            rs.getString("dealership_code"), rs.getString("dealership_name")),
        dealershipId, accountId);
    return new CustomerPortalService.PortalSession(token, expiresAt, profile);
  }

  private void checkRateLimit(String loginKeyHash, String remoteHash) {
    Integer failures = jdbc.queryForObject("""
        select count(*) from auth_login_attempt
        where succeeded = false and attempted_at > now() - (? * interval '1 second')
          and (login_key_hash = ? or remote_address_hash = ?)
        """, Integer.class, ATTEMPT_WINDOW.toSeconds(), loginKeyHash, remoteHash);
    if (failures != null && failures >= MAX_FAILED_ATTEMPTS) {
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
          "Too many sign-in attempts. Try again in 15 minutes.");
    }
  }

  private void recordActivity(String dealershipCode, long accountId, String action, String customerPublicId, String summary) {
    Long dealershipId = jdbc.queryForObject("select id from dealership where upper(code) = upper(?)", Long.class, dealershipCode);
    if (dealershipId != null) recordActivity(dealershipId, accountId, action, customerPublicId, summary);
  }

  private void recordActivity(long dealershipId, long accountId, String action, String customerPublicId, String summary) {
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, ?, 'CUSTOMER_PORTAL_ACCOUNT', ?::uuid, jsonb_build_object('summary', ?))
        """, dealershipId, accountId, action, customerPublicId, summary);
  }

  private String customerPublicId(long dealershipId, long accountId) {
    return jdbc.queryForObject("""
        select customer.public_id::text from customer_portal_account account
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        where account.dealership_id = ? and account.id = ?
        """, String.class, dealershipId, accountId);
  }

  private String randomToken() {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static String normalizeUsername(String value) {
    String username = required(value, "Username", 40).toLowerCase(Locale.ROOT);
    if (!username.matches("[a-z0-9._-]{3,40}")) {
      throw badRequest("Username must be 3–40 characters using letters, numbers, dots, underscores or hyphens.");
    }
    return username;
  }

  private static String required(String value, String label, int maximum) {
    if (value == null) throw badRequest(label + " is required.");
    String cleaned = value.trim();
    if (cleaned.isEmpty() || cleaned.length() > maximum
        || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw badRequest(label + " is invalid.");
    }
    return cleaned;
  }

  private static long number(Object value) { return ((Number) value).longValue(); }

  private static String truncate(String value, int max) {
    if (value == null) return null;
    String clean = value.trim();
    return clean.length() <= max ? clean : clean.substring(0, max);
  }

  private static String remoteHash(String value) {
    return TokenDigests.sha256(value == null || value.isBlank() ? "unknown-remote" : value.trim());
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static ResponseStatusException unauthorized(String message) {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, message);
  }

  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }
}
