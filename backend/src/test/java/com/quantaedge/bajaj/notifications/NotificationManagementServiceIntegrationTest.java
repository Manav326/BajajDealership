package com.quantaedge.bajaj.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class NotificationManagementServiceIntegrationTest {
  private static final Object CONTENT = Map.of(
      "version", 1,
      "blocks", List.of(Map.of("type", "hero", "title", "Service update", "subtitle", "Your service appointment is confirmed.")));

  @Autowired private JdbcTemplate jdbc;
  @Autowired private NotificationManagementService notifications;
  @Autowired private ObjectMapper mapper;

  @Test
  void sendsDurableStaffInboxNotificationAndIdempotentRetryDoesNotDuplicateRecipient() {
    StaffPrincipal owner = createOwner();
    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Workshop briefing", "An update for the team",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of(), "marketingOnly", false),
            CONTENT, null, null));

    assertThat(preview.valid()).isTrue();
    assertThat(preview.recipientCount()).isEqualTo(1);
    assertThat(preview.previewToken()).isNotBlank();

    String key = "send-" + UUID.randomUUID();
    assertThatThrownBy(() -> notifications.send(owner,
        new NotificationManagementService.SendRequest(preview.campaignPublicId(),
            preview.previewToken(), key, null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var approved = notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    assertThat(approved.status()).isEqualTo("APPROVED");

    NotificationManagementService.CampaignResult result = notifications.send(owner,
        new NotificationManagementService.SendRequest(preview.campaignPublicId(),
            preview.previewToken(), key, null, null));
    assertThat(result.campaign().status()).isEqualTo("SENT");
    assertThat(result.campaign().resolvedRecipientCount()).isEqualTo(1);
    assertThat(result.idempotentReplay()).isFalse();

    NotificationManagementService.Page<NotificationManagementService.InboxItem> inbox =
        notifications.inbox(owner, 0, 25, false);
    assertThat(inbox.total()).isEqualTo(1);
    assertThat(inbox.unreadCount()).isEqualTo(1);
    assertThat(inbox.items().getFirst().title()).isEqualTo("Workshop briefing");

    NotificationManagementService.CampaignResult replay = notifications.send(owner,
        new NotificationManagementService.SendRequest(preview.campaignPublicId(),
            preview.previewToken(), key, null, null));
    assertThat(replay.idempotentReplay()).isTrue();
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient where campaign_id = (
          select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isEqualTo(1);
  }

  @Test
  void previewProofIsRequiredAndBoundToItsCampaign() {
    StaffPrincipal owner = createOwner();
    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Internal note", "Do not share publicly",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));

    assertThatThrownBy(() -> notifications.approve(owner, preview.campaignPublicId(), "wrong-preview-proof"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThatThrownBy(() -> notifications.send(owner,
        new NotificationManagementService.SendRequest(preview.campaignPublicId(),
            preview.previewToken(), "blocked-" + UUID.randomUUID(), null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThat(jdbc.queryForObject("""
        select status from notification_campaign where public_id = ?
        """, String.class, preview.campaignPublicId())).isEqualTo("PREVIEWED");
  }

  @Test
  void approvalRejectsAudienceDriftAfterPreview() {
    StaffPrincipal owner = createOwner();
    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Team notice", "Audience must remain stable",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));

    String unique = UUID.randomUUID().toString().substring(0, 8).toLowerCase();
    jdbc.update("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Added after preview', ?, 'test-hash-not-used', 'ACTIVE')
        """, owner.dealershipId(), "new-staff-" + unique + "@example.test");

    assertThatThrownBy(() -> notifications.approve(owner, preview.campaignPublicId(), preview.previewToken()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(jdbc.queryForObject("""
        select status from notification_campaign where public_id = ?
        """, String.class, preview.campaignPublicId())).isEqualTo("PREVIEWED");
  }

  @Test
  void templateEditsCreateImmutableVersions() {
    StaffPrincipal owner = createOwner();
    var first = notifications.createTemplate(owner,
        new NotificationManagementService.TemplateRequest("Service reminder", "Initial template", CONTENT));
    var second = notifications.createTemplateVersion(owner, first.publicId(),
        new NotificationManagementService.TemplateRequest("Service reminder", "Revised template", Map.of(
            "version", 1, "blocks", List.of(Map.of("type", "hero", "title", "Revised service reminder")))));

    assertThat(second.publicId()).isNotEqualTo(first.publicId());
    assertThat(second.contentVersion()).isEqualTo(2);
    assertThat(notifications.findTemplate(owner, first.publicId()).status()).isEqualTo("ARCHIVED");
    assertThat(notifications.findTemplate(owner, second.publicId()).status()).isEqualTo("ACTIVE");
  }

  @Test
  void marketingAudienceIncludesOnlyCustomersWithRecordedConsent() {
    StaffPrincipal owner = createOwner();
    String code = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    jdbc.update("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Non Consented', '9000000001', 'ACTIVE')
        """, owner.dealershipId(), code);
    String consentCode = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    jdbc.update("""
        insert into customer(
          dealership_id, customer_code, full_name, phone, status, marketing_consent_at, marketing_consent_source)
        values (?, ?, 'Consented Customer', '9000000002', 'ACTIVE', now(), 'test opt-in')
        """, owner.dealershipId(), consentCode);

    assertThat(notifications.searchRecipients(owner, "CUSTOMER", null, true))
        .extracting(NotificationManagementService.RecipientOption::recipientName)
        .containsExactly("Consented Customer");
    assertThat(notifications.searchRecipients(owner, "CUSTOMER", "Consented", true))
        .extracting(NotificationManagementService.RecipientOption::recipientName)
        .containsExactly("Consented Customer");
    assertThatThrownBy(() -> notifications.searchRecipients(owner, "STAFF", null, true))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Service tips", "Helpful information",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", true, "excludedRecipients", List.of()),
            CONTENT, null, null));

    assertThat(preview.recipientCount()).isEqualTo(1);
    assertThat(preview.recipients()).extracting(NotificationManagementService.RecipientOption::recipientName)
        .containsExactly("Consented Customer");
  }

  @Test
  void selectedAudienceIncludesOnlyServerEligibleSelectedRecipients() {
    StaffPrincipal owner = createOwner();
    String suffixA = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String suffixB = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long customerA = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Selected Customer', '9110000001', 'ACTIVE') returning id
        """, Long.class, owner.dealershipId(), "CUS-" + suffixA);
    jdbc.update("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Unselected Customer', '9110000002', 'ACTIVE')
        """, owner.dealershipId(), "CUS-" + suffixB);

    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Selected customer update", "Only one person",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", false,
                "selectionMode", "SELECTED",
                "selectedRecipients", List.of(Map.of("kind", "CUSTOMER", "id", customerA)),
                "excludedRecipients", List.of()),
            CONTENT, null, null));

    assertThat(preview.recipientCount()).isEqualTo(1);
    assertThat(preview.recipients())
        .extracting(NotificationManagementService.RecipientOption::recipientName)
        .containsExactly("Selected Customer");
  }

  private StaffPrincipal createOwner() {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "NOTIF-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Notification Test Agency");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "notification-owner-" + unique.toLowerCase() + "@example.test");
    Long roleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, roleId);
    UUID dealerPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    return new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealerPublicId.toString(),
        code, "Test Owner", Set.of("OWNER"),
        Set.of("notification.read", "notification.create", "notification.approve", "notification.send"));
  }
}
