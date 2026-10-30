package com.quantaedge.bajaj.notifications;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Customer-only access to images embedded in campaigns sent to that customer.
 *
 * This deliberately does not share the staff media route or staff permission. An image
 * is visible only while it is referenced by a sent campaign in the authenticated
 * customer's non-dismissed inbox.
 */
@RestController
@RequestMapping("/api/v1/customer/notifications/media")
public class CustomerNotificationMediaController {
  private static final long MAX_IMAGE_BYTES = 4_500_000L;
  private static final List<String> ALLOWED_TYPES = List.of("image/png", "image/jpeg");

  private final JdbcTemplate jdbc;
  private final Path mediaRoot;

  public CustomerNotificationMediaController(
      JdbcTemplate jdbc,
      @Value("${app.notifications.media-root:./var/private-notification-media}") String configuredRoot) {
    this.jdbc = jdbc;
    this.mediaRoot = Path.of(configuredRoot).toAbsolutePath().normalize();
  }

  @GetMapping("/{assetId}")
  @PreAuthorize("hasAuthority('customer.portal')")
  public ResponseEntity<byte[]> read(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @PathVariable UUID assetId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select asset.mime_type, asset.byte_length, asset.sha256, asset.storage_key
        from notification_media_asset asset
        where asset.dealership_id = ? and asset.public_id = ? and asset.status = 'ACTIVE'
          and exists (
            select 1
            from notification_recipient recipient
            join notification_campaign campaign
              on campaign.id = recipient.campaign_id
             and campaign.dealership_id = recipient.dealership_id
            where recipient.dealership_id = asset.dealership_id
              and recipient.recipient_kind = 'CUSTOMER'
              and recipient.customer_id = ?
              and recipient.status <> 'DISMISSED'
              and campaign.status = 'SENT'
              and jsonb_path_exists(
                campaign.content_document,
                '$.**.assetId ? (@ == $assetId)'::jsonpath,
                jsonb_build_object('assetId', asset.public_id::text))
          )
        """, principal.dealershipId(), assetId, principal.customerId());

    if (rows.isEmpty()) {
      // Do not reveal whether another customer or dealership owns this asset.
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Notification image was not found.");
    }

    Map<String, Object> row = rows.getFirst();
    String mimeType = String.valueOf(row.get("mime_type"));
    long expectedLength = ((Number) row.get("byte_length")).longValue();
    String expectedSha256 = String.valueOf(row.get("sha256"));
    String storageKey = String.valueOf(row.get("storage_key"));
    if (!ALLOWED_TYPES.contains(mimeType) || expectedLength < 1 || expectedLength > MAX_IMAGE_BYTES) {
      throw new ResponseStatusException(HttpStatus.GONE, "Notification image is not available.");
    }

    Path assetPath = mediaRoot.resolve(storageKey).normalize();
    if (!assetPath.startsWith(mediaRoot)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Notification image was not found.");
    }

    try {
      byte[] bytes = Files.readAllBytes(assetPath);
      if (bytes.length != expectedLength
          || !mimeType.equals(detectImageType(bytes))
          || !sha256(bytes).equalsIgnoreCase(expectedSha256)) {
        throw new ResponseStatusException(HttpStatus.GONE, "Notification image failed integrity validation.");
      }

      return ResponseEntity.ok()
          .contentType(MediaType.parseMediaType(mimeType))
          .contentLength(bytes.length)
          .cacheControl(CacheControl.noStore())
          .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
          .header("X-Content-Type-Options", "nosniff")
          .header("Content-Security-Policy", "default-src 'none'; sandbox")
          .body(bytes);
    } catch (IOException failure) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Notification image was not found.");
    }
  }

  private static String detectImageType(byte[] bytes) {
    if (bytes.length >= 8
        && (bytes[0] & 0xff) == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e
        && bytes[3] == 0x47 && bytes[4] == 0x0d && bytes[5] == 0x0a
        && bytes[6] == 0x1a && bytes[7] == 0x0a) return "image/png";
    if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff
        && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff) return "image/jpeg";
    return "application/octet-stream";
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required by the Java runtime.", impossible);
    }
  }
}
