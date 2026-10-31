package com.quantaedge.bajaj.social;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * Exercises provider configuration gates and URL safety without network access or persisted side effects.
 * All provider integrations are deliberately unconfigured in these tests.
 */
class SocialProviderFailClosedTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final ObjectMapper mapper = new ObjectMapper();
  private final SocialMediaObjectStorage storage =
      new SocialMediaObjectStorage(jdbc, "", "./var/test-social-media");
  private final SocialMediaAssetService assets =
      new SocialMediaAssetService(jdbc, mapper, storage, "", "");
  private final SocialMetaService meta =
      new SocialMetaService(jdbc, mapper, false, "", "", "", "", "", "", "", "", "");
  private final SocialWhatsappService whatsapp =
      new SocialWhatsappService(jdbc, mapper, assets, false, "", "", "", "", "", "", "");
  private final StaffPrincipal actor = new StaffPrincipal(
      1L, 2L, "ci-staff-public-id", 3L, "ci-dealership-public-id",
      "CI-LUCKY-BAJAJ", "CI Test Owner", Set.of("OWNER"), Set.of());

  @Test
  void metaAuthorizationFailsClosedBeforePersistingOauthState() {
    assertServiceUnavailable(() -> meta.beginAuthorization(actor));

    verifyNoInteractions(jdbc);
  }

  @Test
  void directPublishingAndApprovalFailClosedBeforeCreatingJobs() {
    SocialMetaPublishingService publishing = new SocialMetaPublishingService(jdbc, meta, assets);
    SocialMediaWorkflowService workflow =
        new SocialMediaWorkflowService(jdbc, mapper, meta, assets, publishing);

    assertServiceUnavailable(() -> publishing.publish(actor, null));
    assertServiceUnavailable(() -> workflow.requestApproval(actor, null));

    verifyNoInteractions(jdbc);
  }

  @Test
  void artworkUploadFailsClosedBeforeReadingOrWritingAnAsset() {
    assertServiceUnavailable(() -> assets.upload(actor, null));

    verifyNoInteractions(jdbc);
  }

  @Test
  void whatsappSendFailsClosedBeforeLookingUpCustomerOrConsent() {
    assertServiceUnavailable(() -> whatsapp.send(actor, null));

    verifyNoInteractions(jdbc);
  }

  @Test
  void whatsappScheduleRejectsMissingRequestBeforeProviderOrDatabaseAccess() {
    ResponseStatusException error = assertThrows(
        ResponseStatusException.class,
        () -> new SocialWhatsappScheduleService(jdbc, mapper, whatsapp, assets).schedule(actor, null));

    assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
    verifyNoInteractions(jdbc);
  }

  @Test
  void mediaPublicBaseUrlAllowsOnlyHttpsOrLoopbackOriginsWithoutPathOrQuery() {
    assertTrue(SocialMetaService.isSafePublicBaseUrl("https://assets.example.test"));
    assertTrue(SocialMetaService.isSafePublicBaseUrl("https://assets.example.test/"));
    assertTrue(SocialMetaService.isSafePublicBaseUrl("http://localhost:8080"));
    assertTrue(SocialMetaService.isSafePublicBaseUrl("http://127.0.0.1:8080"));

    assertFalse(SocialMetaService.isSafePublicBaseUrl("http://assets.example.test"));
    assertFalse(SocialMetaService.isSafePublicBaseUrl("https://assets.example.test/private"));
    assertFalse(SocialMetaService.isSafePublicBaseUrl("https://assets.example.test/?token=secret"));
    assertFalse(SocialMetaService.isSafePublicBaseUrl("https://assets.example.test/#fragment"));
    assertFalse(SocialMetaService.isSafePublicBaseUrl(""));
  }

  @Test
  void providerUrlsMustUseHttpsOrLocalhostHttp() {
    assertTrue(SocialMetaService.isAbsoluteHttpUrl("https://graph.example.test/v23.0"));
    assertTrue(SocialMetaService.isAbsoluteHttpUrl("http://localhost:8080/callback"));
    assertTrue(SocialMetaService.isAbsoluteHttpUrl("http://127.0.0.1:8080/callback"));

    assertFalse(SocialMetaService.isAbsoluteHttpUrl("http://graph.example.test"));
    assertFalse(SocialMetaService.isAbsoluteHttpUrl("ftp://graph.example.test/resource"));
    assertFalse(SocialMetaService.isAbsoluteHttpUrl("javascript:alert(1)"));
    assertFalse(SocialMetaService.isAbsoluteHttpUrl(""));
    assertFalse(SocialMetaService.isAbsoluteHttpUrl(null));
  }

  @Test
  void metaProviderFailuresExposeOnlySanitizedFailureCategories() {
    assertEquals("connection_failed",
        SocialMetaService.safeFailureCode(new IllegalStateException("access_token=private")));
    assertEquals("configuration_unavailable",
        SocialMetaService.safeFailureCode(
            new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "private configuration value")));
  }

  private static void assertServiceUnavailable(Runnable action) {
    ResponseStatusException error =
        assertThrows(ResponseStatusException.class, action::run);
    assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.getStatusCode());
  }
}
