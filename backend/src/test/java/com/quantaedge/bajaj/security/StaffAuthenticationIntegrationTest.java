package com.quantaedge.bajaj.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class StaffAuthenticationIntegrationTest {
  private static final String PASSWORD = "Secure-Test-Password-2026";

  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private ObjectMapper mapper;

  private String dealershipCode;
  private String email;

  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    dealershipCode = "AUTH-" + suffix;
    email = "owner-" + suffix.toLowerCase() + "@example.test";
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Authentication Test Agency");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Authentication Test Owner', ?, ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, email, passwordEncoder.encode(PASSWORD));
    Long roleId = jdbc.queryForObject("select id from role where code = 'OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, roleId);
  }

  @Test
  void loginMeAndLogoutUseHashedRevocableBearerSessions() throws Exception {
    MvcResult login = mvc.perform(post("/api/v1/auth/staff/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new LoginRequest(dealershipCode, email, PASSWORD))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.tokenType").value("Bearer"))
        .andExpect(jsonPath("$.staff.fullName").value("Authentication Test Owner"))
        .andExpect(jsonPath("$.staff.roles[0]").value("OWNER"))
        .andReturn();

    JsonNode payload = mapper.readTree(login.getResponse().getContentAsString());
    String token = payload.path("accessToken").asText();
    org.assertj.core.api.Assertions.assertThat(token).isNotBlank();

    Integer matchingHash = jdbc.queryForObject("""
        select count(*) from staff_session where token_hash = ?
        """, Integer.class, TokenDigests.sha256(token));
    org.assertj.core.api.Assertions.assertThat(matchingHash).isEqualTo(1);

    mvc.perform(get("/api/v1/auth/staff/me").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dealershipCode").value(dealershipCode));

    mvc.perform(post("/api/v1/auth/staff/logout").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());

    mvc.perform(get("/api/v1/auth/staff/me").header("Authorization", "Bearer " + token))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void invalidCredentialsDoNotCreateASession() throws Exception {
    mvc.perform(post("/api/v1/auth/staff/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new LoginRequest(dealershipCode, email, "Wrong-password-2026"))))
        .andExpect(status().isUnauthorized());

    Integer sessions = jdbc.queryForObject("""
        select count(*) from staff_session ss
        join staff_user u on u.id = ss.staff_user_id
        where u.email = ?
        """, Integer.class, email);
    org.assertj.core.api.Assertions.assertThat(sessions).isZero();
  }

  private record LoginRequest(String dealershipCode, String login, String password) {}
}
