package com.quantaedge.bajaj.notifications;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NotificationMediaControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void privateMediaReadRequiresAuthenticatedStaffWithNotificationReadPermission() throws Exception {
    UUID assetId = UUID.randomUUID();

    mvc.perform(get("/api/v1/admin/notifications/media/{assetId}", assetId))
        .andExpect(status().isUnauthorized());

    mvc.perform(get("/api/v1/admin/notifications/media/{assetId}", assetId)
            .with(user("customer-account")
                .authorities(new SimpleGrantedAuthority("customer.portal"))))
        .andExpect(status().isForbidden());

    mvc.perform(get("/api/v1/admin/notifications/media/{assetId}", assetId)
            .with(user("notification-creator")
                .authorities(new SimpleGrantedAuthority("notification.create"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void notificationReadPermissionDoesNotGrantMediaUpload() throws Exception {
    var file = new MockMultipartFile(
        "file", "test.png", "image/png", new byte[] {1, 2, 3, 4});

    mvc.perform(multipart("/api/v1/admin/notifications/media")
            .file(file)
            .with(user("notification-reader")
                .authorities(new SimpleGrantedAuthority("notification.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void notificationSendPermissionDoesNotGrantMediaUpload() throws Exception {
    var file = new MockMultipartFile(
        "file", "test.png", "image/png", new byte[] {1, 2, 3, 4});

    mvc.perform(multipart("/api/v1/admin/notifications/media")
            .file(file)
            .with(user("notification-sender")
                .authorities(new SimpleGrantedAuthority("notification.send"))))
        .andExpect(status().isForbidden());
  }
}
