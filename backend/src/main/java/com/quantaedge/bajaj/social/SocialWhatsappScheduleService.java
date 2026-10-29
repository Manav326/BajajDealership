package com.quantaedge.bajaj.social;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
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
import org.springframework.web.server.ResponseStatusException;

/**
 * Durable, dealership-scoped future-send queue. The actual provider send runs through
 * SocialWhatsappService at due time so consent, phone, template approval and media are checked again.
 */
@Service
public class SocialWhatsappScheduleService {
  private static final Duration MIN_LEAD = Duration.ofMinutes(2);
  private static final Duration MAX_LEAD = Duration.ofDays(90);
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final SocialWhatsappService whatsapp;
  private final SocialMediaAssetService assets;

  public SocialWhatsappScheduleService(JdbcTemplate jdbc, ObjectMapper mapper,
      SocialWhatsappService whatsapp, SocialMediaAssetService assets) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.whatsapp = whatsapp;
    this.assets = assets;
  }

  public ScheduledMessageView schedule(StaffPrincipal actor, ScheduleRequest request) {
    if (request == null || request.customerPublicId() == null || request.scheduledAt() == null) {
      throw badRequest("Choose a customer and a future send time.");
    }
    validateSchedule(request.scheduledAt());
    String key = clean(request.idempotencyKey());
    String name = clean(request.templateName());
    String language = clean(request.languageCode());
    List<String> parameters = request.bodyParameters() == null ? List.of() : request.bodyParameters();
    if (key.length() < 8 || key.length() > 120) throw badRequest("A valid idempotency key is required.");
    if (name.isBlank() || name.length() > 120) throw badRequest("Choose a Meta-approved template.");
    if (!language.matches("[A-Za-z]{2,3}(_[A-Za-z]{2,4})?")) throw badRequest("Choose a valid template language.");
    if (parameters.size() > 20 || parameters.stream().anyMatch(p -> p == null || p.isBlank() || p.length() > 1024)) {
      throw badRequest("Fill in all template parameters within the supported limits.");
    }

    Customer customer = findCustomer(actor.dealershipId(), request.customerPublicId());
    String phone = normalizeE164(customer.phone());
    if (phone == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "Customer phone must be in E.164 format.");
    Consent consent = findConsent(actor.dealershipId(), customer.id());
    if (!"OPTED_IN".equals(consent.status()) || !phone.equals(consent.phone())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,
          "Current WhatsApp opt-in is missing, withdrawn, or tied to a different phone number.");
    }

    SocialWhatsappService.TemplateView template = whatsapp.templates(actor).stream()
        .filter(t -> t.name().equals(name) && t.language().equalsIgnoreCase(language))
        .findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT,
            "Template is not currently approved for this language."));
    if (!template.supported()) throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, template.unsupportedReason());
    if (parameters.size() != template.bodyParameterCount()) {
      throw badRequest("This template requires exactly " + template.bodyParameterCount() + " body parameter(s).");
    }
    Long internalAssetId = null;
    if ("IMAGE".equals(template.headerFormat())) {
      if (request.assetId() == null) throw badRequest("This template requires a campaign image.");
      SocialMediaAssetService.PreparedAsset asset = assets.prepare(actor.dealershipId(), request.assetId());
      internalAssetId = asset.internalId();
    } else if (request.assetId() != null) {
      throw badRequest("This template does not have an image header.");
    }

    String parametersJson = writeJson(parameters);
    String assetMarker = request.assetId() == null ? "" : request.assetId().toString();
    String fingerprint = TokenDigests.sha256(request.customerPublicId() + "\n" + name + "\n" + language
        + "\n" + parametersJson + "\n" + assetMarker + "\nSCHEDULED\n" + request.scheduledAt());
    ScheduledRow prior = findByKey(actor.dealershipId(), key);
    if (prior != null) {
      if (!prior.fingerprint().equals(fingerprint)) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "This idempotency key belongs to a different scheduled message.");
      }
      return view(actor.dealershipId(), prior.publicId());
    }
    // Do not reuse the same idempotency key across an immediate send and a scheduled send.
    SocialWhatsappService.MessageView alreadySent = findImmediateByKey(actor, key);
    if (alreadySent != null) throw new ResponseStatusException(HttpStatus.CONFLICT,
        "This idempotency key has already been used for an immediate WhatsApp send.");

    UUID publicId = UUID.randomUUID();
    int inserted = jdbc.update("""
        insert into whatsapp_scheduled_send(
          public_id,dealership_id,customer_id,created_by_staff_user_id,template_name,language_code,
          template_category,body_parameters,asset_id,idempotency_key,request_fingerprint,scheduled_at,status)
        values(?,?,?,?,?,?,?,?::jsonb,?,?,?,?,'SCHEDULED')
        on conflict(dealership_id,idempotency_key) do nothing
        """, publicId, actor.dealershipId(), customer.id(), actor.staffUserId(), name, language,
        template.category(), parametersJson, internalAssetId, key, fingerprint, Timestamp.from(request.scheduledAt()));
    ScheduledRow created = findByKey(actor.dealershipId(), key);
    if (created == null) throw new IllegalStateException("Scheduled WhatsApp message could not be recorded.");
    if (!created.fingerprint().equals(fingerprint)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This idempotency key belongs to a different scheduled message.");
    }
    audit(actor.dealershipId(), actor.staffUserId(), "MESSAGE_SCHEDULED",
        Map.of("scheduledPublicId", created.publicId().toString(), "template", name,
            "scheduledAt", request.scheduledAt().toString()));
    return view(actor.dealershipId(), created.publicId());
  }

  public List<ScheduledMessageView> list(StaffPrincipal actor, int requestedLimit) {
    int limit = Math.max(1, Math.min(100, requestedLimit));
    List<UUID> ids = jdbc.query("""
        select public_id from whatsapp_scheduled_send
        where dealership_id=? order by created_at desc,id desc limit ?
        """, (rs, n) -> rs.getObject(1, UUID.class), actor.dealershipId(), limit);
    return ids.stream().map(id -> view(actor.dealershipId(), id)).toList();
  }

  public ScheduledMessageView cancel(StaffPrincipal actor, UUID publicId) {
    List<ScheduledRow> rows = jdbc.query("""
        select id,public_id,dealership_id,created_by_staff_user_id,request_fingerprint,status,template_name,language_code,
          error_code,created_at,updated_at,scheduled_at,message_send_id
        from whatsapp_scheduled_send where dealership_id=? and public_id=?
        """, (rs, n) -> mapRow(rs), actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound();
    ScheduledRow row = rows.getFirst();
    int updated = jdbc.update("""
        update whatsapp_scheduled_send set status='CANCELLED',dispatch_lock_until=null,
          error_code=null,updated_at=now()
        where dealership_id=? and public_id=? and status='SCHEDULED'
        """, actor.dealershipId(), publicId);
    if (updated != 1) throw conflict("Only a still-scheduled WhatsApp message can be cancelled.");
    audit(actor.dealershipId(), actor.staffUserId(), "SCHEDULED_MESSAGE_CANCELLED",
        Map.of("scheduledPublicId", publicId.toString(), "template", row.templateName()));
    return view(actor.dealershipId(), publicId);
  }

  public ScheduledMessageView status(StaffPrincipal actor, UUID publicId) {
    List<ScheduledRow> rows = jdbc.query("""
        select id,public_id,dealership_id,created_by_staff_user_id,request_fingerprint,status,template_name,language_code,
          error_code,created_at,updated_at,scheduled_at,message_send_id
        from whatsapp_scheduled_send where dealership_id=? and public_id=?
        """, (rs, n) -> mapRow(rs), actor.dealershipId(), publicId);
    if (rows.isEmpty()) {
      SocialWhatsappService.MessageView message = whatsapp.messageStatus(actor, publicId);
      return fromMessage(message, null);
    }
    return view(actor.dealershipId(), publicId);
  }

  @Scheduled(fixedDelayString = "${app.social.whatsapp.dispatch-interval-ms:15000}")
  public void dispatchDueMessages() {
    // Recover jobs created by a worker that stopped after the provider-send row was persisted.
    jdbc.update("""
        update whatsapp_scheduled_send s set message_send_id=m.id,
          status=case when m.status in('FAILED','UNKNOWN') then m.status else 'DISPATCHED' end,
          dispatch_lock_until=null,error_code=m.error_code,
          dispatched_at=coalesce(s.dispatched_at,now()),updated_at=now()
        from whatsapp_message_send m
        where s.status in('DISPATCHING','UNKNOWN') and s.dealership_id=m.dealership_id
          and m.idempotency_key=('schedule-' || s.public_id::text)
          and s.message_send_id is null
        """);
    // A stale lock without a durable provider-send row is uncertain: never blindly send it twice.
    jdbc.update("""
        update whatsapp_scheduled_send s set status='UNKNOWN',error_code='dispatch_lock_expired',
          dispatch_lock_until=null,updated_at=now()
        where s.status='DISPATCHING' and s.dispatch_lock_until < now()
          and not exists(select 1 from whatsapp_message_send m
            where m.dealership_id=s.dealership_id and m.idempotency_key=('schedule-' || s.public_id::text))
        """);
    List<UUID> due = jdbc.query("""
        with candidates as (
          select id from whatsapp_scheduled_send
          where status='SCHEDULED' and scheduled_at<=now()
          order by scheduled_at,id limit 10 for update skip locked
        )
        update whatsapp_scheduled_send s
        set status='DISPATCHING',dispatch_lock_until=now()+interval '2 minutes',
          attempt_count=attempt_count+1,updated_at=now()
        from candidates c where s.id=c.id
        returning s.public_id
        """, (rs, n) -> rs.getObject(1, UUID.class));
    for (UUID id : due) dispatch(id);
  }

  private void dispatch(UUID publicId) {
    ScheduledRow row = loadForDispatch(publicId);
    try {
      DispatchData data = dispatchData(row);
      SocialWhatsappService.MessageView sent = whatsapp.send(data.actor(),
          new SocialWhatsappService.SendRequest(data.customerPublicId(), row.templateName(), row.languageCode(),
              data.parameters(), data.assetPublicId(), "schedule-" + row.publicId()));
      Long messageId = jdbc.queryForObject("""
          select id from whatsapp_message_send where dealership_id=? and public_id=?
          """, Long.class, row.dealershipId(), sent.publicId());
      if (messageId == null) throw new IllegalStateException("Provider send record was not found.");
      String queueStatus = switch (sent.status()) {
        case "FAILED" -> "FAILED";
        case "UNKNOWN" -> "UNKNOWN";
        default -> "DISPATCHED";
      };
      jdbc.update("""
          update whatsapp_scheduled_send set message_send_id=?,status=?,error_code=?,
            dispatch_lock_until=null,dispatched_at=now(),updated_at=now()
          where dealership_id=? and public_id=? and status='DISPATCHING'
          """, messageId, queueStatus, sent.errorCode(), row.dealershipId(), publicId);
      String eventAction = "FAILED".equals(queueStatus) ? "SCHEDULED_MESSAGE_FAILED"
          : "UNKNOWN".equals(queueStatus) ? "SCHEDULED_MESSAGE_UNKNOWN" : "SCHEDULED_MESSAGE_DISPATCHED";
      audit(row.dealershipId(), row.createdBy(), eventAction,
          Map.of("scheduledPublicId", publicId.toString(), "messagePublicId", sent.publicId().toString(),
              "providerStatus", sent.status(), "errorCode", sent.errorCode() == null ? "" : sent.errorCode()));
    } catch (RuntimeException failure) {
      String code = failure instanceof ResponseStatusException ? "dispatch_validation_failed" : safeCode(failure.getClass().getSimpleName());
      jdbc.update("""
          update whatsapp_scheduled_send set status='FAILED',error_code=?,dispatch_lock_until=null,updated_at=now()
          where dealership_id=? and public_id=? and status='DISPATCHING'
          """, code, row.dealershipId(), publicId);
      audit(row.dealershipId(), row.createdBy(), "SCHEDULED_MESSAGE_FAILED",
          Map.of("scheduledPublicId", publicId.toString(), "errorCode", code));
    }
  }

  private DispatchData dispatchData(ScheduledRow row) {
    List<DispatchData> found = jdbc.query("""
        select c.public_id customer_public_id,u.id staff_id,u.public_id::text staff_public_id,u.full_name,
          d.public_id::text dealership_public_id,d.code,d.status dealership_status,u.status staff_status,
          c.status customer_status, s.body_parameters::text parameters_json,a.public_id asset_public_id,
          exists(select 1 from staff_user_role ur join role_permission rp on rp.role_id=ur.role_id
            join permission p on p.id=rp.permission_id
            where ur.staff_user_id=u.id and ur.dealership_id=u.dealership_id
              and p.code='social_media.whatsapp.send') can_send_whatsapp
        from whatsapp_scheduled_send s
        join customer c on c.id=s.customer_id and c.dealership_id=s.dealership_id
        join staff_user u on u.id=s.created_by_staff_user_id and u.dealership_id=s.dealership_id
        join dealership d on d.id=s.dealership_id
        left join social_media_asset a on a.id=s.asset_id and a.dealership_id=s.dealership_id
        where s.dealership_id=? and s.public_id=?
        """, (rs, n) -> {
          if (!"ACTIVE".equals(rs.getString("staff_status")) || !"ACTIVE".equals(rs.getString("dealership_status"))
              || !"ACTIVE".equals(rs.getString("customer_status"))) {
            throw conflict("The scheduled send's staff, dealership or customer is no longer active.");
          }
          if (!rs.getBoolean("can_send_whatsapp")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                "The staff member no longer has permission to send WhatsApp messages.");
          }
          StaffPrincipal actor = new StaffPrincipal(0, rs.getLong("staff_id"), rs.getString("staff_public_id"),
              row.dealershipId(), rs.getString("dealership_public_id"), rs.getString("code"), rs.getString("full_name"),
              Set.of(), Set.of("social_media.whatsapp.send"));
          List<String> parameters;
          try { parameters = mapper.readValue(rs.getString("parameters_json"), new TypeReference<List<String>>() {}); }
          catch (JsonProcessingException invalid) { throw new IllegalStateException("Stored WhatsApp parameters are invalid."); }
          return new DispatchData(actor, rs.getObject("customer_public_id", UUID.class), parameters,
              rs.getObject("asset_public_id", UUID.class));
        }, row.dealershipId(), row.publicId());
    if (found.isEmpty()) throw notFound();
    return found.getFirst();
  }

  private ScheduledRow loadForDispatch(UUID publicId) {
    List<ScheduledRow> rows = jdbc.query("""
        select id,public_id,dealership_id,created_by_staff_user_id,request_fingerprint,status,
          template_name,language_code,error_code,created_at,updated_at,scheduled_at,message_send_id
        from whatsapp_scheduled_send where public_id=?
        """, (rs, n) -> mapRow(rs), publicId);
    if (rows.isEmpty()) throw notFound();
    return rows.getFirst();
  }

  private ScheduledMessageView view(long dealershipId, UUID publicId) {
    ScheduledRow row = jdbc.query("""
        select id,public_id,dealership_id,created_by_staff_user_id,request_fingerprint,status,template_name,language_code,
          error_code,created_at,updated_at,scheduled_at,message_send_id
        from whatsapp_scheduled_send where dealership_id=? and public_id=?
        """, (rs, n) -> mapRow(rs), dealershipId, publicId).stream().findFirst().orElseThrow(SocialWhatsappScheduleService::notFound);
    if (row.messageSendId() != null) {
      SocialWhatsappService.MessageView message = messageByInternalId(dealershipId, row.messageSendId());
      return new ScheduledMessageView(row.publicId(), message.status(), message.templateName(), message.languageCode(),
          message.providerMessageId(), message.errorCode(), row.createdAt(), message.updatedAt(),
          message.acceptedAt(), message.sentAt(), message.deliveredAt(), message.readAt(), message.failedAt(), row.scheduledAt());
    }
    return new ScheduledMessageView(row.publicId(), row.status(), row.templateName(), row.languageCode(),
        null, row.errorCode(), row.createdAt(), row.updatedAt(), null, null, null, null, null, row.scheduledAt());
  }

  private SocialWhatsappService.MessageView messageByInternalId(long dealershipId, long messageId) {
    return whatsapp.messageByInternalIdForSchedule(dealershipId, messageId);
  }

  private SocialWhatsappService.MessageView findImmediateByKey(StaffPrincipal actor, String key) {
    try { return whatsapp.messageByIdempotencyKeyForSchedule(actor.dealershipId(), key); }
    catch (ResponseStatusException missing) { return null; }
  }

  private ScheduledRow findByKey(long dealershipId, String key) {
    List<ScheduledRow> rows = jdbc.query("""
        select id,public_id,dealership_id,created_by_staff_user_id,request_fingerprint,status,template_name,language_code,
          error_code,created_at,updated_at,scheduled_at,message_send_id
        from whatsapp_scheduled_send where dealership_id=? and idempotency_key=?
        """, (rs, n) -> mapRow(rs), dealershipId, key);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private ScheduledRow mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
    Timestamp scheduled = rs.getTimestamp("scheduled_at");
    Timestamp created = rs.getTimestamp("created_at"), updated = rs.getTimestamp("updated_at");
    long messageId = rs.getLong("message_send_id");
    Long messageSendId = rs.wasNull() ? null : messageId;
    return new ScheduledRow(rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getLong("dealership_id"),
        rs.getLong("created_by_staff_user_id"), rs.getString("request_fingerprint"), rs.getString("status"), rs.getString("template_name"),
        rs.getString("language_code"), rs.getString("error_code"), created.toInstant(), updated.toInstant(),
        scheduled.toInstant(), messageSendId);
  }

  private Customer findCustomer(long dealershipId, UUID publicId) {
    List<Customer> rows = jdbc.query("""
        select id,public_id,full_name,phone from customer
        where dealership_id=? and public_id=? and status='ACTIVE'
        """, (rs, n) -> new Customer(rs.getLong("id"), rs.getObject("public_id", UUID.class),
        rs.getString("full_name"), rs.getString("phone")), dealershipId, publicId);
    if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Customer was not found.");
    return rows.getFirst();
  }

  private Consent findConsent(long dealershipId, long customerId) {
    List<Consent> rows = jdbc.query("""
        select phone_number_e164,status from customer_whatsapp_consent
        where dealership_id=? and customer_id=?
        """, (rs, n) -> new Consent(rs.getString("phone_number_e164"), rs.getString("status")),
        dealershipId, customerId);
    if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Record explicit WhatsApp opt-in before scheduling.");
    return rows.getFirst();
  }

  private void validateSchedule(Instant scheduledAt) {
    Instant now = Instant.now();
    if (scheduledAt.isBefore(now.plus(MIN_LEAD)) || scheduledAt.isAfter(now.plus(MAX_LEAD))) {
      throw badRequest("Choose a send time at least two minutes from now and no more than 90 days ahead.");
    }
  }

  private void audit(long dealershipId, Long actor, String action, Map<String,Object> details) {
    try {
      jdbc.update("insert into whatsapp_audit_event(dealership_id,actor_staff_user_id,action,details) values(?,?,?,?::jsonb)",
          dealershipId, actor, action, mapper.writeValueAsString(details));
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Scheduled WhatsApp audit could not be recorded.");
    }
  }

  private static ScheduledMessageView fromMessage(SocialWhatsappService.MessageView m, Instant scheduledAt) {
    return new ScheduledMessageView(m.publicId(),m.status(),m.templateName(),m.languageCode(),m.providerMessageId(),
        m.errorCode(),m.createdAt(),m.updatedAt(),m.acceptedAt(),m.sentAt(),m.deliveredAt(),m.readAt(),m.failedAt(),scheduledAt);
  }
  private static String writeJson(Object value) { try { return new ObjectMapper().writeValueAsString(value); } catch (JsonProcessingException e) { throw new IllegalArgumentException("WhatsApp data could not be serialized."); } }
  private static String normalizeE164(String raw) {
    if(raw==null)return null;String v=raw.replaceAll("[\\s() .-]","");
    return v.matches("\\+[1-9][0-9]{7,14}")?v:null;
  }
  private static String clean(String value) { return value == null ? "" : value.trim(); }
  private static String safeCode(String raw) { String v=raw==null?"":raw.replaceAll("[^a-zA-Z0-9_-]","");return v.isBlank()?"dispatch_error":v.substring(0,Math.min(100,v.length())); }
  private static ResponseStatusException badRequest(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,m); }
  private static ResponseStatusException conflict(String m) { return new ResponseStatusException(HttpStatus.CONFLICT,m); }
  private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND,"Scheduled WhatsApp message was not found."); }
  private record Customer(long id,UUID publicId,String name,String phone){}
  private record Consent(String phone,String status){}
  private record DispatchData(StaffPrincipal actor,UUID customerPublicId,List<String> parameters,UUID assetPublicId){}
  private record ScheduledRow(long id,UUID publicId,long dealershipId,long createdBy,String fingerprint,String status,String templateName,
      String languageCode,String errorCode,Instant createdAt,Instant updatedAt,Instant scheduledAt,Long messageSendId){}
  public record ScheduleRequest(@NotNull UUID customerPublicId,@NotBlank @Size(max=120) String templateName,
      @NotBlank @Size(max=32) String languageCode,List<String> bodyParameters,UUID assetId,
      @NotBlank @Size(max=120) String idempotencyKey,@NotNull Instant scheduledAt){}
  public record ScheduledMessageView(UUID publicId,String status,String templateName,String languageCode,
      String providerMessageId,String errorCode,Instant createdAt,Instant updatedAt,Instant acceptedAt,
      Instant sentAt,Instant deliveredAt,Instant readAt,Instant failedAt,Instant scheduledAt){}
}