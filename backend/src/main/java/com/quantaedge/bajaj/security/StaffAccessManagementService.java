package com.quantaedge.bajaj.security;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class StaffAccessManagementService {
  private static final Duration INVITATION_LIFETIME = Duration.ofHours(24);
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final SecureRandom secureRandom = new SecureRandom();

  public StaffAccessManagementService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
  }

  public List<RoleOption> roleOptions(StaffPrincipal actor) {
    requireOwner(actor);
    return jdbc.query("""
        select r.code, r.display_name,
          coalesce(string_agg(distinct p.code, ',' order by p.code), '') as permission_codes
        from role r
        left join role_permission rp on rp.role_id = r.id
        left join permission p on p.id = rp.permission_id
        where r.code <> 'OWNER'
        group by r.id
        order by r.display_name
        """, (rs, rowNum) -> new RoleOption(
          rs.getString("code"), rs.getString("display_name"),
          splitCodes(rs.getString("permission_codes"))));
  }

  @Transactional
  public InvitationResult invite(
      StaffPrincipal actor, String fullName, String email, String phone,
      List<String> roleCodes, String reason) {
    requireOwner(actor);
    String name = requiredText(fullName, "Full name", 160);
    String normalizedEmail = cleanOptional(email);
    String normalizedPhone = cleanOptional(phone);
    if (normalizedEmail == null && normalizedPhone == null) {
      throw badRequest("Provide an email address or mobile number for staff sign-in.");
    }
    String auditReason = requiredReason(reason);
    List<String> roles = validateRoles(roleCodes);

    String token = createRandomToken();
    String placeholderPassword = passwordEncoder.encode("pending-" + UUID.randomUUID() + "-" + createRandomToken());
    StaffIdentity staff;
    try {
      staff = jdbc.queryForObject("""
          insert into staff_user(dealership_id, full_name, email, phone, password_hash, status)
          values (?, ?, ?, ?, ?, 'INVITED')
          returning id, public_id::text as public_id
          """, (rs, rowNum) -> new StaffIdentity(
              rs.getLong("id"), UUID.fromString(rs.getString("public_id"))),
          actor.dealershipId(), name, normalizedEmail, normalizedPhone, placeholderPassword);
    } catch (DuplicateKeyException duplicate) {
      throw conflict("A staff account with that email or mobile number already exists in this dealership.");
    }
    if (staff == null) throw new IllegalStateException("Staff invitation insert returned no account.");

    for (String role : roles) {
      jdbc.update("""
          insert into staff_user_role(dealership_id, staff_user_id, role_id, assigned_by_staff_user_id)
          select ?, ?, r.id, ?
          from role r where r.code = ?
          """, actor.dealershipId(), staff.id(), actor.staffUserId(), role);
    }

    Instant expiresAt = Instant.now().plus(INVITATION_LIFETIME);
    jdbc.update("""
        insert into staff_invitation(
          dealership_id, staff_user_id, token_hash, issued_by_staff_user_id, expires_at)
        values (?, ?, ?, ?, ?)
        """, actor.dealershipId(), staff.id(), TokenDigests.sha256(token),
        actor.staffUserId(), Timestamp.from(expiresAt));

    audit(actor, "STAFF_INVITATION_ISSUED", staff.publicId().toString(), auditReason,
        "NONE", "INVITED; roles=" + String.join(",", roles) + "; expires=" + expiresAt);
    return new InvitationResult(staff.publicId(), name, actor.dealershipCode(),
        normalizedEmail != null ? normalizedEmail : normalizedPhone, roles, token, expiresAt);
  }

  @Transactional
  public ActivationResult activate(String rawToken, String rawPassword) {
    String token = validateToken(rawToken);
    String password = validatePassword(rawPassword);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select i.id as invitation_id, i.dealership_id, i.staff_user_id,
          s.public_id::text as staff_public_id, s.full_name, s.email, s.phone, s.status as staff_status,
          d.code as dealership_code, d.status as dealership_status
        from staff_invitation i
        join staff_user s on s.dealership_id = i.dealership_id and s.id = i.staff_user_id
        join dealership d on d.id = i.dealership_id
        where i.token_hash = ? and i.accepted_at is null and i.revoked_at is null
          and i.expires_at > now()
        for update of i, s
        """, TokenDigests.sha256(token));

    if (rows.size() != 1) throw unauthorized("This staff invitation is invalid, expired, or already used.");
    Map<String, Object> invitation = rows.getFirst();
    if (!"INVITED".equals(String.valueOf(invitation.get("staff_status")))
        || !"ACTIVE".equals(String.valueOf(invitation.get("dealership_status")))) {
      throw unauthorized("This staff invitation is invalid, expired, or already used.");
    }

    long dealershipId = number(invitation.get("dealership_id"));
    long staffId = number(invitation.get("staff_user_id"));
    int updated = jdbc.update("""
        update staff_user set password_hash = ?, status = 'ACTIVE', updated_at = now()
        where dealership_id = ? and id = ? and status = 'INVITED'
        """, passwordEncoder.encode(password), dealershipId, staffId);
    if (updated != 1) throw conflict("The staff account is no longer awaiting activation.");

    jdbc.update("""
        update staff_invitation set accepted_at = now()
        where id = ? and accepted_at is null and revoked_at is null
        """, number(invitation.get("invitation_id")));

    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, details)
        values (?, 'SYSTEM', 'STAFF_INVITATION_ACTIVATED', 'STAFF_USER', ?,
          jsonb_build_object('statusBefore', 'INVITED', 'statusAfter', 'ACTIVE'))
        """, dealershipId, String.valueOf(invitation.get("staff_public_id")));

    String loginIdentifier = cleanOptional((String) invitation.get("email"));
    if (loginIdentifier == null) loginIdentifier = String.valueOf(invitation.get("phone"));
    return new ActivationResult(
        String.valueOf(invitation.get("dealership_code")),
        String.valueOf(invitation.get("full_name")), loginIdentifier);
  }

  @Transactional
  public RoleAssignmentResult changeRoles(
      StaffPrincipal actor, UUID staffPublicId, List<String> requestedRoles, String reason) {
    requireOwner(actor);
    String auditReason = requiredReason(reason);
    List<String> roles = validateRoles(requestedRoles);
    StaffAccount target = lockTarget(actor, staffPublicId);
    assertNotSelf(actor, target);
    assertNotOwnerTarget(actor, target.id());
    List<String> before = staffRoles(actor.dealershipId(), target.id());
    if (new HashSet<>(before).equals(new HashSet<>(roles))) {
      return new RoleAssignmentResult(target.publicId(), before);
    }

    jdbc.update("delete from staff_user_role where dealership_id = ? and staff_user_id = ?",
        actor.dealershipId(), target.id());
    for (String role : roles) {
      int inserted = jdbc.update("""
          insert into staff_user_role(dealership_id, staff_user_id, role_id, assigned_by_staff_user_id)
          select ?, ?, r.id, ? from role r where r.code = ?
          """, actor.dealershipId(), target.id(), actor.staffUserId(), role);
      if (inserted != 1) throw badRequest("One or more roles are no longer available.");
    }

    audit(actor, "STAFF_ROLES_CHANGED", target.publicId().toString(), auditReason,
        String.join(",", before), String.join(",", roles));
    return new RoleAssignmentResult(target.publicId(), roles);
  }

  @Transactional
  public StaffStatusResult changeStatus(
      StaffPrincipal actor, UUID staffPublicId, String requestedStatus, String reason) {
    requireOwner(actor);
    String desired = requestedStatus == null ? "" : requestedStatus.trim().toUpperCase(Locale.ROOT);
    if (!List.of("ACTIVE", "DISABLED").contains(desired)) {
      throw badRequest("Staff status must be ACTIVE or DISABLED.");
    }
    String auditReason = requiredReason(reason);
    StaffAccount target = lockTarget(actor, staffPublicId);
    assertNotSelf(actor, target);
    assertNotOwnerTarget(actor, target.id());
    if (!List.of("ACTIVE", "DISABLED").contains(target.status())) {
      throw conflict("Only activated staff accounts can be disabled or reactivated.");
    }
    if (target.status().equals(desired)) {
      return new StaffStatusResult(target.publicId(), target.status());
    }

    jdbc.update("""
        update staff_user set status = ?, updated_at = now()
        where dealership_id = ? and id = ?
        """, desired, actor.dealershipId(), target.id());
    if ("DISABLED".equals(desired)) {
      jdbc.update("""
          update staff_session set revoked_at = now()
          where dealership_id = ? and staff_user_id = ? and revoked_at is null
          """, actor.dealershipId(), target.id());
    }
    audit(actor, "STAFF_STATUS_CHANGED", target.publicId().toString(), auditReason,
        target.status(), desired);
    return new StaffStatusResult(target.publicId(), desired);
  }

  private StaffAccount lockTarget(StaffPrincipal actor, UUID staffPublicId) {
    List<StaffAccount> rows = jdbc.query("""
        select u.id, u.public_id::text as public_id, u.status
        from staff_user u
        where u.dealership_id = ? and u.public_id = ?
        for update
        """, (rs, rowNum) -> new StaffAccount(
            rs.getLong("id"), UUID.fromString(rs.getString("public_id")), rs.getString("status")),
        actor.dealershipId(), staffPublicId);
    if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Staff record was not found.");
    return rows.getFirst();
  }

  private void assertNotSelf(StaffPrincipal actor, StaffAccount target) {
    if (target.id() == actor.staffUserId()) {
      throw conflict("You cannot change your own staff roles or status.");
    }
  }

  private void assertNotOwnerTarget(StaffPrincipal actor, long targetStaffId) {
    Integer owners = jdbc.queryForObject("""
        select count(*) from staff_user_role ur
        join role r on r.id = ur.role_id
        where ur.dealership_id = ? and ur.staff_user_id = ? and r.code = 'OWNER'
        """, Integer.class, actor.dealershipId(), targetStaffId);
    if (owners != null && owners > 0) {
      throw conflict("Owner accounts are protected from staff-directory role and status changes.");
    }
  }

  private List<String> validateRoles(List<String> roleCodes) {
    if (roleCodes == null || roleCodes.isEmpty() || roleCodes.size() > 8) {
      throw badRequest("Assign between one and eight roles.");
    }
    LinkedHashSet<String> canonical = new LinkedHashSet<>();
    for (String role : roleCodes) {
      if (role == null || role.isBlank()) throw badRequest("Role codes cannot be blank.");
      canonical.add(role.trim().toUpperCase(Locale.ROOT));
    }
    if (canonical.size() != roleCodes.size()) throw badRequest("Duplicate role codes are not allowed.");
    if (canonical.contains("OWNER")) {
      throw badRequest("The OWNER role is protected and cannot be assigned through staff management.");
    }

    String placeholders = String.join(",", java.util.Collections.nCopies(canonical.size(), "?"));
    List<String> found = jdbc.query(
        "select code from role where code in (" + placeholders + ") and code <> 'OWNER' order by code",
        (rs, rowNum) -> rs.getString(1), canonical.toArray());
    if (!new HashSet<>(found).equals(new HashSet<>(canonical))) {
      throw badRequest("One or more selected roles are not available.");
    }
    return List.copyOf(canonical);
  }

  private List<String> staffRoles(long dealershipId, long staffId) {
    return jdbc.query("""
        select r.code from staff_user_role ur join role r on r.id = ur.role_id
        where ur.dealership_id = ? and ur.staff_user_id = ? order by r.code
        """, (rs, rowNum) -> rs.getString(1), dealershipId, staffId);
  }

  private void requireOwner(StaffPrincipal actor) {
    if (actor == null || !actor.roles().contains("OWNER") || !actor.permissions().contains("staff.manage")) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,
          "Only an authorized dealership owner can manage staff accounts and roles.");
    }
  }

  private void audit(
      StaffPrincipal actor, String action, String targetId, String reason, String before, String after) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, reason, details)
        values (?, 'STAFF', ?, ?, 'STAFF_USER', ?, ?, jsonb_build_object('before', ?, 'after', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, targetId, reason, before, after);
  }

  private String createRandomToken() {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static String validateToken(String raw) {
    if (raw == null || raw.isBlank() || raw.length() > 128) {
      throw unauthorized("This staff invitation is invalid, expired, or already used.");
    }
    return raw.trim();
  }

  private static String validatePassword(String raw) {
    if (raw == null || raw.length() < 12 || raw.length() > 72
        || raw.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("Password must be 12–72 characters and contain no control characters.");
    }
    return raw;
  }

  private static String requiredText(String value, String label, int maxLength) {
    String cleaned = value == null ? "" : value.trim();
    if (cleaned.isEmpty() || cleaned.length() > maxLength) {
      throw badRequest(label + " is required and must be no more than " + maxLength + " characters.");
    }
    return cleaned;
  }

  private static String requiredReason(String value) {
    String cleaned = value == null ? "" : value.trim();
    if (cleaned.length() < 4 || cleaned.length() > 500) {
      throw badRequest("Provide a reason of 4–500 characters for this staff access change.");
    }
    return cleaned;
  }

  private static String cleanOptional(String value) {
    if (value == null || value.isBlank()) return null;
    return value.trim();
  }

  private static List<String> splitCodes(String value) {
    if (value == null || value.isBlank()) return List.of();
    return java.util.Arrays.stream(value.split(",")).filter(part -> !part.isBlank()).toList();
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }

  private static ResponseStatusException unauthorized(String message) {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, message);
  }

  private record StaffIdentity(long id, UUID publicId) {}
  private record StaffAccount(long id, UUID publicId, String status) {}

  public record RoleOption(String code, String displayName, List<String> permissions) {}
  public record InvitationResult(
      UUID staffPublicId, String fullName, String dealershipCode, String loginIdentifier,
      List<String> roles, String activationToken, Instant expiresAt) {}
  public record ActivationResult(String dealershipCode, String fullName, String loginIdentifier) {}
  public record RoleAssignmentResult(UUID staffPublicId, List<String> roles) {}
  public record StaffStatusResult(UUID staffPublicId, String status) {}
}
