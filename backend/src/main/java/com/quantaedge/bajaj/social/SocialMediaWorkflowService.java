package com.quantaedge.bajaj.social;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

/**
 * Durable approval and dispatch workflow for external Meta posts.
 * Provider calls are made only after an auditable social_media.manage approval.
 */
@Service
public class SocialMediaWorkflowService {
  private static final Duration MIN_SCHEDULE_LEAD = Duration.ofMinutes(2);
  private static final Duration MAX_SCHEDULE_LEAD = Duration.ofDays(90);
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final SocialMetaService meta;
  private final SocialMediaAssetService assets;
  private final SocialMetaPublishingService publishing;

  public SocialMediaWorkflowService(JdbcTemplate jdbc, ObjectMapper mapper, SocialMetaService meta,
      SocialMediaAssetService assets, SocialMetaPublishingService publishing) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.meta = meta;
    this.assets = assets;
    this.publishing = publishing;
  }

  @Transactional
  public PublishRequestView requestApproval(StaffPrincipal actor, PublishRequest request) {
    requirePublishConfiguration();
    if (request == null || request.destinationPublicId() == null || request.assetId() == null) {
      throw badRequest("Choose an active destination and campaign artwork.");
    }
    String caption = request.caption() == null ? "" : request.caption().trim();
    String key = clean(request.idempotencyKey());
    if (key.length() < 8 || key.length() > 120) throw badRequest("A valid idempotency key is required.");
    Instant scheduledAt = validateSchedule(request.scheduledAt());
    assets.prepare(actor.dealershipId(), request.assetId());
    Destination destination = findDestination(actor.dealershipId(), request.destinationPublicId());
    String fingerprint = TokenDigests.sha256(destination.publicId() + "\n" + request.assetId() + "\n"
        + caption + "\n" + (scheduledAt == null ? "" : scheduledAt.toString()));
    RequestRow prior = findByKey(actor.dealershipId(), key);
    if (prior != null) {
      if (!prior.fingerprint().equals(fingerprint)) {
        throw new ResponseStatusException(HttpStatus.CONFLICT,
            "This idempotency key was already used for different artwork, destination or schedule.");
      }
      return findView(actor.dealershipId(), prior.publicId());
    }

    UUID publicId = UUID.randomUUID();
    int inserted = jdbc.update("""
        insert into social_media_publish_request(
          public_id,dealership_id,destination_id,asset_id,created_by_staff_user_id,caption,
          idempotency_key,request_fingerprint,scheduled_at,status)
        values (?,?,?,?,?,?,?,?,?,'PENDING_APPROVAL')
        on conflict(dealership_id,idempotency_key) do nothing
        """, publicId, actor.dealershipId(), destination.id(), findAssetId(actor.dealershipId(), request.assetId()),
        actor.staffUserId(), caption, key, fingerprint, timestamp(scheduledAt));
    RequestRow created = findByKey(actor.dealershipId(), key);
    if (created == null) throw new IllegalStateException("Publish approval request could not be recorded.");
    if (!created.fingerprint().equals(fingerprint)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "This idempotency key was already used for different artwork, destination or schedule.");
    }
    if (inserted == 1) {
      approvalEvent(actor.dealershipId(), created.id(), actor.staffUserId(), "REQUESTED",
          Map.of("destinationType", destination.type(), "scheduled", scheduledAt != null));
      meta.audit(actor.dealershipId(), actor.staffUserId(), null, destination.id(),
          "SOCIAL_PUBLISH_APPROVAL_REQUESTED",
          Map.of("requestPublicId", created.publicId().toString(), "scheduled", scheduledAt != null));
    }
    return findView(actor.dealershipId(), created.publicId());
  }

  public List<PublishRequestView> list(StaffPrincipal actor, int requestedLimit) {
    int limit = Math.max(1, Math.min(100, requestedLimit));
    return jdbc.query("""
        select r.public_id,a.public_id asset_public_id,r.status,d.destination_type,d.display_name,r.caption,r.created_at,
          r.scheduled_at,r.approved_at,creator.full_name requested_by,approver.full_name approved_by,
          coalesce(j.status,r.status) effective_status,j.external_post_id,coalesce(j.error_code,r.error_code) effective_error
        from social_media_publish_request r
        join social_media_destination d on d.id=r.destination_id and d.dealership_id=r.dealership_id
        join social_media_asset a on a.id=r.asset_id and a.dealership_id=r.dealership_id
        join staff_user creator on creator.id=r.created_by_staff_user_id and creator.dealership_id=r.dealership_id
        left join staff_user approver on approver.id=r.approved_by_staff_user_id and approver.dealership_id=r.dealership_id
        left join social_media_publish_job j on j.dealership_id=r.dealership_id
          and (j.public_id=r.publish_job_public_id or j.idempotency_key=('workflow-' || r.public_id::text))
        where r.dealership_id=?
        order by r.created_at desc,r.id desc limit ?
        """, (rs, n) -> viewFromResult(rs), actor.dealershipId(), limit);
  }

  @Transactional
  public PublishRequestView approve(StaffPrincipal actor, UUID publicId, DecisionRequest decision) {
    RequestRow row = load(actor.dealershipId(), publicId);
    if (!"PENDING_APPROVAL".equals(row.status())) throw conflict("Only requests awaiting approval can be approved.");
    requirePublishConfiguration();
    Instant now = Instant.now();
    boolean scheduled = row.scheduledAt() != null && row.scheduledAt().isAfter(now);
    String next = scheduled ? "SCHEDULED" : "DISPATCHING";
    int updated = jdbc.update("""
        update social_media_publish_request
        set status=?,approved_by_staff_user_id=?,approved_at=now(),
          dispatch_lock_until=case when ?='DISPATCHING' then now()+interval '2 minutes' else null end,
          error_code=null,updated_at=now()
        where dealership_id=? and public_id=? and status='PENDING_APPROVAL'
        """, next, actor.staffUserId(), next, actor.dealershipId(), publicId);
    if (updated != 1) throw conflict("Another manager changed this request. Refresh the approval queue.");
    approvalEvent(actor.dealershipId(), row.id(), actor.staffUserId(), "APPROVED",
        Map.of("scheduled", scheduled, "note", optionalNote(decision)));
    meta.audit(actor.dealershipId(), actor.staffUserId(), null, row.destinationId(),
        "SOCIAL_PUBLISH_APPROVED", Map.of("requestPublicId", publicId.toString(), "scheduled", scheduled));
    if (!scheduled) {
      TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override public void afterCommit() { dispatch(publicId); }
      });
    }
    return findView(actor.dealershipId(), publicId);
  }

  @Transactional
  public PublishRequestView reject(StaffPrincipal actor, UUID publicId, DecisionRequest decision) {
    RequestRow row = load(actor.dealershipId(), publicId);
    int updated = jdbc.update("""
        update social_media_publish_request set status='REJECTED',error_code=null,updated_at=now()
        where dealership_id=? and public_id=? and status='PENDING_APPROVAL'
        """, actor.dealershipId(), publicId);
    if (updated != 1) throw conflict("Only requests awaiting approval can be rejected.");
    String note = optionalNote(decision);
    approvalEvent(actor.dealershipId(), row.id(), actor.staffUserId(), "REJECTED", Map.of("note", note));
    meta.audit(actor.dealershipId(), actor.staffUserId(), null, row.destinationId(),
        "SOCIAL_PUBLISH_REJECTED", Map.of("requestPublicId", publicId.toString(), "note", note));
    return findView(actor.dealershipId(), publicId);
  }

  @Transactional
  public PublishRequestView cancel(StaffPrincipal actor, UUID publicId) {
    RequestRow row = load(actor.dealershipId(), publicId);
    int updated = jdbc.update("""
        update social_media_publish_request set status='CANCELLED',dispatch_lock_until=null,updated_at=now()
        where dealership_id=? and public_id=? and status in('PENDING_APPROVAL','SCHEDULED')
        """, actor.dealershipId(), publicId);
    if (updated != 1) throw conflict("Only pending or scheduled requests can be cancelled.");
    approvalEvent(actor.dealershipId(), row.id(), actor.staffUserId(), "CANCELLED", Map.of());
    meta.audit(actor.dealershipId(), actor.staffUserId(), null, row.destinationId(),
        "SOCIAL_PUBLISH_CANCELLED", Map.of("requestPublicId", publicId.toString()));
    return findView(actor.dealershipId(), publicId);
  }

  @Scheduled(fixedDelayString = "${app.social.meta.publish-dispatch-interval-ms:10000}")
  public void dispatchDueRequests() {
    jdbc.update("""
        with expired as (
          update social_media_publish_request r set status='UNKNOWN',error_code='dispatch_lock_expired',
            dispatch_lock_until=null,updated_at=now()
          where r.status='DISPATCHING' and r.dispatch_lock_until < now()
            and not exists(select 1 from social_media_publish_job j
              where j.dealership_id=r.dealership_id and j.idempotency_key=('workflow-' || r.public_id::text))
          returning r.id,r.dealership_id,r.public_id
        )
        insert into social_media_publish_approval_event(dealership_id,request_id,actor_staff_user_id,action,details)
        select dealership_id,id,null,'UNKNOWN',
          jsonb_build_object('requestPublicId',public_id::text,'reason','dispatch_lock_expired')
        from expired
        """);
    jdbc.update("""
        with recovered as (
          update social_media_publish_request r set publish_job_public_id=j.public_id,
            status=case when j.status in('FAILED','UNKNOWN') then j.status else 'DISPATCHED' end,
            error_code=j.error_code,dispatch_lock_until=null,
            dispatched_at=coalesce(r.dispatched_at,now()),updated_at=now()
          from social_media_publish_job j
          where r.publish_job_public_id is null
            and (r.status='UNKNOWN' or (r.status='DISPATCHING' and r.dispatch_lock_until < now()))
            and j.dealership_id=r.dealership_id
            and j.idempotency_key=('workflow-' || r.public_id::text)
          returning r.id,r.dealership_id,r.public_id,r.status,r.publish_job_public_id,r.error_code
        )
        insert into social_media_publish_approval_event(dealership_id,request_id,actor_staff_user_id,action,details)
        select dealership_id,id,null,'RECOVERED',
          jsonb_build_object('requestPublicId',public_id::text,'status',status,
            'publishJobPublicId',publish_job_public_id::text,'errorCode',coalesce(error_code,''))
        from recovered
        """);
    List<UUID> due = jdbc.query("""
        with candidates as (
          select id from social_media_publish_request
          where status='SCHEDULED' and scheduled_at<=now()
          order by scheduled_at,id limit 10 for update skip locked
        )
        update social_media_publish_request r
        set status='DISPATCHING',dispatch_lock_until=now()+interval '2 minutes',updated_at=now()
        from candidates c where r.id=c.id
        returning r.public_id
        """, (rs, n) -> rs.getObject(1, UUID.class));
    for (UUID id : due) dispatch(id);
  }

  private void dispatch(UUID publicId) {
    RequestRow row;
    try { row = loadByPublicId(publicId); }
    catch (RuntimeException failure) { return; }
    try {
      StaffPrincipal actor = activeActor(row);
      SocialMetaPublishingService.PublishView published = publishing.publish(actor,
          new SocialMetaPublishingService.PublishRequest(row.destinationPublicId(), row.assetPublicId(),
              row.caption(), "workflow-" + row.publicId()));
      String state = "FAILED".equals(published.status()) ? "FAILED"
          : "UNKNOWN".equals(published.status()) ? "UNKNOWN" : "DISPATCHED";
      jdbc.update("""
          update social_media_publish_request set status=?,publish_job_public_id=?,error_code=?,
            dispatch_lock_until=null,dispatched_at=now(),updated_at=now()
          where dealership_id=? and public_id=? and status='DISPATCHING'
          """, state, published.publicId(), published.errorCode(), row.dealershipId(), publicId);
      approvalEvent(row.dealershipId(), row.id(), null,
          "FAILED".equals(state) ? "FAILED" : "UNKNOWN".equals(state) ? "UNKNOWN" : "DISPATCHED",
          Map.of("publishJobPublicId", published.publicId().toString(), "publishStatus", published.status()));
    } catch (RuntimeException failure) {
      String code = safeCode(failure.getClass().getSimpleName());
      jdbc.update("""
          update social_media_publish_request set status='FAILED',error_code=?,dispatch_lock_until=null,updated_at=now()
          where dealership_id=? and public_id=? and status='DISPATCHING'
          """, code, row.dealershipId(), publicId);
      approvalEvent(row.dealershipId(), row.id(), null, "FAILED", Map.of("errorCode", code));
    }
  }

  private StaffPrincipal activeActor(RequestRow row) {
    List<StaffPrincipal> actors = jdbc.query("""
        select u.id,u.public_id::text staff_public_id,u.full_name,d.public_id::text dealership_public_id,d.code
        from staff_user u join dealership d on d.id=u.dealership_id
        where u.dealership_id=? and u.status='ACTIVE' and d.status='ACTIVE'
          and u.id in (?,?)
          and exists (
            select 1 from staff_user_role ur
            join role_permission rp on rp.role_id=ur.role_id
            join permission p on p.id=rp.permission_id
            where ur.staff_user_id=u.id and ur.dealership_id=u.dealership_id
              and p.code='social_media.publish'
          )
        order by case when u.id=? then 0 else 1 end limit 1
        """, (rs, n) -> new StaffPrincipal(0, rs.getLong("id"), rs.getString("staff_public_id"),
            row.dealershipId(), rs.getString("dealership_public_id"), rs.getString("code"),
            rs.getString("full_name"), Set.of(), Set.of("social_media.publish")),
        row.dealershipId(), row.createdBy(), row.approvedBy(), row.approvedBy());
    if (actors.isEmpty()) throw conflict("The request creator and approver are no longer active.");
    return actors.getFirst();
  }

  private RequestRow load(long dealershipId, UUID publicId) {
    List<RequestRow> rows = jdbc.query("""
        select r.id,r.public_id,r.dealership_id,r.destination_id,r.asset_id,r.created_by_staff_user_id,
          r.approved_by_staff_user_id,r.caption,r.idempotency_key,r.request_fingerprint,r.scheduled_at,r.status,
          d.public_id destination_public_id,a.public_id asset_public_id
        from social_media_publish_request r
        join social_media_destination d on d.id=r.destination_id and d.dealership_id=r.dealership_id
        join social_media_asset a on a.id=r.asset_id and a.dealership_id=r.dealership_id
        where r.dealership_id=? and r.public_id=?
        """, (rs, n) -> mapRequest(rs), dealershipId, publicId);
    if (rows.isEmpty()) throw notFound();
    return rows.getFirst();
  }

  private RequestRow loadByPublicId(UUID publicId) {
    List<RequestRow> rows = jdbc.query("""
        select r.id,r.public_id,r.dealership_id,r.destination_id,r.asset_id,r.created_by_staff_user_id,
          r.approved_by_staff_user_id,r.caption,r.idempotency_key,r.request_fingerprint,r.scheduled_at,r.status,
          d.public_id destination_public_id,a.public_id asset_public_id
        from social_media_publish_request r
        join social_media_destination d on d.id=r.destination_id and d.dealership_id=r.dealership_id
        join social_media_asset a on a.id=r.asset_id and a.dealership_id=r.dealership_id
        where r.public_id=?
        """, (rs, n) -> mapRequest(rs), publicId);
    if (rows.isEmpty()) throw notFound();
    return rows.getFirst();
  }

  private RequestRow findByKey(long dealershipId, String key) {
    List<RequestRow> rows = jdbc.query("""
        select r.id,r.public_id,r.dealership_id,r.destination_id,r.asset_id,r.created_by_staff_user_id,
          r.approved_by_staff_user_id,r.caption,r.idempotency_key,r.request_fingerprint,r.scheduled_at,r.status,
          d.public_id destination_public_id,a.public_id asset_public_id
        from social_media_publish_request r
        join social_media_destination d on d.id=r.destination_id and d.dealership_id=r.dealership_id
        join social_media_asset a on a.id=r.asset_id and a.dealership_id=r.dealership_id
        where r.dealership_id=? and r.idempotency_key=?
        """, (rs, n) -> mapRequest(rs), dealershipId, key);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private PublishRequestView findView(long dealershipId, UUID publicId) {
    List<PublishRequestView> rows = jdbc.query("""
        select r.public_id,a.public_id asset_public_id,r.status,d.destination_type,d.display_name,r.caption,r.created_at,
          r.scheduled_at,r.approved_at,creator.full_name requested_by,approver.full_name approved_by,
          coalesce(j.status,r.status) effective_status,j.external_post_id,coalesce(j.error_code,r.error_code) effective_error
        from social_media_publish_request r
        join social_media_destination d on d.id=r.destination_id and d.dealership_id=r.dealership_id
        join social_media_asset a on a.id=r.asset_id and a.dealership_id=r.dealership_id
        join staff_user creator on creator.id=r.created_by_staff_user_id and creator.dealership_id=r.dealership_id
        left join staff_user approver on approver.id=r.approved_by_staff_user_id and approver.dealership_id=r.dealership_id
        left join social_media_publish_job j on j.dealership_id=r.dealership_id
          and (j.public_id=r.publish_job_public_id or j.idempotency_key=('workflow-' || r.public_id::text))
        where r.dealership_id=? and r.public_id=?
        """, (rs, n) -> viewFromResult(rs), dealershipId, publicId);
    if (rows.isEmpty()) throw notFound();
    return rows.getFirst();
  }

  private static PublishRequestView viewFromResult(java.sql.ResultSet rs) throws java.sql.SQLException {
    Timestamp scheduled = rs.getTimestamp("scheduled_at");
    Timestamp approved = rs.getTimestamp("approved_at");
    return new PublishRequestView(rs.getObject("public_id", UUID.class), rs.getObject("asset_public_id", UUID.class), rs.getString("status"),
        rs.getString("destination_type"), rs.getString("display_name"), rs.getString("caption"),
        rs.getString("requested_by"), rs.getString("approved_by"), rs.getTimestamp("created_at").toInstant(),
        scheduled == null ? null : scheduled.toInstant(), approved == null ? null : approved.toInstant(),
        rs.getString("effective_status"), rs.getString("external_post_id"), rs.getString("effective_error"));
  }

  private static RequestRow mapRequest(java.sql.ResultSet rs) throws java.sql.SQLException {
    Timestamp scheduled = rs.getTimestamp("scheduled_at");
    long approvedId = rs.getLong("approved_by_staff_user_id");
    Long approvedBy = rs.wasNull() ? null : approvedId;
    return new RequestRow(rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getLong("dealership_id"),
        rs.getLong("destination_id"), rs.getLong("asset_id"), rs.getLong("created_by_staff_user_id"),
        approvedBy, rs.getString("caption"), rs.getString("idempotency_key"), rs.getString("request_fingerprint"),
        scheduled == null ? null : scheduled.toInstant(), rs.getString("status"),
        rs.getObject("destination_public_id", UUID.class), rs.getObject("asset_public_id", UUID.class));
  }

  private long findAssetId(long dealershipId, UUID publicId) {
    Long id = jdbc.queryForObject("select id from social_media_asset where dealership_id=? and public_id=? and status='ACTIVE'",
        Long.class, dealershipId, publicId);
    if (id == null) throw notFound();
    return id;
  }

  private Destination findDestination(long dealershipId, UUID publicId) {
    List<Destination> rows = jdbc.query("""
        select id,public_id,destination_type,display_name
        from social_media_destination where dealership_id=? and public_id=? and provider='META' and status='ACTIVE'
        """, (rs, n) -> new Destination(rs.getLong("id"), rs.getObject("public_id", UUID.class),
        rs.getString("destination_type"), rs.getString("display_name")), dealershipId, publicId);
    if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Connected destination was not found.");
    return rows.getFirst();
  }

  private void approvalEvent(long dealershipId, long requestId, Long actor, String action, Map<String, Object> details) {
    try {
      jdbc.update("""
          insert into social_media_publish_approval_event(dealership_id,request_id,actor_staff_user_id,action,details)
          values(?,?,?, ?,?::jsonb)
          """, dealershipId, requestId, actor, action, mapper.writeValueAsString(details));
    } catch (JsonProcessingException failure) {
      throw new IllegalArgumentException("Approval history could not be serialized safely.");
    }
  }

  private Instant validateSchedule(Instant scheduledAt) {
    if (scheduledAt == null) return null;
    Instant now = Instant.now();
    if (scheduledAt.isBefore(now.plus(MIN_SCHEDULE_LEAD)) || scheduledAt.isAfter(now.plus(MAX_SCHEDULE_LEAD))) {
      throw badRequest("Choose a schedule at least two minutes from now and no more than 90 days ahead.");
    }
    return scheduledAt;
  }

  private static String optionalNote(DecisionRequest decision) {
    String note = decision == null || decision.note() == null ? "" : decision.note().trim();
    if (note.length() > 500 || note.chars().anyMatch(Character::isISOControl)) throw badRequest("Approval note is invalid.");
    return note;
  }

  private static String clean(String value) { return value == null ? "" : value.trim(); }
  private static Timestamp timestamp(Instant value) { return value == null ? null : Timestamp.from(value); }
  private static String safeCode(String value) {
    String result = value == null ? "" : value.replaceAll("[^a-zA-Z0-9_-]", "");
    return result.isBlank() ? "publish_dispatch_error" : result.substring(0, Math.min(100, result.length()));
  }
  private void requirePublishConfiguration() {
    List<String> missing = java.util.stream.Stream.concat(
        meta.missingConnectionSettings().stream(),
        assets.missingConfigurationKeys().stream()).distinct().toList();
    if (!missing.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
          "Meta publishing is not configured. Set or correct: " + String.join(", ", missing) + ".");
    }
  }

  private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
  private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Publish request was not found."); }

  public record PublishRequest(@NotNull UUID destinationPublicId,@NotNull UUID assetId,
      @Size(max=2200) String caption,@NotBlank @Size(max=120) String idempotencyKey, Instant scheduledAt) {}
  public record DecisionRequest(@Size(max=500) String note) {}
  public record PublishRequestView(UUID publicId,UUID assetPublicId,String status,String destinationType,String destinationName,
      String caption,String requestedBy,String approvedBy,Instant requestedAt,Instant scheduledAt,Instant approvedAt,
      String publishStatus,String externalPostId,String errorCode) {}
  private record Destination(long id,UUID publicId,String type,String displayName) {}
  private record RequestRow(long id,UUID publicId,long dealershipId,long destinationId,long assetId,long createdBy,
      Long approvedBy,String caption,String idempotencyKey,String fingerprint,Instant scheduledAt,String status,
      UUID destinationPublicId,UUID assetPublicId) {}
}