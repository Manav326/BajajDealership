package com.quantaedge.bajaj.notifications;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Dealership-scoped rich notifications. Durable recipient rows are the inbox source of truth;
 * external transports are independent delivery attempts and cannot erase in-app records.
 */
@Service
public class NotificationManagementService {
  private static final int MAX_RECIPIENTS = 10_000;
  private static final int MAX_PAGE_SIZE = 100;
  private static final long PREVIEW_LIFETIME_SECONDS = 600;
  private static final List<String> RECIPIENT_KINDS = List.of("CUSTOMER", "STAFF");
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final NotificationContentValidator validator;
  private final SecureRandom secureRandom = new SecureRandom();

  private static final RowMapper<TemplateView> TEMPLATE_ROW = (rs, rowNum) -> new TemplateView(
      rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getString("template_family_id"),
      rs.getString("template_name"), rs.getString("description"), rs.getInt("content_version"),
      readDocument(rs.getString("content_document")), rs.getString("status"),
      rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());

  private static final RowMapper<CampaignRecord> CAMPAIGN_ROW = (rs, rowNum) -> new CampaignRecord(
      rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getLong("dealership_id"),
      rs.getLong("created_by_staff_user_id"), rs.getString("scope"), rs.getString("title"),
      rs.getString("summary"), rs.getString("audience_filter_json"),
      rs.getString("audience_snapshot_json"), rs.getString("content_document_json"),
      rs.getObject("template_id") == null ? null : rs.getLong("template_id"),
      (Integer) rs.getObject("template_version"), rs.getString("status"),
      rs.getString("idempotency_key"), rs.getString("preview_token_hash"),
      rs.getString("preview_fingerprint"), instant(rs.getTimestamp("preview_expires_at")),
      instant(rs.getTimestamp("preview_consumed_at")), instant(rs.getTimestamp("scheduled_at")),
      instant(rs.getTimestamp("expires_at")), rs.getInt("resolved_recipient_count"),
      instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("dispatched_at")),
      instant(rs.getTimestamp("cancelled_at")));

  private static final RowMapper<CampaignView> CAMPAIGN_VIEW_ROW = (rs, rowNum) -> new CampaignView(
      rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getString("scope"), rs.getString("title"),
      rs.getString("summary"), rs.getString("status"), rs.getInt("resolved_recipient_count"),
      instant(rs.getTimestamp("scheduled_at")), instant(rs.getTimestamp("expires_at")),
      instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("dispatched_at")),
      instant(rs.getTimestamp("cancelled_at")));

  private static final RowMapper<InboxItem> INBOX_ROW = (rs, rowNum) -> new InboxItem(
      rs.getObject("recipient_public_id", UUID.class),
      rs.getObject("campaign_public_id", UUID.class),
      rs.getString("title"), rs.getString("summary"),
      readDocument(rs.getString("content_document_json")),
      rs.getString("sender_name"), rs.getString("status"),
      instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("read_at")),
      instant(rs.getTimestamp("dismissed_at")));

  public NotificationManagementService(
      JdbcTemplate jdbc, ObjectMapper mapper, NotificationContentValidator validator) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.validator = validator;
  }

  public List<TemplateView> listTemplates(StaffPrincipal actor) {
    return jdbc.query("""
        select id, public_id, template_family_id::text, template_name, description,
          content_version, content_document::text as content_document, status, created_at, updated_at
        from notification_template
        where dealership_id = ? and status <> 'ARCHIVED'
        order by lower(template_name), content_version desc
        """, TEMPLATE_ROW, actor.dealershipId());
  }

  @Transactional
  public TemplateView createTemplate(StaffPrincipal actor, TemplateRequest request) {
    String name = requiredText(request.templateName(), "Template name", 120);
    String description = optionalText(request.description(), 500);
    JsonNode document = validateDocument(request.contentDocument());
    String json = writeJson(document);
    Long id = jdbc.queryForObject("""
        insert into notification_template(
          dealership_id, template_name, description, content_version, content_document, status,
          created_by_staff_user_id, updated_by_staff_user_id)
        values (?, ?, ?, 1, ?::jsonb, 'ACTIVE', ?, ?)
        returning id
        """, Long.class, actor.dealershipId(), name, description, json,
        actor.staffUserId(), actor.staffUserId());
    Map<String, Object> created = jdbc.queryForMap(
        "select public_id from notification_template where id = ? and dealership_id = ?",
        id, actor.dealershipId());
    UUID publicId = (UUID) created.get("public_id");
    audit(actor, "TEMPLATE_CREATED", null, id, Map.of("templateName", name, "version", 1));
    return findTemplate(actor, publicId);
  }

  @Transactional
  public TemplateView createTemplateVersion(StaffPrincipal actor, UUID publicId, TemplateRequest request) {
    List<Map<String, Object>> versions = jdbc.queryForList("""
        select id, template_family_id, template_name, description, content_version, status
        from notification_template
        where dealership_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), publicId);
    if (versions.isEmpty()) throw notFound("Notification template was not found.");
    Map<String, Object> current = versions.getFirst();
    if (!"ACTIVE".equals(String.valueOf(current.get("status")))) {
      throw conflict("Only the latest active template can be edited. Reload the template library.");
    }
    String name = requiredText(request.templateName(), "Template name", 120);
    String description = optionalText(request.description(), 500);
    JsonNode document = validateDocument(request.contentDocument());
    int version = ((Number) current.get("content_version")).intValue() + 1;
    String json = writeJson(document);
    int archived = jdbc.update("""
        update notification_template set status = 'ARCHIVED', updated_at = now()
        where id = ? and dealership_id = ? and status = 'ACTIVE'
        """, current.get("id"), actor.dealershipId());
    if (archived != 1) throw conflict("The template changed while you were editing it. Reload and retry.");

    Long id;
    try {
      id = jdbc.queryForObject("""
          insert into notification_template(
            template_family_id, dealership_id, template_name, description,
            content_version, content_document, status, created_by_staff_user_id, updated_by_staff_user_id)
          values (?::uuid, ?, ?, ?, ?, ?::jsonb, 'ACTIVE', ?, ?)
          returning id
          """, Long.class, String.valueOf(current.get("template_family_id")), actor.dealershipId(),
          name, description, version, json, actor.staffUserId(), actor.staffUserId());
    } catch (DuplicateKeyException failure) {
      throw conflict("A newer version of this template already exists. Reload and retry.");
    }
    UUID latestPublicId = jdbc.queryForObject(
        "select public_id from notification_template where id = ?", UUID.class, id);
    audit(actor, "TEMPLATE_VERSION_CREATED", null, id,
        Map.of("templateFamilyId", String.valueOf(current.get("template_family_id")),
            "previousVersion", version - 1, "version", version));
    return findTemplate(actor, latestPublicId);
  }

  public TemplateView findTemplate(StaffPrincipal actor, UUID publicId) {
    List<TemplateView> rows = jdbc.query("""
        select id, public_id, template_family_id::text, template_name, description,
          content_version, content_document::text as content_document, status, created_at, updated_at
        from notification_template
        where dealership_id = ? and public_id = ?
        """, TEMPLATE_ROW, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Notification template was not found.");
    return rows.getFirst();
  }

  public List<RecipientOption> searchRecipients(StaffPrincipal actor, String kind, String query) {
    String normalizedKind = normalizeKind(kind);
    String term = optionalText(query, 100);
    String like = term == null ? null : "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
    if ("CUSTOMER".equals(normalizedKind)) {
      if (like == null) {
        return jdbc.query("""
            select c.id, c.public_id, c.full_name, c.status
            from customer c where c.dealership_id = ? and c.status = 'ACTIVE'
            order by lower(c.full_name) limit 50
            """, recipientOptionMapper("CUSTOMER", actor), actor.dealershipId());
      }
      return jdbc.query("""
          select c.id, c.public_id, c.full_name, c.status
          from customer c where c.dealership_id = ? and c.status = 'ACTIVE'
            and (lower(c.full_name) like ? escape '!' or c.phone like ? escape '!'
              or lower(coalesce(c.email,'')) like ? escape '!' or lower(c.customer_code) like ? escape '!')
          order by lower(c.full_name) limit 50
          """, recipientOptionMapper("CUSTOMER", actor), actor.dealershipId(),
          like, "%" + escapeLike(term) + "%", like, like);
    }
    if (like == null) {
      return jdbc.query("""
          select u.id, u.public_id, u.full_name, u.status
          from staff_user u where u.dealership_id = ? and u.status = 'ACTIVE'
          order by lower(u.full_name) limit 50
          """, recipientOptionMapper("STAFF", actor), actor.dealershipId());
    }
    return jdbc.query("""
        select u.id, u.public_id, u.full_name, u.status
        from staff_user u where u.dealership_id = ? and u.status = 'ACTIVE'
          and (lower(u.full_name) like ? escape '!' or lower(coalesce(u.email,'')) like ? escape '!'
            or u.phone like ? escape '!')
        order by lower(u.full_name) limit 50
        """, recipientOptionMapper("STAFF", actor), actor.dealershipId(),
        like, like, "%" + escapeLike(term) + "%");
  }

  public NotificationOptions options(StaffPrincipal actor) {
    Map<String, Object> dealership = jdbc.queryForMap("""
        select id, public_id, code, name, status from dealership where id = ?
        """, actor.dealershipId());
    int activeCustomers = count("select count(*) from customer where dealership_id=? and status='ACTIVE'", actor.dealershipId());
    int marketingConsent = count("select count(*) from customer where dealership_id=? and status='ACTIVE' and marketing_consent_at is not null", actor.dealershipId());
    int activeStaff = count("select count(*) from staff_user where dealership_id=? and status='ACTIVE'", actor.dealershipId());
    DealershipOption option = new DealershipOption(
        ((Number) dealership.get("id")).longValue(),
        String.valueOf(dealership.get("code")),
        String.valueOf(dealership.get("name")),
        String.valueOf(dealership.get("status")),
        activeCustomers, marketingConsent, activeStaff);
    return new NotificationOptions(List.of(option), activeCustomers, marketingConsent, activeStaff);
  }

  @Transactional
  public PreviewResult preview(StaffPrincipal actor, PreviewRequest request) {
    String scope = normalizeScope(request.scope());
    String title = requiredText(request.title(), "Notification title", 120);
    String summary = requiredText(request.summary(), "Notification summary", 300);
    JsonNode document = validateDocument(request.contentDocument());
    JsonNode filter = normalizeAudienceFilter(scope, mapper.valueToTree(request.audienceFilter()));
    Long templateId = null;
    Integer templateVersion = null;
    if (request.templatePublicId() != null) {
      List<Map<String, Object>> templateRows = jdbc.queryForList("""
          select id, content_version, status from notification_template
          where dealership_id = ? and public_id = ?
          """, actor.dealershipId(), request.templatePublicId());
      if (templateRows.isEmpty()) throw notFound("Notification template was not found.");
      Map<String, Object> template = templateRows.getFirst();
      if (!"ACTIVE".equals(String.valueOf(template.get("status")))) {
        throw conflict("Only an active template version can be attached to a campaign.");
      }
      templateId = ((Number) template.get("id")).longValue();
      templateVersion = ((Number) template.get("content_version")).intValue();
      if (request.templateVersion() != null && !request.templateVersion().equals(templateVersion)) {
        throw conflict("The selected template version is stale. Reload the template library.");
      }
    }

    List<RecipientCandidate> eligible = resolveAudience(actor, scope, filter);
    if (eligible.size() > MAX_RECIPIENTS) {
      throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
          "The audience exceeds the 10,000-recipient limit. Narrow the audience before sending.");
    }
    Set<String> eligibleKeys = new LinkedHashSet<>();
    eligible.forEach(recipient -> eligibleKeys.add(recipient.key()));
    List<String> invalidExclusions = exclusions(filter).stream()
        .filter(key -> !eligibleKeys.contains(key)).toList();
    if (!invalidExclusions.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Audience exclusions must refer only to eligible recipients returned by this server.");
    }
    List<RecipientCandidate> selected = excludeRecipients(eligible, filter);
    String token = newPreviewToken();
    Instant previewExpires = Instant.now().plusSeconds(PREVIEW_LIFETIME_SECONDS);
    String contentJson = writeJson(document);
    String filterJson = writeJson(filter);
    String snapshotJson = writeJson(snapshot(selected, true));

    UUID campaignPublicId;
    try {
      campaignPublicId = jdbc.queryForObject("""
          insert into notification_campaign(
            dealership_id, created_by_staff_user_id, scope, title, summary, audience_filter,
            audience_snapshot, content_document, template_id, template_version, status,
            idempotency_key, preview_token_hash, preview_expires_at, resolved_recipient_count)
          values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, 'PREVIEWED',
            ?, ?, ?, ?)
          returning public_id
          """, UUID.class,
          actor.dealershipId(), actor.staffUserId(), scope, title, summary, filterJson, snapshotJson,
          contentJson, templateId, templateVersion,
          "PREVIEW-" + UUID.randomUUID(), TokenDigests.sha256(token), Timestamp.from(previewExpires),
          selected.size());
    } catch (DuplicateKeyException failure) {
      throw conflict("This notification preview could not be recorded. Run preview again.");
    }

    CampaignRecord created = loadCampaign(actor.dealershipId(), campaignPublicId, false);
    String fingerprint = fingerprint(created);
    jdbc.update("""
        update notification_campaign set preview_fingerprint = ?, updated_at = now()
        where id = ? and dealership_id = ? and status = 'PREVIEWED'
        """, fingerprint, created.id(), actor.dealershipId());
    audit(actor, "CAMPAIGN_PREVIEWED", created.id(), templateId,
        Map.of("scope", scope, "recipientCount", selected.size(), "previewExpiresAt", previewExpires.toString()));

    Map<String, Integer> recipientCounts = new LinkedHashMap<>();
    for (RecipientCandidate recipient : selected) {
      recipientCounts.merge(recipient.kind(), 1, Integer::sum);
    }
    List<RecipientOption> details = selected.stream().map(this::toOption).toList();
    return new PreviewResult(true, campaignPublicId, token, previewExpires, selected.size(),
        recipientCounts, details, selected.isEmpty()
            ? "No eligible recipients match this audience."
            : "Audience validated. The recipient list will be checked again at dispatch.");
  }

  @Transactional
  public CampaignResult send(StaffPrincipal actor, SendRequest request) {
    if (request.campaignPublicId() == null) throw badRequest("A previewed campaign ID is required.");
    String idempotencyKey = requiredText(request.idempotencyKey(), "Idempotency key", 120);
    String token = requiredText(request.previewToken(), "Preview token", 200);
    CampaignRecord campaign = loadCampaignForActor(actor, request.campaignPublicId(), true);

    if (isAcceptedStatus(campaign.status())) {
      if (idempotencyKey.equals(campaign.idempotencyKey())) {
        return new CampaignResult(toView(campaign), true);
      }
      throw conflict("This preview has already been accepted by another send request.");
    }
    if (!"PREVIEWED".equals(campaign.status())) throw conflict("Only a previewed campaign can be sent or scheduled.");
    if (campaign.previewExpiresAt() == null || !campaign.previewExpiresAt().isAfter(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.GONE, "The preview expired. Review the audience and preview again.");
    }
    if (campaign.previewTokenHash() == null || !constantTimeEquals(
        campaign.previewTokenHash(), TokenDigests.sha256(token))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Preview token is invalid. Run audience preview again.");
    }
    if (campaign.previewFingerprint() == null || !constantTimeEquals(
        campaign.previewFingerprint(), fingerprint(campaign))) {
      throw conflict("The preview snapshot changed. Rebuild the preview before sending.");
    }
    Integer duplicateKey = jdbc.queryForObject("""
        select count(*) from notification_campaign
        where dealership_id = ? and created_by_staff_user_id = ? and idempotency_key = ? and id <> ?
        """, Integer.class, actor.dealershipId(), actor.staffUserId(), idempotencyKey, campaign.id());
    if (duplicateKey != null && duplicateKey > 0) {
      throw conflict("This idempotency key already belongs to a different campaign.");
    }

    Instant scheduledAt = request.scheduledAt();
    Instant expiresAt = request.expiresAt();
    Instant now = Instant.now();
    if (expiresAt != null && !expiresAt.isAfter(now)) throw badRequest("Expiry time must be in the future.");
    if (scheduledAt != null && expiresAt != null && !expiresAt.isAfter(scheduledAt)) {
      throw badRequest("Expiry time must be after the scheduled send time.");
    }
    if (scheduledAt != null && scheduledAt.isAfter(now)) {
      jdbc.update("""
          update notification_campaign
          set idempotency_key = ?, status = 'SCHEDULED', scheduled_at = ?, expires_at = ?,
              preview_consumed_at = now(), updated_at = now()
          where id = ? and dealership_id = ? and status = 'PREVIEWED'
          """, idempotencyKey, Timestamp.from(scheduledAt),
          expiresAt == null ? null : Timestamp.from(expiresAt), campaign.id(), actor.dealershipId());
      audit(actor, "CAMPAIGN_SCHEDULED", campaign.id(), null,
          Map.of("scheduledAt", scheduledAt.toString(), "previewRecipientCount", campaign.resolvedRecipientCount()));
      return new CampaignResult(toView(loadCampaign(actor.dealershipId(), campaign.publicId(), false)), false);
    }

    List<RecipientCandidate> currentAudience = resolveAudience(actor, campaign.scope(), parseObject(campaign.audienceFilterJson()));
    if (currentAudience.size() > MAX_RECIPIENTS) throw badRequest("The audience now exceeds the recipient limit.");
    currentAudience = excludeRecipients(currentAudience, parseObject(campaign.audienceFilterJson()));
    if (currentAudience.isEmpty()) {
      throw conflict("No eligible recipients remain. Review the audience and run preview again.");
    }
    jdbc.update("""
        update notification_campaign
        set idempotency_key = ?, preview_consumed_at = now(), expires_at = ?, updated_at = now()
        where id = ? and dealership_id = ? and status = 'PREVIEWED'
        """, idempotencyKey, expiresAt == null ? null : Timestamp.from(expiresAt),
        campaign.id(), actor.dealershipId());
    dispatchRecipients(actor.dealershipId(), campaign, currentAudience);
    recordSnapshotAndStatus(campaign, currentAudience, "SENT");
    audit(actor, "CAMPAIGN_SENT", campaign.id(), campaign.templateId(),
        Map.of("resolvedRecipientCount", currentAudience.size(), "channel", "IN_APP"));
    CampaignRecord updated = loadCampaign(actor.dealershipId(), campaign.publicId(), false);
    return new CampaignResult(toView(updated), false);
  }

  public List<CampaignView> listCampaigns(StaffPrincipal actor, int requestedLimit) {
    int limit = Math.max(1, Math.min(requestedLimit, MAX_PAGE_SIZE));
    return jdbc.query("""
        select id, public_id, scope, title, summary, status, resolved_recipient_count,
          scheduled_at, expires_at, created_at, dispatched_at, cancelled_at
        from notification_campaign where dealership_id = ?
        order by created_at desc, id desc limit ?
        """, CAMPAIGN_VIEW_ROW, actor.dealershipId(), limit);
  }

  @Transactional
  public CampaignView cancel(StaffPrincipal actor, UUID publicId) {
    CampaignRecord campaign = loadCampaign(actor.dealershipId(), publicId, true);
    if (!List.of("PREVIEWED", "SCHEDULED", "QUEUED").contains(campaign.status())) {
      throw conflict("Only a previewed or pending campaign can be cancelled.");
    }
    jdbc.update("""
        update notification_campaign set status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        where id = ? and dealership_id = ?
        """, campaign.id(), actor.dealershipId());
    audit(actor, "CAMPAIGN_CANCELLED", campaign.id(), campaign.templateId(),
        Map.of("previousStatus", campaign.status()));
    return toView(loadCampaign(actor.dealershipId(), publicId, false));
  }

  @Transactional
  public int dispatchDueScheduledCampaigns() {
    List<UUID> dueCampaigns = jdbc.query("""
        select public_id from notification_campaign
        where status = 'SCHEDULED' and scheduled_at <= now()
        order by scheduled_at, id limit 25
        """, (rs, rowNum) -> rs.getObject(1, UUID.class));
    int dispatched = 0;
    for (UUID campaignId : dueCampaigns) {
      if (dispatchScheduledCampaign(campaignId)) dispatched++;
    }
    return dispatched;
  }

  @Transactional
  public boolean dispatchScheduledCampaign(UUID publicId) {
    List<CampaignRecord> rows = jdbc.query("""
        select """ + CAMPAIGN_COLUMNS + """
        from notification_campaign
        where public_id = ? and status = 'SCHEDULED' and scheduled_at <= now()
        for update skip locked
        """, CAMPAIGN_ROW, publicId);
    if (rows.isEmpty()) return false;
    CampaignRecord campaign = rows.getFirst();
    if (campaign.expiresAt() != null && !campaign.expiresAt().isAfter(Instant.now())) {
      jdbc.update("""
          update notification_campaign set status = 'EXPIRED', updated_at = now()
          where id = ? and status = 'SCHEDULED'
          """, campaign.id());
      auditSystem(campaign, "CAMPAIGN_EXPIRED", Map.of("reason", "Expiry elapsed before dispatch."));
      return false;
    }

    StaffPrincipal actor = findActor(campaign);
    List<RecipientCandidate> currentAudience = resolveAudience(
        actor, campaign.scope(), parseObject(campaign.audienceFilterJson()));
    currentAudience = excludeRecipients(currentAudience, parseObject(campaign.audienceFilterJson()));
    if (currentAudience.isEmpty()) {
      jdbc.update("""
          update notification_campaign set status = 'FAILED', resolved_recipient_count = 0, updated_at = now()
          where id = ? and status = 'SCHEDULED'
          """, campaign.id());
      auditSystem(campaign, "CAMPAIGN_FAILED_NO_RECIPIENTS",
          Map.of("reason", "No eligible recipients remained at scheduled dispatch."));
      return false;
    }
    dispatchRecipients(campaign.dealershipId(), campaign, currentAudience);
    recordSnapshotAndStatus(campaign, currentAudience, "SENT");
    auditSystem(campaign, "CAMPAIGN_SENT", Map.of(
        "resolvedRecipientCount", currentAudience.size(), "channel", "IN_APP", "scheduled", true));
    return true;
  }

  public Page<InboxItem> inbox(StaffPrincipal actor, int requestedPage, int requestedSize, boolean unreadOnly) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int size = Math.max(1, Math.min(requestedSize, MAX_PAGE_SIZE));
    long offset = (long) page * size;
    String filter = unreadOnly ? " and r.read_at is null " : "";
    Long totalValue = jdbc.queryForObject("""
        select count(*) from notification_recipient r
        join notification_campaign c on c.id = r.campaign_id and c.dealership_id = r.dealership_id
        where r.dealership_id = ? and r.recipient_kind = 'STAFF' and r.staff_user_id = ?
          and r.status <> 'DISMISSED' and c.status = 'SENT'
        """ + filter, Long.class, actor.dealershipId(), actor.staffUserId());
    long total = totalValue == null ? 0 : totalValue;
    List<InboxItem> items = jdbc.query("""
        select r.public_id as recipient_public_id, c.public_id as campaign_public_id,
          c.title, c.summary, c.content_document::text as content_document_json,
          sender.full_name as sender_name, r.status, r.created_at, r.read_at, r.dismissed_at
        from notification_recipient r
        join notification_campaign c on c.id = r.campaign_id and c.dealership_id = r.dealership_id
        join staff_user sender on sender.id = c.created_by_staff_user_id and sender.dealership_id = c.dealership_id
        where r.dealership_id = ? and r.recipient_kind = 'STAFF' and r.staff_user_id = ?
          and r.status <> 'DISMISSED' and c.status = 'SENT'
        """ + filter + " order by r.created_at desc, r.id desc limit ? offset ?",
        INBOX_ROW, actor.dealershipId(), actor.staffUserId(), size, offset);
    Integer unread = jdbc.queryForObject("""
        select count(*) from notification_recipient r
        join notification_campaign c on c.id=r.campaign_id and c.dealership_id=r.dealership_id
        where r.dealership_id=? and r.recipient_kind='STAFF' and r.staff_user_id=?
          and r.status <> 'DISMISSED' and r.read_at is null and c.status='SENT'
        """, Integer.class, actor.dealershipId(), actor.staffUserId());
    return new Page<>(items, page, size, total, unread == null ? 0 : unread);
  }

  @Transactional
  public void markRead(StaffPrincipal actor, UUID recipientPublicId, boolean read) {
    int changed = jdbc.update("""
        update notification_recipient r
        set status = case when ? then 'READ' else 'IN_APP_CREATED' end,
            read_at = case when ? then coalesce(r.read_at, now()) else null end
        where r.dealership_id = ? and r.recipient_kind = 'STAFF' and r.staff_user_id = ?
          and r.public_id = ? and r.status <> 'DISMISSED'
          and exists (select 1 from notification_campaign c
            where c.id = r.campaign_id and c.dealership_id = r.dealership_id and c.status = 'SENT')
        """, read, read, actor.dealershipId(), actor.staffUserId(), recipientPublicId);
    if (changed == 0) throw notFound("Notification was not found in this user's inbox.");
  }

  @Transactional
  public void dismiss(StaffPrincipal actor, UUID recipientPublicId) {
    int changed = jdbc.update("""
        update notification_recipient r
        set status = 'DISMISSED', dismissed_at = now()
        where r.dealership_id = ? and r.recipient_kind = 'STAFF' and r.staff_user_id = ?
          and r.public_id = ? and r.status <> 'DISMISSED'
          and exists (select 1 from notification_campaign c
            where c.id = r.campaign_id and c.dealership_id = r.dealership_id and c.status = 'SENT')
        """, actor.dealershipId(), actor.staffUserId(), recipientPublicId);
    if (changed == 0) throw notFound("Notification was not found in this user's inbox.");
  }

  @Transactional
  public int markAllRead(StaffPrincipal actor) {
    return jdbc.update("""
        update notification_recipient r set status = 'READ', read_at = coalesce(read_at, now())
        where r.dealership_id = ? and r.recipient_kind = 'STAFF' and r.staff_user_id = ?
          and r.status = 'IN_APP_CREATED' and r.read_at is null
          and exists (select 1 from notification_campaign c
            where c.id = r.campaign_id and c.dealership_id = r.dealership_id and c.status = 'SENT')
        """, actor.dealershipId(), actor.staffUserId());
  }

  private static final String CAMPAIGN_COLUMNS = """
      id, public_id, dealership_id, created_by_staff_user_id, scope, title, summary,
      audience_filter::text as audience_filter_json, audience_snapshot::text as audience_snapshot_json,
      content_document::text as content_document_json, template_id, template_version, status,
      idempotency_key, preview_token_hash, preview_fingerprint, preview_expires_at, preview_consumed_at,
      scheduled_at, expires_at, resolved_recipient_count, created_at, dispatched_at, cancelled_at
      """;

  private CampaignRecord loadCampaign(long dealershipId, UUID publicId, boolean lock) {
    String sql = "select " + CAMPAIGN_COLUMNS
        + " from notification_campaign where dealership_id = ? and public_id = ?"
        + (lock ? " for update" : "");
    List<CampaignRecord> rows = jdbc.query(sql, CAMPAIGN_ROW, dealershipId, publicId);
    if (rows.isEmpty()) throw notFound("Notification campaign was not found.");
    return rows.getFirst();
  }

  private CampaignRecord loadCampaignForActor(StaffPrincipal actor, UUID publicId, boolean lock) {
    CampaignRecord record = loadCampaign(actor.dealershipId(), publicId, lock);
    if (record.createdByStaffUserId() != actor.staffUserId()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,
          "Only the staff member who previewed this campaign can complete its send request.");
    }
    return record;
  }

  private void dispatchRecipients(long dealershipId, CampaignRecord campaign, List<RecipientCandidate> recipients) {
    for (RecipientCandidate candidate : recipients) {
      Long customerId = "CUSTOMER".equals(candidate.kind()) ? candidate.id() : null;
      Long staffId = "STAFF".equals(candidate.kind()) ? candidate.id() : null;
      jdbc.update("""
          insert into notification_recipient(
            campaign_id, dealership_id, recipient_kind, customer_id, staff_user_id, status)
          values (?, ?, ?, ?, ?, 'IN_APP_CREATED')
          on conflict do nothing
          """, campaign.id(), dealershipId, candidate.kind(), customerId, staffId);

      Long recipientId = jdbc.queryForObject("""
          select id from notification_recipient
          where campaign_id = ? and dealership_id = ? and recipient_kind = ?
            and ((customer_id is not null and customer_id = ?) or (staff_user_id is not null and staff_user_id = ?))
          """, Long.class, campaign.id(), dealershipId, candidate.kind(), customerId, staffId);
      jdbc.update("""
          insert into notification_delivery_attempt(
            dealership_id, recipient_id, channel, status, attempt_number, next_attempt_at, attempted_at)
          values (?, ?, 'IN_APP', 'DELIVERED', 1, now(), now())
          on conflict do nothing
          """, dealershipId, recipientId);
    }
  }

  private void recordSnapshotAndStatus(CampaignRecord campaign, List<RecipientCandidate> recipients, String status) {
    String snapshot = writeJson(snapshot(recipients, false));
    jdbc.update("""
        update notification_campaign
        set status = ?, audience_snapshot = ?::jsonb, resolved_recipient_count = ?,
            dispatched_at = now(), updated_at = now()
        where id = ? and dealership_id = ?
        """, status, snapshot, recipients.size(), campaign.id(), campaign.dealershipId());
  }

  private List<RecipientCandidate> resolveAudience(StaffPrincipal actor, String scope, JsonNode filter) {
    Set<String> kinds = audienceKinds(scope, filter);
    boolean marketingOnly = filter.path("marketingOnly").asBoolean(false);
    if (marketingOnly && kinds.stream().anyMatch(kind -> !"CUSTOMER".equals(kind))) {
      throw badRequest("Marketing-consent filters may only target customers.");
    }
    List<RecipientCandidate> result = new ArrayList<>();
    if (kinds.contains("CUSTOMER")) {
      String marketingFilter = marketingOnly ? " and c.marketing_consent_at is not null " : "";
      result.addAll(jdbc.query("""
          select c.id, c.public_id, c.full_name, c.dealership_id, d.name as dealership_name, d.code as dealership_code
          from customer c join dealership d on d.id = c.dealership_id
          where c.dealership_id = ? and c.status = 'ACTIVE'
          """ + marketingFilter + " order by lower(c.full_name), c.id limit " + (MAX_RECIPIENTS + 1),
          (rs, rowNum) -> new RecipientCandidate("CUSTOMER", rs.getLong("id"),
              rs.getObject("public_id", UUID.class), rs.getString("full_name"),
              rs.getLong("dealership_id"), rs.getString("dealership_name"), rs.getString("dealership_code")),
          actor.dealershipId()));
    }
    if (kinds.contains("STAFF")) {
      result.addAll(jdbc.query("""
          select u.id, u.public_id, u.full_name, u.dealership_id, d.name as dealership_name, d.code as dealership_code
          from staff_user u join dealership d on d.id = u.dealership_id
          where u.dealership_id = ? and u.status = 'ACTIVE'
          order by lower(u.full_name), u.id limit """ + (MAX_RECIPIENTS + 1),
          (rs, rowNum) -> new RecipientCandidate("STAFF", rs.getLong("id"),
              rs.getObject("public_id", UUID.class), rs.getString("full_name"),
              rs.getLong("dealership_id"), rs.getString("dealership_name"), rs.getString("dealership_code")),
          actor.dealershipId()));
    }
    Set<String> selected = selectedRecipientKeys(filter);
    if (!selected.isEmpty()) {
      result.removeIf(candidate -> !selected.contains(candidate.key()));
    }
    if (result.size() > MAX_RECIPIENTS) {
      throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
          "The audience exceeds the 10,000-recipient limit. Narrow the audience.");
    }
    return result;
  }

  private JsonNode normalizeAudienceFilter(String scope, JsonNode raw) {
    ObjectNode filter = mapper.createObjectNode();
    Set<String> kinds = new LinkedHashSet<>();
    JsonNode kindsInput = raw == null ? null : raw.path("recipientTypes");
    if (kindsInput != null && kindsInput.isArray()) {
      for (JsonNode value : kindsInput) {
        String normalized = value.asText("").trim().toUpperCase(Locale.ROOT);
        if ("STUDENT".equals(normalized) || "PARENT".equals(normalized) || "USER_ACCOUNT".equals(normalized)) {
          normalized = "CUSTOMER";
        }
        if (RECIPIENT_KINDS.contains(normalized)) kinds.add(normalized);
        else if (!normalized.isEmpty()) throw badRequest("Unsupported notification recipient type: " + normalized);
      }
    }
    if ("CUSTOMER".equals(scope)) kinds = new LinkedHashSet<>(List.of("CUSTOMER"));
    if ("STAFF".equals(scope)) kinds = new LinkedHashSet<>(List.of("STAFF"));
    if ("DEALERSHIP".equals(scope) && kinds.isEmpty()) kinds.addAll(RECIPIENT_KINDS);
    if (kinds.isEmpty()) throw badRequest("Choose at least one eligible recipient group.");
    filter.set("recipientTypes", mapper.valueToTree(kinds));
    boolean marketingOnly = raw != null && raw.path("marketingOnly").asBoolean(false);
    if (marketingOnly && (kinds.size() != 1 || !kinds.contains("CUSTOMER"))) {
      throw badRequest("Marketing campaigns can only target customers with recorded consent.");
    }
    filter.put("marketingOnly", marketingOnly);

    ArrayNode exclusions = mapper.createArrayNode();
    JsonNode rawExclusions = raw == null ? null : raw.path("excludedRecipients");
    if (rawExclusions != null && rawExclusions.isArray()) {
      Set<String> deduplicated = new LinkedHashSet<>();
      for (JsonNode item : rawExclusions) {
        String kind = item.path("kind").asText("").trim().toUpperCase(Locale.ROOT);
        long id = item.path("id").asLong(-1);
        if (!RECIPIENT_KINDS.contains(kind) || id < 1) {
          throw badRequest("Each exclusion must identify an eligible customer or staff recipient.");
        }
        String key = kind + ":" + id;
        if (deduplicated.add(key)) {
          ObjectNode exclusion = mapper.createObjectNode();
          exclusion.put("kind", kind);
          exclusion.put("id", id);
          exclusions.add(exclusion);
        }
      }
    }
    filter.set("excludedRecipients", exclusions);

    ArrayNode selectedRecipients = mapper.createArrayNode();
    JsonNode rawSelected = raw == null ? null : raw.path("selectedRecipients");
    if (rawSelected != null && rawSelected.isArray()) {
      Set<String> deduplicated = new LinkedHashSet<>();
      for (JsonNode item : rawSelected) {
        String kind = item.path("kind").asText("").trim().toUpperCase(Locale.ROOT);
        long id = item.path("id").asLong(-1);
        if (!RECIPIENT_KINDS.contains(kind) || id < 1 || !kinds.contains(kind)) {
          throw badRequest("Selected recipients must belong to the chosen recipient group.");
        }
        String key = kind + ":" + id;
        if (deduplicated.add(key)) {
          ObjectNode recipient = mapper.createObjectNode();
          recipient.put("kind", kind);
          recipient.put("id", id);
          selectedRecipients.add(recipient);
        }
      }
    }
    filter.set("selectedRecipients", selectedRecipients);
    return filter;
  }

  private static Set<String> selectedRecipientKeys(JsonNode filter) {
    Set<String> selected = new LinkedHashSet<>();
    JsonNode rows = filter.path("selectedRecipients");
    if (rows.isArray()) {
      for (JsonNode item : rows) {
        selected.add(item.path("kind").asText("").toUpperCase(Locale.ROOT)
            + ":" + item.path("id").asLong(-1));
      }
    }
    return selected;
  }

  private static Set<String> audienceKinds(String scope, JsonNode filter) {
    if ("CUSTOMER".equals(scope)) return Set.of("CUSTOMER");
    if ("STAFF".equals(scope)) return Set.of("STAFF");
    Set<String> kinds = new LinkedHashSet<>();
    JsonNode types = filter.path("recipientTypes");
    if (types.isArray()) for (JsonNode type : types) {
      String value = type.asText("").trim().toUpperCase(Locale.ROOT);
      if (RECIPIENT_KINDS.contains(value)) kinds.add(value);
    }
    return kinds;
  }

  private static List<RecipientCandidate> excludeRecipients(List<RecipientCandidate> candidates, JsonNode filter) {
    Set<String> exclusions = exclusions(filter);
    return candidates.stream().filter(candidate -> !exclusions.contains(candidate.key())).toList();
  }

  private static Set<String> exclusions(JsonNode filter) {
    Set<String> excluded = new LinkedHashSet<>();
    JsonNode rows = filter.path("excludedRecipients");
    if (rows.isArray()) for (JsonNode item : rows) {
      excluded.add(item.path("kind").asText("").toUpperCase(Locale.ROOT) + ":" + item.path("id").asLong(-1));
    }
    return excluded;
  }

  private ObjectNode snapshot(List<RecipientCandidate> recipients, boolean preview) {
    ObjectNode snapshot = mapper.createObjectNode();
    snapshot.put("stage", preview ? "PREVIEW" : "DISPATCH");
    snapshot.put("resolvedAt", Instant.now().toString());
    snapshot.put("recipientCount", recipients.size());
    ArrayNode rows = snapshot.putArray("recipients");
    for (RecipientCandidate recipient : recipients) {
      ObjectNode row = rows.addObject();
      row.put("kind", recipient.kind());
      row.put("id", recipient.id());
      row.put("publicId", recipient.publicId().toString());
    }
    return snapshot;
  }

  private String fingerprint(CampaignRecord row) {
    try {
      String payload = mapper.writeValueAsString(List.of(
          "notification-preview-v1",
          Long.toString(row.dealershipId()),
          Long.toString(row.createdByStaffUserId()),
          row.scope(), row.title(), row.summary(),
          row.audienceFilterJson(), row.contentDocumentJson(),
          row.templateId() == null ? "" : row.templateId().toString(),
          row.templateVersion() == null ? "" : row.templateVersion().toString()));
      return TokenDigests.sha256(payload);
    } catch (JsonProcessingException impossible) {
      throw new IllegalStateException("Could not fingerprint the validated notification preview.", impossible);
    }
  }

  private TemplateView findTemplateForId(StaffPrincipal actor, Long id) {
    List<TemplateView> rows = jdbc.query("""
        select id, public_id, template_family_id::text, template_name, description,
          content_version, content_document::text as content_document, status, created_at, updated_at
        from notification_template where dealership_id = ? and id = ?
        """, TEMPLATE_ROW, actor.dealershipId(), id);
    if (rows.isEmpty()) throw notFound("Notification template was not found.");
    return rows.getFirst();
  }

  private void audit(
      StaffPrincipal actor, String action, Long campaignId, Long templateId, Map<String, Object> details) {
    jdbc.update("""
        insert into notification_audit(
          dealership_id, actor_staff_user_id, campaign_id, template_id, action, details)
        values (?, ?, ?, ?, ?, ?::jsonb)
        """, actor.dealershipId(), actor.staffUserId(), campaignId, templateId, action, writeJson(details));
  }

  private void auditSystem(CampaignRecord campaign, String action, Map<String, Object> details) {
    jdbc.update("""
        insert into notification_audit(dealership_id, campaign_id, template_id, action, details)
        values (?, ?, ?, ?, ?::jsonb)
        """, campaign.dealershipId(), campaign.id(), campaign.templateId(), action, writeJson(details));
  }

  private StaffPrincipal findActor(CampaignRecord campaign) {
    List<Map<String, Object>> users = jdbc.queryForList("""
        select u.id, u.public_id::text as staff_public_id, u.full_name,
          d.public_id::text as dealership_public_id, d.code
        from staff_user u join dealership d on d.id = u.dealership_id
        where u.id = ? and u.dealership_id = ? and u.status = 'ACTIVE' and d.status = 'ACTIVE'
        """, campaign.createdByStaffUserId(), campaign.dealershipId());
    if (users.isEmpty()) throw new IllegalStateException("The scheduled notification creator is no longer active.");
    Map<String, Object> user = users.getFirst();
    return new StaffPrincipal(0, ((Number) user.get("id")).longValue(),
        String.valueOf(user.get("staff_public_id")), campaign.dealershipId(),
        String.valueOf(user.get("dealership_public_id")), String.valueOf(user.get("code")),
        String.valueOf(user.get("full_name")), Set.of(), Set.of());
  }

  private RecipientOption toOption(RecipientCandidate recipient) {
    return new RecipientOption(recipient.id(), recipient.kind(), recipient.publicId(),
        recipient.name(), null, recipient.dealershipId(), recipient.dealershipName(), recipient.dealershipCode());
  }

  private RowMapper<RecipientOption> recipientOptionMapper(String kind, StaffPrincipal actor) {
    return (rs, rowNum) -> new RecipientOption(
        rs.getLong("id"), kind, rs.getObject("public_id", UUID.class),
        rs.getString("full_name"), null, actor.dealershipId(),
        dealershipName(actor.dealershipId()), actor.dealershipCode());
  }

  private String dealershipName(long dealershipId) {
    return jdbc.queryForObject("select name from dealership where id = ?", String.class, dealershipId);
  }

  private int count(String sql, Object... args) {
    Integer value = jdbc.queryForObject(sql, Integer.class, args);
    return value == null ? 0 : value;
  }

  private JsonNode validateDocument(Object rawDocument) {
    return validator.validate(rawDocument);
  }

  private static String normalizeScope(String raw) {
    String scope = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
    if ("INSTITUTION".equals(scope)) return "DEALERSHIP";
    if (List.of("CUSTOMER", "STAFF", "DEALERSHIP").contains(scope)) return scope;
    throw badRequest("Notification scope must be CUSTOMER, STAFF or DEALERSHIP.");
  }

  private static String normalizeKind(String raw) {
    String kind = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
    if ("STUDENT".equals(kind) || "PARENT".equals(kind) || "USER_ACCOUNT".equals(kind)) kind = "CUSTOMER";
    if (!RECIPIENT_KINDS.contains(kind)) throw badRequest("Recipient type must be CUSTOMER or STAFF.");
    return kind;
  }

  private static String requiredText(String value, String field, int maximum) {
    String cleaned = optionalText(value, maximum);
    if (cleaned == null) throw badRequest(field + " is required.");
    return cleaned;
  }

  private static String optionalText(String value, int maximum) {
    if (value == null) return null;
    String clean = value.trim();
    if (clean.isEmpty()) return null;
    if (clean.length() > maximum || clean.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return clean;
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  private static String newPreviewToken() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static boolean constantTimeEquals(String left, String right) {
    return left != null && right != null && MessageDigest.isEqual(
        left.getBytes(java.nio.charset.StandardCharsets.UTF_8),
        right.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  private static boolean isAcceptedStatus(String status) {
    return List.of("SCHEDULED", "QUEUED", "PROCESSING", "SENT", "PARTIALLY_FAILED", "FAILED", "CANCELLED", "EXPIRED")
        .contains(status);
  }

  private CampaignView toView(CampaignRecord campaign) {
    return new CampaignView(campaign.id(), campaign.publicId(), campaign.scope(), campaign.title(), campaign.summary(),
        campaign.status(), campaign.resolvedRecipientCount(), campaign.scheduledAt(), campaign.expiresAt(),
        campaign.createdAt(), campaign.dispatchedAt(), campaign.cancelledAt());
  }

  private static String writeJson(Object value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (JsonProcessingException impossible) {
      throw new IllegalArgumentException("Notification data could not be serialized safely.", impossible);
    }
  }

  private static final ObjectMapper JSON = new ObjectMapper();

  private static JsonNode readDocument(String raw) {
    if (raw == null) return null;
    try { return JSON.readTree(raw); }
    catch (JsonProcessingException failure) {
      throw new IllegalStateException("Stored notification document is invalid.", failure);
    }
  }

  private static ObjectNode parseObject(String raw) {
    try {
      JsonNode node = JSON.readTree(raw);
      if (node != null && node.isObject()) return (ObjectNode) node;
      throw new IllegalStateException("Stored notification JSON is not an object.");
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Stored notification JSON is invalid.", failure);
    }
  }

  private static Instant instant(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toInstant();
  }

  private static ResponseStatusException notFound(String message) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }

  public record TemplateRequest(String templateName, String description, Object contentDocument) {}
  public record TemplateView(
      long id, UUID publicId, String templateFamilyId, String templateName, String description,
      int contentVersion, JsonNode contentDocument, String status, Instant createdAt, Instant updatedAt) {}
  public record DealershipOption(
      long id, String institutionCode, String displayName, String status,
      int activeCustomerCount, int marketingConsentCustomerCount, int activeStaffCount) {}
  public record NotificationOptions(
      List<DealershipOption> institutions, int activeCustomerCount,
      int marketingConsentCustomerCount, int activeStaffCount) {}
  public record PreviewRequest(
      String scope, String title, String summary, Object audienceFilter,
      Object contentDocument, UUID templatePublicId, Integer templateVersion) {}
  public record SendRequest(
      UUID campaignPublicId, String previewToken, String idempotencyKey,
      Instant scheduledAt, Instant expiresAt) {}
  public record RecipientOption(
      long recipientId, String recipientKind, UUID publicId, String recipientName,
      String classCode, long institutionId, String institutionName, String institutionCode) {}
  public record PreviewResult(
      boolean valid, UUID campaignPublicId, String previewToken, Instant expiresAt,
      int recipientCount, Map<String, Integer> recipientCounts,
      List<RecipientOption> recipients, String message) {}
  public record CampaignResult(CampaignView campaign, boolean idempotentReplay) {}
  public record CampaignView(
      long id, UUID publicId, String scope, String title, String summary, String status,
      int resolvedRecipientCount, Instant scheduledAt, Instant expiresAt, Instant createdAt,
      Instant dispatchedAt, Instant cancelledAt) {}
  public record InboxItem(
      UUID recipientPublicId, UUID campaignPublicId, String title, String summary,
      JsonNode contentDocument, String senderName, String status, Instant createdAt,
      Instant readAt, Instant dismissedAt) {}
  public record Page<T>(List<T> items, int page, int pageSize, long total, int unreadCount) {}
  private record RecipientCandidate(
      String kind, long id, UUID publicId, String name, long dealershipId,
      String dealershipName, String dealershipCode) {
    String key() { return kind + ":" + id; }
  }
  private record CampaignRecord(
      long id, UUID publicId, long dealershipId, long createdByStaffUserId, String scope,
      String title, String summary, String audienceFilterJson, String audienceSnapshotJson,
      String contentDocumentJson, Long templateId, Integer templateVersion, String status,
      String idempotencyKey, String previewTokenHash, String previewFingerprint,
      Instant previewExpiresAt, Instant previewConsumedAt, Instant scheduledAt, Instant expiresAt,
      int resolvedRecipientCount, Instant createdAt, Instant dispatchedAt, Instant cancelledAt) {}
}
