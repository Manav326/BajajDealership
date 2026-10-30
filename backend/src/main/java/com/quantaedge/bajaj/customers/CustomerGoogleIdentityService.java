package com.quantaedge.bajaj.customers;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.jackson2.JacksonFactory;
import java.io.IOException;
import java.net.URI;
import java.security.GeneralSecurityException;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Verifies Google Identity Services ID tokens exactly as QuantaEdge does:
 * provider-signed token, expiry/issuer checks and one centrally configured audience.
 * No email or profile field supplied outside the verified token is trusted.
 */
@Service
public class CustomerGoogleIdentityService {
  private final String clientId;
  private final String androidClientId;
  private final GoogleIdTokenVerifier verifier;

  public CustomerGoogleIdentityService(
      @Value("${app.auth.google-client-id:}") String clientId,
      @Value("${app.auth.google-android-client-id:}") String androidClientId) {
    this.clientId = clientId == null ? "" : clientId.trim();
    this.androidClientId = androidClientId == null ? "" : androidClientId.trim();
    List<String> audiences = java.util.stream.Stream.of(this.clientId, this.androidClientId)
        .filter(value -> !value.isBlank())
        .distinct()
        .toList();
    this.verifier = audiences.isEmpty() ? null
        : new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), JacksonFactory.getDefaultInstance())
            .setAudience(audiences)
            .build();
  }

  /** Public OAuth client IDs are not secrets; client secrets must never be sent to a client. */
  public String publicClientId() {
    return clientId;
  }

  public String publicAndroidClientId() {
    return androidClientId;
  }

  public VerifiedIdentity verify(String credential) {
    if (verifier == null) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
          "Google sign-in is not configured. Configure GOOGLE_WEB_CLIENT_ID and/or GOOGLE_ANDROID_CLIENT_ID as applicable.");
    }
    if (credential == null || credential.isBlank() || credential.length() > 12000) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Google did not return a valid sign-in credential. Please try again.");
    }

    final GoogleIdToken token;
    try {
      token = verifier.verify(credential);
    } catch (GeneralSecurityException | IOException ex) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
          "Google sign-in could not be verified. Please try again.", ex);
    }
    if (token == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
          "Google sign-in token is invalid, expired, or was issued to another application.");
    }

    GoogleIdToken.Payload payload = token.getPayload();
    String subject = safeText(payload.getSubject(), 255);
    String email = safeText(payload.getEmail(), 320).toLowerCase(Locale.ROOT);
    String name = safeText(payload.get("name"), 120);
    boolean emailVerified = Boolean.TRUE.equals(payload.getEmailVerified());
    String pictureUrl = safePicture(payload.get("picture"));

    if (subject.isBlank() || !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
        || !emailVerified) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
          "Google must confirm a verified email address before you can continue.");
    }
    if (name.isBlank()) name = email.substring(0, email.indexOf('@'));
    return new VerifiedIdentity(subject, email, name, pictureUrl);
  }

  private static String safeText(Object value, int maxLength) {
    if (value == null) return "";
    String text = String.valueOf(value).trim();
    return text.length() <= maxLength ? text : text.substring(0, maxLength);
  }

  private static String safePicture(Object value) {
    String url = safeText(value, 2048);
    if (url.isBlank()) return null;
    try {
      URI uri = URI.create(url);
      String host = uri.getHost();
      if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
          || !(host.equals("googleusercontent.com") || host.endsWith(".googleusercontent.com"))) {
        return null;
      }
      return url;
    } catch (IllegalArgumentException ex) {
      return null;
    }
  }

  public record VerifiedIdentity(String subject, String email, String name, String pictureUrl) {}
}
