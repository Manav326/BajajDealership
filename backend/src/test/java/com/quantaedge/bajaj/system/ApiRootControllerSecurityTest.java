package com.quantaedge.bajaj.system;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiRootControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void apiRootIsPublicAndExplainsWhereToCheckHealthAndSignIn() throws Exception {
    mvc.perform(get("/"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.service").value("Lucky Bajaj Agency API"))
        .andExpect(jsonPath("$.status").value("available"))
        .andExpect(jsonPath("$.health").isArray())
        .andExpect(jsonPath("$.staffSignIn").value("/api/v1/auth/staff/login"))
        .andExpect(jsonPath("$.customerSignIn").value("/api/v1/customer/auth/login"));
  }

  @Test
  void apiHealthIsPublicWithoutOpeningBusinessEndpoints() throws Exception {
    mvc.perform(get("/api/v1/system/health"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("UP"));
  }
}
