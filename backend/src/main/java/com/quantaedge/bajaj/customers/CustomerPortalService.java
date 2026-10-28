package com.quantaedge.bajaj.customers;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.CustomerPortalAttemptRecorder;
import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Customer portal authentication and data access, always scoped to the authenticated CRM customer. */
@Service
public class CustomerPortalService {
  private static final int MAX_FAILED_ATTEMPTS = 8;
  private static final Duration ATTEMPT_WINDOW = Duration.ofMinutes(15);
  private static final Duration INVITATION_LIFETIME = Duration.ofHours(48);
  private static final Duration SESSION_LIFETIME = Duration.ofDays(30);
  private static final BigDecimal ZERO_MONEY = BigDecimal.ZERO.setScale(2);
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final CustomerPortalAttemptRecorder attemptRecorder;
  private final SecureRandom secureRandom = new SecureRandom();
  private final String dummyPasswordHash;

  public CustomerPortalService(
      JdbcTemplate jdbc, PasswordEncoder passwordEncoder, CustomerPortalAttemptRecorder attemptRecorder) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.attemptRecorder = attemptRecorder;
    this.dummyPasswordHash = passwordEncoder.encode("customer-portal-dummy-" + UUID.randomUUID());
  }

  @Transactional
  public InvitationView issueInvitation(StaffPrincipal actor, UUID customerPublicId) {
    List<Map<String, Object>> customers = jdbc.queryForList("""
        select id, public_id, full_name, status
        from customer
        where dealership_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), customerPublicId);
    if (customers.isEmpty()) throw notFound("Customer was not found in this dealership.");
    Map<String, Object> customer = customers.getFirst();
    if (!"ACTIVE".equals(String.valueOf(customer.get("status")))) {
      throw conflict("Only an active CRM customer can activate a portal account.");
    }
    long customerId = number(customer.get("id"));

    List<Map<String, Object>> accounts = jdbc.queryForList("""
        select id, status from customer_portal_account
        where dealership_id = ? and customer_id = ?
        """, actor.dealershipId(), customerId);
    String purpose = accounts.isEmpty() ? "SETUP" : "PASSWORD_RESET";
    if (!accounts.isEmpty() && !"ACTIVE".equals(String.valueOf(accounts.getFirst().get("status")))) {
      throw conflict("This customer portal account is disabled. Re-enable it through the approved account-support process.");
    }

    jdbc.update("""
        update customer_portal_invitation set revoked_at = now()
        where dealership_id = ? and customer_id = ? and used_at is null and revoked_at is null
        """, actor.dealershipId(), customerId);

    String rawToken = createRandomToken();
    Instant expiresAt = Instant.now().plus(INVITATION_LIFETIME);
    UUID invitationPublicId = jdbc.queryForObject("""
        insert into customer_portal_invitation(
          dealership_id, customer_id, purpose, token_hash, issued_by_staff_user_id, expires_at)
        values (?, ?, ?, ?, ?, ?)
        returning public_id
        """, UUID.class, actor.dealershipId(), customerId, purpose,
        TokenDigests.sha256(rawToken), actor.staffUserId(), Timestamp.from(expiresAt));

    audit(actor, "CUSTOMER_PORTAL_INVITATION_ISSUED", "CUSTOMER_PORTAL_INVITATION",
        invitationPublicId.toString(),
        "Issued a single-use " + purpose + " invitation for CRM customer "
            + customerPublicId + "; invitation expires at " + expiresAt + ".");
    return new InvitationView(customerPublicId, String.valueOf(customer.get("full_name")),
        purpose, rawToken, expiresAt);
  }

  @Transactional
  public PortalSession activate(ActivationRequest request, String remoteAddress, String userAgent) {
    if (request == null) throw badRequest("Activation details are required.");
    String rawToken = required(request.activationToken(), "Activation invitation", 128);
    String password = validatePassword(request.password());
    String tokenHash = TokenDigests.sha256(rawToken);
    String loginKeyHash = TokenDigests.sha256("customer-portal-activation:" + tokenHash);
    String remoteHash = remoteHash(remoteAddress);
    checkRateLimit(loginKeyHash, remoteHash);

    List<Map<String, Object>> invitations = jdbc.queryForList("""
        select invitation.id, invitation.public_id, invitation.dealership_id, invitation.customer_id,
          invitation.purpose, invitation.expires_at, customer.public_id as customer_public_id,
          customer.customer_code, customer.full_name, customer.preferred_language,
          customer.phone, customer.email, customer.status as customer_status,
          dealership.public_id as dealership_public_id, dealership.code as dealership_code,
          dealership.name as dealership_name, dealership.status as dealership_status
        from customer_portal_invitation invitation
        join customer on customer.dealership_id = invitation.dealership_id and customer.id = invitation.customer_id
        join dealership on dealership.id = invitation.dealership_id
        where invitation.token_hash = ? and invitation.used_at is null
          and invitation.revoked_at is null and invitation.expires_at > now()
        for update of invitation, customer
        """, tokenHash);

    if (invitations.size() != 1) {
      attemptRecorder.record(loginKeyHash, remoteHash, false, null);
      throw unauthorized("The activation invitation is invalid or expired. Ask the dealership to issue a new one.");
    }

    Map<String, Object> invitation = invitations.getFirst();
    if (!"ACTIVE".equals(String.valueOf(invitation.get("customer_status")))
        || !"ACTIVE".equals(String.valueOf(invitation.get("dealership_status")))) {
      attemptRecorder.record(loginKeyHash, remoteHash, false, null);
      throw unauthorized("The activation invitation is invalid or expired. Ask the dealership to issue a new one.");
    }

    long dealershipId = number(invitation.get("dealership_id"));
    long customerId = number(invitation.get("customer_id"));
    String purpose = String.valueOf(invitation.get("purpose"));
    long accountId;
    if ("SETUP".equals(purpose)) {
      List<Long> existing = jdbc.query("""
          select id from customer_portal_account where dealership_id = ? and customer_id = ?
          """, (rs, rowNum) -> rs.getLong(1), dealershipId, customerId);
      if (!existing.isEmpty()) {
        attemptRecorder.record(loginKeyHash, remoteHash, false, null);
        throw conflict("This account was already activated. Ask the dealership to issue a password-reset invitation.");
      }
      accountId = jdbc.queryForObject("""
          insert into customer_portal_account(
            dealership_id, customer_id, password_hash, status, password_changed_at)
          values (?, ?, ?, 'ACTIVE', now())
          returning id
          """, Long.class, dealershipId, customerId, passwordEncoder.encode(password));
    } else if ("PASSWORD_RESET".equals(purpose)) {
      List<Long> accounts = jdbc.query("""
          select id from customer_portal_account
          where dealership_id = ? and customer_id = ? and status = 'ACTIVE'
          for update
          """, (rs, rowNum) -> rs.getLong(1), dealershipId, customerId);
      if (accounts.size() != 1) {
        attemptRecorder.record(loginKeyHash, remoteHash, false, null);
        throw unauthorized("The activation invitation is invalid or expired. Ask the dealership to issue a new one.");
      }
      accountId = accounts.getFirst();
      jdbc.update("""
          update customer_portal_account
          set password_hash = ?, failed_login_count = 0, locked_until = null,
              password_changed_at = now(), updated_at = now()
          where dealership_id = ? and id = ? and status = 'ACTIVE'
          """, passwordEncoder.encode(password), dealershipId, accountId);
      jdbc.update("""
          update customer_portal_session set revoked_at = now()
          where dealership_id = ? and account_id = ? and revoked_at is null
          """, dealershipId, accountId);
    } else {
      attemptRecorder.record(loginKeyHash, remoteHash, false, null);
      throw unauthorized("The activation invitation is invalid or expired. Ask the dealership to issue a new one.");
    }

    int consumed = jdbc.update("""
        update customer_portal_invitation set used_at = now()
        where id = ? and used_at is null and revoked_at is null and expires_at > now()
        """, number(invitation.get("id")));
    if (consumed != 1) throw conflict("This invitation has already been used. Ask the dealership for a new one.");
    jdbc.update("""
        update customer_portal_invitation set revoked_at = now()
        where dealership_id = ? and customer_id = ? and id <> ?
          and used_at is null and revoked_at is null
        """, dealershipId, customerId, number(invitation.get("id")));

    recordActivity(dealershipId, accountId,
        "PASSWORD_RESET".equals(purpose) ? "ACCOUNT_PASSWORD_RESET" : "ACCOUNT_ACTIVATED",
        "CUSTOMER_PORTAL_ACCOUNT", String.valueOf(invitation.get("customer_public_id")),
        "Customer portal account setup completed.");
    attemptRecorder.record(loginKeyHash, remoteHash, true, null);
    return createSession(dealershipId, accountId, remoteAddress, userAgent);
  }

  @Transactional
  public PortalSession login(LoginRequest request, String remoteAddress, String userAgent) {
    if (request == null) throw badRequest("Sign-in details are required.");
    String dealershipCode = required(request.dealershipCode(), "Dealership code", 40).toUpperCase(Locale.ROOT);
    String customerCode = required(request.customerCode(), "Customer code", 40).toUpperCase(Locale.ROOT);
    String password = request.password() == null ? "" : request.password();
    if (password.isBlank() || password.length() > 128) throw unauthorized("Invalid customer sign-in details.");

    String loginKeyHash = TokenDigests.sha256("customer-portal:" + dealershipCode + ":" + customerCode);
    String remoteHash = remoteHash(remoteAddress);
    checkRateLimit(loginKeyHash, remoteHash);

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select account.id as account_id, account.public_id as account_public_id,
          account.password_hash, account.status as account_status, account.locked_until,
          customer.id as customer_id, dealership.id as dealership_id,
          customer.status as customer_status, dealership.status as dealership_status
        from customer
        join dealership on dealership.id = customer.dealership_id
        left join customer_portal_account account
          on account.dealership_id = customer.dealership_id and account.customer_id = customer.id
        where upper(dealership.code) = ? and upper(customer.customer_code) = ?
        limit 2
        """, dealershipCode, customerCode);

    Map<String, Object> candidate = rows.size() == 1 ? rows.getFirst() : null;
    String hash = candidate == null || candidate.get("password_hash") == null
        ? dummyPasswordHash : String.valueOf(candidate.get("password_hash"));
    boolean passwordMatches = passwordEncoder.matches(password, hash);
    boolean isLocked = candidate != null && candidate.get("locked_until") != null
        && ((Timestamp) candidate.get("locked_until")).toInstant().isAfter(Instant.now());
    boolean accountAllowed = candidate != null
        && "ACTIVE".equals(String.valueOf(candidate.get("account_status")))
        && "ACTIVE".equals(String.valueOf(candidate.get("customer_status")))
        && "ACTIVE".equals(String.valueOf(candidate.get("dealership_status")))
        && !isLocked;

    if (!passwordMatches || !accountAllowed) {
      Long accountId = candidate != null && candidate.get("account_id") != null
          ? number(candidate.get("account_id")) : null;
      attemptRecorder.record(loginKeyHash, remoteHash, false, accountId);
      throw unauthorized("Invalid customer sign-in details.");
    }

    long dealershipId = number(candidate.get("dealership_id"));
    long accountId = number(candidate.get("account_id"));
    jdbc.update("""
        update customer_portal_account set last_login_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'ACTIVE'
        """, dealershipId, accountId);
    attemptRecorder.record(loginKeyHash, remoteHash, true, null);
    return createSession(dealershipId, accountId, remoteAddress, userAgent);
  }

  @Transactional
  public void logout(CustomerPrincipal actor) {
    jdbc.update("""
        update customer_portal_session set revoked_at = now()
        where dealership_id = ? and id = ? and account_id = ? and revoked_at is null
        """, actor.dealershipId(), actor.sessionId(), actor.accountId());
  }

  public CustomerProfile profile(CustomerPrincipal actor) {
    List<CustomerProfile> rows = jdbc.query("""
        select customer.public_id, customer.customer_code, customer.full_name,
          customer.phone, customer.email, customer.preferred_language,
          dealership.code as dealership_code, dealership.name as dealership_name
        from customer
        join dealership on dealership.id = customer.dealership_id
        where customer.dealership_id = ? and customer.id = ? and customer.status = 'ACTIVE'
          and dealership.status = 'ACTIVE'
        """, (rs, rowNum) -> new CustomerProfile(
            rs.getObject("public_id", UUID.class), rs.getString("customer_code"), rs.getString("full_name"),
            rs.getString("phone"), rs.getString("email"), rs.getString("preferred_language"),
            rs.getString("dealership_code"), rs.getString("dealership_name")),
        actor.dealershipId(), actor.customerId());
    if (rows.isEmpty()) throw notFound("Customer profile is no longer active.");
    return rows.getFirst();
  }

  public List<VehicleView> vehicles(CustomerPrincipal actor) {
    return jdbc.query("""
        select vehicle.public_id, model.model_name, model.variant_name, model.colour_name,
          model.model_year, vehicle.chassis_number, vehicle.engine_number, customer_vehicle.ownership_started_at
        from customer_vehicle
        join vehicle_unit vehicle
          on vehicle.dealership_id = customer_vehicle.dealership_id and vehicle.id = customer_vehicle.vehicle_unit_id
        join vehicle_model model
          on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        where customer_vehicle.dealership_id = ? and customer_vehicle.customer_id = ?
          and customer_vehicle.ownership_ended_at is null
        order by customer_vehicle.ownership_started_at desc, customer_vehicle.id desc
        """, (rs, rowNum) -> new VehicleView(
            rs.getObject("public_id", UUID.class), rs.getString("model_name"), rs.getString("variant_name"),
            rs.getString("colour_name"), (Integer) rs.getObject("model_year"),
            rs.getString("chassis_number"), rs.getString("engine_number"),
            rs.getTimestamp("ownership_started_at").toInstant()),
        actor.dealershipId(), actor.customerId());
  }

  public List<ServiceHistoryView> serviceHistory(CustomerPrincipal actor) {
    return jdbc.query("""
        select job.public_id as job_public_id, job.job_card_code, job.status, job.customer_concern,
          job.checked_in_at, job.completed_at, job.delivered_at, model.model_name, model.variant_name,
          model.colour_name, vehicle.chassis_number, invoice.invoice_number, invoice.status as invoice_status,
          invoice.issued_at, invoice.invoice_total,
          coalesce((
            select sum(allocation.amount)
            from service_payment_allocation allocation
            join service_payment payment
              on payment.dealership_id = allocation.dealership_id and payment.id = allocation.payment_id
            where allocation.dealership_id = invoice.dealership_id and allocation.invoice_id = invoice.id
              and payment.status = 'RECORDED'
          ), 0) as paid_amount
        from service_job_card job
        join vehicle_unit vehicle on vehicle.dealership_id = job.dealership_id and vehicle.id = job.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        left join lateral (
          select inv.id, inv.invoice_number, inv.status, inv.issued_at, inv.invoice_total, inv.dealership_id
          from service_invoice inv
          where inv.dealership_id = job.dealership_id and inv.job_card_id = job.id
            and inv.status <> 'CANCELLED'
          order by inv.id desc limit 1
        ) invoice on true
        where job.dealership_id = ? and job.customer_id = ?
        order by job.checked_in_at desc, job.id desc
        """, (rs, rowNum) -> {
      BigDecimal total = rs.getBigDecimal("invoice_total");
      BigDecimal paid = rs.getBigDecimal("paid_amount");
      BigDecimal balance = total == null ? ZERO_MONEY : total.subtract(paid).max(BigDecimal.ZERO).setScale(2);
      return new ServiceHistoryView(
          rs.getObject("job_public_id", UUID.class), rs.getString("job_card_code"), rs.getString("status"),
          rs.getString("customer_concern"), rs.getString("model_name"), rs.getString("variant_name"),
          rs.getString("colour_name"), rs.getString("chassis_number"), rs.getTimestamp("checked_in_at").toInstant(),
          instantOrNull(rs.getTimestamp("completed_at")), instantOrNull(rs.getTimestamp("delivered_at")),
          rs.getString("invoice_number"), rs.getString("invoice_status"), instantOrNull(rs.getTimestamp("issued_at")),
          total, paid == null ? ZERO_MONEY : paid, balance, "Operational invoice — not a GST tax invoice.");
    }, actor.dealershipId(), actor.customerId());
  }

  public NotificationPage notifications(
      CustomerPrincipal actor, int requestedPage, int requestedSize, boolean unreadOnly) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int size = Math.max(1, Math.min(requestedSize, 100));
    long offset = (long) page * size;
    String unreadFilter = unreadOnly ? " and recipient.read_at is null " : "";
    Long totalValue = jdbc.queryForObject("""
        select count(*)
        from notification_recipient recipient
        join notification_campaign campaign
          on campaign.id = recipient.campaign_id and campaign.dealership_id = recipient.dealership_id
        where recipient.dealership_id = ? and recipient.recipient_kind = 'CUSTOMER'
          and recipient.customer_id = ? and recipient.status <> 'DISMISSED' and campaign.status = 'SENT'
        """ + unreadFilter, Long.class, actor.dealershipId(), actor.customerId());
    long total = totalValue == null ? 0 : totalValue;
    List<CustomerNotificationView> items = jdbc.query("""
        select recipient.public_id as recipient_public_id, campaign.public_id as campaign_public_id,
          campaign.title, campaign.summary, campaign.content_document::text as content_document_json,
          sender.full_name as sender_name, recipient.status, recipient.created_at, recipient.read_at
        from notification_recipient recipient
        join notification_campaign campaign
          on campaign.id = recipient.campaign_id and campaign.dealership_id = recipient.dealership_id
        join staff_user sender
          on sender.dealership_id = campaign.dealership_id and sender.id = campaign.created_by_staff_user_id
        where recipient.dealership_id = ? and recipient.recipient_kind = 'CUSTOMER'
          and recipient.customer_id = ? and recipient.status <> 'DISMISSED' and campaign.status = 'SENT'
        """ + unreadFilter + " order by recipient.created_at desc, recipient.id desc limit ? offset ?",
        (rs, rowNum) -> new CustomerNotificationView(
            rs.getObject("recipient_public_id", UUID.class), rs.getObject("campaign_public_id", UUID.class),
            rs.getString("title"), rs.getString("summary"), rs.getString("content_document_json"),
            rs.getString("sender_name"), rs.getString("status"),
            rs.getTimestamp("created_at").toInstant(), instantOrNull(rs.getTimestamp("read_at"))),
        actor.dealershipId(), actor.customerId(), size, offset);
    Integer unreadValue = jdbc.queryForObject("""
        select count(*)
        from notification_recipient recipient
        join notification_campaign campaign
          on campaign.id = recipient.campaign_id and campaign.dealership_id = recipient.dealership_id
        where recipient.dealership_id = ? and recipient.recipient_kind = 'CUSTOMER'
          and recipient.customer_id = ? and recipient.status <> 'DISMISSED'
          and recipient.read_at is null and campaign.status = 'SENT'
        """, Integer.class, actor.dealershipId(), actor.customerId());
    return new NotificationPage(items, page, size, total, unreadValue == null ? 0 : unreadValue);
  }

  @Transactional
  public void markNotificationRead(CustomerPrincipal actor, UUID recipientPublicId, boolean read) {
    int changed = jdbc.update("""
        update notification_recipient recipient
        set status = case when ? then 'READ' else 'IN_APP_CREATED' end,
            read_at = case when ? then coalesce(recipient.read_at, now()) else null end
        where recipient.dealership_id = ? and recipient.recipient_kind = 'CUSTOMER'
          and recipient.customer_id = ? and recipient.public_id = ?
          and recipient.status <> 'DISMISSED'
          and exists (
            select 1 from notification_campaign campaign
            where campaign.id = recipient.campaign_id
              and campaign.dealership_id = recipient.dealership_id
              and campaign.status = 'SENT')
        """, read, read, actor.dealershipId(), actor.customerId(), recipientPublicId);
    if (changed == 0) throw notFound("Notification was not found in this customer's inbox.");
    recordActivity(actor.dealershipId(), actor.accountId(), read ? "NOTIFICATION_READ" : "NOTIFICATION_MARKED_UNREAD",
        "NOTIFICATION_RECIPIENT", recipientPublicId.toString(),
        read ? "Customer marked a dealership notification as read." : "Customer marked a dealership notification as unread.");
  }

  @Transactional
  public void dismissNotification(CustomerPrincipal actor, UUID recipientPublicId) {
    int changed = jdbc.update("""
        update notification_recipient recipient
        set status = 'DISMISSED', dismissed_at = now()
        where recipient.dealership_id = ? and recipient.recipient_kind = 'CUSTOMER'
          and recipient.customer_id = ? and recipient.public_id = ?
          and recipient.status <> 'DISMISSED'
          and exists (
            select 1 from notification_campaign campaign
            where campaign.id = recipient.campaign_id
              and campaign.dealership_id = recipient.dealership_id
              and campaign.status = 'SENT')
        """, actor.dealershipId(), actor.customerId(), recipientPublicId);
    if (changed == 0) throw notFound("Notification was not found in this customer's inbox.");
    recordActivity(actor.dealershipId(), actor.accountId(), "NOTIFICATION_DISMISSED",
        "NOTIFICATION_RECIPIENT", recipientPublicId.toString(),
        "Customer dismissed a dealership notification from the inbox.");
  }

  public List<AppointmentView> appointments(CustomerPrincipal actor) {
    return queryAppointments(actor, null);
  }

  @Transactional
  public AppointmentView createAppointment(CustomerPrincipal actor, CustomerAppointmentRequest request) {
    if (request == null || request.vehiclePublicId() == null) throw badRequest("Choose one of your current bikes.");
    if (request.scheduledFor() == null) throw badRequest("Appointment date and time are required.");
    Instant now = Instant.now();
    if (!request.scheduledFor().isAfter(now)) throw badRequest("Choose an appointment time in the future.");
    if (request.scheduledFor().isAfter(now.plus(Duration.ofDays(365)))) {
      throw badRequest("Appointment time must be within the next 12 months.");
    }
    int slotMinutes = request.slotMinutes() == null ? 60 : request.slotMinutes();
    if (slotMinutes < 15 || slotMinutes > 480) throw badRequest("Appointment duration must be 15 to 480 minutes.");
    String concern = required(request.customerConcern(), "Service concern", 3000);
    String language = normalizeLanguage(request.customerLanguage());

    List<Long> vehicleIds = jdbc.query("""
        select id from vehicle_unit
        where dealership_id = ? and public_id = ?
        for update
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), request.vehiclePublicId());
    if (vehicleIds.isEmpty()) throw notFound("Bike was not found in this dealership.");
    long vehicleId = vehicleIds.getFirst();

    Integer owned = jdbc.queryForObject("""
        select count(*) from customer_vehicle
        where dealership_id = ? and customer_id = ? and vehicle_unit_id = ?
          and ownership_ended_at is null
        """, Integer.class, actor.dealershipId(), actor.customerId(), vehicleId);
    if (owned == null || owned != 1) {
      throw notFound("This bike is not currently linked to your customer account.");
    }

    Instant end = request.scheduledFor().plus(Duration.ofMinutes(slotMinutes));
    Integer conflicts = jdbc.queryForObject("""
        select count(*) from service_appointment
        where dealership_id = ? and vehicle_unit_id = ?
          and status in ('REQUESTED', 'CONFIRMED')
          and scheduled_for < ?
          and scheduled_for + (slot_minutes * interval '1 minute') > ?
        """, Integer.class, actor.dealershipId(), vehicleId,
        Timestamp.from(end), Timestamp.from(request.scheduledFor()));
    if (conflicts != null && conflicts > 0) {
      throw conflict("This bike already has an appointment during that time. Choose another slot.");
    }

    String code = "APT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID appointmentPublicId = jdbc.queryForObject("""
        insert into service_appointment(
          dealership_id, appointment_code, customer_id, vehicle_unit_id, scheduled_for,
          slot_minutes, customer_concern, customer_language, source, status, staff_notes)
        values (?, ?, ?, ?, ?, ?, ?, ?, 'CUSTOMER_WEB', 'REQUESTED', null)
        returning public_id
        """, UUID.class, actor.dealershipId(), code, actor.customerId(), vehicleId,
        Timestamp.from(request.scheduledFor()), slotMinutes, concern, language);
    long appointmentId = jdbc.queryForObject("""
        select id from service_appointment where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), appointmentPublicId);

    jdbc.update("""
        insert into service_appointment_transition(
          dealership_id, appointment_id, from_status, to_status, action, actor_staff_user_id, reason)
        values (?, ?, null, 'REQUESTED', 'CUSTOMER_APPOINTMENT_REQUESTED', null, ?)
        """, actor.dealershipId(), appointmentId,
        "Requested by customer portal account " + actor.accountPublicId() + ".");
    recordActivity(actor.dealershipId(), actor.accountId(), "APPOINTMENT_REQUESTED",
        "SERVICE_APPOINTMENT", appointmentPublicId.toString(),
        "Customer requested service appointment " + code + ".");
    return queryAppointments(actor, appointmentPublicId).stream().findFirst()
        .orElseThrow(() -> conflict("Appointment was saved but could not be loaded."));
  }

  @Transactional
  public AppointmentView cancelAppointment(
      CustomerPrincipal actor, UUID appointmentPublicId, String rawReason) {
    String reason = required(rawReason, "Cancellation reason", 500);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, status, appointment_code
        from service_appointment
        where dealership_id = ? and customer_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), actor.customerId(), appointmentPublicId);
    if (rows.isEmpty()) throw notFound("Appointment was not found for this customer.");
    Map<String, Object> row = rows.getFirst();
    String status = String.valueOf(row.get("status"));
    if (!List.of("REQUESTED", "CONFIRMED").contains(status)) {
      throw conflict("Only a requested or confirmed appointment can be cancelled from the customer portal.");
    }
    int changed = jdbc.update("""
        update service_appointment
        set status = 'CANCELLED', status_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status in ('REQUESTED', 'CONFIRMED')
        """, reason, actor.dealershipId(), number(row.get("id")));
    if (changed != 1) throw conflict("Appointment status changed. Refresh and retry.");
    jdbc.update("""
        insert into service_appointment_transition(
          dealership_id, appointment_id, from_status, to_status, action, actor_staff_user_id, reason)
        values (?, ?, ?, 'CANCELLED', 'CUSTOMER_APPOINTMENT_CANCELLED', null, ?)
        """, actor.dealershipId(), number(row.get("id")), status,
        "Customer portal account " + actor.accountPublicId() + ": " + reason);
    recordActivity(actor.dealershipId(), actor.accountId(), "APPOINTMENT_CANCELLED",
        "SERVICE_APPOINTMENT", appointmentPublicId.toString(),
        "Customer cancelled appointment " + row.get("appointment_code") + ".");
    return queryAppointments(actor, appointmentPublicId).stream().findFirst()
        .orElseThrow(() -> conflict("Appointment was cancelled but could not be loaded."));
  }

  private List<AppointmentView> queryAppointments(CustomerPrincipal actor, UUID onlyPublicId) {
    String filter = onlyPublicId == null ? "" : " and appointment.public_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    args.add(actor.customerId());
    if (onlyPublicId != null) args.add(onlyPublicId);
    return jdbc.query("""
        select appointment.public_id, appointment.appointment_code, vehicle.public_id as vehicle_public_id,
          model.model_name, model.variant_name, model.colour_name, vehicle.chassis_number,
          appointment.scheduled_for, appointment.slot_minutes, appointment.customer_concern,
          appointment.customer_language, appointment.source, appointment.status, appointment.status_reason,
          appointment.checked_in_at, appointment.created_at, appointment.updated_at
        from service_appointment appointment
        join vehicle_unit vehicle on vehicle.dealership_id = appointment.dealership_id
          and vehicle.id = appointment.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id
          and model.id = vehicle.vehicle_model_id
        where appointment.dealership_id = ? and appointment.customer_id = ?
        """ + filter + " order by appointment.scheduled_for desc, appointment.id desc",
        (rs, rowNum) -> new AppointmentView(
            rs.getObject("public_id", UUID.class), rs.getString("appointment_code"),
            rs.getObject("vehicle_public_id", UUID.class), rs.getString("model_name"),
            rs.getString("variant_name"), rs.getString("colour_name"), rs.getString("chassis_number"),
            rs.getTimestamp("scheduled_for").toInstant(), rs.getInt("slot_minutes"),
            rs.getString("customer_concern"), rs.getString("customer_language"), rs.getString("source"),
            rs.getString("status"), rs.getString("status_reason"), instantOrNull(rs.getTimestamp("checked_in_at")),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()),
        args.toArray());
  }

  private PortalSession createSession(long dealershipId, long accountId, String remoteAddress, String userAgent) {
    String token = createRandomToken();
    Instant now = Instant.now();
    Instant expiresAt = now.plus(SESSION_LIFETIME);
    Long sessionId = jdbc.queryForObject("""
        insert into customer_portal_session(
          dealership_id, account_id, token_hash, issued_at, expires_at, last_seen_at, user_agent, remote_address_hash)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        returning id
        """, Long.class, dealershipId, accountId, TokenDigests.sha256(token), Timestamp.from(now),
        Timestamp.from(expiresAt), Timestamp.from(now), truncate(userAgent, 300), remoteHash(remoteAddress));
    CustomerPrincipal principal = principalForSession(sessionId == null ? -1L : sessionId);
    return new PortalSession(token, expiresAt, profile(principal));
  }

  private CustomerPrincipal principalForSession(long sessionId) {
    List<CustomerPrincipal> rows = jdbc.query("""
        select session.id as session_id, account.id as account_id, account.public_id as account_public_id,
          customer.id as customer_id, customer.public_id as customer_public_id,
          dealership.id as dealership_id, dealership.public_id as dealership_public_id,
          dealership.code as dealership_code, dealership.name as dealership_name,
          customer.customer_code, customer.full_name, customer.preferred_language, customer.phone, customer.email
        from customer_portal_session session
        join customer_portal_account account
          on account.dealership_id = session.dealership_id and account.id = session.account_id
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = session.dealership_id
        where session.id = ? and session.revoked_at is null and session.expires_at > now()
          and account.status = 'ACTIVE' and customer.status = 'ACTIVE' and dealership.status = 'ACTIVE'
        """, (rs, rowNum) -> new CustomerPrincipal(
            rs.getLong("session_id"), rs.getLong("account_id"), rs.getString("account_public_id"),
            rs.getLong("customer_id"), rs.getString("customer_public_id"), rs.getLong("dealership_id"),
            rs.getString("dealership_public_id"), rs.getString("dealership_code"), rs.getString("dealership_name"),
            rs.getString("customer_code"), rs.getString("full_name"), rs.getString("preferred_language"),
            rs.getString("phone"), rs.getString("email")), sessionId);
    if (rows.size() != 1) throw conflict("Customer session could not be established.");
    return rows.getFirst();
  }

  private void checkRateLimit(String loginKeyHash, String remoteHash) {
    Integer failedCount = jdbc.queryForObject("""
        select count(*) from auth_login_attempt
        where succeeded = false
          and attempted_at > now() - (? * interval '1 second')
          and (login_key_hash = ? or remote_address_hash = ?)
        """, Integer.class, ATTEMPT_WINDOW.toSeconds(), loginKeyHash, remoteHash);
    if (failedCount != null && failedCount >= MAX_FAILED_ATTEMPTS) {
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
          "Too many sign-in attempts. Try again in 15 minutes.");
    }
  }

  private void recordActivity(
      long dealershipId, long accountId, String action, String entityType, String entityPublicId, String summary) {
    jdbc.update("""
        insert into customer_portal_activity(
          dealership_id, account_id, action, entity_type, entity_public_id, details)
        values (?, ?, ?, ?, ?::uuid, jsonb_build_object('summary', ?))
        """, dealershipId, accountId, action, entityType, entityPublicId, summary);
  }

  private void audit(StaffPrincipal actor, String action, String entityType, String entityId, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, entityType, entityId, summary);
  }

  private static String validatePassword(String value) {
    if (value == null || value.length() < 12 || value.length() > 128
        || value.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("Password must be 12–128 characters and contain no control characters.");
    }
    return value;
  }

  private String createRandomToken() {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static String normalizeLanguage(String raw) {
    String value = raw == null || raw.isBlank() ? "hi" : raw.trim().toLowerCase(Locale.ROOT);
    if (!List.of("hi", "en", "hinglish").contains(value)) throw badRequest("Choose Hindi, English or Hinglish.");
    return value;
  }

  private static String remoteHash(String remoteAddress) {
    String value = remoteAddress == null || remoteAddress.isBlank() ? "unknown-remote" : remoteAddress.trim();
    return TokenDigests.sha256(value);
  }

  private static String truncate(String raw, int maximum) {
    if (raw == null) return null;
    String value = raw.trim();
    return value.length() <= maximum ? value : value.substring(0, maximum);
  }

  private static String required(String value, String label, int maximum) {
    if (value == null) throw badRequest(label + " is required.");
    String cleaned = value.trim();
    if (cleaned.isEmpty() || cleaned.length() > maximum || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw badRequest(label + " is invalid.");
    }
    return cleaned;
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static Instant instantOrNull(Timestamp timestamp) {
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

  private static ResponseStatusException unauthorized(String message) {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, message);
  }

  public record ActivationRequest(String activationToken, String password) {}
  public record LoginRequest(String dealershipCode, String customerCode, String password) {}
  public record SessionRequest(String accessToken, Instant expiresAt, CustomerProfile customer) {}
  public record PortalSession(String accessToken, Instant expiresAt, CustomerProfile customer) {}
  public record CustomerProfile(
      UUID publicId, String customerCode, String fullName, String phone, String email,
      String preferredLanguage, String dealershipCode, String dealershipName) {}
  public record InvitationView(
      UUID customerPublicId, String customerName, String purpose, String activationToken, Instant expiresAt) {}
  public record CustomerAppointmentRequest(
      UUID vehiclePublicId, Instant scheduledFor, Integer slotMinutes, String customerConcern, String customerLanguage) {}
  public record CustomerNotificationView(
      UUID recipientPublicId, UUID campaignPublicId, String title, String summary,
      String contentDocumentJson, String senderName, String status, Instant createdAt, Instant readAt) {}
  public record NotificationPage(
      List<CustomerNotificationView> items, int page, int pageSize, long total, int unreadCount) {}
  public record AppointmentView(
      UUID publicId, String appointmentCode, UUID vehiclePublicId,
      String modelName, String variantName, String colourName, String chassisNumber,
      Instant scheduledFor, int slotMinutes, String customerConcern, String customerLanguage,
      String source, String status, String statusReason, Instant checkedInAt, Instant createdAt, Instant updatedAt) {}
  public record VehicleView(
      UUID publicId, String modelName, String variantName, String colourName, Integer modelYear,
      String chassisNumber, String engineNumber, Instant ownershipStartedAt) {}
  public record ServiceHistoryView(
      UUID jobCardPublicId, String jobCardCode, String status, String customerConcern,
      String modelName, String variantName, String colourName, String chassisNumber,
      Instant checkedInAt, Instant completedAt, Instant deliveredAt,
      String invoiceNumber, String invoiceStatus, Instant invoiceIssuedAt,
      BigDecimal invoiceTotal, BigDecimal paidAmount, BigDecimal balanceDue, String invoiceNotice) {}
}
