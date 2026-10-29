package com.quantaedge.bajaj.social;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

class SocialMediaObjectStorageTest {
  @TempDir Path tempDir;

  @Test
  void filesystemStorageRoundTripsObjectsAndRemovesFailedUploads() {
    SocialMediaObjectStorage storage = filesystemStorage();
    byte[] bytes = "campaign-artwork".getBytes(StandardCharsets.UTF_8);
    String key = storage.newKey("asset-123.jpg");

    assertEquals("fs/asset-123.jpg", key);
    storage.write(key, bytes, "image/jpeg");
    assertArrayEquals(bytes, storage.read(key));

    storage.delete(key);
    assertFalse(Files.exists(tempDir.resolve("assets").resolve("asset-123.jpg")));
    storage.close();
  }

  @Test
  void oldBareFilesystemKeysRemainReadable() throws Exception {
    SocialMediaObjectStorage storage = filesystemStorage();
    Path oldAsset = tempDir.resolve("assets").resolve("old-asset.jpg");
    Files.createDirectories(oldAsset.getParent());
    byte[] bytes = "legacy".getBytes(StandardCharsets.UTF_8);
    Files.write(oldAsset, bytes);

    assertArrayEquals(bytes, storage.read("old-asset.jpg"));
    storage.close();
  }

  @Test
  void rejectsPathTraversalInsteadOfReadingOutsideStorageRoot() {
    SocialMediaObjectStorage storage = filesystemStorage();
    assertThrows(ResponseStatusException.class, () -> storage.read("../outside.jpg"));
    storage.close();
  }

  @Test
  void s3BackendIsUnavailableUntilBucketAndRegionAreConfigured() {
    SocialMediaObjectStorage storage = new SocialMediaObjectStorage(
        "s3", tempDir.resolve("assets").toString(), "", "", "", "", "", true);
    assertFalse(storage.isConfigured());
    assertThrows(ResponseStatusException.class, () -> storage.newKey("asset.jpg"));
    storage.close();
  }

  @Test
  void s3BackendUsesNamespacedKeysWhenConfiguredForRoleCredentials() {
    SocialMediaObjectStorage storage = new SocialMediaObjectStorage(
        "s3", tempDir.resolve("assets").toString(), "campaign-assets", "ap-south-1",
        "", "", "", true);

    assertTrue(storage.isConfigured());
    assertEquals("s3/asset-123.jpg", storage.newKey("asset-123.jpg"));
    storage.close();
  }

  private SocialMediaObjectStorage filesystemStorage() {
    return new SocialMediaObjectStorage(
        "filesystem", tempDir.resolve("assets").toString(), "", "", "", "", "", true);
  }
}
