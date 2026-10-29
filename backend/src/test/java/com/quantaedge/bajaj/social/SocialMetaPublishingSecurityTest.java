package com.quantaedge.bajaj.social;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
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
class SocialMetaPublishingSecurityTest {
 @Autowired private MockMvc mvc;
 @Test void requiresAuthenticatedStaff() throws Exception {
  mvc.perform(post("/api/v1/admin/social/meta/publish").contentType(MediaType.APPLICATION_JSON).content("{\"destinationPublicId\":\"a0c4bd8f-9b65-4dce-8c2e-1a9b9e6d2ab1\",\"assetId\":\"b0c4bd8f-9b65-4dce-8c2e-1a9b9e6d2ab1\",\"caption\":\"Test\",\"idempotencyKey\":\"test-key-1234\"}")).andExpect(status().isUnauthorized());
 }
 @Test void manageWithoutPublishPermissionIsForbidden() throws Exception {
  mvc.perform(post("/api/v1/admin/social/meta/publish").with(user("social-account-manager").authorities(new SimpleGrantedAuthority("social_media.manage"))).contentType(MediaType.APPLICATION_JSON).content("{\"destinationPublicId\":\"a0c4bd8f-9b65-4dce-8c2e-1a9b9e6d2ab1\",\"assetId\":\"b0c4bd8f-9b65-4dce-8c2e-1a9b9e6d2ab1\",\"caption\":\"Test\",\"idempotencyKey\":\"test-key-1234\"}")).andExpect(status().isForbidden());
 }
 @Test void publishingPermissionCannotApproveWithoutManagementPermission() throws Exception {
  mvc.perform(post("/api/v1/admin/social/meta/publish-requests/00000000-0000-0000-0000-000000000001/approve")
    .with(user("social-publisher").authorities(new SimpleGrantedAuthority("social_media.publish"))))
    .andExpect(status().isForbidden());
 }
}
