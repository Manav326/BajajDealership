package com.quantaedge.bajaj.notifications;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
class NotificationControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void unauthenticatedStaffCannotSendCampaignsOrAccessAdminInbox() throws Exception {
    mvc.perform(post("/api/v1/admin/notifications/send")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "campaignPublicId":"%s",
                  "previewToken":"preview-token",
                  "idempotencyKey":"security-send-unauthenticated"
                }
                """.formatted(UUID.randomUUID())))
        .andExpect(status().isUnauthorized());

    mvc.perform(get("/api/v1/admin/notifications/inbox"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void notificationReadDoesNotGrantTemplateCreationPreviewOrSending() throws Exception {
    var reader = user("notification-reader")
        .authorities(new SimpleGrantedAuthority("notification.read"));

    mvc.perform(post("/api/v1/admin/notifications/templates")
            .with(reader)
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "templateName":"Security test",
                  "description":"Permission boundary",
                  "contentDocument":{"version":1,"blocks":[]}
                }
                """))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/notifications/preview")
            .with(user("notification-reader")
                .authorities(new SimpleGrantedAuthority("notification.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "scope":"STAFF",
                  "title":"Security test",
                  "summary":"Permission boundary",
                  "audienceFilter":{"recipientTypes":["STAFF"],"excludedRecipients":[]},
                  "contentDocument":{"version":1,"blocks":[]}
                }
                """))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/notifications/send")
            .with(user("notification-reader")
                .authorities(new SimpleGrantedAuthority("notification.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "campaignPublicId":"%s",
                  "previewToken":"preview-token",
                  "idempotencyKey":"security-send-read-only"
                }
                """.formatted(UUID.randomUUID())))
        .andExpect(status().isForbidden());
  }

  @Test
  void creatorCannotSendApproveOrCancelCampaignsWithoutTheSpecificPermissions() throws Exception {
    UUID campaignId = UUID.randomUUID();

    mvc.perform(post("/api/v1/admin/notifications/send")
            .with(user("notification-creator")
                .authorities(new SimpleGrantedAuthority("notification.create")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "campaignPublicId":"%s",
                  "previewToken":"preview-token",
                  "idempotencyKey":"security-send-create-only"
                }
                """.formatted(campaignId)))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/notifications/campaigns/{publicId}/approve", campaignId)
            .with(user("notification-creator")
                .authorities(new SimpleGrantedAuthority("notification.create")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"previewToken":"preview-token"}"""))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/notifications/campaigns/{publicId}/cancel", campaignId)
            .with(user("notification-creator")
                .authorities(new SimpleGrantedAuthority("notification.create"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void senderCannotApproveOrCancelAndApproverCannotSend() throws Exception {
    UUID campaignId = UUID.randomUUID();

    mvc.perform(post("/api/v1/admin/notifications/campaigns/{publicId}/approve", campaignId)
            .with(user("notification-sender")
                .authorities(new SimpleGrantedAuthority("notification.send")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"previewToken":"preview-token"}"""))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/notifications/campaigns/{publicId}/cancel", campaignId)
            .with(user("notification-sender")
                .authorities(new SimpleGrantedAuthority("notification.send"))))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/notifications/send")
            .with(user("notification-approver")
                .authorities(new SimpleGrantedAuthority("notification.approve")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "campaignPublicId":"%s",
                  "previewToken":"preview-token",
                  "idempotencyKey":"security-approve-only"
                }
                """.formatted(campaignId)))
        .andExpect(status().isForbidden());
  }
}
