package com.quantaedge.bajaj.social;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.Base64;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * Exercises provider configuration gates and URL diagnostics without network access or persisted side effects.
 * All provider integrations are deliberately unconfigured in the service tests.
 */
class SocialProviderFailClosedTest {
  private static final String VALID_KEY = Base64.getEncoder().encodeToString(new byte[32]);

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
  void metaCallbackDiagnosticsRejectUnsafeSchemesAndRemoteHttpUrls() {
    for (String invalidUrl : new String[] {
        "http://callback.example.test",
        "ftp://callback.example.test/resource",
        "javascript:alert(1)",
        ""
    }) {
      assertTrue(meta(invalidUrl, "https://complete.example.test", "https://assets.example.test")
          .missingConnectionSettings().stream()
          .anyMatch(key -> key.startsWith("SOCIAL_META_REDIRECT_URI")));
      assertTrue(meta("https://callback.example.test", invalidUrl, "https://assets.example.test")
          .missingConnectionSettings().stream()
          .anyMatch(key -> key.startsWith("SOCIAL_META_COMPLETION_URL")));
    }
  }

  @Test
  void mediaConfigurationDiagnosticsAllowOnlyHttpsOrLoopbackOrigins() {
    for (String allowedUrl : new String[] {
        "https://assets.example.test",
        "https://assets.example.test/",
        "http://localhost:8080",
        "http://127.0.0.1:8080"
    }) {
      assertFalse(meta("https://callback.example.test", "https://complete.example.test", allowedUrl)
          .missingPublishingSettings().stream()
          .anyMatch(key -> key.startsWith("SOCIAL_MEDIA_PUBLIC_BASE_URL")));
    }

    for (String invalidUrl : new String[] {
        "http://assets.example.test",
        "https://assets.example.test/private",
        "https://assets.example.test/?token=secret",
        "https://assets.example.test/#fragment",
        ""
    }) {
      assertTrue(meta("https://callback.example.test", "https://complete.example.test", invalidUrl)
          .missingPublishingSettings().stream()
          .anyMatch(key -> key.startsWith("SOCIAL_MEDIA_PUBLIC_BASE_URL")));
    }
  }

  private SocialMetaService meta(String redirectUri, String completionUrl, String publicBaseUrl) {
    return new SocialMetaService(
        jdbc, mapper, true, "test-app-id", "test-app-secret", "v23.0",
        redirectUri, completionUrl, VALID_KEY, publicBaseUrl, VALID_KEY, "database");
  }

  private static void assertServiceUnavailable(Runnable action) {
    ResponseStatusException error =
        assertThrows(ResponseStatusException.class, action::run);
    assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.getStatusCode());
  }
}
