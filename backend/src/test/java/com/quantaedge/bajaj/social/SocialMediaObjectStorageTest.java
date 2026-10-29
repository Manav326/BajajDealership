package com.quantaedge.bajaj.social;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class SocialMediaObjectStorageTest {
  @TempDir Path tempDir;

  @Test
  void filesystemStorageRoundTripsObjectsAndRemovesUploads() {
    SocialMediaObjectStorage storage = filesystemStorage();
    byte[] bytes = "campaign-artwork".getBytes(StandardCharsets.UTF_8);
    String key = storage.newKey("asset-123.jpg");

    assertEquals("fs/asset-123.jpg", key);
    storage.write(key, bytes, "image/jpeg");
    assertArrayEquals(bytes, storage.read(key));

    storage.delete(key);
    assertFalse(Files.exists(tempDir.resolve("assets").resolve("asset-123.jpg")));
  }

  @Test
  void databaseStorageRoundTripsContentWithoutExternalStorageCredentials() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    SocialMediaObjectStorage storage =
        new SocialMediaObjectStorage(jdbc, "database", tempDir.resolve("assets").toString());
    byte[] bytes = "campaign-artwork".getBytes(StandardCharsets.UTF_8);
    String key = storage.newKey("asset-123.jpg");
    assertEquals("db/asset-123.jpg", key);
    assertTrue(storage.isConfigured());

    when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
    storage.write(key, bytes, "image/jpeg");
    when(jdbc.queryForObject(anyString(), eq(byte[].class), eq(key))).thenReturn(bytes);
    assertArrayEquals(bytes, storage.read(key));

    storage.delete(key);
    verify(jdbc).update(eq("delete from social_media_object_storage where storage_key = ?"),
        (Object[]) org.mockito.ArgumentMatchers.argThat(args -> args != null
            && args.length == 1 && key.equals(args[0])));
  }

  @Test
  void oldBareFilesystemKeysRemainReadable() throws Exception {
    SocialMediaObjectStorage storage = filesystemStorage();
    Path oldAsset = tempDir.resolve("assets").resolve("old-asset.jpg");
    Files.createDirectories(oldAsset.getParent());
    byte[] bytes = "legacy".getBytes(StandardCharsets.UTF_8);
    Files.write(oldAsset, bytes);

    assertArrayEquals(bytes, storage.read("old-asset.jpg"));
  }

  @Test
  void rejectsPathTraversalInsteadOfReadingOutsideStorageRoot() {
    SocialMediaObjectStorage storage = filesystemStorage();
    assertThrows(ResponseStatusException.class, () -> storage.read("../outside.jpg"));
  }

  @Test
  void databaseStorageRejectsUnsupportedContentTypes() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    SocialMediaObjectStorage storage =
        new SocialMediaObjectStorage(jdbc, "database", tempDir.resolve("assets").toString());
    assertThrows(ResponseStatusException.class,
        () -> storage.write(storage.newKey("asset-123.jpg"), new byte[] {1}, "text/plain"));
  }

  @Test
  void invalidStorageBackendIsNotConfigured() {
    SocialMediaObjectStorage storage =
        new SocialMediaObjectStorage(null, "unknown", tempDir.resolve("assets").toString());
    assertFalse(storage.isConfigured());
    assertThrows(ResponseStatusException.class, () -> storage.newKey("asset.jpg"));
  }

  private SocialMediaObjectStorage filesystemStorage() {
    return new SocialMediaObjectStorage(
        null, "filesystem", tempDir.resolve("assets").toString());
  }
}
