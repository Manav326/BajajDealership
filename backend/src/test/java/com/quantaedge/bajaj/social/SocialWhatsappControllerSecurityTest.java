package com.quantaedge.bajaj.social;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class SocialWhatsappControllerSecurityTest {
 @Autowired private MockMvc mvc;
 @Test void statusNeedsAuthentication() throws Exception {mvc.perform(get("/api/v1/admin/social/whatsapp/status")).andExpect(status().isUnauthorized());}
 @Test void genericSocialManageCannotChangeWhatsappConsent() throws Exception {
  mvc.perform(post("/api/v1/admin/social/whatsapp/customers/00000000-0000-0000-0000-000000000001/consent")
   .with(user("social-manager").authorities(new SimpleGrantedAuthority("social_media.manage")))
   .contentType(MediaType.APPLICATION_JSON).content("{\"optedIn\":true,\"source\":\"customer request\"}")).andExpect(status().isForbidden());
 }
 @Test void badWebhookTokenIsRejected() throws Exception {
  mvc.perform(get("/api/v1/social/whatsapp/webhook").queryParam("hub.mode","subscribe").queryParam("hub.verify_token","wrong").queryParam("hub.challenge","123"))
   .andExpect(status().isForbidden());
 }
 @Test void readPermissionCannotScheduleWhatsAppMessages() throws Exception {
  mvc.perform(post("/api/v1/admin/social/whatsapp/schedule")
    .with(user("social-reader").authorities(new SimpleGrantedAuthority("social_media.whatsapp.read")))
    .contentType(MediaType.APPLICATION_JSON)
    .content("{\"customerPublicId\":\"00000000-0000-0000-0000-000000000001\",\"templateName\":\"approved_template\",\"languageCode\":\"en\",\"bodyParameters\":[],\"idempotencyKey\":\"schedule-test-123\",\"scheduledAt\":\"2026-12-01T10:00:00Z\"}"))
   .andExpect(status().isForbidden());
 }
}
