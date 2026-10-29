package com.quantaedge.bajaj.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = "app.bootstrap.token=integration-bootstrap-token")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class OwnerBootstrapIntegrationTest {
  @Autowired private MockMvc mvc;

  @Test
  void invalidBootstrapTokenIsRejectedByThePublicEndpointWithoutStaffSignIn() throws Exception {
    mvc.perform(post("/api/v1/system/bootstrap")
            .header("X-Bootstrap-Token", "deliberately-invalid")
            .contentType(MediaType.APPLICATION_JSON)
            .content(ownerPayload("DIAG-ONLY", "diag@example.test")))
        .andExpect(status().isNotFound());
  }

  @Test
  void oneTimeSetupTokenCanCreateOnlyTheInitialOwner() throws Exception {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    String firstPayload = ownerPayload("SETUP-" + suffix, "owner-" + suffix.toLowerCase(Locale.ROOT) + "@example.test");
    String secondPayload = ownerPayload("SETUP-OTHER-" + suffix, "owner-other-" + suffix.toLowerCase(Locale.ROOT) + "@example.test");

    mvc.perform(post("/api/v1/system/bootstrap")
            .header("X-Bootstrap-Token", "integration-bootstrap-token")
            .contentType(MediaType.APPLICATION_JSON)
            .content(firstPayload))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("created"))
        .andExpect(jsonPath("$.role").value("OWNER"));

    mvc.perform(post("/api/v1/system/bootstrap")
            .header("X-Bootstrap-Token", "integration-bootstrap-token")
            .contentType(MediaType.APPLICATION_JSON)
            .content(secondPayload))
        .andExpect(status().isConflict());
  }

  private static String ownerPayload(String code, String email) {
    return """
        {
          "dealershipCode": "%s",
          "dealershipName": "Bootstrap Integration Test Dealership",
          "ownerName": "Bootstrap Integration Test Owner",
          "email": "%s",
          "phone": null,
          "password": "Secure-Owner-Password-2026"
        }
        """.formatted(code, email);
  }
}
