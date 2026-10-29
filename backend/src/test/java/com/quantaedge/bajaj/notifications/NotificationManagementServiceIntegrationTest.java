package com.quantaedge.bajaj.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = "app.notifications.dispatch-interval-ms=3600000")
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
  void savedPreviewRendersExactPersistedCampaignAndAudienceSummary() {
    StaffPrincipal owner = createOwner();
    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Saved design", "The saved content must be inspectable",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            Map.of("version", 1, "blocks", List.of(
                Map.of("type", "hero", "title", "Exact saved headline", "subtitle", "Saved subtitle"))),
            null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        preview.campaignPublicId(), preview.previewToken(), "preview-" + UUID.randomUUID(),
        java.time.Instant.now().plusSeconds(3600), null));

    var saved = notifications.savedPreview(owner, preview.campaignPublicId());
    assertThat(saved.campaign().status()).isEqualTo("SCHEDULED");
    assertThat(saved.contentDocument().path("blocks").get(0).path("title").asText())
        .isEqualTo("Exact saved headline");
    assertThat(saved.previewedRecipientCount()).isEqualTo(1);
    assertThat(saved.recipientCounts()).containsEntry("STAFF", 1);
    assertThat(saved.approvedAt()).isNotNull();
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void sendNowDispatchesScheduledCampaignOnceAndPreservesApprovedContent() {
    StaffPrincipal owner = createNotificationOperator();
    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Send now notice", "Scheduled content must dispatch once",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    var scheduled = notifications.send(owner, new NotificationManagementService.SendRequest(
        preview.campaignPublicId(), preview.previewToken(), "scheduled-" + UUID.randomUUID(),
        java.time.Instant.now().plusSeconds(3600), null));
    assertThat(scheduled.campaign().status()).isEqualTo("SCHEDULED");

    var sent = notifications.sendNow(owner, preview.campaignPublicId());
    assertThat(sent.campaign().status()).isEqualTo("SENT");
    assertThat(sent.alreadySent()).isFalse();

    var replay = notifications.sendNow(owner, preview.campaignPublicId());
    assertThat(replay.campaign().status()).isEqualTo("SENT");
    assertThat(replay.alreadySent()).isTrue();
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isEqualTo(1);
    assertThat(notifications.savedPreview(owner, preview.campaignPublicId())
        .contentDocument().path("blocks").get(0).path("title").asText()).isEqualTo("Service update");
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void expiredCampaignCannotBeDispatchedManuallyOrByTheScheduler() {
    StaffPrincipal owner = createNotificationOperator();
    NotificationManagementService.PreviewResult manualPreview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Expired manual dispatch", "Must not send after expiry",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, manualPreview.campaignPublicId(), manualPreview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        manualPreview.campaignPublicId(), manualPreview.previewToken(), "expire-manual-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));
    jdbc.update("""
        update notification_campaign
        set scheduled_at = now() - interval '2 seconds',
            expires_at = now() - interval '1 second',
            next_dispatch_attempt_at = null
        where dealership_id = ? and public_id = ? and status = 'SCHEDULED'
        """, owner.dealershipId(), manualPreview.campaignPublicId());

    var manualResult = notifications.sendNow(owner, manualPreview.campaignPublicId());
    assertThat(manualResult.campaign().status()).isEqualTo("EXPIRED");
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, manualPreview.campaignPublicId())).isZero();

    NotificationManagementService.PreviewResult scheduledPreview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Expired scheduled dispatch", "Scheduler must not send after expiry",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, scheduledPreview.campaignPublicId(), scheduledPreview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        scheduledPreview.campaignPublicId(), scheduledPreview.previewToken(), "expire-scheduled-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));
    jdbc.update("""
        update notification_campaign
        set scheduled_at = now() - interval '2 seconds',
            expires_at = now() - interval '1 second',
            next_dispatch_attempt_at = null
        where dealership_id = ? and public_id = ? and status = 'SCHEDULED'
        """, owner.dealershipId(), scheduledPreview.campaignPublicId());

    assertThat(notifications.dispatchScheduledCampaign(scheduledPreview.campaignPublicId())).isFalse();
    assertThat(jdbc.queryForObject("""
        select status from notification_campaign where public_id = ?
        """, String.class, scheduledPreview.campaignPublicId())).isEqualTo("EXPIRED");
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, scheduledPreview.campaignPublicId())).isZero();
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void sendNowRaceWithScheduledDispatcherCreatesOnlyOneInboxDelivery() throws Exception {
    StaffPrincipal owner = createNotificationOperator();
    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Dispatch race", "Only one dispatch may win",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        preview.campaignPublicId(), preview.previewToken(), "race-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));
    jdbc.update("""
        update notification_campaign
        set scheduled_at = now() - interval '2 seconds', next_dispatch_attempt_at = null
        where dealership_id = ? and public_id = ? and status = 'SCHEDULED'
        """, owner.dealershipId(), preview.campaignPublicId());

    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<NotificationManagementService.SendNowResult> manual = executor.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting to start Send now.");
        return notifications.sendNow(owner, preview.campaignPublicId());
      });
      Future<Boolean> scheduled = executor.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting to start scheduler dispatch.");
        return notifications.dispatchScheduledCampaign(preview.campaignPublicId());
      });

      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      var sendResult = manual.get(20, TimeUnit.SECONDS);
      scheduled.get(20, TimeUnit.SECONDS);

      assertThat(sendResult.campaign().status()).isEqualTo("SENT");
      assertThat(jdbc.queryForObject("""
          select count(*) from notification_recipient
          where campaign_id = (select id from notification_campaign where public_id = ?)
          """, Integer.class, preview.campaignPublicId())).isEqualTo(1);
      assertThat(jdbc.queryForObject("""
          select status from notification_campaign where public_id = ?
          """, String.class, preview.campaignPublicId())).isEqualTo("SENT");
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void failedSendNowPersistsRetryStateAfterDispatchTransactionRollsBack() {
    StaffPrincipal owner = createNotificationOperator();
    String code = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Selected Customer', '9220000001', 'ACTIVE') returning id
        """, Long.class, owner.dealershipId(), code);

    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Retry state test", "A stale selected recipient must fail safely",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", false,
                "selectionMode", "SELECTED",
                "selectedRecipients", List.of(Map.of("kind", "CUSTOMER", "id", customerId)),
                "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        preview.campaignPublicId(), preview.previewToken(), "retry-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));

    // The saved selection is unchanged, but this recipient is no longer eligible at dispatch.
    jdbc.update("update customer set status = 'INACTIVE' where dealership_id = ? and id = ?",
        owner.dealershipId(), customerId);

    assertThatThrownBy(() -> notifications.sendNow(owner, preview.campaignPublicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    var saved = jdbc.queryForMap("""
        select status, dispatch_attempt_count, last_dispatch_error, next_dispatch_attempt_at
        from notification_campaign where dealership_id = ? and public_id = ?
        """, owner.dealershipId(), preview.campaignPublicId());
    assertThat(saved.get("status")).isEqualTo("SCHEDULED");
    assertThat(((Number) saved.get("dispatch_attempt_count")).intValue()).isEqualTo(1);
    assertThat(String.valueOf(saved.get("last_dispatch_error")))
        .contains("Dispatch error: ResponseStatusException");
    assertThat((Timestamp) saved.get("next_dispatch_attempt_at")).isNotNull();
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isZero();
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void oneBrokenDueCampaignDoesNotRollBackOtherCampaignsInTheBatch() {
    StaffPrincipal owner = createNotificationOperator();
    String code = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Campaign Batch Customer', '9230000001', 'ACTIVE') returning id
        """, Long.class, owner.dealershipId(), code);

    NotificationManagementService.PreviewResult brokenPreview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Isolated failure", "This selected audience will become ineligible",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", false,
                "selectionMode", "SELECTED",
                "selectedRecipients", List.of(Map.of("kind", "CUSTOMER", "id", customerId)),
                "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, brokenPreview.campaignPublicId(), brokenPreview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        brokenPreview.campaignPublicId(), brokenPreview.previewToken(), "broken-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));

    NotificationManagementService.PreviewResult healthyPreview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Healthy due campaign", "This campaign must still dispatch",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, healthyPreview.campaignPublicId(), healthyPreview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        healthyPreview.campaignPublicId(), healthyPreview.previewToken(), "healthy-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));

    jdbc.update("update customer set status = 'INACTIVE' where dealership_id = ? and id = ?",
        owner.dealershipId(), customerId);
    jdbc.update("""
        update notification_campaign
        set scheduled_at = now() - interval '2 seconds', next_dispatch_attempt_at = null
        where dealership_id = ? and public_id in (?, ?) and status = 'SCHEDULED'
        """, owner.dealershipId(), brokenPreview.campaignPublicId(), healthyPreview.campaignPublicId());

    assertThat(notifications.dispatchDueScheduledCampaigns()).isEqualTo(1);
    assertThat(jdbc.queryForObject("""
        select status from notification_campaign where public_id = ?
        """, String.class, healthyPreview.campaignPublicId())).isEqualTo("SENT");
    assertThat(jdbc.queryForObject("""
        select status from notification_campaign where public_id = ?
        """, String.class, brokenPreview.campaignPublicId())).isEqualTo("SCHEDULED");
    assertThat(jdbc.queryForObject("""
        select last_dispatch_error from notification_campaign where public_id = ?
        """, String.class, brokenPreview.campaignPublicId()))
        .contains("Dispatch error: ResponseStatusException");
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, brokenPreview.campaignPublicId())).isZero();
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, healthyPreview.campaignPublicId())).isEqualTo(1);
  }


  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void savedPreviewComparesOriginalAudienceSnapshotWithCurrentEligibility() {
    StaffPrincipal owner = createNotificationOperator();
    String code = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Eligibility Snapshot Customer', '9250000001', 'ACTIVE') returning id
        """, Long.class, owner.dealershipId(), code);

    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Saved audience comparison", "The original approval snapshot must stay inspectable",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", false,
                "selectionMode", "SELECTED",
                "selectedRecipients", List.of(Map.of("kind", "CUSTOMER", "id", customerId)),
                "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        preview.campaignPublicId(), preview.previewToken(), "saved-eligibility-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));
    jdbc.update("update customer set status = 'INACTIVE' where dealership_id = ? and id = ?",
        owner.dealershipId(), customerId);

    var saved = notifications.savedPreview(owner, preview.campaignPublicId());
    assertThat(saved.campaign().status()).isEqualTo("SCHEDULED");
    assertThat(saved.audienceStage()).isEqualTo("PREVIEW");
    assertThat(saved.audienceResolvedAt()).isNotNull();
    assertThat(saved.previewedRecipientCount()).isEqualTo(1);
    assertThat(saved.recipientCounts()).containsEntry("CUSTOMER", 1);
    assertThat(saved.currentEligibleRecipientCount()).isZero();
    assertThat(saved.currentEligibleRecipientCounts()).isEmpty();
    assertThat(saved.eligibilityCheckedAt()).isNotNull();
    assertThat(saved.currentEligibleRecipientCount()).isNotEqualTo(saved.previewedRecipientCount());
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void sendNowDispatchesAnApprovedCampaignWithoutAPlannedScheduleAndIsIdempotent() {
    StaffPrincipal owner = createNotificationOperator();
    var preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "STAFF", "Approved direct send", "Approved campaigns can be delivered without a schedule",
            Map.of("recipientTypes", List.of("STAFF"), "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());

    var sent = notifications.sendNow(owner, preview.campaignPublicId());
    assertThat(sent.alreadySent()).isFalse();
    assertThat(sent.campaign().status()).isEqualTo("SENT");
    assertThat(sent.campaign().scheduledAt()).isNull();
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isEqualTo(1);

    var replay = notifications.sendNow(owner, preview.campaignPublicId());
    assertThat(replay.alreadySent()).isTrue();
    assertThat(replay.campaign().status()).isEqualTo("SENT");
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isEqualTo(1);
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void failedApprovedSendCanBeManuallyRetriedAfterEligibilityIsRestored() {
    StaffPrincipal owner = createNotificationOperator();
    String code = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Direct Retry Customer', '9260000001', 'ACTIVE') returning id
        """, Long.class, owner.dealershipId(), code);
    var preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Direct retry", "Manual retry remains available after an approved direct-send failure",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", false,
                "selectionMode", "SELECTED",
                "selectedRecipients", List.of(Map.of("kind", "CUSTOMER", "id", customerId)),
                "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    jdbc.update("update customer set status = 'INACTIVE' where dealership_id = ? and id = ?",
        owner.dealershipId(), customerId);

    assertThatThrownBy(() -> notifications.sendNow(owner, preview.campaignPublicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
    var failed = jdbc.queryForMap("""
        select status, scheduled_at, dispatch_attempt_count, last_dispatch_error, next_dispatch_attempt_at
        from notification_campaign where dealership_id = ? and public_id = ?
        """, owner.dealershipId(), preview.campaignPublicId());
    assertThat(failed.get("status")).isEqualTo("FAILED");
    assertThat(failed.get("scheduled_at")).isNull();
    assertThat(((Number) failed.get("dispatch_attempt_count")).intValue()).isEqualTo(1);
    assertThat(String.valueOf(failed.get("last_dispatch_error")))
        .contains("Dispatch error: ResponseStatusException");
    assertThat(failed.get("next_dispatch_attempt_at")).isNull();
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isZero();

    jdbc.update("update customer set status = 'ACTIVE' where dealership_id = ? and id = ?",
        owner.dealershipId(), customerId);
    var retried = notifications.sendNow(owner, preview.campaignPublicId());
    assertThat(retried.alreadySent()).isFalse();
    assertThat(retried.campaign().status()).isEqualTo("SENT");
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isEqualTo(1);
  }

  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void automaticRetryStateBecomesTerminalAfterTheConfiguredAttemptLimit() {
    StaffPrincipal owner = createNotificationOperator();
    String code = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Retry Exhaustion Customer', '9240000001', 'ACTIVE') returning id
        """, Long.class, owner.dealershipId(), code);

    NotificationManagementService.PreviewResult preview = notifications.preview(owner,
        new NotificationManagementService.PreviewRequest(
            "CUSTOMER", "Retry exhaustion test", "Repeated stale-recipient dispatch must become terminal",
            Map.of("recipientTypes", List.of("CUSTOMER"), "marketingOnly", false,
                "selectionMode", "SELECTED",
                "selectedRecipients", List.of(Map.of("kind", "CUSTOMER", "id", customerId)),
                "excludedRecipients", List.of()),
            CONTENT, null, null));
    notifications.approve(owner, preview.campaignPublicId(), preview.previewToken());
    notifications.send(owner, new NotificationManagementService.SendRequest(
        preview.campaignPublicId(), preview.previewToken(), "exhaust-" + UUID.randomUUID(),
        Instant.now().plusSeconds(3600), null));
    jdbc.update("""
        update notification_campaign
        set scheduled_at = now() - interval '1 second', next_dispatch_attempt_at = null
        where dealership_id = ? and public_id = ?
        """, owner.dealershipId(), preview.campaignPublicId());
    jdbc.update("update customer set status = 'INACTIVE' where dealership_id = ? and id = ?",
        owner.dealershipId(), customerId);

    for (int attempt = 1; attempt <= 5; attempt++) {
      // Drive the actual scheduled dispatcher, not repeated manual Send now requests.
      assertThat(notifications.dispatchDueScheduledCampaigns()).isZero();

      var saved = jdbc.queryForMap("""
          select status, dispatch_attempt_count, last_dispatch_error, next_dispatch_attempt_at
          from notification_campaign where dealership_id = ? and public_id = ?
          """, owner.dealershipId(), preview.campaignPublicId());
      assertThat(((Number) saved.get("dispatch_attempt_count")).intValue()).isEqualTo(attempt);
      assertThat(String.valueOf(saved.get("last_dispatch_error")))
          .contains("Dispatch error: ResponseStatusException");
      if (attempt < 5) {
        assertThat(saved.get("status")).isEqualTo("SCHEDULED");
        Timestamp nextAttempt = (Timestamp) saved.get("next_dispatch_attempt_at");
        assertThat(nextAttempt).isNotNull();
        assertThat(nextAttempt.toInstant()).isAfter(Instant.now());
        // Advance only this synthetic retry to the due boundary instead of sleeping for backoff.
        jdbc.update("""
            update notification_campaign set next_dispatch_attempt_at = now() - interval '1 second'
            where dealership_id = ? and public_id = ?
            """, owner.dealershipId(), preview.campaignPublicId());
      } else {
        assertThat(saved.get("status")).isEqualTo("FAILED");
        assertThat(saved.get("next_dispatch_attempt_at")).isNull();
      }
    }

    assertThat(jdbc.queryForList("""
        select action from notification_audit
        where dealership_id = ?
          and campaign_id = (select id from notification_campaign where public_id = ?)
        order by id
        """, String.class, owner.dealershipId(), preview.campaignPublicId()))
        .contains("CAMPAIGN_DISPATCH_RETRY_SCHEDULED", "CAMPAIGN_DISPATCH_FAILED");
    assertThat(jdbc.queryForObject("""
        select count(*) from notification_recipient
        where campaign_id = (select id from notification_campaign where public_id = ?)
        """, Integer.class, preview.campaignPublicId())).isZero();
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
    return createNotificationActor("OWNER");
  }

  /**
   * Non-transactional dispatch tests use a non-owner role so their committed fixtures cannot
   * interfere with the system-wide one-time initial-owner bootstrap test.
   */
  private StaffPrincipal createNotificationOperator() {
    return createNotificationActor("MANAGER");
  }

  private StaffPrincipal createNotificationActor(String roleCode) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "NOTIF-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Notification Test Agency");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Test Notification Actor', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "notification-test-" + unique.toLowerCase() + "@example.test");
    Long roleId = jdbc.queryForObject("select id from role where code = ?", Long.class, roleCode);
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
        code, "Test Notification Actor", Set.of(roleCode),
        Set.of("notification.read", "notification.create", "notification.approve", "notification.send"));
  }
}
