package com.quantaedge.bajaj.notifications;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NotificationApprovalSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void campaignApprovalRequiresAuthenticatedStaff() throws Exception {
    mvc.perform(post("/api/v1/admin/notifications/campaigns/{publicId}/approve", UUID.randomUUID())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"previewToken\":\"preview-token-value\"}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void campaignApprovalRequiresExplicitApprovalPermission() throws Exception {
    mvc.perform(post("/api/v1/admin/notifications/campaigns/{publicId}/approve", UUID.randomUUID())
            .with(user("notification-reader")
                .authorities(new SimpleGrantedAuthority("notification.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"previewToken\":\"preview-token-value\"}"))
        .andExpect(status().isForbidden());
  }
}
