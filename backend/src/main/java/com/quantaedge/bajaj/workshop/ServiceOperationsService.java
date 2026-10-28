package com.quantaedge.bajaj.workshop;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
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
 * Workshop intake operations. Client-submitted IDs are never treated as dealership scope;
 * all lookups are constrained by the authenticated staff principal.
 */
@Service
public class ServiceOperationsService {
  private static final List<String> APPOINTMENT_STATUSES =
      List.of("REQUESTED", "CONFIRMED", "CANCELLED", "CHECKED_IN", "NO_SHOW", "COMPLETED");
  private static final List<String> JOB_CARD_STATUSES =
      List.of("OPEN", "INSPECTING", "ESTIMATE_PENDING", "AWAITING_APPROVAL", "APPROVED",
          "IN_PROGRESS", "QUALITY_CHECK", "READY_FOR_COLLECTION", "INVOICED", "DELIVERED", "CANCELLED");
  private static final List<String> SOURCES =
      List.of("STAFF", "PHONE", "WALK_IN", "CUSTOMER_WEB", "CUSTOMER_APP");

  private static final RowMapper<AppointmentView> APPOINTMENT_ROW = (rs, rowNum) -> new AppointmentView(
      rs.getObject("public_id", UUID.class),
      rs.getString("appointment_code"),
      rs.getObject("customer_public_id", UUID.class),
      rs.getString("customer_name"),
      rs.getString("customer_phone"),
      rs.getObject("vehicle_public_id", UUID.class),
      rs.getString("model_name"),
      rs.getString("variant_name"),
      rs.getString("colour_name"),
      rs.getString("chassis_number"),
      rs.getString("engine_number"),
      rs.getTimestamp("scheduled_for").toInstant(),
      rs.getInt("slot_minutes"),
      rs.getString("customer_concern"),
      rs.getString("customer_language"),
      rs.getString("source"),
      rs.getString("status"),
      rs.getString("status_reason"),
      rs.getString("requested_by_name"),
      instantOrNull(rs.getTimestamp("checked_in_at")),
      rs.getTimestamp("created_at").toInstant(),
      rs.getTimestamp("updated_at").toInstant());

  private static final RowMapper<JobCardView> JOB_CARD_ROW = (rs, rowNum) -> new JobCardView(
      rs.getObject("public_id", UUID.class),
      rs.getString("job_card_code"),
      rs.getObject("appointment_public_id", UUID.class),
      rs.getString("appointment_code"),
      rs.getObject("customer_public_id", UUID.class),
      rs.getString("customer_name"),
      rs.getString("customer_phone"),
      rs.getObject("vehicle_public_id", UUID.class),
      rs.getString("model_name"),
      rs.getString("variant_name"),
      rs.getString("colour_name"),
      rs.getString("chassis_number"),
      rs.getString("engine_number"),
      rs.getString("status"),
      rs.getString("customer_concern"),
      (Integer) rs.getObject("odometer_km"),
      (Integer) rs.getObject("fuel_level_percent"),
      rs.getString("checkin_notes"),
      rs.getTimestamp("checked_in_at").toInstant(),
      instantOrNull(rs.getTimestamp("completed_at")),
      instantOrNull(rs.getTimestamp("delivered_at")),
      rs.getInt("inspection_count"),
      rs.getInt("pending_inspection_count"),
      rs.getTimestamp("created_at").toInstant(),
      rs.getTimestamp("updated_at").toInstant());

  private static final RowMapper<InspectionItemView> INSPECTION_ROW = (rs, rowNum) -> new InspectionItemView(
      rs.getObject("public_id", UUID.class),
      rs.getString("checklist_code"),
      rs.getString("label"),
      rs.getString("status"),
      rs.getString("notes"),
      rs.getString("checked_by_name"),
      instantOrNull(rs.getTimestamp("checked_at")),
      rs.getTimestamp("updated_at").toInstant());

  private static final RowMapper<AssignmentView> ASSIGNMENT_ROW = (rs, rowNum) -> new AssignmentView(
      rs.getObject("public_id", UUID.class),
      rs.getString("assignment_role"),
      rs.getObject("staff_public_id", UUID.class),
      rs.getString("staff_name"),
      rs.getString("staff_status"),
      rs.getTimestamp("assigned_at").toInstant(),
      instantOrNull(rs.getTimestamp("unassigned_at")),
      rs.getString("note"));

  private static final String APPOINTMENT_SELECT = """
      select a.public_id, a.appointment_code,
        c.public_id as customer_public_id, c.full_name as customer_name, c.phone as customer_phone,
        vu.public_id as vehicle_public_id, vm.model_name, vm.variant_name, vm.colour_name,
        vu.chassis_number, vu.engine_number, a.scheduled_for, a.slot_minutes, a.customer_concern,
        a.customer_language, a.source, a.status, a.status_reason, requester.full_name as requested_by_name,
        a.checked_in_at, a.created_at, a.updated_at
      from service_appointment a
      join customer c on c.dealership_id = a.dealership_id and c.id = a.customer_id
      join vehicle_unit vu on vu.dealership_id = a.dealership_id and vu.id = a.vehicle_unit_id
      join vehicle_model vm on vm.dealership_id = vu.dealership_id and vm.id = vu.vehicle_model_id
      left join staff_user requester on requester.dealership_id = a.dealership_id
        and requester.id = a.requested_by_staff_user_id
      """;

  private static final String JOB_CARD_SELECT = """
      select jc.public_id, jc.job_card_code, a.public_id as appointment_public_id,
        a.appointment_code, c.public_id as customer_public_id, c.full_name as customer_name,
        c.phone as customer_phone, vu.public_id as vehicle_public_id, vm.model_name,
        vm.variant_name, vm.colour_name, vu.chassis_number, vu.engine_number, jc.status,
        jc.customer_concern, jc.odometer_km, jc.fuel_level_percent, jc.checkin_notes,
        jc.checked_in_at, jc.completed_at, jc.delivered_at,
        (select count(*) from service_inspection_item si
          where si.dealership_id = jc.dealership_id and si.job_card_id = jc.id) as inspection_count,
        (select count(*) from service_inspection_item si
          where si.dealership_id = jc.dealership_id and si.job_card_id = jc.id
            and si.status = 'PENDING') as pending_inspection_count,
        jc.created_at, jc.updated_at
      from service_job_card jc
      join customer c on c.dealership_id = jc.dealership_id and c.id = jc.customer_id
      join vehicle_unit vu on vu.dealership_id = jc.dealership_id and vu.id = jc.vehicle_unit_id
      join vehicle_model vm on vm.dealership_id = vu.dealership_id and vm.id = vu.vehicle_model_id
      left join service_appointment a on a.dealership_id = jc.dealership_id and a.id = jc.appointment_id
      """;

  private final JdbcTemplate jdbc;

  public ServiceOperationsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public List<WorkshopCustomerOption> listCustomerOptions(StaffPrincipal actor, String query) {
    String term = cleanSearch(query);
    String where = "";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      String phoneLike = "%" + escapeLike(term) + "%";
      where = """
          and (lower(c.full_name) like ? escape '!'
            or lower(c.customer_code) like ? escape '!'
            or coalesce(c.phone, '') like ? escape '!'
            or lower(coalesce(c.email, '')) like ? escape '!')
          """;
      args.add(like);
      args.add(like);
      args.add(phoneLike);
      args.add(like);
    }
    args.add(50);
    return jdbc.query("""
        select c.public_id, c.full_name, c.phone,
          count(cv.vehicle_unit_id)::int as current_vehicle_count
        from customer c
        join customer_vehicle cv on cv.dealership_id = c.dealership_id
          and cv.customer_id = c.id and cv.ownership_ended_at is null
        where c.dealership_id = ? and c.status = 'ACTIVE'
        """ + where + """
        group by c.id
        order by lower(c.full_name), c.id
        limit ?
        """,
        (rs, rowNum) -> new WorkshopCustomerOption(
            rs.getObject("public_id", UUID.class), rs.getString("full_name"),
            rs.getString("phone"), rs.getInt("current_vehicle_count")),
        args.toArray());
  }

  public List<WorkshopVehicleOption> listCustomerVehicles(StaffPrincipal actor, UUID customerPublicId) {
    List<Long> customerIds = jdbc.query("""
        select id from customer
        where dealership_id = ? and public_id = ? and status = 'ACTIVE'
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), customerPublicId);
    if (customerIds.isEmpty()) throw notFound("Active customer was not found in this dealership.");
    return jdbc.query("""
        select vu.public_id, vm.model_name, vm.variant_name, vm.colour_name,
          vu.chassis_number, vu.engine_number, vu.stock_status
        from customer_vehicle cv
        join vehicle_unit vu on vu.dealership_id = cv.dealership_id and vu.id = cv.vehicle_unit_id
        join vehicle_model vm on vm.dealership_id = vu.dealership_id and vm.id = vu.vehicle_model_id
        where cv.dealership_id = ? and cv.customer_id = ? and cv.ownership_ended_at is null
        order by lower(vm.model_name), vu.chassis_number
        """, (rs, rowNum) -> new WorkshopVehicleOption(
            rs.getObject("public_id", UUID.class), rs.getString("model_name"),
            rs.getString("variant_name"), rs.getString("colour_name"),
            rs.getString("chassis_number"), rs.getString("engine_number"), rs.getString("stock_status")),
        actor.dealershipId(), customerIds.getFirst());
  }

  public List<StaffOption> listAssignableStaff(StaffPrincipal actor, String assignmentRole, String query) {
    String role = assignmentRole == null ? "" : assignmentRole.trim().toUpperCase(Locale.ROOT);
    if (!List.of("SERVICE_ADVISOR", "TECHNICIAN", "QUALITY_INSPECTOR").contains(role)) {
      throw badRequest("Choose a supported assignment role.");
    }
    String roleFilter = switch (role) {
      case "TECHNICIAN" -> "('MECHANIC', 'OWNER', 'MANAGER')";
      case "SERVICE_ADVISOR" -> "('SERVICE_ADVISOR', 'OWNER', 'MANAGER')";
      case "QUALITY_INSPECTOR" -> "('SERVICE_ADVISOR', 'OWNER', 'MANAGER')";
      default -> throw badRequest("Choose a supported assignment role.");
    };
    String term = cleanSearch(query);
    String where = "";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      where = " and (lower(u.full_name) like ? escape '!' or lower(coalesce(u.email,'')) like ? escape '!') ";
      args.add(like);
      args.add(like);
    }
    args.add(50);
    String sql = """
        select u.public_id, u.full_name, u.status
        from staff_user u
        where u.dealership_id = ? and u.status = 'ACTIVE'
          and exists (
            select 1 from staff_user_role ur join role r on r.id = ur.role_id
            where ur.dealership_id = u.dealership_id and ur.staff_user_id = u.id
              and r.code in """ + roleFilter + """
          )
        """ + where + " order by lower(u.full_name), u.id limit ?";
    return jdbc.query(sql,
        (rs, rowNum) -> new StaffOption(
            rs.getObject("public_id", UUID.class), rs.getString("full_name"),
            rs.getString("status"), role),
        args.toArray());
  }

  public Page<AppointmentView> listAppointments(
      StaffPrincipal actor, int requestedPage, int requestedSize, String status, String query) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    String normalizedStatus = normalizeOptionalStatus(status, APPOINTMENT_STATUSES, "appointment");
    String term = cleanSearch(query);
    String where = " where a.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (normalizedStatus != null) {
      where += " and a.status = ? ";
      args.add(normalizedStatus);
    }
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      String serial = "%" + escapeLike(term) + "%";
      where += """
          and (
            lower(c.full_name) like ? escape '!'
            or coalesce(c.phone, '') like ? escape '!'
            or lower(a.appointment_code) like ? escape '!'
            or lower(vu.chassis_number) like ? escape '!'
            or lower(vu.engine_number) like ? escape '!'
          )
          """;
      args.add(like);
      args.add(serial);
      args.add(like);
      args.add(like);
      args.add(like);
    }

    Long totalValue = jdbc.queryForObject("""
        select count(*)
        from service_appointment a
        join customer c on c.dealership_id = a.dealership_id and c.id = a.customer_id
        join vehicle_unit vu on vu.dealership_id = a.dealership_id and vu.id = a.vehicle_unit_id
        """ + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(window.size());
    args.add(window.offset());
    List<AppointmentView> items = jdbc.query(
        APPOINTMENT_SELECT + where + " order by a.scheduled_for asc, a.id desc limit ? offset ?",
        APPOINTMENT_ROW, args.toArray());
    return new Page<>(items, window.page(), window.size(), total);
  }

  public AppointmentView getAppointment(StaffPrincipal actor, UUID publicId) {
    List<AppointmentView> rows = jdbc.query(
        APPOINTMENT_SELECT + " where a.dealership_id = ? and a.public_id = ?",
        APPOINTMENT_ROW, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Service appointment was not found.");
    return rows.getFirst();
  }

  @Transactional
  public AppointmentView createAppointment(StaffPrincipal actor, AppointmentRequest request) {
    if (request.customerPublicId() == null || request.vehiclePublicId() == null) {
      throw badRequest("Choose a customer and a vehicle.");
    }
    if (request.scheduledFor() == null) throw badRequest("Appointment date and time are required.");
    String concern = requiredText(request.customerConcern(), "Customer concern", 3000);
    String language = normalizeLanguage(request.customerLanguage());
    String source = request.source() == null ? "STAFF" : request.source().trim().toUpperCase(Locale.ROOT);
    if (!SOURCES.contains(source)) throw badRequest("Appointment source is not supported.");
    int slotMinutes = request.slotMinutes() == null ? 60 : request.slotMinutes();
    if (slotMinutes < 15 || slotMinutes > 480) throw badRequest("Appointment duration must be 15 to 480 minutes.");
    String staffNotes = optionalText(request.staffNotes(), 3000);

    Ownership ownership = requireCurrentOwnership(actor, request.customerPublicId(), request.vehiclePublicId());
    String appointmentCode = "APT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID publicId;
    try {
      publicId = jdbc.queryForObject("""
          insert into service_appointment(
            dealership_id, appointment_code, customer_id, vehicle_unit_id, scheduled_for,
            slot_minutes, customer_concern, customer_language, source, status,
            staff_notes, requested_by_staff_user_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)
          returning public_id
          """, UUID.class,
          actor.dealershipId(), appointmentCode, ownership.customerId(), ownership.vehicleUnitId(),
          Timestamp.from(request.scheduledFor()), slotMinutes, concern, language, source,
          staffNotes, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "Appointment was not saved because its reference conflicted. Please retry.", duplicate);
    }

    long appointmentId = jdbc.queryForObject(
        "select id from service_appointment where dealership_id = ? and public_id = ?",
        Long.class, actor.dealershipId(), publicId);
    appointmentTransition(actor, appointmentId, null, "REQUESTED", "APPOINTMENT_CREATED", null);
    audit(actor, "SERVICE_APPOINTMENT_CREATED", "SERVICE_APPOINTMENT", publicId.toString(),
        "A service appointment was created.");
    return getAppointment(actor, publicId);
  }

  @Transactional
  public AppointmentView confirmAppointment(StaffPrincipal actor, UUID publicId, String note) {
    AppointmentLock appointment = lockAppointment(actor, publicId);
    if ("CONFIRMED".equals(appointment.status())) return getAppointment(actor, publicId);
    if (!"REQUESTED".equals(appointment.status())) {
      throw conflict("Only a requested appointment can be confirmed.");
    }
    int changed = jdbc.update("""
        update service_appointment
        set status = 'CONFIRMED', confirmed_by_staff_user_id = ?, status_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'REQUESTED'
        """, actor.staffUserId(), optionalText(note, 500), actor.dealershipId(), appointment.id());
    if (changed != 1) throw conflict("Appointment status changed. Refresh and try again.");
    appointmentTransition(actor, appointment.id(), appointment.status(), "CONFIRMED", "APPOINTMENT_CONFIRMED", note);
    audit(actor, "SERVICE_APPOINTMENT_CONFIRMED", "SERVICE_APPOINTMENT", publicId.toString(),
        "The service appointment was confirmed.");
    return getAppointment(actor, publicId);
  }

  @Transactional
  public AppointmentView cancelAppointment(StaffPrincipal actor, UUID publicId, String reason) {
    AppointmentLock appointment = lockAppointment(actor, publicId);
    if ("CANCELLED".equals(appointment.status())) return getAppointment(actor, publicId);
    if (!List.of("REQUESTED", "CONFIRMED").contains(appointment.status())) {
      throw conflict("This appointment can no longer be cancelled from the appointment queue.");
    }
    String safeReason = requiredText(reason, "Cancellation reason", 500);
    int changed = jdbc.update("""
        update service_appointment
        set status = 'CANCELLED', cancelled_by_staff_user_id = ?, status_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status in ('REQUESTED', 'CONFIRMED')
        """, actor.staffUserId(), safeReason, actor.dealershipId(), appointment.id());
    if (changed != 1) throw conflict("Appointment status changed. Refresh and try again.");
    appointmentTransition(actor, appointment.id(), appointment.status(), "CANCELLED", "APPOINTMENT_CANCELLED", safeReason);
    audit(actor, "SERVICE_APPOINTMENT_CANCELLED", "SERVICE_APPOINTMENT", publicId.toString(),
        "The service appointment was cancelled with a recorded reason.");
    return getAppointment(actor, publicId);
  }

  @Transactional
  public JobCardView checkInAppointment(StaffPrincipal actor, UUID publicId, CheckInRequest request) {
    AppointmentLock appointment = lockAppointment(actor, publicId);
    if ("CHECKED_IN".equals(appointment.status())) {
      return getJobCardForAppointment(actor, appointment.id());
    }
    if (!List.of("REQUESTED", "CONFIRMED").contains(appointment.status())) {
      throw conflict("Only a requested or confirmed appointment can be checked in.");
    }

    verifyCurrentOwnershipByIds(actor, appointment.customerId(), appointment.vehicleUnitId());
    Integer odometer = request == null ? null : request.odometerKm();
    Integer fuelLevel = request == null ? null : request.fuelLevelPercent();
    String notes = request == null ? null : optionalText(request.checkinNotes(), 3000);
    if (odometer != null && odometer < 0) throw badRequest("Odometer must be zero or greater.");
    if (fuelLevel != null && (fuelLevel < 0 || fuelLevel > 100)) {
      throw badRequest("Fuel level must be between 0 and 100 percent.");
    }

    String jobCode = "JC-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID jobPublicId = jdbc.queryForObject("""
        insert into service_job_card(
          dealership_id, job_card_code, appointment_id, customer_id, vehicle_unit_id,
          status, customer_concern, odometer_km, fuel_level_percent, checkin_notes, checked_in_by_staff_user_id)
        values (?, ?, ?, ?, ?, 'INSPECTING', ?, ?, ?, ?, ?)
        returning public_id
        """, UUID.class,
        actor.dealershipId(), jobCode, appointment.id(), appointment.customerId(),
        appointment.vehicleUnitId(), appointment.customerConcern(), odometer, fuelLevel, notes, actor.staffUserId());
    long jobCardId = jdbc.queryForObject(
        "select id from service_job_card where dealership_id = ? and public_id = ?",
        Long.class, actor.dealershipId(), jobPublicId);

    int changed = jdbc.update("""
        update service_appointment
        set status = 'CHECKED_IN', checked_in_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status in ('REQUESTED', 'CONFIRMED')
        """, actor.dealershipId(), appointment.id());
    if (changed != 1) throw conflict("Appointment status changed while checking in. Refresh and try again.");

    appointmentTransition(actor, appointment.id(), appointment.status(), "CHECKED_IN", "APPOINTMENT_CHECKED_IN",
        "Job card " + jobCode + " created.");
    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason, request_key, details)
        values (?, ?, null, 'INSPECTING', 'JOB_CARD_CREATED', ?, ?, ?, jsonb_build_object('appointmentCode', ?))
        """, actor.dealershipId(), jobCardId, actor.staffUserId(),
        "Vehicle checked into workshop.", "checkin:" + appointment.id(), appointment.appointmentCode());

    createDefaultInspection(actor, jobCardId);
    audit(actor, "SERVICE_JOB_CARD_CREATED", "SERVICE_JOB_CARD", jobPublicId.toString(),
        "Workshop check-in created job card " + jobCode + ".");
    audit(actor, "SERVICE_APPOINTMENT_CHECKED_IN", "SERVICE_APPOINTMENT", publicId.toString(),
        "Vehicle check-in recorded and linked to its job card.");
    return getJobCard(actor, jobPublicId);
  }

  public Page<JobCardView> listJobCards(
      StaffPrincipal actor, int requestedPage, int requestedSize, String status, String query) {
    PageWindow window = pageWindow(requestedPage, requestedSize);
    String normalizedStatus = normalizeOptionalStatus(status, JOB_CARD_STATUSES, "job card");
    String term = cleanSearch(query);
    String where = " where jc.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (normalizedStatus != null) {
      where += " and jc.status = ? ";
      args.add(normalizedStatus);
    }
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      String serial = "%" + escapeLike(term) + "%";
      where += """
          and (
            lower(jc.job_card_code) like ? escape '!'
            or lower(c.full_name) like ? escape '!'
            or coalesce(c.phone, '') like ? escape '!'
            or lower(vu.chassis_number) like ? escape '!'
            or lower(vu.engine_number) like ? escape '!'
          )
          """;
      args.add(like);
      args.add(like);
      args.add(serial);
      args.add(like);
      args.add(like);
    }
    Long totalValue = jdbc.queryForObject("""
        select count(*) from service_job_card jc
        join customer c on c.dealership_id=jc.dealership_id and c.id=jc.customer_id
        join vehicle_unit vu on vu.dealership_id=jc.dealership_id and vu.id=jc.vehicle_unit_id
        """ + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(window.size());
    args.add(window.offset());
    List<JobCardView> items = jdbc.query(
        JOB_CARD_SELECT + where + " order by jc.checked_in_at desc, jc.id desc limit ? offset ?",
        JOB_CARD_ROW, args.toArray());
    return new Page<>(items, window.page(), window.size(), total);
  }

  public JobCardView getJobCard(StaffPrincipal actor, UUID publicId) {
    List<JobCardView> rows = jdbc.query(
        JOB_CARD_SELECT + " where jc.dealership_id = ? and jc.public_id = ?",
        JOB_CARD_ROW, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Workshop job card was not found.");
    return rows.getFirst();
  }

  public List<InspectionItemView> listInspectionItems(StaffPrincipal actor, UUID jobCardPublicId) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    return jdbc.query("""
        select item.public_id, item.checklist_code, item.label, item.status, item.notes,
          checker.full_name as checked_by_name, item.checked_at, item.updated_at
        from service_inspection_item item
        left join staff_user checker on checker.dealership_id=item.dealership_id and checker.id=item.checked_by_staff_user_id
        where item.dealership_id = ? and item.job_card_id = ?
        order by item.id
        """, INSPECTION_ROW, actor.dealershipId(), jobCardId);
  }

  @Transactional
  public InspectionItemView updateInspectionItem(
      StaffPrincipal actor, UUID jobCardPublicId, UUID itemPublicId, InspectionUpdate request) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<Map<String, Object>> cards = jdbc.queryForList("""
        select status from service_job_card where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (cards.isEmpty()) throw notFound("Workshop job card was not found.");
    if (!"INSPECTING".equals(String.valueOf(cards.getFirst().get("status")))) {
      throw conflict("Inspection items can only be updated while the job card is in inspection.");
    }
    String status = request.status() == null ? "" : request.status().trim().toUpperCase(Locale.ROOT);
    if (!List.of("PENDING", "OK", "ATTENTION", "NOT_APPLICABLE").contains(status)) {
      throw badRequest("Inspection result must be Pending, OK, Attention or Not applicable.");
    }
    String notes = optionalText(request.notes(), 1000);
    int changed = jdbc.update("""
        update service_inspection_item
        set status = ?, notes = ?, checked_by_staff_user_id = case when ? = 'PENDING' then null else ? end,
            checked_at = case when ? = 'PENDING' then null else now() end, updated_at = now()
        where dealership_id = ? and job_card_id = ? and public_id = ?
        """, status, notes, status, actor.staffUserId(), status,
        actor.dealershipId(), jobCardId, itemPublicId);
    if (changed == 0) throw notFound("Inspection item was not found on this job card.");
    audit(actor, "SERVICE_INSPECTION_ITEM_UPDATED", "SERVICE_JOB_CARD", jobCardPublicId.toString(),
        "Inspection checklist item was updated to " + status + ".");
    return listInspectionItems(actor, jobCardPublicId).stream()
        .filter(item -> item.publicId().equals(itemPublicId))
        .findFirst().orElseThrow(() -> notFound("Inspection item was not found on this job card."));
  }

  @Transactional
  public JobCardView completeInspection(StaffPrincipal actor, UUID jobCardPublicId, String note) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<Map<String, Object>> cards = jdbc.queryForList("""
        select status from service_job_card where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (cards.isEmpty()) throw notFound("Workshop job card was not found.");
    String currentStatus = String.valueOf(cards.getFirst().get("status"));
    if ("ESTIMATE_PENDING".equals(currentStatus)) return getJobCard(actor, jobCardPublicId);
    if (!"INSPECTING".equals(currentStatus)) throw conflict("This job card is not in inspection.");

    Long itemCount = jdbc.queryForObject("""
        select count(*) from service_inspection_item
        where dealership_id = ? and job_card_id = ?
        """, Long.class, actor.dealershipId(), jobCardId);
    Long pendingCount = jdbc.queryForObject("""
        select count(*) from service_inspection_item
        where dealership_id = ? and job_card_id = ? and status = 'PENDING'
        """, Long.class, actor.dealershipId(), jobCardId);
    if (itemCount == null || itemCount == 0 || pendingCount == null || pendingCount > 0) {
      throw conflict("Complete every inspection checklist item before finishing inspection.");
    }

    int changed = jdbc.update("""
        update service_job_card set status = 'ESTIMATE_PENDING', updated_at = now()
        where dealership_id = ? and id = ? and status = 'INSPECTING'
        """, actor.dealershipId(), jobCardId);
    if (changed != 1) throw conflict("Job card changed while completing inspection. Refresh and retry.");
    String reason = optionalText(note, 500);
    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason, details)
        values (?, ?, 'INSPECTING', 'ESTIMATE_PENDING', 'INSPECTION_COMPLETED', ?, ?, jsonb_build_object('inspectionItemCount', ?))
        """, actor.dealershipId(), jobCardId, actor.staffUserId(), reason, itemCount);
    audit(actor, "SERVICE_INSPECTION_COMPLETED", "SERVICE_JOB_CARD", jobCardPublicId.toString(),
        "Inspection checklist completed; job card is awaiting an estimate.");
    return getJobCard(actor, jobCardPublicId);
  }

  @Transactional
  public EstimateView createEstimate(StaffPrincipal actor, UUID jobCardPublicId, EstimateRequest request) {
    if (request.lines() == null || request.lines().isEmpty() || request.lines().size() > 100) {
      throw badRequest("An estimate must contain between 1 and 100 line items.");
    }
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<Map<String, Object>> cardRows = jdbc.queryForList("""
        select status, job_card_code from service_job_card
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (cardRows.isEmpty()) throw notFound("Workshop job card was not found.");
    String sourceJobStatus = String.valueOf(cardRows.getFirst().get("status"));
    if (!List.of("ESTIMATE_PENDING", "APPROVED", "IN_PROGRESS").contains(sourceJobStatus)) {
      throw conflict("An estimate revision can only be created before a job is closed or while work is paused for an estimate.");
    }

    Integer previousRevision = jdbc.queryForObject("""
        select coalesce(max(revision), 0) from service_estimate
        where dealership_id = ? and job_card_id = ?
        """, Integer.class, actor.dealershipId(), jobCardId);
    int revision = (previousRevision == null ? 0 : previousRevision) + 1;

    BigDecimal parts = BigDecimal.ZERO.setScale(2);
    BigDecimal labour = BigDecimal.ZERO.setScale(2);
    BigDecimal other = BigDecimal.ZERO.setScale(2);
    BigDecimal maxMoney = new BigDecimal("999999999999.99");
    List<NormalizedEstimateLine> normalizedLines = new ArrayList<>();
    Set<UUID> selectedReservations = new LinkedHashSet<>();

    for (EstimateLineInput line : request.lines()) {
      if (line == null) throw badRequest("Estimate line items cannot be empty.");
      String lineType = line.lineType() == null ? "" : line.lineType().trim().toUpperCase(Locale.ROOT);
      if (!List.of("PART", "LABOUR", "OTHER").contains(lineType)) {
        throw badRequest("Estimate line type must be PART, LABOUR or OTHER.");
      }
      String description = requiredText(line.description(), "Estimate line description", 300);
      BigDecimal quantity = line.quantity();
      BigDecimal unitPrice = line.unitPrice();
      if (quantity == null || quantity.signum() <= 0 || quantity.compareTo(new BigDecimal("1000000")) > 0) {
        throw badRequest("Estimate quantity must be greater than zero and within the supported range.");
      }
      if (unitPrice == null || unitPrice.signum() < 0
          || unitPrice.compareTo(new BigDecimal("100000000")) > 0) {
        throw badRequest("Unit price must be non-negative and within the supported range.");
      }

      BigDecimal safeQuantity = quantity.setScale(3, RoundingMode.HALF_UP);
      BigDecimal safeUnitPrice = unitPrice.setScale(2, RoundingMode.HALF_UP);
      PartEstimateSnapshot sourceSnapshot = null;
      if (line.reservationPublicId() != null) {
        if (!"PART".equals(lineType)) {
          throw badRequest("Only a PART estimate line can be linked to a job-card part reservation.");
        }
        if (!selectedReservations.add(line.reservationPublicId())) {
          throw badRequest("A part reservation may be included only once in each estimate revision.");
        }
        sourceSnapshot = lockPartEstimateSnapshot(actor, jobCardId, line.reservationPublicId());
        BigDecimal expectedQuantity = sourceSnapshot.quantityReserved()
            .subtract(sourceSnapshot.quantityReturned()).subtract(sourceSnapshot.quantityReleased())
            .setScale(3, RoundingMode.HALF_UP);
        if (expectedQuantity.signum() <= 0) {
          throw conflict("This reservation has no planned or unreturned quantity to include in an estimate.");
        }
        if (safeQuantity.compareTo(expectedQuantity) != 0) {
          throw conflict("Reserved/returned part quantity changed. Refresh the job-card part list before creating a revision.");
        }
        if (!description.equals(sourceSnapshot.skuCode() + " — " + sourceSnapshot.partName())) {
          throw conflict("Part description changed from the selected reservation. Refresh and select the reservation again.");
        }
      }

      BigDecimal lineTotal = safeQuantity.multiply(safeUnitPrice).setScale(2, RoundingMode.HALF_UP);
      if (lineTotal.compareTo(maxMoney) > 0) {
        throw badRequest("An estimate line total exceeds the supported monetary range.");
      }
      if ("PART".equals(lineType)) parts = parts.add(lineTotal);
      else if ("LABOUR".equals(lineType)) labour = labour.add(lineTotal);
      else other = other.add(lineTotal);
      if (parts.compareTo(maxMoney) > 0 || labour.compareTo(maxMoney) > 0 || other.compareTo(maxMoney) > 0) {
        throw badRequest("The estimate subtotal exceeds the supported monetary range.");
      }
      normalizedLines.add(new NormalizedEstimateLine(
          lineType, description, safeQuantity, safeUnitPrice, sourceSnapshot));
    }

    parts = parts.setScale(2, RoundingMode.HALF_UP);
    labour = labour.setScale(2, RoundingMode.HALF_UP);
    other = other.setScale(2, RoundingMode.HALF_UP);
    BigDecimal subtotal = parts.add(labour).add(other);
    BigDecimal discount = request.discountAmount() == null
        ? BigDecimal.ZERO.setScale(2) : request.discountAmount().setScale(2, RoundingMode.HALF_UP);
    if (discount.signum() < 0 || discount.compareTo(subtotal) > 0) {
      throw badRequest("Discount must be non-negative and cannot exceed the estimate subtotal.");
    }
    BigDecimal estimatedTotal = subtotal.subtract(discount).setScale(2, RoundingMode.HALF_UP);
    String customerMessage = optionalText(request.customerMessage(), 2000);

    UUID estimatePublicId = jdbc.queryForObject("""
        insert into service_estimate(
          dealership_id, job_card_id, revision, status, parts_subtotal, labour_subtotal,
          other_subtotal, discount_amount, estimated_total, customer_message,
          created_by_staff_user_id, submitted_at, source_job_status)
        values (?, ?, ?, 'AWAITING_CUSTOMER', ?, ?, ?, ?, ?, ?, ?, now(), ?)
        returning public_id
        """, UUID.class, actor.dealershipId(), jobCardId, revision,
        parts, labour, other, discount, estimatedTotal, customerMessage, actor.staffUserId(), sourceJobStatus);
    long estimateId = jdbc.queryForObject("""
        select id from service_estimate where dealership_id = ? and public_id = ?
        """, Long.class, actor.dealershipId(), estimatePublicId);

    int lineNumber = 0;
    for (NormalizedEstimateLine line : normalizedLines) {
      lineNumber++;
      BigDecimal lineTotal = line.quantity().multiply(line.unitPrice()).setScale(2, RoundingMode.HALF_UP);
      PartEstimateSnapshot source = line.sourceSnapshot();
      jdbc.update("""
          insert into service_estimate_line(
            dealership_id, estimate_id, line_number, line_type, description, quantity, unit_price, line_total,
            source_reservation_id, source_quantity_reserved, source_quantity_issued,
            source_quantity_returned, source_quantity_released, source_unit_cost_snapshot, source_snapshot_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, actor.dealershipId(), estimateId, lineNumber, line.lineType(), line.description(),
          line.quantity(), line.unitPrice(), lineTotal,
          source == null ? null : source.id(),
          source == null ? null : source.quantityReserved(),
          source == null ? null : source.quantityIssued(),
          source == null ? null : source.quantityReturned(),
          source == null ? null : source.quantityReleased(),
          source == null ? null : source.unitCostSnapshot(),
          source == null ? null : Timestamp.from(Instant.now()));
    }

    int changed = jdbc.update("""
        update service_job_card set status = 'AWAITING_APPROVAL', updated_at = now()
        where dealership_id = ? and id = ? and status = ?
        """, actor.dealershipId(), jobCardId, sourceJobStatus);
    if (changed != 1) throw conflict("Job-card status changed while the estimate revision was being created.");

    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason, details)
        values (?, ?, ?, 'AWAITING_APPROVAL', 'ESTIMATE_SUBMITTED', ?, ?,
          jsonb_build_object('estimateRevision', ?, 'estimatedTotal', ?::numeric, 'lineCount', ?,
            'sourceJobStatus', ?))
        """, actor.dealershipId(), jobCardId, sourceJobStatus, actor.staffUserId(),
        "Estimate revision " + revision + " submitted for customer decision.",
        revision, estimatedTotal, normalizedLines.size(), sourceJobStatus);
    audit(actor, "SERVICE_ESTIMATE_SUBMITTED", "SERVICE_ESTIMATE", estimatePublicId.toString(),
        "Estimate revision " + revision + " submitted for customer decision from job state " + sourceJobStatus
            + "; linked part reservations preserve issued/returned/released and unit-cost snapshots.");
    return getEstimate(actor, jobCardPublicId, estimatePublicId);
  }

  private PartEstimateSnapshot lockPartEstimateSnapshot(
      StaffPrincipal actor, long jobCardId, UUID reservationPublicId) {
    List<PartEstimateSnapshot> rows = jdbc.query("""
        select reservation.id, reservation.public_id, reservation.reservation_code,
          part.sku_code, part.part_name, reservation.quantity_reserved, reservation.quantity_issued,
          reservation.quantity_returned, reservation.quantity_released, reservation.unit_cost_snapshot,
          reservation.status
        from service_job_part_reservation reservation
        join spare_part part on part.dealership_id = reservation.dealership_id and part.id = reservation.part_id
        where reservation.dealership_id = ? and reservation.job_card_id = ?
          and reservation.public_id = ?
        for update of reservation
        """, (rs, rowNum) -> new PartEstimateSnapshot(
            rs.getLong("id"), rs.getObject("public_id", UUID.class), rs.getString("reservation_code"),
            rs.getString("sku_code"), rs.getString("part_name"), rs.getBigDecimal("quantity_reserved"),
            rs.getBigDecimal("quantity_issued"), rs.getBigDecimal("quantity_returned"),
            rs.getBigDecimal("quantity_released"), rs.getBigDecimal("unit_cost_snapshot"),
            rs.getString("status")),
        actor.dealershipId(), jobCardId, reservationPublicId);
    if (rows.isEmpty()) {
      throw notFound("The selected part reservation was not found on this job card.");
    }
    return rows.getFirst();
  }

  public List<EstimateView> listEstimates(StaffPrincipal actor, UUID jobCardPublicId) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<UUID> ids = jdbc.query("""
        select public_id from service_estimate
        where dealership_id = ? and job_card_id = ?
        order by revision desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), jobCardId);
    return ids.stream().map(id -> getEstimate(actor, jobCardPublicId, id)).toList();
  }

  public EstimateView getEstimate(StaffPrincipal actor, UUID jobCardPublicId, UUID estimatePublicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select estimate.id, estimate.public_id, estimate.revision, estimate.status,
          estimate.parts_subtotal, estimate.labour_subtotal, estimate.other_subtotal,
          estimate.discount_amount, estimate.estimated_total, estimate.customer_message,
          estimate.submitted_at, estimate.decided_at, estimate.created_at,
          creator.full_name as creator_name, jc.public_id as job_card_public_id, jc.job_card_code
        from service_estimate estimate
        join service_job_card jc on jc.dealership_id = estimate.dealership_id and jc.id = estimate.job_card_id
        join staff_user creator on creator.dealership_id = estimate.dealership_id
          and creator.id = estimate.created_by_staff_user_id
        where estimate.dealership_id = ? and jc.public_id = ? and estimate.public_id = ?
        """, actor.dealershipId(), jobCardPublicId, estimatePublicId);
    if (rows.isEmpty()) throw notFound("Service estimate was not found for this job card.");
    Map<String, Object> row = rows.getFirst();
    long estimateId = ((Number) row.get("id")).longValue();
    List<EstimateLineView> lines = jdbc.query("""
        select line.line_number, line.line_type, line.description, line.quantity, line.unit_price, line.line_total,
          reservation.public_id as source_reservation_public_id,
          reservation.reservation_code as source_reservation_code,
          line.source_quantity_reserved, line.source_quantity_issued, line.source_quantity_returned,
          line.source_quantity_released, line.source_unit_cost_snapshot, line.source_snapshot_at
        from service_estimate_line line
        left join service_job_part_reservation reservation
          on reservation.dealership_id = line.dealership_id and reservation.id = line.source_reservation_id
        where line.dealership_id = ? and line.estimate_id = ?
        order by line.line_number
        """, (rs, rowNum) -> new EstimateLineView(
            rs.getInt("line_number"), rs.getString("line_type"), rs.getString("description"),
            rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_price"), rs.getBigDecimal("line_total"),
            (UUID) rs.getObject("source_reservation_public_id"), rs.getString("source_reservation_code"),
            rs.getBigDecimal("source_quantity_reserved"), rs.getBigDecimal("source_quantity_issued"),
            rs.getBigDecimal("source_quantity_returned"), rs.getBigDecimal("source_quantity_released"),
            rs.getBigDecimal("source_unit_cost_snapshot"), instantOrNull(rs.getTimestamp("source_snapshot_at"))),
        actor.dealershipId(), estimateId);
    List<EstimateDecisionView> decisions = jdbc.query("""
        select decision.decision, decision.evidence_method, decision.evidence_reference, decision.note,
          staff.full_name as recorded_by_name, decision.recorded_at
        from service_estimate_decision decision
        join staff_user staff on staff.dealership_id = decision.dealership_id
          and staff.id = decision.recorded_by_staff_user_id
        where decision.dealership_id = ? and decision.estimate_id = ?
        order by decision.recorded_at desc, decision.id desc
        """, (rs, rowNum) -> new EstimateDecisionView(
            rs.getString("decision"), rs.getString("evidence_method"), rs.getString("evidence_reference"),
            rs.getString("note"), rs.getString("recorded_by_name"), rs.getTimestamp("recorded_at").toInstant()),
        actor.dealershipId(), estimateId);
    return new EstimateView(
        (UUID) row.get("public_id"), (UUID) row.get("job_card_public_id"), String.valueOf(row.get("job_card_code")),
        ((Number) row.get("revision")).intValue(), String.valueOf(row.get("status")),
        (BigDecimal) row.get("parts_subtotal"), (BigDecimal) row.get("labour_subtotal"),
        (BigDecimal) row.get("other_subtotal"), (BigDecimal) row.get("discount_amount"),
        (BigDecimal) row.get("estimated_total"), (String) row.get("customer_message"),
        String.valueOf(row.get("creator_name")), instantOrNull((Timestamp) row.get("submitted_at")),
        instantOrNull((Timestamp) row.get("decided_at")), (Timestamp) row.get("created_at") == null
            ? null : ((Timestamp) row.get("created_at")).toInstant(), lines, decisions);
  }

  @Transactional
  public EstimateView recordEstimateDecision(
      StaffPrincipal actor, UUID jobCardPublicId, UUID estimatePublicId, EstimateDecisionRequest request) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<Map<String, Object>> cardRows = jdbc.queryForList("""
        select status from service_job_card
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (cardRows.isEmpty()) throw notFound("Workshop job card was not found.");
    String cardStatus = String.valueOf(cardRows.getFirst().get("status"));
    if (!"AWAITING_APPROVAL".equals(cardStatus)) {
      throw conflict("The job card is not awaiting a customer estimate decision.");
    }

    List<Map<String, Object>> estimateRows = jdbc.queryForList("""
        select id, status, revision, estimated_total, source_job_status
        from service_estimate
        where dealership_id = ? and job_card_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), jobCardId, estimatePublicId);
    if (estimateRows.isEmpty()) throw notFound("Service estimate was not found for this job card.");
    Map<String, Object> estimate = estimateRows.getFirst();
    if (!"AWAITING_CUSTOMER".equals(String.valueOf(estimate.get("status")))) {
      throw conflict("Only an estimate awaiting customer decision can be decided.");
    }
    String decision = request.decision() == null ? "" : request.decision().trim().toUpperCase(Locale.ROOT);
    if (!List.of("APPROVED", "DECLINED", "REVISION_REQUESTED").contains(decision)) {
      throw badRequest("Decision must be APPROVED, DECLINED or REVISION_REQUESTED.");
    }
    String evidenceMethod = request.evidenceMethod() == null ? "" : request.evidenceMethod().trim().toUpperCase(Locale.ROOT);
    if (!List.of("OTP", "SIGNED_FORM", "IN_PERSON", "PHONE_RECORD", "WRITTEN_MESSAGE").contains(evidenceMethod)) {
      throw badRequest("Choose a supported customer-decision evidence method.");
    }
    String evidenceReference = optionalText(request.evidenceReference(), 160);
    String note = optionalText(request.note(), 1000);
    if (List.of("OTP", "SIGNED_FORM").contains(evidenceMethod) && evidenceReference == null) {
      throw badRequest("An evidence reference is required for OTP or signed-form decisions.");
    }
    if (List.of("IN_PERSON", "PHONE_RECORD", "WRITTEN_MESSAGE").contains(evidenceMethod)
        && note == null && evidenceReference == null) {
      throw badRequest("Record a short note or evidence reference for this decision method.");
    }

    long estimateId = ((Number) estimate.get("id")).longValue();
    jdbc.update("""
        insert into service_estimate_decision(
          dealership_id, estimate_id, decision, evidence_method, evidence_reference, note, recorded_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), estimateId, decision, evidenceMethod, evidenceReference, note, actor.staffUserId());

    String estimateStatus = "APPROVED".equals(decision) ? "APPROVED"
        : "DECLINED".equals(decision) ? "DECLINED" : "SUPERSEDED";
    int estimateChanged = jdbc.update("""
        update service_estimate set status = ?, decided_at = now(), updated_at = now()
        where dealership_id = ? and id = ? and status = 'AWAITING_CUSTOMER'
        """, estimateStatus, actor.dealershipId(), estimateId);
    if (estimateChanged != 1) throw conflict("Estimate status changed while recording its decision.");

    String sourceJobStatus = String.valueOf(estimate.get("source_job_status"));
    String nextJobStatus = "APPROVED".equals(decision)
        ? ("ESTIMATE_PENDING".equals(sourceJobStatus) ? "APPROVED" : sourceJobStatus)
        : sourceJobStatus;
    if ("APPROVED".equals(decision)) {
      jdbc.update("""
          update service_estimate
          set status = 'SUPERSEDED', updated_at = now()
          where dealership_id = ? and job_card_id = ? and id <> ? and status = 'APPROVED'
          """, actor.dealershipId(), jobCardId, estimateId);
    }
    int cardChanged = jdbc.update("""
        update service_job_card set status = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'AWAITING_APPROVAL'
        """, nextJobStatus, actor.dealershipId(), jobCardId);
    if (cardChanged != 1) throw conflict("Job-card status changed while recording the estimate decision.");

    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason, details)
        values (?, ?, 'AWAITING_APPROVAL', ?, 'ESTIMATE_DECISION_RECORDED', ?, ?,
          jsonb_build_object('estimateRevision', ?, 'decision', ?, 'evidenceMethod', ?))
        """, actor.dealershipId(), jobCardId, nextJobStatus, actor.staffUserId(),
        note == null ? "Customer estimate decision recorded." : note,
        estimate.get("revision"), decision, evidenceMethod);
    audit(actor, "SERVICE_ESTIMATE_DECISION_RECORDED", "SERVICE_ESTIMATE", estimatePublicId.toString(),
        "Recorded customer decision " + decision + " using evidence method " + evidenceMethod
            + ". The evidence method is staff-recorded and does not itself verify an external OTP/provider.");
    return getEstimate(actor, jobCardPublicId, estimatePublicId);
  }

  @Transactional
  public JobCardView startWork(StaffPrincipal actor, UUID jobCardPublicId, String note) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select status from service_job_card where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (rows.isEmpty()) throw notFound("Workshop job card was not found.");
    String current = String.valueOf(rows.getFirst().get("status"));
    if ("IN_PROGRESS".equals(current)) return getJobCard(actor, jobCardPublicId);
    if (!"APPROVED".equals(current)) throw conflict("Only a customer-approved job card can begin work.");
    Integer technicianAssigned = jdbc.queryForObject("""
        select count(*) from service_job_assignment
        where dealership_id = ? and job_card_id = ? and assignment_role = 'TECHNICIAN'
          and unassigned_at is null
        """, Integer.class, actor.dealershipId(), jobCardId);
    if (technicianAssigned == null || technicianAssigned == 0) {
      throw conflict("Assign an active technician before starting work.");
    }
    int changed = jdbc.update("""
        update service_job_card set status = 'IN_PROGRESS', updated_at = now()
        where dealership_id = ? and id = ? and status = 'APPROVED'
        """, actor.dealershipId(), jobCardId);
    if (changed != 1) throw conflict("Job-card status changed while starting work.");
    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason)
        values (?, ?, 'APPROVED', 'IN_PROGRESS', 'WORK_STARTED', ?, ?)
        """, actor.dealershipId(), jobCardId, actor.staffUserId(), optionalText(note, 500));
    audit(actor, "SERVICE_WORK_STARTED", "SERVICE_JOB_CARD", jobCardPublicId.toString(),
        "Repair work started after customer estimate approval and technician assignment.");
    return getJobCard(actor, jobCardPublicId);
  }

  @Transactional
  public JobCardView recordQualityCheck(
      StaffPrincipal actor, UUID jobCardPublicId, QualityCheckRequest request) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select status from service_job_card where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (rows.isEmpty()) throw notFound("Workshop job card was not found.");
    String current = String.valueOf(rows.getFirst().get("status"));
    if (!"IN_PROGRESS".equals(current)) {
      throw conflict("Quality check is available only after repair work is in progress.");
    }
    Integer assignedInspector = jdbc.queryForObject("""
        select count(*) from service_job_assignment
        where dealership_id = ? and job_card_id = ? and assignment_role = 'QUALITY_INSPECTOR'
          and assigned_staff_user_id = ? and unassigned_at is null
        """, Integer.class, actor.dealershipId(), jobCardId, actor.staffUserId());
    if (assignedInspector == null || assignedInspector == 0) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,
          "The signed-in staff member must be the assigned quality inspector for this job card.");
    }
    if (request.brakesOk() == null || request.lightsOk() == null || request.hornOk() == null
        || request.noVisibleLeaks() == null || request.roadTestOk() == null
        || request.toolsRemoved() == null || request.customerConcernResolved() == null) {
      throw badRequest("Complete every quality-check item before recording the result.");
    }

    boolean passed = request.brakesOk() && request.lightsOk() && request.hornOk()
        && request.noVisibleLeaks() && request.roadTestOk() && request.toolsRemoved()
        && request.customerConcernResolved();
    String outcome = passed ? "PASSED" : "FAILED";
    String notes = optionalText(request.notes(), 1500);
    jdbc.update("""
        insert into service_quality_check(
          dealership_id, job_card_id, outcome, checklist_document, notes, checked_by_staff_user_id)
        values (?, ?, ?, jsonb_build_object(
          'brakesOk', ?, 'lightsOk', ?, 'hornOk', ?, 'noVisibleLeaks', ?,
          'roadTestOk', ?, 'toolsRemoved', ?, 'customerConcernResolved', ?), ?, ?)
        """, actor.dealershipId(), jobCardId, outcome,
        request.brakesOk(), request.lightsOk(), request.hornOk(), request.noVisibleLeaks(),
        request.roadTestOk(), request.toolsRemoved(), request.customerConcernResolved(),
        notes, actor.staffUserId());

    String next = passed ? "READY_FOR_COLLECTION" : "IN_PROGRESS";
    int changed = jdbc.update("""
        update service_job_card set status = ?, completed_at = case when ? = 'READY_FOR_COLLECTION' then coalesce(completed_at, now()) else completed_at end, updated_at = now()
        where dealership_id = ? and id = ? and status = 'IN_PROGRESS'
        """, next, next, actor.dealershipId(), jobCardId);
    if (changed != 1) throw conflict("Job-card status changed while recording the quality check.");
    jdbc.update("""
        insert into service_job_transition(
          dealership_id, job_card_id, from_status, to_status, action, actor_staff_user_id, reason,
          details)
        values (?, ?, 'IN_PROGRESS', ?, 'QUALITY_CHECK_RECORDED', ?, ?,
          jsonb_build_object('outcome', ?, 'canHandOver', false))
        """, actor.dealershipId(), jobCardId, next, actor.staffUserId(),
        notes == null ? "Quality check " + outcome.toLowerCase(Locale.ROOT) + "." : notes, outcome);
    audit(actor, "SERVICE_QUALITY_CHECK_RECORDED", "SERVICE_JOB_CARD", jobCardPublicId.toString(),
        "Quality check " + outcome + (passed
            ? "; ready for collection, but final handover remains blocked until invoice/payment controls exist."
            : "; job remains in progress for corrective work."));
    return getJobCard(actor, jobCardPublicId);
  }

  public List<AssignmentView> listAssignments(StaffPrincipal actor, UUID jobCardPublicId) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    return jdbc.query("""
        select assignment.public_id, assignment.assignment_role, staff.public_id as staff_public_id,
          staff.full_name as staff_name, staff.status as staff_status, assignment.assigned_at,
          assignment.unassigned_at, assignment.note
        from service_job_assignment assignment
        join staff_user staff on staff.dealership_id=assignment.dealership_id and staff.id=assignment.assigned_staff_user_id
        where assignment.dealership_id = ? and assignment.job_card_id = ?
        order by assignment.assigned_at desc, assignment.id desc
        """, ASSIGNMENT_ROW, actor.dealershipId(), jobCardId);
  }

  @Transactional
  public AssignmentView assignStaff(StaffPrincipal actor, UUID jobCardPublicId, AssignmentRequest request) {
    long jobCardId = requireJobCardId(actor, jobCardPublicId);
    String role = request.assignmentRole() == null ? "" : request.assignmentRole().trim().toUpperCase(Locale.ROOT);
    if (!List.of("SERVICE_ADVISOR", "TECHNICIAN", "QUALITY_INSPECTOR").contains(role)) {
      throw badRequest("Choose a supported assignment role.");
    }
    if (request.staffPublicId() == null) throw badRequest("Choose a staff member to assign.");
    List<Map<String, Object>> targetRows = jdbc.queryForList("""
        select staff.id, staff.status
        from staff_user staff
        where staff.dealership_id = ? and staff.public_id = ?
        """, actor.dealershipId(), request.staffPublicId());
    if (targetRows.isEmpty() || !"ACTIVE".equals(String.valueOf(targetRows.getFirst().get("status")))) {
      throw notFound("Active staff member was not found in this dealership.");
    }
    long targetStaffId = ((Number) targetRows.getFirst().get("id")).longValue();
    Set<String> targetRoles = new LinkedHashSet<>(jdbc.query("""
        select r.code from staff_user_role link join role r on r.id = link.role_id
        where link.dealership_id = ? and link.staff_user_id = ?
        """, (rs, rowNum) -> rs.getString(1), actor.dealershipId(), targetStaffId));
    boolean manager = targetRoles.contains("OWNER") || targetRoles.contains("MANAGER");
    boolean allowed = switch (role) {
      case "TECHNICIAN" -> manager || targetRoles.contains("MECHANIC");
      case "SERVICE_ADVISOR" -> manager || targetRoles.contains("SERVICE_ADVISOR");
      case "QUALITY_INSPECTOR" -> manager || targetRoles.contains("SERVICE_ADVISOR");
      default -> false;
    };
    if (!allowed) {
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
          "The selected staff member does not have the role required for this assignment.");
    }

    List<Map<String, Object>> existingCards = jdbc.queryForList("""
        select status from service_job_card where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), jobCardId);
    if (existingCards.isEmpty()) throw notFound("Workshop job card was not found.");
    String cardStatus = String.valueOf(existingCards.getFirst().get("status"));
    if (List.of("READY_FOR_COLLECTION", "INVOICED", "DELIVERED", "CANCELLED").contains(cardStatus)) {
      throw conflict("A completed or closed job card cannot be reassigned.");
    }

    List<Map<String, Object>> current = jdbc.queryForList("""
        select id, assigned_staff_user_id from service_job_assignment
        where dealership_id = ? and job_card_id = ? and assignment_role = ? and unassigned_at is null
        for update
        """, actor.dealershipId(), jobCardId, role);
    if (!current.isEmpty()
        && ((Number) current.getFirst().get("assigned_staff_user_id")).longValue() == targetStaffId) {
      return listAssignments(actor, jobCardPublicId).stream()
          .filter(a -> a.unassignedAt() == null && a.assignmentRole().equals(role))
          .findFirst().orElseThrow(() -> conflict("Current assignment could not be loaded."));
    }
    jdbc.update("""
        update service_job_assignment set unassigned_at = now()
        where dealership_id = ? and job_card_id = ? and assignment_role = ? and unassigned_at is null
        """, actor.dealershipId(), jobCardId, role);
    String note = optionalText(request.note(), 500);
    UUID publicId = jdbc.queryForObject("""
        insert into service_job_assignment(
          dealership_id, job_card_id, assigned_staff_user_id, assignment_role,
          assigned_by_staff_user_id, note)
        values (?, ?, ?, ?, ?, ?)
        returning public_id
        """, UUID.class, actor.dealershipId(), jobCardId, targetStaffId, role, actor.staffUserId(), note);
    audit(actor, "SERVICE_JOB_ASSIGNED", "SERVICE_JOB_CARD", jobCardPublicId.toString(),
        "Job assigned under role " + role + " to staff " + request.staffPublicId() + ".");
    return listAssignments(actor, jobCardPublicId).stream()
        .filter(a -> a.publicId().equals(publicId))
        .findFirst().orElseThrow(() -> conflict("Assignment was saved but could not be loaded."));
  }

  private void createDefaultInspection(StaffPrincipal actor, long jobCardId) {
    Object[][] checklist = {
      {"VISIBLE_DAMAGE", "Visible bodywork damage"},
      {"LIGHTS_SIGNALS", "Lights and indicators"},
      {"TYRES_WHEELS", "Tyres and wheels"},
      {"BRAKES_CONTROLS", "Brakes and controls"},
      {"LEAKS_FLUIDS", "Visible leaks and fluids"},
      {"BATTERY_ELECTRICAL", "Battery and electrical checks"},
      {"CUSTOMER_CONCERN", "Customer-reported concern inspected"}
    };
    for (Object[] item : checklist) {
      jdbc.update("""
          insert into service_inspection_item(dealership_id, job_card_id, checklist_code, label, status)
          values (?, ?, ?, ?, 'PENDING')
          on conflict (dealership_id, job_card_id, checklist_code) do nothing
          """, actor.dealershipId(), jobCardId, item[0], item[1]);
    }
  }

  private Ownership requireCurrentOwnership(
      StaffPrincipal actor, UUID customerPublicId, UUID vehiclePublicId) {
    List<Ownership> rows = jdbc.query("""
        select customer.id as customer_id, vehicle.id as vehicle_unit_id
        from customer
        join vehicle_unit vehicle on vehicle.dealership_id = customer.dealership_id
        join customer_vehicle owner_link on owner_link.dealership_id = customer.dealership_id
          and owner_link.customer_id = customer.id and owner_link.vehicle_unit_id = vehicle.id
          and owner_link.ownership_ended_at is null
        where customer.dealership_id = ? and customer.public_id = ? and vehicle.public_id = ?
          and customer.status = 'ACTIVE'
        """, (rs, rowNum) -> new Ownership(rs.getLong("customer_id"), rs.getLong("vehicle_unit_id")),
        actor.dealershipId(), customerPublicId, vehiclePublicId);
    if (rows.isEmpty()) {
      throw notFound("The customer and currently linked vehicle must both belong to this dealership.");
    }
    return rows.getFirst();
  }

  private void verifyCurrentOwnershipByIds(StaffPrincipal actor, long customerId, long vehicleId) {
    Integer exists = jdbc.queryForObject("""
        select count(*)
        from customer customer
        join vehicle_unit vehicle on vehicle.dealership_id = customer.dealership_id
        join customer_vehicle owner_link on owner_link.dealership_id = customer.dealership_id
          and owner_link.customer_id = customer.id and owner_link.vehicle_unit_id = vehicle.id
          and owner_link.ownership_ended_at is null
        where customer.dealership_id = ? and customer.id = ? and vehicle.id = ? and customer.status = 'ACTIVE'
        """, Integer.class, actor.dealershipId(), customerId, vehicleId);
    if (exists == null || exists == 0) {
      throw conflict("Current customer-to-vehicle ownership is no longer valid. Refresh the appointment.");
    }
  }

  private AppointmentLock lockAppointment(StaffPrincipal actor, UUID publicId) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select id, customer_id, vehicle_unit_id, status, appointment_code, customer_concern
        from service_appointment
        where dealership_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Service appointment was not found.");
    Map<String, Object> row = rows.getFirst();
    return new AppointmentLock(
        ((Number) row.get("id")).longValue(),
        ((Number) row.get("customer_id")).longValue(),
        ((Number) row.get("vehicle_unit_id")).longValue(),
        String.valueOf(row.get("status")),
        String.valueOf(row.get("appointment_code")),
        String.valueOf(row.get("customer_concern")));
  }

  private JobCardView getJobCardForAppointment(StaffPrincipal actor, long appointmentId) {
    List<UUID> ids = jdbc.query("""
        select public_id from service_job_card
        where dealership_id = ? and appointment_id = ?
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), appointmentId);
    if (ids.isEmpty()) {
      throw new IllegalStateException("An appointment is marked checked-in without its job card.");
    }
    return getJobCard(actor, ids.getFirst());
  }

  private long requireJobCardId(StaffPrincipal actor, UUID publicId) {
    List<Long> ids = jdbc.query("""
        select id from service_job_card where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), publicId);
    if (ids.isEmpty()) throw notFound("Workshop job card was not found.");
    return ids.getFirst();
  }

  private void appointmentTransition(
      StaffPrincipal actor, long appointmentId, String from, String to, String action, String reason) {
    jdbc.update("""
        insert into service_appointment_transition(
          dealership_id, appointment_id, from_status, to_status, action, actor_staff_user_id, reason)
        values (?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), appointmentId, from, to, action, actor.staffUserId(), optionalText(reason, 500));
  }

  private void audit(StaffPrincipal actor, String action, String entityType, String entityId, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, entityType, entityId, summary);
  }

  private static String normalizeOptionalStatus(String value, List<String> allowed, String label) {
    if (value == null || value.isBlank()) return null;
    String normalized = value.trim().toUpperCase(Locale.ROOT);
    if (!allowed.contains(normalized)) throw badRequest("Unknown " + label + " status.");
    return normalized;
  }

  private static String normalizeLanguage(String raw) {
    String language = raw == null || raw.isBlank() ? "hi" : raw.trim().toLowerCase(Locale.ROOT);
    if (!List.of("hi", "en", "hinglish").contains(language)) {
      throw badRequest("Customer language must be hi, en or hinglish.");
    }
    return language;
  }

  private static String requiredText(String raw, String label, int maxLength) {
    String cleaned = optionalText(raw, maxLength);
    if (cleaned == null) throw badRequest(label + " is required.");
    return cleaned;
  }

  private static String optionalText(String raw, int maxLength) {
    if (raw == null) return null;
    String cleaned = raw.trim();
    if (cleaned.isEmpty()) return null;
    if (cleaned.length() > maxLength || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return cleaned;
  }

  private static String cleanSearch(String raw) {
    if (raw == null || raw.isBlank()) return null;
    String cleaned = raw.trim();
    return cleaned.substring(0, Math.min(cleaned.length(), 100));
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  private static PageWindow pageWindow(int requestedPage, int requestedSize) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int size = Math.max(1, Math.min(requestedSize, 100));
    return new PageWindow(page, size, (long) page * size);
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

  public record WorkshopCustomerOption(UUID publicId, String fullName, String phone, int currentVehicleCount) {}
  public record WorkshopVehicleOption(
      UUID publicId, String modelName, String variantName, String colourName,
      String chassisNumber, String engineNumber, String stockStatus) {}
  public record StaffOption(UUID publicId, String fullName, String status, String assignmentRole) {}

  public record AppointmentRequest(
      UUID customerPublicId,
      UUID vehiclePublicId,
      Instant scheduledFor,
      Integer slotMinutes,
      String customerConcern,
      String customerLanguage,
      String source,
      String staffNotes) {}

  public record AppointmentView(
      UUID publicId,
      String appointmentCode,
      UUID customerPublicId,
      String customerName,
      String customerPhone,
      UUID vehiclePublicId,
      String modelName,
      String variantName,
      String colourName,
      String chassisNumber,
      String engineNumber,
      Instant scheduledFor,
      int slotMinutes,
      String customerConcern,
      String customerLanguage,
      String source,
      String status,
      String statusReason,
      String requestedByName,
      Instant checkedInAt,
      Instant createdAt,
      Instant updatedAt) {}

  public record CheckInRequest(Integer odometerKm, Integer fuelLevelPercent, String checkinNotes) {}

  public record JobCardView(
      UUID publicId,
      String jobCardCode,
      UUID appointmentPublicId,
      String appointmentCode,
      UUID customerPublicId,
      String customerName,
      String customerPhone,
      UUID vehiclePublicId,
      String modelName,
      String variantName,
      String colourName,
      String chassisNumber,
      String engineNumber,
      String status,
      String customerConcern,
      Integer odometerKm,
      Integer fuelLevelPercent,
      String checkinNotes,
      Instant checkedInAt,
      Instant completedAt,
      Instant deliveredAt,
      int inspectionCount,
      int pendingInspectionCount,
      Instant createdAt,
      Instant updatedAt) {}

  public record InspectionUpdate(String status, String notes) {}
  public record InspectionItemView(
      UUID publicId, String checklistCode, String label, String status, String notes,
      String checkedByName, Instant checkedAt, Instant updatedAt) {}

  public record EstimateLineInput(
      String lineType, String description, BigDecimal quantity, BigDecimal unitPrice, UUID reservationPublicId) {
    public EstimateLineInput(String lineType, String description, BigDecimal quantity, BigDecimal unitPrice) {
      this(lineType, description, quantity, unitPrice, null);
    }
  }
  private record NormalizedEstimateLine(
      String lineType, String description, BigDecimal quantity, BigDecimal unitPrice,
      PartEstimateSnapshot sourceSnapshot) {}
  private record PartEstimateSnapshot(
      long id, UUID publicId, String reservationCode, String skuCode, String partName,
      BigDecimal quantityReserved, BigDecimal quantityIssued, BigDecimal quantityReturned,
      BigDecimal quantityReleased, BigDecimal unitCostSnapshot, String status) {}
  public record EstimateRequest(List<EstimateLineInput> lines, BigDecimal discountAmount, String customerMessage) {}
  public record EstimateDecisionRequest(
      String decision, String evidenceMethod, String evidenceReference, String note) {}
  public record EstimateLineView(
      int lineNumber, String lineType, String description, BigDecimal quantity, BigDecimal unitPrice, BigDecimal lineTotal,
      UUID sourceReservationPublicId, String sourceReservationCode,
      BigDecimal sourceQuantityReserved, BigDecimal sourceQuantityIssued, BigDecimal sourceQuantityReturned,
      BigDecimal sourceQuantityReleased, BigDecimal sourceUnitCostSnapshot, Instant sourceSnapshotAt) {}
  public record EstimateDecisionView(
      String decision, String evidenceMethod, String evidenceReference, String note,
      String recordedByName, Instant recordedAt) {}
  public record EstimateView(
      UUID publicId, UUID jobCardPublicId, String jobCardCode, int revision, String status,
      BigDecimal partsSubtotal, BigDecimal labourSubtotal, BigDecimal otherSubtotal,
      BigDecimal discountAmount, BigDecimal estimatedTotal, String customerMessage,
      String createdByName, Instant submittedAt, Instant decidedAt, Instant createdAt,
      List<EstimateLineView> lines, List<EstimateDecisionView> decisions) {}
  public record QualityCheckRequest(
      Boolean brakesOk, Boolean lightsOk, Boolean hornOk, Boolean noVisibleLeaks,
      Boolean roadTestOk, Boolean toolsRemoved, Boolean customerConcernResolved, String notes) {}

  public record AssignmentRequest(UUID staffPublicId, String assignmentRole, String note) {}
  public record AssignmentView(
      UUID publicId, String assignmentRole, UUID staffPublicId, String staffName, String staffStatus,
      Instant assignedAt, Instant unassignedAt, String note) {}

  public record Page<T>(List<T> items, int page, int pageSize, long total) {}
  private record PageWindow(int page, int size, long offset) {}
  private record Ownership(long customerId, long vehicleUnitId) {}
  private record AppointmentLock(
      long id, long customerId, long vehicleUnitId, String status, String appointmentCode, String customerConcern) {}
}
