package com.quantaedge.bajaj.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.server.ResponseStatusException;

class CustomerNotificationMediaControllerTest {
  private static final long DEALERSHIP_ID = 41L;
  private static final long CUSTOMER_ID = 73L;
  private static final byte[] PNG_HEADER = new byte[] {
      (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  };

  @TempDir Path mediaRoot;

  private JdbcTemplate jdbc;
  private CustomerNotificationMediaController controller;
  private CustomerPrincipal customer;

  @BeforeEach
  void setUp() {
    jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
    controller = new CustomerNotificationMediaController(jdbc, mediaRoot.toString());
    customer = new CustomerPrincipal(
        1L, 2L, "account-public-id", CUSTOMER_ID, "customer-public-id",
        DEALERSHIP_ID, "dealership-public-id", "LUCKY-BAJAJ", "Lucky Bajaj Agency",
        "CUS-TEST", "Maestro Test Customer", "en", null, null);
  }

  @Test
  void returnsImageOnlyWhenCustomerScopedSentCampaignQueryFindsAsset() throws Exception {
    UUID assetId = UUID.randomUUID();
    String storageKey = DEALERSHIP_ID + "/" + assetId + ".png";
    Path file = mediaRoot.resolve(storageKey);
    Files.createDirectories(file.getParent());
    Files.write(file, PNG_HEADER);
    when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(Map.of(
        "mime_type", "image/png",
        "byte_length", (long) PNG_HEADER.length,
        "sha256", sha256(PNG_HEADER),
        "storage_key", storageKey)));

    ResponseEntity<byte[]> response = controller.read(customer, assetId);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getHeaders().getContentType().toString()).isEqualTo("image/png");
    assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    assertThat(response.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
    assertThat(response.getBody()).containsExactly(PNG_HEADER);

    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<Object[]> parameters = ArgumentCaptor.forClass(Object[].class);
    verify(jdbc).queryForList(sql.capture(), parameters.capture());
    assertThat(sql.getValue())
        .contains("recipient.recipient_kind = 'CUSTOMER'")
        .contains("recipient.customer_id = ?")
        .contains("campaign.status = 'SENT'")
        .contains("recipient.status <> 'DISMISSED'")
        .contains("jsonb_path_exists");
    assertThat(parameters.getValue()).containsExactly(DEALERSHIP_ID, assetId, CUSTOMER_ID);
  }

  @Test
  void doesNotDiscloseMediaThatIsNotInThisCustomersInbox() {
    UUID assetId = UUID.randomUUID();
    when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

    ResponseStatusException failure = assertThrows(
        ResponseStatusException.class, () -> controller.read(customer, assetId));

    assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void rejectsStorageKeysThatEscapeThePrivateMediaRoot() {
    UUID assetId = UUID.randomUUID();
    when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(Map.of(
        "mime_type", "image/png",
        "byte_length", (long) PNG_HEADER.length,
        "sha256", sha256(PNG_HEADER),
        "storage_key", "../../outside.png")));

    ResponseStatusException failure = assertThrows(
        ResponseStatusException.class, () -> controller.read(customer, assetId));

    assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void customerRouteUsesCustomerPortalPermissionNotStaffNotificationPermission() throws Exception {
    PreAuthorize guard = CustomerNotificationMediaController.class
        .getMethod("read", CustomerPrincipal.class, UUID.class)
        .getAnnotation(PreAuthorize.class);

    assertThat(guard).isNotNull();
    assertThat(guard.value()).isEqualTo("hasAuthority('customer.portal')");
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (Exception failure) {
      throw new IllegalStateException(failure);
    }
  }
}
