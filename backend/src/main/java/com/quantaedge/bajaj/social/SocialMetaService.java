package com.quantaedge.bajaj.social;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Server-side Meta account connection. Provider tokens never leave this service and are
 * encrypted before persistence. Social publishing itself remains a separate release step.
 */
@Service
public class SocialMetaService {
  private static final String TOKEN_AAD = "bajaj-social-meta-token-v1";
  private static final long OAUTH_STATE_LIFETIME_SECONDS = 600;
  private static final List<String> REQUESTED_SCOPES = List.of(
      "pages_show_list", "pages_read_engagement", "pages_manage_posts",
      "instagram_basic", "instagram_content_publish");

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final boolean enabled;
  private final String appId;
  private final String appSecret;
  private final String graphApiVersion;
  private final String redirectUri;
  private final String completionUrl;
  private final String tokenEncryptionKeyBase64;
  private final String socialMediaPublicBaseUrl;
  private final String socialMediaAssetSigningKeyBase64;
  private final SecureRandom secureRandom = new SecureRandom();
  private final HttpClient httpClient = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(10))
      .followRedirects(HttpClient.Redirect.NEVER)
      .build();

  public SocialMetaService(
      JdbcTemplate jdbc, ObjectMapper mapper,
      @Value("${app.social.meta.enabled:false}") boolean enabled,
      @Value("${app.social.meta.app-id:}") String appId,
      @Value("${app.social.meta.app-secret:}") String appSecret,
      @Value("${app.social.meta.graph-api-version:}") String graphApiVersion,
      @Value("${app.social.meta.redirect-uri:}") String redirectUri,
      @Value("${app.social.meta.completion-url:}") String completionUrl,
      @Value("${app.social.meta.token-encryption-key-base64:}") String tokenEncryptionKeyBase64,
      @Value("${app.social.media.public-base-url:}") String socialMediaPublicBaseUrl,
      @Value("${app.social.media.asset-signing-key-base64:}") String socialMediaAssetSigningKeyBase64) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.enabled = enabled;
    this.appId = clean(appId);
    this.appSecret = clean(appSecret);
    this.graphApiVersion = clean(graphApiVersion);
    this.redirectUri = clean(redirectUri);
    this.completionUrl = clean(completionUrl);
    this.tokenEncryptionKeyBase64 = clean(tokenEncryptionKeyBase64);
    this.socialMediaPublicBaseUrl = clean(socialMediaPublicBaseUrl);
    this.socialMediaAssetSigningKeyBase64 = clean(socialMediaAssetSigningKeyBase64);
  }

  public StatusView status(StaffPrincipal actor) {
    List<DestinationView> destinations = jdbc.query("""
        select public_id, destination_type, display_name, username, status
        from social_media_destination
        where dealership_id = ?
        order by status, destination_type, lower(display_name), id
        """, (rs, rowNum) -> new DestinationView(
            rs.getObject("public_id", UUID.class), rs.getString("destination_type"),
            rs.getString("display_name"), rs.getString("username"), rs.getString("status")),
        actor.dealershipId());

    boolean configured = isConfigured();
    boolean publishingReady = configured && isAssetPublishingConfigured();
    return new StatusView(configured, publishingReady, configured ? "READY" : "CONFIGURATION_REQUIRED",
        !configured ? "Meta account connection is not configured on the server. External publishing remains disabled."
            : publishingReady ? "Meta is configured. Connected destinations can publish after staff confirmation."
            : "Meta connection is configured, but direct publishing still needs public media URL and signing key settings.",
        destinations);
  }

  /** Disconnect linked Meta identities; always disable local publishing if remote revocation is uncertain. */
  public DisconnectResult disconnect(StaffPrincipal actor) {
    List<MetaConnectionRow> connections = jdbc.query("""
        select id, public_id, user_access_token_ciphertext
        from social_media_connection
        where dealership_id = ? and provider = 'META' and status = 'ACTIVE'
        order by id
        """, (rs, rowNum) -> new MetaConnectionRow(
            rs.getLong("id"), rs.getObject("public_id", UUID.class),
            rs.getString("user_access_token_ciphertext")), actor.dealershipId());

    int providerRevocationsConfirmed = 0;
    int destinationsDisabled = 0;
    for (MetaConnectionRow connection : connections) {
      boolean providerRevoked = false;
      String revokeOutcome = "not_confirmed";
      try {
        String token = decryptTokenForPublishing(connection.tokenCiphertext());
        JsonNode response = graphDelete("me/permissions", Map.of("access_token", token));
        providerRevoked = response.isBoolean() && response.booleanValue();
        revokeOutcome = providerRevoked ? "confirmed" : "not_confirmed";
      } catch (Exception failure) {
        revokeOutcome = safeFailureCode(failure);
      }

      int disabledForConnection = jdbc.update("""
          update social_media_destination
          set status = 'DISCONNECTED', page_access_token_ciphertext = 'REVOKED', updated_at = now()
          where dealership_id = ? and connection_id = ? and status = 'ACTIVE'
          """, actor.dealershipId(), connection.id());
      destinationsDisabled += disabledForConnection;
      jdbc.update("""
          update social_media_connection
          set status = 'DISCONNECTED', user_access_token_ciphertext = 'REVOKED', updated_at = now()
          where dealership_id = ? and id = ? and status = 'ACTIVE'
          """, actor.dealershipId(), connection.id());

      if (providerRevoked) providerRevocationsConfirmed++;
      audit(actor.dealershipId(), actor.staffUserId(), connection.id(), null,
          "META_OAUTH_DISCONNECTED",
          Map.of("connectionPublicId", connection.publicId().toString(),
              "destinationsDisabled", disabledForConnection,
              "providerRevocation", revokeOutcome));
    }

    String message = connections.isEmpty()
        ? "There are no active Meta connections for this dealership."
        : providerRevocationsConfirmed == connections.size()
            ? "Meta accounts disconnected. Meta confirmed revoking this app's authorization."
            : "Local Meta publishing has been disabled and stored tokens cleared. Meta did not confirm every remote revocation; review the app's access in Meta Business settings.";
    return new DisconnectResult(connections.size(), destinationsDisabled, providerRevocationsConfirmed, message);
  }

  public ConnectResponse beginAuthorization(StaffPrincipal actor) {
    requireConfigured();
    byte[] randomState = new byte[32];
    secureRandom.nextBytes(randomState);
    String state = Base64.getUrlEncoder().withoutPadding().encodeToString(randomState);
    Instant expiresAt = Instant.now().plusSeconds(OAUTH_STATE_LIFETIME_SECONDS);

    jdbc.update("""
        delete from social_media_oauth_state
        where expires_at <= now() or consumed_at < now() - interval '1 day'
        """);
    jdbc.update("""
        insert into social_media_oauth_state(state_hash, dealership_id, staff_user_id, expires_at)
        values (?, ?, ?, ?)
        """, TokenDigests.sha256(state), actor.dealershipId(), actor.staffUserId(), Timestamp.from(expiresAt));
    audit(actor.dealershipId(), actor.staffUserId(), null, null, "META_OAUTH_STARTED",
        Map.of("stateExpiresAt", expiresAt.toString()));

    String authorizationUrl = UriComponentsBuilder
        .fromUriString("https://www.facebook.com/" + graphApiVersion + "/dialog/oauth")
        .queryParam("client_id", appId)
        .queryParam("redirect_uri", redirectUri)
        .queryParam("response_type", "code")
        .queryParam("state", state)
        .queryParam("scope", String.join(",", REQUESTED_SCOPES))
        .build().encode().toUriString();
    return new ConnectResponse(authorizationUrl, expiresAt);
  }

  /** Validates and consumes OAuth state before exchanging a code. Redirects never use caller-supplied URLs. */
  public URI completeAuthorization(String rawState, String code, String providerError) {
    if (rawState == null || rawState.isBlank() || rawState.length() > 256) {
      return completionLocation("invalid_state");
    }
    OAuthAttempt attempt = consumeState(rawState);
    if (attempt == null) return completionLocation("invalid_state");

    if (providerError != null && !providerError.isBlank()) {
      audit(attempt.dealershipId(), attempt.staffUserId(), null, null, "META_OAUTH_CANCELLED",
          Map.of("reason", "provider_denied_or_cancelled"));
      return completionLocation("cancelled");
    }
    if (code == null || code.isBlank() || code.length() > 4096) {
      audit(attempt.dealershipId(), attempt.staffUserId(), null, null, "META_OAUTH_FAILED",
          Map.of("reason", "missing_authorization_code"));
      return completionLocation("error");
    }

    try {
      requireConfigured();
      TokenInfo token = exchangeAuthorizationCode(code);
      JsonNode profile = graphGet("me", Map.of("fields", "id,name", "access_token", token.value()));
      String providerUserId = requiredProviderText(profile, "id");
      String providerUserName = optionalProviderText(profile, "name");
      List<PageAccount> pages = listManagedPages(token.value());
      persistConnection(attempt, providerUserId, providerUserName, token, pages);
      audit(attempt.dealershipId(), attempt.staffUserId(),
          findConnectionId(attempt.dealershipId(), providerUserId), null, "META_OAUTH_CONNECTED",
          Map.of("facebookPageCount", pages.size(),
              "instagramDestinationCount", pages.stream().filter(page -> page.instagramId() != null).count()));
      return completionLocation("connected");
    } catch (Exception failure) {
      // Never log provider response bodies, authorization codes, or access tokens.
      audit(attempt.dealershipId(), attempt.staffUserId(), null, null, "META_OAUTH_FAILED",
          Map.of("reason", safeFailureCode(failure)));
      return completionLocation("error");
    }
  }

  boolean isMetaConfigured() { return isConfigured(); }
  private boolean isAssetPublishingConfigured() {
    if (!isSafePublicBaseUrl(socialMediaPublicBaseUrl)) return false;
    try { return Base64.getDecoder().decode(socialMediaAssetSigningKeyBase64).length == 32; }
    catch (IllegalArgumentException badKey) { return false; }
  }
  private static boolean isSafePublicBaseUrl(String value) {
    try { URI uri=URI.create(value);
      boolean secure="https".equalsIgnoreCase(uri.getScheme())||("http".equalsIgnoreCase(uri.getScheme())&&("localhost".equalsIgnoreCase(uri.getHost())||"127.0.0.1".equalsIgnoreCase(uri.getHost())));
      return secure&&uri.isAbsolute()&&uri.getHost()!=null&&(uri.getPath()==null||uri.getPath().isBlank()||"/".equals(uri.getPath()))&&uri.getQuery()==null&&uri.getFragment()==null;
    }catch(IllegalArgumentException e){return false;}
  }
  private boolean isConfigured() {
    return enabled && !appId.isBlank() && !appSecret.isBlank()
        && graphApiVersion.matches("v[0-9]+\\.[0-9]+")
        && isAbsoluteHttpUrl(redirectUri) && isAbsoluteHttpUrl(completionUrl)
        && hasValidEncryptionKey();
  }

  private void requireConfigured() {
    if (!isConfigured()) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
          "Meta account connection is not configured. No external publishing is enabled.");
    }
  }

  private boolean hasValidEncryptionKey() {
    try {
      return Base64.getDecoder().decode(tokenEncryptionKeyBase64).length == 32;
    } catch (IllegalArgumentException invalidKey) {
      return false;
    }
  }

  private static boolean isAbsoluteHttpUrl(String value) {
    if (value == null || value.isBlank()) return false;
    try {
      URI uri = URI.create(value);
      return uri.isAbsolute() && uri.getHost() != null
          && ("https".equalsIgnoreCase(uri.getScheme())
              || ("http".equalsIgnoreCase(uri.getScheme())
                  && ("localhost".equalsIgnoreCase(uri.getHost()) || "127.0.0.1".equals(uri.getHost()))));
    } catch (IllegalArgumentException invalidUri) {
      return false;
    }
  }

  private OAuthAttempt consumeState(String state) {
    List<OAuthAttempt> attempts = jdbc.query("""
        update social_media_oauth_state set consumed_at = now()
        where state_hash = ? and consumed_at is null and expires_at > now()
        returning dealership_id, staff_user_id
        """, (rs, rowNum) -> new OAuthAttempt(rs.getLong("dealership_id"), rs.getLong("staff_user_id")),
        TokenDigests.sha256(state));
    return attempts.size() == 1 ? attempts.getFirst() : null;
  }

  private TokenInfo exchangeAuthorizationCode(String code) {
    JsonNode shortLived = graphGet("oauth/access_token", Map.of(
        "client_id", appId, "client_secret", appSecret, "redirect_uri", redirectUri, "code", code));
    String shortToken = requiredProviderText(shortLived, "access_token");
    JsonNode longLived = graphGet("oauth/access_token", Map.of(
        "grant_type", "fb_exchange_token", "client_id", appId,
        "client_secret", appSecret, "fb_exchange_token", shortToken));
    String token = requiredProviderText(longLived, "access_token");
    long expiresIn = longLived.path("expires_in").asLong(0);
    return new TokenInfo(token, expiresIn > 0 ? Instant.now().plusSeconds(expiresIn) : null);
  }

  private List<PageAccount> listManagedPages(String userToken) {
    List<PageAccount> pages = new ArrayList<>();
    String after = null;
    for (int pageNumber = 0; pageNumber < 10; pageNumber++) {
      Map<String, String> query = new LinkedHashMap<>();
      query.put("fields", "id,name,access_token,instagram_business_account{id,username}");
      query.put("limit", "100");
      query.put("access_token", userToken);
      if (after != null) query.put("after", after);
      JsonNode response = graphGet("me/accounts", query);
      JsonNode rows = response.path("data");
      if (rows.isArray()) {
        for (JsonNode row : rows) {
          String pageId = optionalProviderText(row, "id");
          String pageName = optionalProviderText(row, "name");
          String pageToken = optionalProviderText(row, "access_token");
          if (pageId == null || pageName == null || pageToken == null) continue;
          JsonNode instagram = row.path("instagram_business_account");
          String instagramId = instagram.isObject() ? optionalProviderText(instagram, "id") : null;
          String instagramUsername = instagram.isObject() ? optionalProviderText(instagram, "username") : null;
          pages.add(new PageAccount(pageId, pageName, pageToken, instagramId, instagramUsername));
        }
      }
      String nextAfter = response.path("paging").path("cursors").path("after").asText("");
      if (nextAfter.isBlank() || nextAfter.equals(after)) break;
      after = nextAfter;
    }
    return pages;
  }

  private void persistConnection(
      OAuthAttempt attempt, String providerUserId, String providerUserName, TokenInfo token, List<PageAccount> pages) {
    jdbc.update("""
        insert into social_media_connection(
          dealership_id, provider, provider_user_id, provider_user_name,
          user_access_token_ciphertext, token_expires_at, status, connected_by_staff_user_id)
        values (?, 'META', ?, ?, ?, ?, 'ACTIVE', ?)
        on conflict (dealership_id, provider, provider_user_id) do update set
          provider_user_name = excluded.provider_user_name,
          user_access_token_ciphertext = excluded.user_access_token_ciphertext,
          token_expires_at = excluded.token_expires_at,
          status = 'ACTIVE',
          connected_by_staff_user_id = excluded.connected_by_staff_user_id,
          connected_at = now(), updated_at = now()
        """, attempt.dealershipId(), providerUserId, providerUserName,
        encryptToken(token.value()), timestamp(token.expiresAt()), attempt.staffUserId());

    long connectionId = findConnectionId(attempt.dealershipId(), providerUserId);
    jdbc.update("""
        update social_media_destination set status = 'DISCONNECTED', updated_at = now()
        where dealership_id = ? and connection_id = ?
        """, attempt.dealershipId(), connectionId);

    for (PageAccount page : pages) {
      upsertDestination(attempt.dealershipId(), connectionId, "FACEBOOK_PAGE",
          page.id(), null, page.name(), null, page.accessToken(), token.expiresAt());
      if (page.instagramId() != null) {
        String displayName = page.instagramUsername() == null ? page.name() : "@" + page.instagramUsername();
        upsertDestination(attempt.dealershipId(), connectionId, "INSTAGRAM_PROFESSIONAL",
            page.instagramId(), page.id(), displayName, page.instagramUsername(), page.accessToken(), token.expiresAt());
      }
    }
  }

  private void upsertDestination(
      long dealershipId, long connectionId, String type, String providerId, String parentPageId,
      String displayName, String username, String pageAccessToken, Instant tokenExpiresAt) {
    jdbc.update("""
        insert into social_media_destination(
          dealership_id, connection_id, provider, destination_type, provider_destination_id,
          parent_page_provider_id, display_name, username, page_access_token_ciphertext, token_expires_at, status)
        values (?, ?, 'META', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        on conflict (dealership_id, provider, destination_type, provider_destination_id) do update set
          connection_id = excluded.connection_id,
          parent_page_provider_id = excluded.parent_page_provider_id,
          display_name = excluded.display_name,
          username = excluded.username,
          page_access_token_ciphertext = excluded.page_access_token_ciphertext,
          token_expires_at = excluded.token_expires_at,
          status = 'ACTIVE', updated_at = now()
        """, dealershipId, connectionId, type, providerId, parentPageId, displayName, username,
        encryptToken(pageAccessToken), timestamp(tokenExpiresAt));
  }

  private long findConnectionId(long dealershipId, String providerUserId) {
    Long id = jdbc.queryForObject("""
        select id from social_media_connection
        where dealership_id = ? and provider = 'META' and provider_user_id = ?
        """, Long.class, dealershipId, providerUserId);
    if (id == null) throw new IllegalStateException("The Meta connection record was not saved.");
    return id;
  }

  JsonNode graphGet(String resource, Map<String, String> query) {
    URI uri = UriComponentsBuilder
        .fromUriString("https://graph.facebook.com/" + graphApiVersion + "/" + resource)
        .queryParams(toQueryParams(query))
        .build().encode().toUri();
    HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(20))
        .header("Accept", "application/json")
        .GET().build();
    try {
      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() < 200 || response.statusCode() >= 300) {
        throw new MetaProviderException("meta_http_" + response.statusCode());
      }
      JsonNode body = mapper.readTree(response.body());
      if (body == null) throw new MetaProviderException("meta_empty_response");
      if (body.has("error")) {
        String code = body.path("error").path("code").asText("provider_error");
        throw new MetaProviderException("meta_api_" + safeCode(code));
      }
      return body;
    } catch (JsonProcessingException failure) {
      throw new MetaProviderException("meta_invalid_json");
    } catch (IOException failure) {
      throw new MetaProviderException("meta_network_error");
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new MetaProviderException("meta_request_interrupted");
    }
  }

  private JsonNode graphDelete(String resource, Map<String, String> query) {
    URI uri = UriComponentsBuilder.fromUriString("https://graph.facebook.com/" + graphApiVersion + "/" + resource)
        .queryParams(toQueryParams(query)).build().encode().toUri();
    HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20))
        .header("Accept", "application/json").DELETE().build();
    try {
      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() < 200 || response.statusCode() >= 300)
        throw new MetaProviderException("meta_http_" + response.statusCode());
      JsonNode body = mapper.readTree(response.body());
      if (body == null) throw new MetaProviderException("meta_empty_response");
      if (body.has("error"))
        throw new MetaProviderException("meta_api_" + safeCode(body.path("error").path("code").asText("provider_error")));
      return body;
    } catch (JsonProcessingException failure) {
      throw new MetaProviderException("meta_invalid_json");
    } catch (IOException failure) {
      throw new MetaProviderException("meta_network_error");
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new MetaProviderException("meta_request_interrupted");
    }
  }

  JsonNode graphPost(String resource,Map<String,String> form){
    URI uri=URI.create("https://graph.facebook.com/"+graphApiVersion+"/"+resource);
    String body=form.entrySet().stream().map(e->java.net.URLEncoder.encode(e.getKey(),StandardCharsets.UTF_8)+"="+java.net.URLEncoder.encode(e.getValue(),StandardCharsets.UTF_8)).collect(java.util.stream.Collectors.joining("&"));
    HttpRequest req=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20)).header("Accept","application/json").header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body,StandardCharsets.UTF_8)).build();
    try{HttpResponse<String> res=httpClient.send(req,HttpResponse.BodyHandlers.ofString());if(res.statusCode()<200||res.statusCode()>=300)throw new MetaProviderException("meta_http_"+res.statusCode());JsonNode json=mapper.readTree(res.body());if(json==null)throw new MetaProviderException("meta_empty_response");if(json.has("error"))throw new MetaProviderException("meta_api_"+safeCode(json.path("error").path("code").asText("provider_error")));return json;}
    catch(JsonProcessingException e){throw new MetaProviderException("meta_invalid_json");}catch(IOException e){throw new MetaProviderException("meta_network_error");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new MetaProviderException("meta_request_interrupted");}
  }
  String decryptTokenForPublishing(String encrypted){
    try{byte[] combined=Base64.getUrlDecoder().decode(encrypted);if(combined.length<=12)throw new IllegalArgumentException("bad token");
      byte[] nonce=java.util.Arrays.copyOfRange(combined,0,12),cipherText=java.util.Arrays.copyOfRange(combined,12,combined.length);
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(Base64.getDecoder().decode(tokenEncryptionKeyBase64),"AES"),new GCMParameterSpec(128,nonce));
      cipher.updateAAD(TOKEN_AAD.getBytes(StandardCharsets.UTF_8));return new String(cipher.doFinal(cipherText),StandardCharsets.UTF_8);
    }catch(GeneralSecurityException|IllegalArgumentException e){throw new IllegalStateException("Meta token decryption failed.");}
  }

  private static org.springframework.util.LinkedMultiValueMap<String, String> toQueryParams(Map<String, String> query) {
    org.springframework.util.LinkedMultiValueMap<String, String> result = new org.springframework.util.LinkedMultiValueMap<>();
    query.forEach(result::add);
    return result;
  }

  private String encryptToken(String token) {
    try {
      byte[] key = Base64.getDecoder().decode(tokenEncryptionKeyBase64);
      byte[] nonce = new byte[12];
      secureRandom.nextBytes(nonce);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
      cipher.updateAAD(TOKEN_AAD.getBytes(StandardCharsets.UTF_8));
      byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
      byte[] combined = new byte[nonce.length + encrypted.length];
      System.arraycopy(nonce, 0, combined, 0, nonce.length);
      System.arraycopy(encrypted, 0, combined, nonce.length, encrypted.length);
      return Base64.getUrlEncoder().withoutPadding().encodeToString(combined);
    } catch (GeneralSecurityException | IllegalArgumentException failure) {
      throw new IllegalStateException("Meta access token encryption failed.");
    }
  }

  void audit(long dealershipId, Long staffUserId, Long connectionId, Long destinationId,
      String action, Map<String, Object> details) {
    String json;
    try {
      json = mapper.writeValueAsString(details);
    } catch (JsonProcessingException impossible) {
      throw new IllegalArgumentException("Social audit details could not be serialized.");
    }
    jdbc.update("""
        insert into social_media_audit(
          dealership_id, actor_staff_user_id, connection_id, destination_id, provider, action, details)
        values (?, ?, ?, ?, 'META', ?, ?::jsonb)
        """, dealershipId, staffUserId, connectionId, destinationId, action, json);
  }

  private URI completionLocation(String outcome) {
    if (completionUrl.isBlank()) return URI.create("/api/v1/system/health");
    int hash = completionUrl.indexOf('#');
    String origin = hash >= 0 ? completionUrl.substring(0, hash) : completionUrl;
    String route = hash >= 0 ? completionUrl.substring(hash + 1) : "/social-media-studio";
    if (route.isBlank()) route = "/social-media-studio";
    String separator = route.contains("?") ? "&" : "?";
    return URI.create(origin + "#" + route + separator + "meta=" + outcome);
  }

  private static Timestamp timestamp(Instant value) {
    return value == null ? null : Timestamp.from(value);
  }

  private static String requiredProviderText(JsonNode node, String field) {
    String value = optionalProviderText(node, field);
    if (value == null) throw new MetaProviderException("meta_missing_" + field);
    return value;
  }

  private static String optionalProviderText(JsonNode node, String field) {
    String value = node.path(field).asText("").trim();
    return value.isEmpty() ? null : value;
  }

  private static String safeFailureCode(Exception failure) {
    if (failure instanceof MetaProviderException provider) return safeCode(provider.code);
    if (failure instanceof ResponseStatusException) return "configuration_unavailable";
    return "connection_failed";
  }

  private static String safeCode(String value) {
    String normalized = value == null ? "" : value.replaceAll("[^a-zA-Z0-9_-]", "");
    if (normalized.isBlank()) return "provider_error";
    return normalized.substring(0, Math.min(60, normalized.length()));
  }

  private static String clean(String value) {
    return value == null ? "" : value.trim();
  }

  public record StatusView(boolean configured, boolean publishingReady, String code, String message, List<DestinationView> destinations) {}
  public record DestinationView(UUID publicId, String type, String displayName, String username, String status) {}
  public record ConnectResponse(String authorizationUrl, Instant stateExpiresAt) {}
  public record DisconnectResult(int connectionsDisconnected, int destinationsDisabled, int providerRevocationsConfirmed, String message) {}
  private record MetaConnectionRow(long id, UUID publicId, String tokenCiphertext) {}
  private record OAuthAttempt(long dealershipId, long staffUserId) {}
  private record TokenInfo(String value, Instant expiresAt) {}
  private record PageAccount(String id, String name, String accessToken, String instagramId, String instagramUsername) {}

  private static final class MetaProviderException extends RuntimeException {
    private final String code;
    MetaProviderException(String code) { super(code); this.code = code; }
  }
}
