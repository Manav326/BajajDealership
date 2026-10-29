package com.quantaedge.bajaj.social;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stores small campaign images in the existing database by default, avoiding a separate paid
 * storage service. Filesystem mode remains available for local development and legacy files.
 */
@Component
public class SocialMediaObjectStorage {
  private final JdbcTemplate jdbc;
  private final Path root;
  private final String backend;

  public SocialMediaObjectStorage(
      JdbcTemplate jdbc,
      @Value("${app.social.media.storage-backend:database}") String backend,
      @Value("${app.social.media.media-root:./var/social-media-assets}") String root) {
    this.jdbc = jdbc;
    this.backend = backend == null ? "" : backend.trim().toLowerCase(Locale.ROOT);
    this.root = Path.of(root).toAbsolutePath().normalize();
  }

  public boolean isConfigured() {
    return "database".equals(backend) || "filesystem".equals(backend);
  }

  public String newKey(String fileName) {
    requireConfigured();
    return ("database".equals(backend) ? "db/" : "fs/") + safeFileName(fileName);
  }

  public void write(String storageKey, byte[] bytes, String contentType) {
    Key key = parseKey(storageKey);
    if ("database".equals(key.backend())) {
      if (jdbc == null || bytes == null || bytes.length == 0 || bytes.length > 4_500_000
          || !"image/jpeg".equals(contentType)) {
        throw unavailable();
      }
      try {
        jdbc.update("""
            insert into social_media_object_storage(storage_key, content_type, content, byte_length)
            values (?, ?, ?, ?)
            """, key.storageKey(), contentType, bytes, (long) bytes.length);
      } catch (DataAccessException e) {
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
    if ("database".equals(key.backend())) {
      if (jdbc == null) throw unavailable();
      try {
        return jdbc.queryForObject("""
            select content from social_media_object_storage where storage_key = ?
            """, byte[].class, key.storageKey());
      } catch (EmptyResultDataAccessException e) {
        throw notFound();
      } catch (DataAccessException e) {
        throw unavailable();
      }
    }
    try {
      return Files.readAllBytes(localPath(key.fileName()));
    } catch (IOException e) {
      throw notFound();
    }
  }

  /** Best-effort cleanup if the asset metadata insert fails after the content has been stored. */
  public void delete(String storageKey) {
    try {
      Key key = parseKey(storageKey);
      if ("database".equals(key.backend())) {
        if (jdbc != null) {
          jdbc.update("delete from social_media_object_storage where storage_key = ?", key.storageKey());
        }
      } else {
        Files.deleteIfExists(localPath(key.fileName()));
      }
    } catch (RuntimeException | IOException ignored) {
      // Never hide the original database/storage failure with a cleanup error.
    }
  }

  private Path localPath(String fileName) {
    Path path = root.resolve(safeFileName(fileName)).normalize();
    if (!path.startsWith(root)) throw notFound();
    return path;
  }

  private static Key parseKey(String raw) {
    if (raw == null || raw.isBlank() || raw.length() > 340) throw notFound();
    if (raw.startsWith("db/")) {
      return new Key("database", safeFileName(raw.substring(3)), raw);
    }
    if (raw.startsWith("fs/")) {
      return new Key("filesystem", safeFileName(raw.substring(3)), raw);
    }
    // Pre-storage-boundary records used a bare UUID.jpg filename on local disk.
    return new Key("filesystem", safeFileName(raw), raw);
  }

  private static String safeFileName(String value) {
    if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,299}")) {
      throw notFound();
    }
    return value;
  }

  private void requireConfigured() {
    if (!isConfigured()) throw unavailable();
  }

  private static ResponseStatusException unavailable() {
    return new ResponseStatusException(
        HttpStatus.SERVICE_UNAVAILABLE, "Artwork storage is unavailable.");
  }

  private static ResponseStatusException notFound() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Artwork is unavailable.");
  }

  private record Key(String backend, String fileName, String storageKey) {}
}
