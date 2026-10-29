package com.quantaedge.bajaj.social;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SocialMetaControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void statusRequiresAuthenticatedStaff() throws Exception {
    mvc.perform(get("/api/v1/admin/social/meta/status"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void connectingMetaRequiresSocialMediaManagePermission() throws Exception {
    mvc.perform(post("/api/v1/admin/social/meta/connect")
            .with(user("notification-reader")
                .authorities(new SimpleGrantedAuthority("notification.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void callbackDoesNotRequireAnExistingStaffBrowserSession() throws Exception {
    // An invalid state must be rejected by the one-time state check, not by the bearer filter.
    mvc.perform(get("/api/v1/social/meta/callback")
            .queryParam("state", "invalid-state"))
        .andExpect(status().isSeeOther());
  }
}
