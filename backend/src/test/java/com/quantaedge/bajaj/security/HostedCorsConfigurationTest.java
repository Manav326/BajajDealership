package com.quantaedge.bajaj.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "app.cors.allowed-origins=https://staff-preview.example.test,https://customer-preview.example.test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HostedCorsConfigurationTest {
  @Autowired private MockMvc mvc;

  @Test
  void configuredStaffAndCustomerOriginsAreAllowed() throws Exception {
    mvc.perform(get("/actuator/health")
            .header("Origin", "https://staff-preview.example.test"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", "https://staff-preview.example.test"));
  }

  @Test
  void unconfiguredOriginIsRejected() throws Exception {
    mvc.perform(get("/actuator/health")
            .header("Origin", "https://untrusted.example.test"))
        .andExpect(status().isForbidden());
  }

  @Test
  void bootstrapHeaderIsAllowedForHostedPreflight() throws Exception {
    mvc.perform(options("/api/v1/system/bootstrap")
            .header("Origin", "https://staff-preview.example.test")
            .header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "content-type,x-bootstrap-token"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", "https://staff-preview.example.test"));
  }
}
