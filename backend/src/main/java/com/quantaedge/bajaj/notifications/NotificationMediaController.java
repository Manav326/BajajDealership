package com.quantaedge.bajaj.notifications;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

/** Private, dealership-scoped image storage for the rich notification editor. */
@RestController
@RequestMapping("/api/v1/admin/notifications/media")
public class NotificationMediaController {
  private static final long MAX_IMAGE_BYTES = 4_500_000L;
  private static final long MAX_IMAGE_PIXELS = 20_000_000L;
  private static final List<String> ALLOWED_TYPES = List.of("image/png", "image/jpeg");
  private final JdbcTemplate jdbc;
  private final Path mediaRoot;

  public NotificationMediaController(
      JdbcTemplate jdbc,
      @Value("${app.notifications.media-root:./var/private-notification-media}") String configuredRoot) {
    this.jdbc = jdbc;
    this.mediaRoot = Path.of(configuredRoot).toAbsolutePath().normalize();
  }

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @PreAuthorize("hasAuthority('notification.create')")
  @Transactional
  public MediaAsset upload(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestPart("file") MultipartFile file) {
    if (file == null || file.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose an image before uploading.");
    }
    if (file.getSize() > MAX_IMAGE_BYTES) {
      throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Images must be 4.5 MB or smaller.");
    }

    String declaredType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(java.util.Locale.ROOT);
    if (!ALLOWED_TYPES.contains(declaredType)) {
      throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Only PNG and JPEG images are currently supported.");
    }

    byte[] bytes;
    try {
      bytes = file.getBytes();
    } catch (IOException failure) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The image could not be read.");
    }
    String actualType = detectImageType(bytes);
    if (!declaredType.equals(actualType)) {
      throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "The uploaded file content does not match its image type.");
    }

    java.awt.image.BufferedImage image;
    try (java.io.ByteArrayInputStream input = new java.io.ByteArrayInputStream(bytes)) {
      image = ImageIO.read(input);
    } catch (IOException failure) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The image could not be decoded.");
    }
    if (image == null || image.getWidth() < 1 || image.getHeight() < 1
        || (long) image.getWidth() * image.getHeight() > MAX_IMAGE_PIXELS) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The image dimensions are invalid or too large.");
    }

    UUID assetId = UUID.randomUUID();
    String extension = "image/png".equals(actualType) ? ".png" : ".jpg";
    String relativeKey = principal.dealershipId() + "/" + assetId + extension;
    Path destination = mediaRoot.resolve(relativeKey).normalize();
    if (!destination.startsWith(mediaRoot)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid media location.");
    }
    try {
      Files.createDirectories(destination.getParent());
      Files.write(destination, bytes);
    } catch (IOException failure) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "The image could not be saved securely.");
    }

    String altText = safeFileLabel(file.getOriginalFilename());
    int inserted;
    try {
      inserted = jdbc.update("""
          insert into notification_media_asset(
            public_id, dealership_id, created_by_staff_user_id, asset_kind, mime_type,
            byte_length, sha256, width, height, storage_key, alt_text, decorative, status)
          values (?, ?, ?, 'IMAGE', ?, ?, ?, ?, ?, ?, ?, false, 'ACTIVE')
          """,
          assetId, principal.dealershipId(), principal.staffUserId(), actualType, bytes.length,
          sha256(bytes), image.getWidth(), image.getHeight(), relativeKey, altText);
    } catch (RuntimeException failure) {
      try { Files.deleteIfExists(destination); } catch (IOException ignored) { /* Preserve the database error. */ }
      throw failure;
    }
    if (inserted != 1) {
      try { Files.deleteIfExists(destination); } catch (IOException ignored) { /* No row was persisted. */ }
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "The image metadata could not be saved.");
    }

    return new MediaAsset(assetId, actualType, bytes.length, image.getWidth(), image.getHeight(), altText,
        "/api/v1/admin/notifications/media/" + assetId, Instant.now());
  }

  @GetMapping("/{assetId}")
  @PreAuthorize("hasAuthority('notification.read')")
  public ResponseEntity<byte[]> read(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID assetId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select mime_type, byte_length, storage_key, status
        from notification_media_asset
        where dealership_id = ? and public_id = ?
        """, principal.dealershipId(), assetId);
    if (rows.isEmpty() || !"ACTIVE".equals(String.valueOf(rows.getFirst().get("status")))) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Notification image was not found.");
    }
    Map<String, Object> row = rows.getFirst();
    String mimeType = String.valueOf(row.get("mime_type"));
    if (!ALLOWED_TYPES.contains(mimeType)) {
      throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "This media type is not available.");
    }
    Path assetPath = mediaRoot.resolve(String.valueOf(row.get("storage_key"))).normalize();
    if (!assetPath.startsWith(mediaRoot)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Notification image was not found.");
    }
    try {
      byte[] bytes = Files.readAllBytes(assetPath);
      if (bytes.length != ((Number) row.get("byte_length")).longValue()
          || !mimeType.equals(detectImageType(bytes))) {
        throw new ResponseStatusException(HttpStatus.GONE, "Notification image failed integrity validation.");
      }
      return ResponseEntity.ok()
          .contentType(MediaType.parseMediaType(mimeType))
          .contentLength(bytes.length)
          .cacheControl(CacheControl.noStore())
          .header(HttpHeaders.X_CONTENT_TYPE_OPTIONS, "nosniff")
          .header(HttpHeaders.CONTENT_SECURITY_POLICY, "default-src 'none'; sandbox")
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

  private static String safeFileLabel(String name) {
    String extension = StringUtils.getFilenameExtension(name == null ? "" : name);
    if (extension == null) return "Notification image";
    String normalized = extension.toLowerCase(java.util.Locale.ROOT);
    if (!List.of("png", "jpg", "jpeg").contains(normalized)) return "Notification image";
    return "Notification image (" + normalized + ")";
  }

  public record MediaAsset(
      UUID assetId, String mimeType, long byteLength, int width, int height,
      String altText, String mediaUrl, Instant createdAt) {}
}
