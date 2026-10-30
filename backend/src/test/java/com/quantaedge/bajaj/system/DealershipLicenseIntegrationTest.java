package com.quantaedge.bajaj.system;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = "app.license.admin-token=license-admin-test-token-with-high-entropy")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class DealershipLicenseIntegrationTest {
  private static final String PASSWORD = "License-Test-Password-2026";
  private static final String ADMIN_TOKEN = "license-admin-test-token-with-high-entropy";

  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private ObjectMapper mapper;

  private long dealershipId;
  private String dealershipCode;
  private String email;
  private String token;

  @BeforeEach
  void setUp() throws Exception {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    dealershipCode = "LIC-" + suffix;
    email = "license-owner-" + suffix.toLowerCase() + "@example.test";
    dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "License Test Agency");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'License Test Owner', ?, ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, email, passwordEncoder.encode(PASSWORD));
    Long ownerRoleId = jdbc.queryForObject("select id from role where code = 'OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);

    MvcResult login = mvc.perform(post("/api/v1/auth/staff/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new LoginRequest(dealershipCode, email, PASSWORD))))
        .andExpect(status().isOk())
        .andReturn();
    JsonNode payload = mapper.readTree(login.getResponse().getContentAsString());
    token = payload.path("accessToken").asText();
    assertThat(token).isNotBlank();

    Integer licenses = jdbc.queryForObject(
        "select count(*) from dealership_license where dealership_id = ?",
        Integer.class, dealershipId);
    assertThat(licenses).isEqualTo(1);
  }

  @Test
  void expiredAfterGraceKeepsExistingRecordsReadableButRejectsWrites() throws Exception {
    jdbc.update("""
        update dealership_license
        set starts_at = now() - interval '38 days',
            expires_at = now() - interval '8 days', grace_period_days = 7
        where dealership_id = ?
        """, dealershipId);

    mvc.perform(get("/api/v1/system/license/status").header("Authorization", bearer()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("READ_ONLY"));

    mvc.perform(get("/api/v1/admin/staff/roles").header("Authorization", bearer()))
        .andExpect(status().isOk());

    mvc.perform(post("/api/v1/admin/staff/invitations")
            .header("Authorization", bearer())
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new InvitationRequest(
                "New Team Member", "new-member-" + UUID.randomUUID() + "@example.test",
                null, List.of("SALES_EXECUTIVE"), "License gate integration test"))))
        .andExpect(status().isPaymentRequired())
        .andExpect(jsonPath("$.code").value("LICENSE_READ_ONLY"));
  }

  @Test
  void suspendedLicenseBlocksBusinessReadsButAllowsStatusAndLogout() throws Exception {
    jdbc.update("update dealership_license set status = 'SUSPENDED' where dealership_id = ?", dealershipId);

    mvc.perform(get("/api/v1/system/license/status").header("Authorization", bearer()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("SUSPENDED"));

    mvc.perform(get("/api/v1/admin/staff/roles").header("Authorization", bearer()))
        .andExpect(status().isLocked())
        .andExpect(jsonPath("$.code").value("LICENSE_SUSPENDED"));

    mvc.perform(get("/api/v1/auth/staff/me").header("Authorization", bearer()))
        .andExpect(status().isOk());

    mvc.perform(post("/api/v1/auth/staff/logout").header("Authorization", bearer()))
        .andExpect(status().isOk());
  }

  @Test
  void staffSeatLimitIsEnforcedAndReportedAsStructuredLicenseError() throws Exception {
    jdbc.update("update dealership_license set max_staff_seats = 1 where dealership_id = ?", dealershipId);

    mvc.perform(post("/api/v1/admin/staff/invitations")
            .header("Authorization", bearer())
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new InvitationRequest(
                "New Team Member", "seat-limit-" + UUID.randomUUID() + "@example.test",
                null, List.of("SALES_EXECUTIVE"), "Seat limit integration test"))))
        .andExpect(status().isPaymentRequired())
        .andExpect(jsonPath("$.code").value("LICENSE_SEAT_LIMIT"));
  }

  @Test
  void vendorConsoleCanUpdateLicenseAndEveryChangeHasAuditEvidence() throws Exception {
    Instant startsAt = Instant.now().minusSeconds(3600);
    Instant expiresAt = Instant.now().plusSeconds(60L * 60 * 24 * 45);
    String body = mapper.writeValueAsString(new LicenseUpdateRequest(
        "STANDARD", "ACTIVE", startsAt, expiresAt, 5, 12, 5, "Renewed subscription for integration test"));

    mvc.perform(put("/api/v1/system/license/admin/licenses/" + dealershipCode)
            .header("X-License-Admin-Token", ADMIN_TOKEN)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.planCode").value("STANDARD"))
        .andExpect(jsonPath("$.maxStaffSeats").value(12))
        .andExpect(jsonPath("$.maxDesktopDevices").value(5))
        .andExpect(jsonPath("$.state").value("ACTIVE"));

    Integer audited = jdbc.queryForObject("""
        select count(*) from audit_event
        where dealership_id = ? and action = 'DEALERSHIP_LICENSE_UPDATED'
          and entity_type = 'DEALERSHIP_LICENSE'
        """, Integer.class, dealershipId);
    assertThat(audited).isEqualTo(1);
  }

  @Test
  void adminConsoleRejectsMissingOrIncorrectToken() throws Exception {
    mvc.perform(get("/api/v1/system/license/admin/licenses"))
        .andExpect(status().isUnauthorized());

    mvc.perform(get("/api/v1/system/license/admin/licenses")
            .header("X-License-Admin-Token", "incorrect-token"))
        .andExpect(status().isUnauthorized());
  }

  private String bearer() {
    return "Bearer " + token;
  }

  private record LoginRequest(String dealershipCode, String login, String password) {}
  private record InvitationRequest(
      String fullName, String email, String phone, List<String> roleCodes, String reason) {}
  private record LicenseUpdateRequest(
      String planCode, String status, Instant startsAt, Instant expiresAt,
      int gracePeriodDays, int maxStaffSeats, int maxDesktopDevices, String reason) {}
}
