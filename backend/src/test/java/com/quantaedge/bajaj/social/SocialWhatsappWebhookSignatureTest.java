package com.quantaedge.bajaj.social;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.social.SocialMediaAssetService;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class SocialWhatsappWebhookSignatureTest {
  private static final String APP_SECRET = "test-meta-app-secret";
  private static final byte[] BODY =
      "{\"entry\":[{\"changes\":[{\"value\":{\"statuses\":[]}}]}]}"
          .getBytes(StandardCharsets.UTF_8);

  @Test
  void acceptsOnlyTheExactHmacForTheUnmodifiedRequestBody() throws Exception {
    SocialWhatsappService service = service(true);

    assertTrue(service.verifyWebhookSignature(BODY, signature(BODY, APP_SECRET)));

    byte[] alteredBody = "{\"entry\":[]}".getBytes(StandardCharsets.UTF_8);
    assertFalse(service.verifyWebhookSignature(alteredBody, signature(BODY, APP_SECRET)));
    assertFalse(service.verifyWebhookSignature(BODY, signature(BODY, "different-secret")));
  }

  @Test
  void rejectsMissingMalformedAndDisabledWebhookSignatures() throws Exception {
    String valid = signature(BODY, APP_SECRET);
    SocialWhatsappService enabled = service(true);
    SocialWhatsappService disabled = service(false);

    assertFalse(enabled.verifyWebhookSignature(BODY, null));
    assertFalse(enabled.verifyWebhookSignature(BODY, ""));
    assertFalse(enabled.verifyWebhookSignature(BODY, "sha256=not-the-hmac"));
    assertFalse(disabled.verifyWebhookSignature(BODY, valid));
  }

  @Test
  void verifiesWebhookChallengeWithConfiguredTokenOnly() {
    SocialWhatsappService service = service(true);

    assertTrue(service.verifyWebhook("subscribe", "test-verify-token", "challenge-123"));
    assertFalse(service.verifyWebhook("subscribe", "wrong-token", "challenge-123"));
    assertFalse(service.verifyWebhook("unsubscribe", "test-verify-token", "challenge-123"));
    assertFalse(service.verifyWebhook("subscribe", "test-verify-token", null));
  }

  private static SocialWhatsappService service(boolean enabled) {
    return new SocialWhatsappService(
        mock(JdbcTemplate.class),
        new ObjectMapper(),
        mock(SocialMediaAssetService.class),
        enabled,
        "v23.0",
        "test-phone-number-id",
        "test-business-account-id",
        "test-access-token",
        "test-verify-token",
        APP_SECRET,
        "LUCKY-BAJAJ");
  }

  private static String signature(byte[] body, String secret) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body));
  }
}
