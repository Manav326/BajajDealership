package com.quantaedge.bajaj.security;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/system")
public class OwnerBootstrapController {
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final StaffSecurityConfiguration.BootstrapTokenVerifier tokenVerifier;
  private final String configuredBootstrapToken;

  public OwnerBootstrapController(
      JdbcTemplate jdbc,
      PasswordEncoder passwordEncoder,
      StaffSecurityConfiguration.BootstrapTokenVerifier tokenVerifier,
      @Value("${app.bootstrap.token:}") String configuredBootstrapToken) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.tokenVerifier = tokenVerifier;
    this.configuredBootstrapToken = configuredBootstrapToken;
  }

  @GetMapping("/bootstrap/status")
  public BootstrapStatus bootstrapStatus() {
    Integer provisionedOwners = jdbc.queryForObject("""
        select count(*)
        from staff_user_role ur
        join role r on r.id = ur.role_id
        where r.code = 'OWNER'
        """, Integer.class);
    boolean tokenConfigured = configuredBootstrapToken != null && !configuredBootstrapToken.isBlank();
    boolean ownerAlreadyProvisioned = provisionedOwners != null && provisionedOwners > 0;
    boolean available = tokenConfigured && !ownerAlreadyProvisioned;
    java.util.List<String> missing = tokenConfigured ? java.util.List.of() : java.util.List.of("APP_BOOTSTRAP_TOKEN");
    String message = !tokenConfigured
        ? "Initial owner setup is unavailable because APP_BOOTSTRAP_TOKEN is not configured on the API."
        : ownerAlreadyProvisioned
            ? "Initial owner setup has already been completed."
            : "Initial owner setup is ready.";
    return new BootstrapStatus(available, message, missing);
  }

  @PostMapping("/bootstrap")
  @Transactional
  public BootstrapResponse bootstrap(
      @RequestHeader(name = "X-Bootstrap-Token", required = false) String suppliedToken,
      @Valid @RequestBody BootstrapRequest request) {
    if (!tokenVerifier.matches(suppliedToken)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Initial setup is not enabled.");
    }
    // Serialize bootstrap attempts and make this credential truly one-time across the instance.
    jdbc.execute("select pg_advisory_xact_lock(741982031)");
    Integer provisionedOwners = jdbc.queryForObject("""
        select count(*)
        from staff_user_role ur
        join role r on r.id = ur.role_id
        where r.code = 'OWNER'
        """, Integer.class);
    if (provisionedOwners != null && provisionedOwners > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "Initial owner setup has already been completed. Sign in or ask an authorized owner to invite staff.");
    }
    if ((request.email() == null || request.email().isBlank())
        && (request.phone() == null || request.phone().isBlank())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide an owner email or phone number.");
    }
    if (request.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Password must be at most 72 UTF-8 bytes for the configured password hash.");
    }

    String code = request.dealershipCode().trim().toUpperCase(java.util.Locale.ROOT);
    String name = request.dealershipName().trim();
    Long dealershipId;
    java.util.List<java.util.Map<String, Object>> dealers = jdbc.queryForList(
        "select id, status from dealership where code = ?", code);
    if (dealers.isEmpty()) {
      dealershipId = jdbc.queryForObject("""
          insert into dealership(code, name) values (?, ?) returning id
          """, Long.class, code, name);
    } else {
      java.util.Map<String, Object> dealer = dealers.getFirst();
      if (!"ACTIVE".equals(String.valueOf(dealer.get("status")))) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "This dealership is not active.");
      }
      dealershipId = ((Number) dealer.get("id")).longValue();
    }

    Integer ownerCount = jdbc.queryForObject("""
        select count(*) from staff_user_role ur
        join role r on r.id = ur.role_id
        where ur.dealership_id = ? and r.code = 'OWNER'
        """, Integer.class, dealershipId);
    if (ownerCount != null && ownerCount > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "An owner has already been provisioned for this dealership.");
    }

    String email = request.email() == null || request.email().isBlank()
        ? null : request.email().trim().toLowerCase(java.util.Locale.ROOT);
    String phone = request.phone() == null || request.phone().isBlank() ? null : request.phone().trim();
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, phone, password_hash, status)
        values (?, ?, ?, ?, ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, request.ownerName().trim(), email, phone,
        passwordEncoder.encode(request.password()));
    Long ownerRoleId = jdbc.queryForObject("select id from role where code = 'OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);
    jdbc.update("""
        insert into audit_event(dealership_id, actor_kind, action, entity_type, entity_id, details)
        values (?, 'SYSTEM', 'OWNER_BOOTSTRAPPED', 'STAFF_USER', ?, jsonb_build_object('role', 'OWNER'))
        """, dealershipId, Long.toString(staffId));

    return new BootstrapResponse("created", code,
        request.ownerName().trim(), "OWNER");
  }

  public record BootstrapRequest(
      @NotBlank @Pattern(regexp = "[A-Za-z0-9][A-Za-z0-9_-]{2,39}") String dealershipCode,
      @NotBlank @Size(max = 160) String dealershipName,
      @NotBlank @Size(max = 160) String ownerName,
      @Email @Size(max = 320) String email,
      @Size(max = 32) String phone,
      @NotBlank @Size(min = 12, max = 72) String password) {}

  public record BootstrapStatus(boolean available, String message, java.util.List<String> missingConfigurationKeys) {}

  public record BootstrapResponse(String status, String dealershipCode, String ownerName, String role) {}
}
