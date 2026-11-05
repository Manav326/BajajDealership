package com.quantaedge.bajaj.downloads;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Resolves the latest complete stable Lucky Bajaj release and streams its
 * public assets through the dealership API. GitHub redirects are followed
 * server-side so browsers can measure real download progress on a same-origin
 * response without being sent to a third-party redirect target.
 */
@Service
public class PublicDownloadService {
  private static final Duration RELEASE_CACHE_TTL = Duration.ofMinutes(2);
  private static final int MAX_REDIRECTS = 5;
  private static final Pattern STABLE_TAG = Pattern.compile("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
  private static final Pattern SINGLE_RANGE = Pattern.compile("^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$");

  private static final Map<String, String> DOWNLOAD_ASSETS = Map.of(
      "android-standard", "LuckyBajaj-Android.apk",
      "android-liquid-glass", "LuckyBajaj-LiquidGlass-Android.apk",
      "windows-exe", "LuckyBajajDesktopSetup.exe",
      "windows-msi", "LuckyBajajDesktop.msi");

  private static final String CHECKSUMS_ASSET = "SHA256SUMS.txt";
  private static final String MANIFEST_ASSET = "release-manifest.json";

  private final ObjectMapper objectMapper;
  private final HttpClient httpClient;
  private final String repository;
  private final URI githubApiBase;
  private final String assetHost;
  private final boolean allowLocalHttp;
  private volatile CachedRelease cachedRelease;

  public PublicDownloadService(
      ObjectMapper objectMapper,
      @Value("${app.public-downloads.github-repository:Manav326/BajajDealership}") String repository) {
    this(
        objectMapper,
        repository,
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build(),
        URI.create("https://api.github.com/"),
        "github.com",
        false);
  }

  PublicDownloadService(
      ObjectMapper objectMapper,
      String repository,
      HttpClient httpClient,
      URI githubApiBase,
      String assetHost,
      boolean allowLocalHttp) {
    this.objectMapper = objectMapper;
    this.repository = repository == null ? "" : repository.trim();
    this.httpClient = httpClient;
    this.githubApiBase = githubApiBase;
    this.assetHost = assetHost;
    this.allowLocalHttp = allowLocalHttp;
  }

  public DownloadStatus getStatus() throws IOException, InterruptedException {
    ReleaseInfo release = getLatestRelease();
    if (release == null || !release.isComplete()) {
      return new DownloadStatus(null, false, false, false, false);
    }
    return new DownloadStatus(
        release.tagName(),
        release.assets().containsKey(DOWNLOAD_ASSETS.get("android-standard")),
        release.assets().containsKey(DOWNLOAD_ASSETS.get("android-liquid-glass")),
        release.assets().containsKey(DOWNLOAD_ASSETS.get("windows-exe")),
        release.assets().containsKey(DOWNLOAD_ASSETS.get("windows-msi")));
  }

  public Optional<DownloadAsset> openDownload(String platform, String range, String ifRange)
      throws IOException, InterruptedException {
    String assetName = DOWNLOAD_ASSETS.get(platform);
    if (assetName == null) return Optional.empty();

    ReleaseInfo release = getLatestRelease();
    if (release == null || !release.isComplete()) return Optional.empty();

    URI assetUri = release.assets().get(assetName);
    if (assetUri == null) return Optional.empty();

    if (range != null && !range.isBlank() && !SINGLE_RANGE.matcher(range.trim()).matches()) {
      throw new IllegalArgumentException("Only a single byte range is supported.");
    }

    HttpResponse<InputStream> response = sendAssetRequest(assetUri, range, ifRange);
    int status = response.statusCode();
    if (status == 404) {
      response.body().close();
      return Optional.empty();
    }
    if (status != 200 && status != 206 && status != 416) {
      response.body().close();
      throw new IOException("The release provider returned HTTP " + status + ".");
    }

    return Optional.of(new DownloadAsset(assetName, response));
  }

  private ReleaseInfo getLatestRelease() throws IOException, InterruptedException {
    CachedRelease cache = cachedRelease;
    if (cache != null && Instant.now().isBefore(cache.expiresAt())) return cache.release();

    synchronized (this) {
      cache = cachedRelease;
      if (cache != null && Instant.now().isBefore(cache.expiresAt())) return cache.release();

      if (!repository.matches("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) {
        throw new IllegalStateException("Public download repository must use owner/repository format.");
      }

      URI metadataUri = githubApiBase.resolve("repos/" + repository + "/releases/latest");
      HttpRequest request = HttpRequest.newBuilder(metadataUri)
          .timeout(Duration.ofSeconds(15))
          .header("Accept", "application/vnd.github+json")
          .header("User-Agent", "LuckyBajaj-Release-Downloads")
          .GET()
          .build();

      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == 404) {
        cachedRelease = new CachedRelease(null, Instant.now().plus(RELEASE_CACHE_TTL));
        return null;
      }
      if (response.statusCode() != 200) {
        throw new IOException("The release metadata provider returned HTTP " + response.statusCode() + ".");
      }

      JsonNode root = objectMapper.readTree(response.body());
      String tagName = root.path("tag_name").asText("");
      if (!STABLE_TAG.matcher(tagName).matches() || root.path("draft").asBoolean(true)
          || root.path("prerelease").asBoolean(true)) {
        cachedRelease = new CachedRelease(null, Instant.now().plus(RELEASE_CACHE_TTL));
        return null;
      }

      Map<String, URI> assets = new HashMap<>();
      JsonNode releaseAssets = root.path("assets");
      if (releaseAssets.isArray()) {
        for (JsonNode asset : releaseAssets) {
          String name = asset.path("name").asText("");
          if (!DOWNLOAD_ASSETS.containsValue(name)
              && !CHECKSUMS_ASSET.equals(name)
              && !MANIFEST_ASSET.equals(name)) {
            continue;
          }
          URI uri = validateAssetUri(asset.path("browser_download_url").asText(""), name);
          if (uri != null) assets.put(name, uri);
        }
      }

      ReleaseInfo release = new ReleaseInfo(tagName, Map.copyOf(assets));
      cachedRelease = new CachedRelease(release, Instant.now().plus(RELEASE_CACHE_TTL));
      return release;
    }
  }

  private URI validateAssetUri(String value, String assetName) {
    try {
      URI candidate = URI.create(value);
      String expectedPrefix = "/" + repository + "/releases/download/";
      if (!candidate.isAbsolute()
          || !"https".equalsIgnoreCase(candidate.getScheme())
          || !assetHost.equalsIgnoreCase(candidate.getHost())
          || candidate.getPort() != -1
          || candidate.getUserInfo() != null
          || candidate.getQuery() != null
          || candidate.getFragment() != null
          || !candidate.getPath().startsWith(expectedPrefix)
          || !candidate.getPath().endsWith("/" + assetName)) {
        return null;
      }
      return candidate;
    } catch (IllegalArgumentException invalidUri) {
      return null;
    }
  }

  private HttpResponse<InputStream> sendAssetRequest(URI initialUri, String range, String ifRange)
      throws IOException, InterruptedException {
    URI current = initialUri;
    for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      HttpRequest.Builder builder = HttpRequest.newBuilder(current)
          .timeout(Duration.ofMinutes(10))
          .header("Accept", "application/octet-stream")
          .header("User-Agent", "LuckyBajaj-Release-Downloads")
          .GET();
      if (range != null && !range.isBlank()) builder.header("Range", range.trim());
      if (ifRange != null && !ifRange.isBlank() && ifRange.length() <= 256
          && !ifRange.contains("\r") && !ifRange.contains("\n")) {
        builder.header("If-Range", ifRange);
      }

      HttpResponse<InputStream> response =
          httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
      int status = response.statusCode();
      if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) {
        return response;
      }

      String location = response.headers().firstValue("Location").orElse("");
      response.body().close();
      URI next;
      try {
        next = current.resolve(location);
      } catch (IllegalArgumentException invalidLocation) {
        throw new IOException("The release asset redirect was invalid.", invalidLocation);
      }
      if (!isAllowedRedirect(next) || redirects == MAX_REDIRECTS) {
        throw new IOException("The release asset redirect was invalid or exceeded its limit.");
      }
      current = next;
    }
    throw new IOException("The release asset redirect limit was exceeded.");
  }

  private boolean isAllowedRedirect(URI uri) {
    if (uri == null || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) {
      return false;
    }
    boolean expectedHost = assetHost.equalsIgnoreCase(uri.getHost());
    boolean githubAssetHost = uri.getHost().toLowerCase().endsWith(".githubusercontent.com");
    boolean allowedScheme = "https".equalsIgnoreCase(uri.getScheme())
        || (allowLocalHttp && "http".equalsIgnoreCase(uri.getScheme()) && expectedHost);
    return allowedScheme && (expectedHost || githubAssetHost);
  }

  public record DownloadStatus(
      String version,
      boolean androidStandardAvailable,
      boolean androidLiquidGlassAvailable,
      boolean windowsExeAvailable,
      boolean windowsMsiAvailable) {}

  public record DownloadAsset(String fileName, HttpResponse<InputStream> response) {}

  private record ReleaseInfo(String tagName, Map<String, URI> assets) {
    private boolean isComplete() {
      return DOWNLOAD_ASSETS.values().stream().allMatch(assets::containsKey)
          && assets.containsKey(CHECKSUMS_ASSET)
          && assets.containsKey(MANIFEST_ASSET);
    }
  }

  private record CachedRelease(ReleaseInfo release, Instant expiresAt) {}
}
