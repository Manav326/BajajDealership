package com.quantaedge.bajaj.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class StaffAccessManagementServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private StaffAccessManagementService access;

  private StaffPrincipal owner;
  private long dealershipId;
  private String dealershipCode;

  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    dealershipCode = "TEAM-" + suffix;
    UUID dealershipPublicId = UUID.randomUUID();
    dealershipId = jdbc.queryForObject("""
        insert into dealership(public_id, code, name) values (?, ?, ?) returning id
        """, Long.class, dealershipPublicId, dealershipCode, "Team Access Test Agency");
    UUID ownerPublicId = UUID.randomUUID();
    long ownerId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, public_id, full_name, email, password_hash, status)
        values (?, ?, 'Test Owner', ?, ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, ownerPublicId,
        "owner-" + suffix.toLowerCase() + "@example.test", passwordEncoder.encode("Owner-Test-Password-2026"));
    Long ownerRole = jdbc.queryForObject("select id from role where code = 'OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, ownerId, ownerRole);
    owner = new StaffPrincipal(
        1L, ownerId, ownerPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Test Owner", Set.of("OWNER"), Set.of("staff.read", "staff.manage"));
  }

  @Test
  void invitationTokenIsHashedAndActivationIsSingleUse() {
    var invite = access.invite(owner, "New Staff", "new-" + UUID.randomUUID() + "@example.test",
        null, List.of("SALES_EXECUTIVE"), "New staff joining sales");
    String storedHash = jdbc.queryForObject("""
        select token_hash from staff_invitation where staff_user_id = (
          select id from staff_user where public_id = ?)
        """, String.class, invite.staffPublicId());
    assertThat(storedHash).isEqualTo(TokenDigests.sha256(invite.activationToken()));
    assertThat(storedHash).isNotEqualTo(invite.activationToken());
    assertThat(jdbc.queryForObject("select status from staff_user where public_id = ?",
        String.class, invite.staffPublicId())).isEqualTo("INVITED");

    var activated = access.activate(invite.activationToken(), "New-Staff-Password-2026");
    assertThat(activated.dealershipCode()).isEqualTo(dealershipCode);
    assertThat(activated.loginIdentifier()).isEqualTo(invite.loginIdentifier());
    assertThat(jdbc.queryForObject("select status from staff_user where public_id = ?",
        String.class, invite.staffPublicId())).isEqualTo("ACTIVE");
    String storedPassword = jdbc.queryForObject("select password_hash from staff_user where public_id = ?",
        String.class, invite.staffPublicId());
    assertThat(passwordEncoder.matches("New-Staff-Password-2026", storedPassword)).isTrue();
    assertThat(jdbc.queryForObject("""
        select count(*) from staff_invitation where token_hash = ? and accepted_at is not null
        """, Integer.class, TokenDigests.sha256(invite.activationToken()))).isEqualTo(1);
    assertThatThrownBy(() -> access.activate(invite.activationToken(), "New-Staff-Password-2026"))
        .isInstanceOf(ResponseStatusException.class)
        .extracting(error -> ((ResponseStatusException) error).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void ownerRoleCannotBeAssignedAndOwnerAccountsAreProtected() {
    var invite = access.invite(owner, "Target Staff", "target-" + UUID.randomUUID() + "@example.test",
        null, List.of("SALES_EXECUTIVE"), "New sales staff");
    assertThatThrownBy(() -> access.changeRoles(owner, invite.staffPublicId(),
        List.of("OWNER"), "Attempt owner escalation"))
        .isInstanceOf(ResponseStatusException.class)
        .extracting(error -> ((ResponseStatusException) error).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    assertThatThrownBy(() -> access.changeStatus(owner, UUID.fromString(owner.staffPublicId()),
        "DISABLED", "Self disable attempt"))
        .isInstanceOf(ResponseStatusException.class)
        .extracting(error -> ((ResponseStatusException) error).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    UUID protectedOwnerId = UUID.randomUUID();
    long secondOwnerId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, public_id, full_name, email, password_hash, status)
        values (?, ?, 'Protected Owner', ?, ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, protectedOwnerId, "protected-" + UUID.randomUUID() + "@example.test",
        passwordEncoder.encode("Protected-Owner-Password-2026"));
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        select ?, ?, id from role where code = 'OWNER'
        """, dealershipId, secondOwnerId);
    assertThatThrownBy(() -> access.changeStatus(owner, protectedOwnerId, "DISABLED", "Owner protection test"))
        .isInstanceOf(ResponseStatusException.class)
        .extracting(error -> ((ResponseStatusException) error).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  void disablingStaffRevokesAllSessionsAndReactivationPreservesAssignedRole() {
    var invite = access.invite(owner, "Session Staff", "session-" + UUID.randomUUID() + "@example.test",
        null, List.of("CASHIER"), "New cashier onboarding");
    access.activate(invite.activationToken(), "Session-Staff-Password-2026");
    long targetId = jdbc.queryForObject("select id from staff_user where public_id = ?",
        Long.class, invite.staffPublicId());
    String sessionTokenHash = TokenDigests.sha256("active-session-token");
    jdbc.update("""
        insert into staff_session(dealership_id, staff_user_id, token_hash, expires_at)
        values (?, ?, ?, now() + interval '1 hour')
        """, dealershipId, targetId, sessionTokenHash);

    assertThat(access.changeStatus(owner, invite.staffPublicId(), "DISABLED", "Staff left dealership").status())
        .isEqualTo("DISABLED");
    assertThat(jdbc.queryForObject("select revoked_at is not null from staff_session where token_hash = ?",
        Boolean.class, sessionTokenHash)).isTrue();

    assertThat(access.changeStatus(owner, invite.staffPublicId(), "ACTIVE", "Approved staff return").status())
        .isEqualTo("ACTIVE");
    assertThat(jdbc.queryForObject("""
        select count(*) from staff_user_role ur join role r on r.id = ur.role_id
        where ur.dealership_id = ? and ur.staff_user_id = ? and r.code = 'CASHIER'
        """, Integer.class, dealershipId, targetId)).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select count(*) from audit_event where dealership_id = ? and entity_id = ?
          and action = 'STAFF_STATUS_CHANGED'
        """, Integer.class, dealershipId, invite.staffPublicId().toString())).isEqualTo(2);
  }
}
