package com.quantaedge.bajaj.social;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class SocialConfigurationVisibilityTest {

  @Test
  void metaDiagnosticsListMissingConnectionAndPublishingKeysWithoutSecretValues() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    SocialMetaService meta = new SocialMetaService(
        jdbc, new ObjectMapper(), false, "", "", "", "", "", "", "", "", "");

    List<String> connectionKeys = meta.missingConnectionSettings();
    assertTrue(connectionKeys.contains("SOCIAL_META_ENABLED (set to true after credentials are supplied)"));
    assertTrue(connectionKeys.contains("SOCIAL_META_APP_ID"));
    assertTrue(connectionKeys.contains("SOCIAL_META_APP_SECRET"));
    assertTrue(connectionKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_META_GRAPH_API_VERSION")));
    assertTrue(connectionKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_META_REDIRECT_URI")));
    assertTrue(connectionKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_META_COMPLETION_URL")));
    assertTrue(connectionKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_META_TOKEN_ENCRYPTION_KEY_BASE64")));

    List<String> publishingKeys = meta.missingPublishingSettings();
    assertTrue(publishingKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_MEDIA_PUBLIC_BASE_URL")));
    assertTrue(publishingKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_MEDIA_ASSET_SIGNING_KEY_BASE64")));
    assertTrue(publishingKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_MEDIA_STORAGE_BACKEND")));
  }

  @Test
  void whatsappDiagnosticsListMissingMessagingAndWebhookKeys() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    SocialMediaObjectStorage storage = new SocialMediaObjectStorage(jdbc, "", "./var/test-social-media");
    SocialMediaAssetService assets = new SocialMediaAssetService(
        jdbc, new ObjectMapper(), storage, "", "");
    SocialWhatsappService whatsapp = new SocialWhatsappService(
        jdbc, new ObjectMapper(), assets, false, "", "", "", "", "", "", "");

    List<String> messagingKeys = whatsapp.missingConfigurationKeys(123L);
    assertTrue(messagingKeys.contains("SOCIAL_WHATSAPP_ENABLED (set to true after credentials are supplied)"));
    assertTrue(messagingKeys.stream().anyMatch(key -> key.startsWith("SOCIAL_META_GRAPH_API_VERSION")));
    assertTrue(messagingKeys.contains("SOCIAL_WHATSAPP_PHONE_NUMBER_ID"));
    assertTrue(messagingKeys.contains("SOCIAL_WHATSAPP_BUSINESS_ACCOUNT_ID"));
    assertTrue(messagingKeys.contains("SOCIAL_WHATSAPP_ACCESS_TOKEN"));
    assertTrue(messagingKeys.contains("SOCIAL_WHATSAPP_DEALERSHIP_CODE"));

    List<String> webhookKeys = whatsapp.missingWebhookConfigurationKeys();
    assertTrue(webhookKeys.contains("SOCIAL_WHATSAPP_VERIFY_TOKEN"));
    assertTrue(webhookKeys.contains("SOCIAL_META_APP_SECRET"));
    assertTrue(webhookKeys.contains("SOCIAL_WHATSAPP_PHONE_NUMBER_ID"));
    assertTrue(webhookKeys.contains("SOCIAL_WHATSAPP_DEALERSHIP_CODE (must match an active dealership)"));
  }

  @Test
  void artworkDiagnosticsListPublicUrlStorageAndSigningRequirements() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    SocialMediaObjectStorage storage = new SocialMediaObjectStorage(jdbc, "", "./var/test-social-media");
    SocialMediaAssetService assets = new SocialMediaAssetService(
        jdbc, new ObjectMapper(), storage, "", "");

    List<String> missing = assets.missingConfigurationKeys();
    assertTrue(missing.stream().anyMatch(key -> key.startsWith("SOCIAL_MEDIA_PUBLIC_BASE_URL")));
    assertTrue(missing.stream().anyMatch(key -> key.startsWith("SOCIAL_MEDIA_STORAGE_BACKEND")));
    assertTrue(missing.stream().anyMatch(key -> key.startsWith("SOCIAL_MEDIA_ASSET_SIGNING_KEY_BASE64")));
  }
}
