package com.quantaedge.bajaj.social;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

/**
 * Shared storage boundary for social artwork. S3-compatible objects are private;
 * public access remains through the existing expiring, HMAC-signed API route.
 */
@Component
public class SocialMediaObjectStorage {
  private final Path root;
  private final String backend;
  private final String bucket;
  private final String region;
  private final String endpoint;
  private final String accessKey;
  private final String secretKey;
  private final boolean pathStyleAccess;
  private volatile S3Client client;

  public SocialMediaObjectStorage(
      @Value("${app.social.media.storage-backend:filesystem}") String backend,
      @Value("${app.social.media.media-root:./var/social-media-assets}") String root,
      @Value("${app.social.media.s3.bucket:}") String bucket,
      @Value("${app.social.media.s3.region:}") String region,
      @Value("${app.social.media.s3.endpoint:}") String endpoint,
      @Value("${app.social.media.s3.access-key:}") String accessKey,
      @Value("${app.social.media.s3.secret-key:}") String secretKey,
      @Value("${app.social.media.s3.path-style-access:true}") boolean pathStyleAccess) {
    this.backend = backend == null ? "" : backend.trim().toLowerCase(Locale.ROOT);
    this.root = Path.of(root).toAbsolutePath().normalize();
    this.bucket = clean(bucket);
    this.region = clean(region);
    this.endpoint = clean(endpoint);
    this.accessKey = clean(accessKey);
    this.secretKey = clean(secretKey);
    this.pathStyleAccess = pathStyleAccess;
  }

  public boolean isConfigured() {
    if ("filesystem".equals(backend)) {
      return true;
    }
    return "s3".equals(backend) && isS3ConfigurationValid();
  }

  public String newKey(String fileName) {
    requireConfigured();
    String safeName = safeFileName(fileName);
    return ("s3".equals(backend) ? "s3/" : "fs/") + safeName;
  }

  public void write(String storageKey, byte[] bytes, String contentType) {
    Key key = parseKey(storageKey);
    if ("s3".equals(key.backend())) {
      requireS3Configuration();
      try {
        s3Client().putObject(
            PutObjectRequest.builder()
                .bucket(bucket)
                .key(key.fileName())
                .contentType(contentType)
                .contentLength((long) bytes.length)
                .build(),
            RequestBody.fromBytes(bytes));
      } catch (RuntimeException e) {
        throw unavailable();
      }
      return;
    }
    Path path = localPath(key.fileName());
    try {
      Files.createDirectories(root);
      Files.write(path, bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    } catch (IOException e) {
      throw unavailable();
    }
  }

  public byte[] read(String storageKey) {
    Key key = parseKey(storageKey);
    if ("s3".equals(key.backend())) {
      requireS3Configuration();
      try {
        return s3Client().getObjectAsBytes(
            GetObjectRequest.builder().bucket(bucket).key(key.fileName()).build()).asByteArray();
      } catch (RuntimeException e) {
        throw unavailable();
      }
    }
    try {
      return Files.readAllBytes(localPath(key.fileName()));
    } catch (IOException e) {
      throw unavailable();
    }
  }

  /** Best-effort cleanup is used only when a database insert fails after upload. */
  public void delete(String storageKey) {
    try {
      Key key = parseKey(storageKey);
      if ("s3".equals(key.backend())) {
        requireS3Configuration();
        s3Client().deleteObject(
            DeleteObjectRequest.builder().bucket(bucket).key(key.fileName()).build());
      } else {
        Files.deleteIfExists(localPath(key.fileName()));
      }
    } catch (RuntimeException | IOException ignored) {
      // Never hide the original database/storage failure with a cleanup error.
    }
  }

  private S3Client s3Client() {
    S3Client current = client;
    if (current != null) {
      return current;
    }
    synchronized (this) {
      if (client != null) {
        return client;
      }
      var builder = S3Client.builder().region(Region.of(region));
      if (!accessKey.isBlank()) {
        builder.credentialsProvider(
            StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey)));
      } else {
        // Allows workload/IAM role credentials without putting long-lived keys in deployment env.
        builder.credentialsProvider(DefaultCredentialsProvider.create());
      }
      if (!endpoint.isBlank()) {
        builder.endpointOverride(URI.create(endpoint));
        builder.serviceConfiguration(
            S3Configuration.builder().pathStyleAccessEnabled(pathStyleAccess).build());
      }
      client = builder.build();
      return client;
    }
  }

  private boolean isS3ConfigurationValid() {
    if (bucket.isBlank() || region.isBlank()) {
      return false;
    }
    if (accessKey.isBlank() != secretKey.isBlank()) {
      return false;
    }
    return endpoint.isBlank() || (!accessKey.isBlank() && isSafeEndpoint(endpoint));
  }

  private void requireConfigured() {
    if (!isConfigured()) {
      throw unavailable();
    }
  }

  private void requireS3Configuration() {
    if (!isS3ConfigurationValid()) {
      throw unavailable();
    }
  }

  private Path localPath(String fileName) {
    Path path = root.resolve(safeFileName(fileName)).normalize();
    if (!path.startsWith(root)) {
      throw notFound();
    }
    return path;
  }

  private static Key parseKey(String raw) {
    if (raw == null || raw.isBlank() || raw.length() > 340) {
      throw notFound();
    }
    if (raw.startsWith("s3/")) {
      return new Key("s3", safeFileName(raw.substring(3)));
    }
    if (raw.startsWith("fs/")) {
      return new Key("filesystem", safeFileName(raw.substring(3)));
    }
    // Pre-object-storage records used a bare UUID.jpg filename on the local disk.
    return new Key("filesystem", safeFileName(raw));
  }

  private static String safeFileName(String value) {
    if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,299}")) {
      throw notFound();
    }
    return value;
  }

  private static boolean isSafeEndpoint(String raw) {
    try {
      URI uri = URI.create(raw);
      String scheme = uri.getScheme();
      boolean secure = "https".equalsIgnoreCase(scheme)
          || ("http".equalsIgnoreCase(scheme)
              && ("localhost".equalsIgnoreCase(uri.getHost())
                  || "127.0.0.1".equalsIgnoreCase(uri.getHost())
                  || "::1".equals(uri.getHost())));
      return secure && uri.isAbsolute() && uri.getHost() != null
          && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null
          && (uri.getPath() == null || uri.getPath().isBlank() || "/".equals(uri.getPath()));
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  private static String clean(String raw) {
    return raw == null ? "" : raw.trim();
  }

  private static ResponseStatusException unavailable() {
    return new ResponseStatusException(
        HttpStatus.SERVICE_UNAVAILABLE, "Artwork storage is unavailable.");
  }

  private static ResponseStatusException notFound() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Artwork is unavailable.");
  }

  @PreDestroy
  public void close() {
    S3Client current = client;
    if (current != null) {
      current.close();
    }
  }

  private record Key(String backend, String fileName) {}
}
