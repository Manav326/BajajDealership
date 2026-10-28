package com.quantaedge.bajaj.sales;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Dealership-scoped sales enquiries, test rides and individual-unit reservations. */
@Service
public class SalesOperationsService {
  private static final Set<String> ENQUIRY_STATUSES =
      Set.of("NEW", "CONTACTED", "QUALIFIED", "TEST_RIDE_SCHEDULED", "BOOKED", "LOST", "CLOSED");
  private static final Set<String> LEAD_SOURCES =
      Set.of("WALK_IN", "PHONE", "WEBSITE", "REFERRAL", "CAMPAIGN", "SOCIAL_MEDIA", "OTHER");
  private static final Set<String> CONTACT_PREFERENCES =
      Set.of("CALL", "SMS", "WHATSAPP", "EMAIL", "IN_PERSON", "NONE");
  private static final Set<String> ACTIVE_ENQUIRY_STATUSES =
      Set.of("NEW", "CONTACTED", "QUALIFIED", "TEST_RIDE_SCHEDULED");

  private final JdbcTemplate jdbc;

  public SalesOperationsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Page<EnquiryView> listEnquiries(
      StaffPrincipal actor, int requestedPage, int requestedSize, String rawQuery, String rawStatus) {
    PageWindow page = window(requestedPage, requestedSize);
    String term = cleanSearch(rawQuery);
    String status = optional(rawStatus, 28);
    if (status != null) {
      status = status.toUpperCase(Locale.ROOT);
      if (!ENQUIRY_STATUSES.contains(status)) throw badRequest("Unknown sales enquiry status.");
    }
    String where = " where enquiry.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (status != null) {
      where += " and enquiry.status = ? ";
      args.add(status);
    }
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      where += """
          and (
            lower(enquiry.enquiry_code) like ? escape '!'
            or lower(customer.full_name) like ? escape '!'
            or customer.phone like ? escape '!'
            or lower(coalesce(customer.email, '')) like ? escape '!'
            or lower(coalesce(model.model_name, '')) like ? escape '!'
          )
          """;
      args.add(like);
      args.add(like);
      args.add("%" + escapeLike(term) + "%");
      args.add(like);
      args.add(like);
    }
    Long totalValue = jdbc.queryForObject("""
        select count(*) from sales_enquiry enquiry
        join customer on customer.dealership_id = enquiry.dealership_id and customer.id = enquiry.customer_id
        left join vehicle_model model on model.dealership_id = enquiry.dealership_id
          and model.id = enquiry.interested_model_id
        """ + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(page.size());
    args.add(page.offset());
    List<UUID> ids = jdbc.query("""
        select enquiry.public_id
        from sales_enquiry enquiry
        join customer on customer.dealership_id = enquiry.dealership_id and customer.id = enquiry.customer_id
        left join vehicle_model model on model.dealership_id = enquiry.dealership_id
          and model.id = enquiry.interested_model_id
        """ + where + " order by case when enquiry.next_follow_up_at is null then 1 else 0 end, "
            + "enquiry.next_follow_up_at, enquiry.updated_at desc limit ? offset ?",
        (rs, rowNum) -> rs.getObject(1, UUID.class), args.toArray());
    return new Page<>(ids.stream().map(id -> getEnquiry(actor, id)).toList(),
        page.page(), page.size(), total);
  }

  @Transactional
  public EnquiryView createEnquiry(StaffPrincipal actor, EnquiryRequest request) {
    if (request == null || request.customerPublicId() == null) throw badRequest("Choose a customer.");
    long customerId = requireCustomerId(actor, request.customerPublicId());
    Long modelId = request.interestedModelPublicId() == null
        ? null : requireModelId(actor, request.interestedModelPublicId());
    Long assigneeId = request.assignedStaffPublicId() == null
        ? null : requireActiveStaffId(actor, request.assignedStaffPublicId());
    String leadSource = normalizeChoice(request.leadSource(), "Lead source", LEAD_SOURCES, "WALK_IN");
    String contactPreference = normalizeChoice(
        request.contactPreference(), "Contact preference", CONTACT_PREFERENCES, "CALL");
    Instant nextFollowUpAt = request.nextFollowUpAt();
    String note = optional(request.note(), 2000);
    String code = "ENQ-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID publicId;
    try {
      publicId = jdbc.queryForObject("""
          insert into sales_enquiry(
            dealership_id, enquiry_code, customer_id, interested_model_id, assigned_staff_user_id,
            created_by_staff_user_id, status, lead_source, contact_preference, next_follow_up_at, notes)
          values (?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), code, customerId, modelId, assigneeId,
          actor.staffUserId(), leadSource, contactPreference,
          nextFollowUpAt == null ? null : Timestamp.from(nextFollowUpAt), note);
    } catch (DuplicateKeyException duplicate) {
      throw conflict("A sales enquiry with this code already exists. Retry the operation.");
    }
    long enquiryId = requireEnquiryId(actor, publicId);
    addActivity(actor, enquiryId, "ENQUIRY_CREATED", null, "NEW",
        note == null ? "Sales enquiry created." : note, nextFollowUpAt, "SALES_ENQUIRY", publicId.toString());
    audit(actor, "SALES_ENQUIRY_CREATED", "SALES_ENQUIRY", publicId.toString(),
        "Created enquiry " + code + " from " + leadSource + ".");
    return getEnquiry(actor, publicId);
  }

  public EnquiryView getEnquiry(StaffPrincipal actor, UUID publicId) {
    List<EnquiryView> rows = jdbc.query("""
        select enquiry.public_id, enquiry.enquiry_code, customer.public_id as customer_public_id,
          customer.customer_code, customer.full_name as customer_name, customer.phone as customer_phone,
          customer.email as customer_email, model.public_id as model_public_id, model.model_code,
          model.model_name, model.variant_name, model.colour_name,
          assignee.public_id as assignee_public_id, assignee.full_name as assignee_name,
          enquiry.status, enquiry.lead_source, enquiry.contact_preference, enquiry.next_follow_up_at,
          enquiry.last_contacted_at, enquiry.notes, enquiry.created_at, enquiry.updated_at
        from sales_enquiry enquiry
        join customer on customer.dealership_id = enquiry.dealership_id and customer.id = enquiry.customer_id
        left join vehicle_model model on model.dealership_id = enquiry.dealership_id
          and model.id = enquiry.interested_model_id
        left join staff_user assignee on assignee.dealership_id = enquiry.dealership_id
          and assignee.id = enquiry.assigned_staff_user_id
        where enquiry.dealership_id = ? and enquiry.public_id = ?
        """, (rs, rowNum) -> new EnquiryView(
            rs.getObject("public_id", UUID.class), rs.getString("enquiry_code"),
            rs.getObject("customer_public_id", UUID.class), rs.getString("customer_code"),
            rs.getString("customer_name"), rs.getString("customer_phone"), rs.getString("customer_email"),
            rs.getObject("model_public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
            rs.getString("variant_name"), rs.getString("colour_name"),
            rs.getObject("assignee_public_id", UUID.class), rs.getString("assignee_name"),
            rs.getString("status"), rs.getString("lead_source"), rs.getString("contact_preference"),
            instantOrNull(rs.getTimestamp("next_follow_up_at")),
            instantOrNull(rs.getTimestamp("last_contacted_at")), rs.getString("notes"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()),
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Sales enquiry was not found in this dealership.");
    return rows.getFirst();
  }

  public EnquiryDetailView getEnquiryDetail(StaffPrincipal actor, UUID publicId) {
    EnquiryView enquiry = getEnquiry(actor, publicId);
    long enquiryId = requireEnquiryId(actor, publicId);
    List<ActivityView> activities = jdbc.query("""
        select activity.public_id, activity.activity_type, activity.from_status, activity.to_status,
          activity.note, activity.follow_up_at, activity.reference_type, activity.reference_id,
          staff.full_name as actor_name, activity.created_at
        from sales_enquiry_activity activity
        join staff_user staff on staff.dealership_id = activity.dealership_id
          and staff.id = activity.actor_staff_user_id
        where activity.dealership_id = ? and activity.enquiry_id = ?
        order by activity.created_at desc, activity.id desc limit 100
        """, (rs, rowNum) -> new ActivityView(
            rs.getObject("public_id", UUID.class), rs.getString("activity_type"), rs.getString("from_status"),
            rs.getString("to_status"), rs.getString("note"), instantOrNull(rs.getTimestamp("follow_up_at")),
            rs.getString("reference_type"), rs.getString("reference_id"), rs.getString("actor_name"),
            rs.getTimestamp("created_at").toInstant()), actor.dealershipId(), enquiryId);
    List<TestRideView> testRides = listTestRidesForEnquiry(actor, enquiryId);
    List<BookingView> bookings = listBookingsForEnquiry(actor, enquiryId);
    return new EnquiryDetailView(enquiry, activities, testRides, bookings);
  }

  @Transactional
  public EnquiryView changeStatus(StaffPrincipal actor, UUID publicId, StatusRequest request) {
    if (request == null) throw badRequest("Status update is required.");
    String target = normalizeChoice(request.status(), "Enquiry status", ENQUIRY_STATUSES, null);
    if ("BOOKED".equals(target)) throw badRequest("An enquiry becomes BOOKED only when an available vehicle is reserved.");
    long enquiryId = requireEnquiryId(actor, publicId);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select status from sales_enquiry
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), enquiryId);
    if (rows.isEmpty()) throw notFound("Sales enquiry was not found.");
    String previous = String.valueOf(rows.getFirst().get("status"));
    if (previous.equals(target)) throw conflict("The enquiry is already in that status.");
    if (!allowedStatusTransition(previous, target)) {
      throw conflict("Sales enquiry cannot move from " + previous + " to " + target + ".");
    }
    if (Set.of("LOST", "CLOSED").contains(target)) {
      Integer activeRides = jdbc.queryForObject("""
          select count(*) from sales_test_ride
          where dealership_id = ? and enquiry_id = ? and status in ('SCHEDULED', 'CHECKED_OUT')
          """, Integer.class, actor.dealershipId(), enquiryId);
      if (activeRides != null && activeRides > 0) {
        throw conflict("Cancel or finish active test rides before closing or losing this enquiry.");
      }
      Integer activeBookings = jdbc.queryForObject("""
          select count(*) from sales_booking
          where dealership_id = ? and enquiry_id = ? and status = 'ACTIVE'
          """, Integer.class, actor.dealershipId(), enquiryId);
      if (activeBookings != null && activeBookings > 0) {
        throw conflict("Cancel the active vehicle booking before closing this enquiry.");
      }
    }
    String note = optional(request.note(), 2000);
    int changed = jdbc.update("""
        update sales_enquiry
        set status = ?, last_contacted_at = case when ? in ('CONTACTED', 'QUALIFIED', 'TEST_RIDE_SCHEDULED')
              then now() else last_contacted_at end,
            updated_at = now()
        where dealership_id = ? and id = ? and status = ?
        """, target, target, actor.dealershipId(), enquiryId, previous);
    if (changed != 1) throw conflict("Sales enquiry status changed concurrently. Refresh and retry.");
    addActivity(actor, enquiryId, "STATUS_CHANGED", previous, target,
        note == null ? "Status changed from " + previous + " to " + target + "." : note,
        null, "SALES_ENQUIRY", publicId.toString());
    audit(actor, "SALES_ENQUIRY_STATUS_CHANGED", "SALES_ENQUIRY", publicId.toString(),
        "Enquiry status changed from " + previous + " to " + target + ".");
    return getEnquiry(actor, publicId);
  }

  @Transactional
  public EnquiryView setFollowUp(StaffPrincipal actor, UUID publicId, FollowUpRequest request) {
    if (request == null) throw badRequest("Follow-up details are required.");
    long enquiryId = requireEnquiryId(actor, publicId);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select status from sales_enquiry
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), enquiryId);
    if (rows.isEmpty()) throw notFound("Sales enquiry was not found.");
    String status = String.valueOf(rows.getFirst().get("status"));
    if (Set.of("LOST", "CLOSED").contains(status)) {
      throw conflict("Reopen the enquiry before scheduling another follow-up.");
    }
    String note = optional(request.note(), 2000);
    jdbc.update("""
        update sales_enquiry set next_follow_up_at = ?, updated_at = now()
        where dealership_id = ? and id = ?
        """, request.followUpAt(), actor.dealershipId(), enquiryId);
    addActivity(actor, enquiryId, "FOLLOW_UP_SET", status, status,
        note == null ? (request.followUpAt() == null ? "Follow-up cleared." : "Follow-up scheduled.")
            : note, request.followUpAt(), "SALES_ENQUIRY", publicId.toString());
    audit(actor, "SALES_ENQUIRY_FOLLOW_UP_SET", "SALES_ENQUIRY", publicId.toString(),
        request.followUpAt() == null ? "Follow-up date cleared." : "Follow-up scheduled for " + request.followUpAt());
    return getEnquiry(actor, publicId);
  }

  @Transactional
  public TestRideView scheduleTestRide(StaffPrincipal actor, UUID enquiryPublicId, TestRideRequest request) {
    if (request == null || request.vehicleUnitPublicId() == null) throw badRequest("Choose a bike for the test ride.");
    if (request.scheduledStart() == null || request.scheduledEnd() == null) {
      throw badRequest("Choose a test-ride start and end time.");
    }
    Instant now = Instant.now();
    if (!request.scheduledStart().isAfter(now)) throw badRequest("Test ride must be scheduled in the future.");
    Duration duration = Duration.between(request.scheduledStart(), request.scheduledEnd());
    if (duration.isNegative() || duration.isZero()
        || duration.compareTo(Duration.ofMinutes(15)) < 0 || duration.compareTo(Duration.ofHours(4)) > 0) {
      throw badRequest("Test ride must last between 15 minutes and 4 hours.");
    }
    long enquiryId = requireEnquiryId(actor, enquiryPublicId);
    List<Map<String, Object>> enquiryRows = jdbc.queryForList("""
        select status, interested_model_id from sales_enquiry
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), enquiryId);
    if (enquiryRows.isEmpty()) throw notFound("Sales enquiry was not found.");
    Map<String, Object> enquiry = enquiryRows.getFirst();
    String enquiryStatus = String.valueOf(enquiry.get("status"));
    if (!ACTIVE_ENQUIRY_STATUSES.contains(enquiryStatus)) {
      throw conflict("Only an active, unbooked enquiry can schedule a test ride.");
    }

    List<Map<String, Object>> unitRows = jdbc.queryForList("""
        select id, public_id, stock_status, vehicle_model_id
        from vehicle_unit
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), request.vehicleUnitPublicId());
    if (unitRows.isEmpty()) throw notFound("Test-ride bike was not found in this dealership.");
    Map<String, Object> unit = unitRows.getFirst();
    if (!"AVAILABLE".equals(String.valueOf(unit.get("stock_status")))) {
      throw conflict("Only an available bike can be scheduled for a test ride.");
    }
    Object interestedModelId = enquiry.get("interested_model_id");
    if (interestedModelId != null && !interestedModelId.equals(unit.get("vehicle_model_id"))) {
      throw conflict("Selected bike does not match the model requested on this enquiry.");
    }
    long unitId = ((Number) unit.get("id")).longValue();
    Integer conflicts = jdbc.queryForObject("""
        select count(*) from sales_test_ride
        where dealership_id = ? and vehicle_unit_id = ?
          and status in ('SCHEDULED', 'CHECKED_OUT')
          and scheduled_start < ? and scheduled_end > ?
        """, Integer.class, actor.dealershipId(), unitId,
        Timestamp.from(request.scheduledEnd()), Timestamp.from(request.scheduledStart()));
    if (conflicts != null && conflicts > 0) {
      throw conflict("This bike already has a test ride during the selected time.");
    }
    Integer activeBookings = jdbc.queryForObject("""
        select count(*) from sales_booking
        where dealership_id = ? and vehicle_unit_id = ? and status = 'ACTIVE'
        """, Integer.class, actor.dealershipId(), unitId);
    if (activeBookings != null && activeBookings > 0) throw conflict("This bike has an active booking.");

    String code = "TR-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    String note = optional(request.notes(), 1000);
    UUID ridePublicId = jdbc.queryForObject("""
        insert into sales_test_ride(
          dealership_id, test_ride_code, enquiry_id, vehicle_unit_id,
          scheduled_start, scheduled_end, notes, created_by_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        returning public_id
        """, UUID.class, actor.dealershipId(), code, enquiryId, unitId,
        Timestamp.from(request.scheduledStart()), Timestamp.from(request.scheduledEnd()), note, actor.staffUserId());
    if (!"TEST_RIDE_SCHEDULED".equals(enquiryStatus)) {
      int changed = jdbc.update("""
          update sales_enquiry set status = 'TEST_RIDE_SCHEDULED', last_contacted_at = now(), updated_at = now()
          where dealership_id = ? and id = ? and status = ?
          """, actor.dealershipId(), enquiryId, enquiryStatus);
      if (changed != 1) throw conflict("Enquiry status changed while scheduling the test ride.");
    }
    addActivity(actor, enquiryId, "TEST_RIDE_SCHEDULED", enquiryStatus, "TEST_RIDE_SCHEDULED",
        note == null ? "Test ride scheduled for " + code + "." : note,
        request.scheduledStart(), "SALES_TEST_RIDE", ridePublicId.toString());
    audit(actor, "SALES_TEST_RIDE_SCHEDULED", "SALES_TEST_RIDE", ridePublicId.toString(),
        "Scheduled " + code + " for enquiry " + enquiryPublicId + ".");
    return getTestRide(actor, ridePublicId);
  }

  @Transactional
  public TestRideView checkOutTestRide(StaffPrincipal actor, UUID ridePublicId, String rawNote) {
    Map<String, Object> ride = lockTestRide(actor, ridePublicId);
    if (!"SCHEDULED".equals(String.valueOf(ride.get("status")))) {
      throw conflict("Only a scheduled test ride can be checked out.");
    }
    Instant start = ((Timestamp) ride.get("scheduled_start")).toInstant();
    Instant end = ((Timestamp) ride.get("scheduled_end")).toInstant();
    Instant now = Instant.now();
    if (start.isAfter(now.plus(Duration.ofMinutes(30))) || !end.isAfter(now)) {
      throw conflict("Test-ride check-out is allowed only within 30 minutes of the scheduled start and before its end.");
    }
    UUID enquiryPublicId = (UUID) ride.get("enquiry_public_id");
    UUID vehiclePublicId = (UUID) ride.get("vehicle_public_id");
    List<Map<String, Object>> units = jdbc.queryForList("""
        select stock_status from vehicle_unit
        where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), vehiclePublicId);
    if (units.isEmpty() || !"AVAILABLE".equals(String.valueOf(units.getFirst().get("stock_status")))) {
      throw conflict("The bike is no longer available for a test ride.");
    }
    long rideId = number(ride.get("id"));
    String note = optional(rawNote, 1000);
    int changed = jdbc.update("""
        update sales_test_ride set status = 'CHECKED_OUT', checked_out_at = now(),
          checked_out_by_staff_user_id = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'SCHEDULED'
        """, actor.staffUserId(), actor.dealershipId(), rideId);
    if (changed != 1) throw conflict("Test ride changed while checking it out.");
    long enquiryId = number(ride.get("enquiry_id"));
    addActivity(actor, enquiryId, "TEST_RIDE_CHECKED_OUT", null, null,
        note == null ? "Bike checked out for test ride." : note, null, "SALES_TEST_RIDE", ridePublicId.toString());
    audit(actor, "SALES_TEST_RIDE_CHECKED_OUT", "SALES_TEST_RIDE", ridePublicId.toString(),
        "Checked out bike for test ride on enquiry " + enquiryPublicId + ".");
    return getTestRide(actor, ridePublicId);
  }

  @Transactional
  public TestRideView completeTestRide(StaffPrincipal actor, UUID ridePublicId, String rawNote) {
    Map<String, Object> ride = lockTestRide(actor, ridePublicId);
    if (!"CHECKED_OUT".equals(String.valueOf(ride.get("status")))) {
      throw conflict("Only a checked-out test ride can be completed.");
    }
    long rideId = number(ride.get("id"));
    long enquiryId = number(ride.get("enquiry_id"));
    String note = optional(rawNote, 1000);
    int changed = jdbc.update("""
        update sales_test_ride set status = 'COMPLETED', completed_at = now(),
          completed_by_staff_user_id = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'CHECKED_OUT'
        """, actor.staffUserId(), actor.dealershipId(), rideId);
    if (changed != 1) throw conflict("Test ride changed while recording completion.");
    jdbc.update("""
        update sales_enquiry set status = 'QUALIFIED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'TEST_RIDE_SCHEDULED'
          and not exists (
            select 1 from sales_test_ride other
            where other.dealership_id = ? and other.enquiry_id = ?
              and other.id <> ? and other.status in ('SCHEDULED', 'CHECKED_OUT'))
        """, actor.dealershipId(), enquiryId, actor.dealershipId(), enquiryId, rideId);
    addActivity(actor, enquiryId, "TEST_RIDE_COMPLETED", "TEST_RIDE_SCHEDULED", null,
        note == null ? "Test ride completed." : note, null, "SALES_TEST_RIDE", ridePublicId.toString());
    audit(actor, "SALES_TEST_RIDE_COMPLETED", "SALES_TEST_RIDE", ridePublicId.toString(),
        "Completed the test ride for enquiry " + ride.get("enquiry_public_id") + ".");
    return getTestRide(actor, ridePublicId);
  }

  @Transactional
  public TestRideView cancelTestRide(StaffPrincipal actor, UUID ridePublicId, String rawReason) {
    String reason = required(rawReason, "Cancellation reason", 500);
    Map<String, Object> ride = lockTestRide(actor, ridePublicId);
    String previous = String.valueOf(ride.get("status"));
    if (!Set.of("SCHEDULED", "CHECKED_OUT").contains(previous)) {
      throw conflict("Only a scheduled or checked-out test ride can be cancelled.");
    }
    long rideId = number(ride.get("id"));
    long enquiryId = number(ride.get("enquiry_id"));
    int changed = jdbc.update("""
        update sales_test_ride set status = 'CANCELLED', cancelled_at = now(),
          cancelled_by_staff_user_id = ?, cancellation_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = ?
        """, actor.staffUserId(), reason, actor.dealershipId(), rideId, previous);
    if (changed != 1) throw conflict("Test ride changed while cancelling.");
    jdbc.update("""
        update sales_enquiry set status = 'QUALIFIED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'TEST_RIDE_SCHEDULED'
          and not exists (
            select 1 from sales_test_ride other
            where other.dealership_id = ? and other.enquiry_id = ?
              and other.id <> ? and other.status in ('SCHEDULED', 'CHECKED_OUT'))
        """, actor.dealershipId(), enquiryId, actor.dealershipId(), enquiryId, rideId);
    addActivity(actor, enquiryId, "TEST_RIDE_CANCELLED", previous, "CANCELLED", reason,
        null, "SALES_TEST_RIDE", ridePublicId.toString());
    audit(actor, "SALES_TEST_RIDE_CANCELLED", "SALES_TEST_RIDE", ridePublicId.toString(),
        "Cancelled the test ride. Reason: " + reason);
    return getTestRide(actor, ridePublicId);
  }

  @Transactional
  public BookingView createBooking(StaffPrincipal actor, UUID enquiryPublicId, BookingRequest request) {
    if (request == null || request.vehicleUnitPublicId() == null) throw badRequest("Choose a bike to reserve.");
    long enquiryId = requireEnquiryId(actor, enquiryPublicId);
    List<Map<String, Object>> enquiries = jdbc.queryForList("""
        select customer_id, interested_model_id, status from sales_enquiry
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), enquiryId);
    if (enquiries.isEmpty()) throw notFound("Sales enquiry was not found.");
    Map<String, Object> enquiry = enquiries.getFirst();
    String enquiryStatus = String.valueOf(enquiry.get("status"));
    if (!ACTIVE_ENQUIRY_STATUSES.contains(enquiryStatus)) {
      throw conflict("Only an active, unbooked enquiry can reserve a bike.");
    }

    List<Map<String, Object>> units = jdbc.queryForList("""
        select id, stock_status, vehicle_model_id
        from vehicle_unit where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), request.vehicleUnitPublicId());
    if (units.isEmpty()) throw notFound("Bike was not found in this dealership.");
    Map<String, Object> unit = units.getFirst();
    if (!"AVAILABLE".equals(String.valueOf(unit.get("stock_status")))) {
      throw conflict("Only an available bike can be booked. Current stock status: "
          + unit.get("stock_status") + ".");
    }
    Object interestedModelId = enquiry.get("interested_model_id");
    if (interestedModelId != null && !interestedModelId.equals(unit.get("vehicle_model_id"))) {
      throw conflict("Selected bike does not match the model requested on the enquiry.");
    }
    long unitId = number(unit.get("id"));
    Integer activeRides = jdbc.queryForObject("""
        select count(*) from sales_test_ride
        where dealership_id = ? and vehicle_unit_id = ? and status in ('SCHEDULED', 'CHECKED_OUT')
        """, Integer.class, actor.dealershipId(), unitId);
    if (activeRides != null && activeRides > 0) {
      throw conflict("Cancel or complete scheduled test rides before booking this bike.");
    }
    String code = "BK-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    String note = optional(request.notes(), 1000);
    UUID bookingPublicId;
    try {
      bookingPublicId = jdbc.queryForObject("""
          insert into sales_booking(
            dealership_id, booking_code, enquiry_id, customer_id, vehicle_unit_id, status, notes,
            created_by_staff_user_id)
          values (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
          returning public_id
          """, UUID.class, actor.dealershipId(), code, enquiryId, number(enquiry.get("customer_id")),
          unitId, note, actor.staffUserId());
    } catch (DuplicateKeyException duplicate) {
      throw conflict("This enquiry or bike already has an active booking.");
    }
    int unitChanged = jdbc.update("""
        update vehicle_unit set stock_status = 'RESERVED', updated_at = now()
        where dealership_id = ? and id = ? and stock_status = 'AVAILABLE'
        """, actor.dealershipId(), unitId);
    if (unitChanged != 1) throw conflict("Bike stock changed while booking. Refresh and retry.");
    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, 'AVAILABLE', 'RESERVED', 'RESERVED', 'SALES_BOOKING', ?, ?, ?)
        """, actor.dealershipId(), unitId, bookingPublicId.toString(), actor.staffUserId(),
        note == null ? "Vehicle reserved by sales booking " + code + "." : note);
    int enquiryChanged = jdbc.update("""
        update sales_enquiry set status = 'BOOKED', updated_at = now()
        where dealership_id = ? and id = ? and status = ?
        """, actor.dealershipId(), enquiryId, enquiryStatus);
    if (enquiryChanged != 1) throw conflict("Enquiry status changed while booking.");
    addActivity(actor, enquiryId, "BOOKING_CREATED", enquiryStatus, "BOOKED",
        note == null ? "Reserved bike under booking " + code + "." : note,
        null, "SALES_BOOKING", bookingPublicId.toString());
    audit(actor, "SALES_BOOKING_CREATED", "SALES_BOOKING", bookingPublicId.toString(),
        "Reserved individual vehicle unit under booking " + code + "; no sale invoice or payment is implied.");
    return getBooking(actor, bookingPublicId);
  }

  @Transactional
  public BookingView cancelBooking(StaffPrincipal actor, UUID bookingPublicId, BookingCancelRequest request) {
    if (request == null) throw badRequest("Booking cancellation details are required.");
    String reason = required(request.reason(), "Cancellation reason", 500);
    List<Map<String, Object>> referenceRows = jdbc.queryForList("""
        select enquiry_id from sales_booking
        where dealership_id = ? and public_id = ?
        """, actor.dealershipId(), bookingPublicId);
    if (referenceRows.isEmpty()) throw notFound("Sales booking was not found.");
    long enquiryId = number(referenceRows.getFirst().get("enquiry_id"));
    jdbc.queryForList("""
        select id from sales_enquiry where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), enquiryId);
    List<Map<String, Object>> bookingRows = jdbc.queryForList("""
        select id, enquiry_id, vehicle_unit_id, status, booking_code
        from sales_booking where dealership_id = ? and public_id = ? for update
        """, actor.dealershipId(), bookingPublicId);
    if (bookingRows.isEmpty()) throw notFound("Sales booking was not found.");
    Map<String, Object> booking = bookingRows.getFirst();
    if (!"ACTIVE".equals(String.valueOf(booking.get("status")))) {
      throw conflict("Only an active booking can be cancelled.");
    }
    long unitId = number(booking.get("vehicle_unit_id"));
    List<Map<String, Object>> unitRows = jdbc.queryForList("""
        select public_id, stock_status from vehicle_unit
        where dealership_id = ? and id = ? for update
        """, actor.dealershipId(), unitId);
    if (unitRows.isEmpty()) throw notFound("Reserved bike was not found.");
    if (!"RESERVED".equals(String.valueOf(unitRows.getFirst().get("stock_status")))) {
      throw conflict("The bike is no longer reserved by this booking; stock was not changed.");
    }
    UUID unitPublicId = (UUID) unitRows.getFirst().get("public_id");
    int bookingChanged = jdbc.update("""
        update sales_booking set status = 'CANCELLED', cancelled_at = now(),
          cancelled_by_staff_user_id = ?, cancellation_reason = ?, updated_at = now()
        where dealership_id = ? and id = ? and status = 'ACTIVE'
        """, actor.staffUserId(), reason, actor.dealershipId(), number(booking.get("id")));
    if (bookingChanged != 1) throw conflict("Booking changed while cancelling.");
    int unitChanged = jdbc.update("""
        update vehicle_unit set stock_status = 'AVAILABLE', updated_at = now()
        where dealership_id = ? and id = ? and stock_status = 'RESERVED'
        """, actor.dealershipId(), unitId);
    if (unitChanged != 1) throw conflict("Bike stock changed while releasing the booking.");
    jdbc.update("""
        insert into vehicle_stock_movement(
          dealership_id, vehicle_unit_id, from_status, to_status, event_type,
          reference_type, reference_id, actor_staff_user_id, reason)
        values (?, ?, 'RESERVED', 'AVAILABLE', 'RESERVATION_RELEASED', 'SALES_BOOKING', ?, ?, ?)
        """, actor.dealershipId(), unitId, bookingPublicId.toString(), actor.staffUserId(),
        "Cancelled booking " + booking.get("booking_code") + ": " + reason);
    jdbc.update("""
        update sales_enquiry set status = 'QUALIFIED', updated_at = now()
        where dealership_id = ? and id = ? and status = 'BOOKED'
        """, actor.dealershipId(), enquiryId);
    addActivity(actor, enquiryId, "BOOKING_CANCELLED", "BOOKED", "QUALIFIED",
        reason, null, "SALES_BOOKING", bookingPublicId.toString());
    audit(actor, "SALES_BOOKING_CANCELLED", "SALES_BOOKING", bookingPublicId.toString(),
        "Cancelled booking " + booking.get("booking_code") + " and returned bike " + unitPublicId + " to AVAILABLE stock.");
    return getBooking(actor, bookingPublicId);
  }

  public Page<BookingView> listBookings(StaffPrincipal actor, int requestedPage, int requestedSize, String rawQuery) {
    PageWindow page = window(requestedPage, requestedSize);
    String term = cleanSearch(rawQuery);
    String where = " where booking.dealership_id = ? ";
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());
    if (term != null) {
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      where += """
          and (lower(booking.booking_code) like ? escape '!'
            or lower(customer.full_name) like ? escape '!'
            or lower(job.enquiry_code) like ? escape '!'
            or lower(vehicle.chassis_number) like ? escape '!')
          """;
      args.add(like); args.add(like); args.add(like); args.add(like);
    }
    Long totalValue = jdbc.queryForObject("""
        select count(*) from sales_booking booking
        join customer on customer.dealership_id = booking.dealership_id and customer.id = booking.customer_id
        join sales_enquiry job on job.dealership_id = booking.dealership_id and job.id = booking.enquiry_id
        join vehicle_unit vehicle on vehicle.dealership_id = booking.dealership_id and vehicle.id = booking.vehicle_unit_id
        """ + where, Long.class, args.toArray());
    long total = totalValue == null ? 0 : totalValue;
    args.add(page.size()); args.add(page.offset());
    List<UUID> ids = jdbc.query("""
        select booking.public_id from sales_booking booking
        join customer on customer.dealership_id = booking.dealership_id and customer.id = booking.customer_id
        join sales_enquiry job on job.dealership_id = booking.dealership_id and job.id = booking.enquiry_id
        join vehicle_unit vehicle on vehicle.dealership_id = booking.dealership_id and vehicle.id = booking.vehicle_unit_id
        """ + where + " order by booking.created_at desc, booking.id desc limit ? offset ?",
        (rs, rowNum) -> rs.getObject(1, UUID.class), args.toArray());
    return new Page<>(ids.stream().map(id -> getBooking(actor, id)).toList(), page.page(), page.size(), total);
  }

  public BookingView getBooking(StaffPrincipal actor, UUID publicId) {
    List<BookingView> rows = jdbc.query("""
        select booking.public_id, booking.booking_code, booking.status, booking.notes,
          booking.created_at, booking.cancelled_at, booking.cancellation_reason,
          enquiry.public_id as enquiry_public_id, enquiry.enquiry_code,
          customer.public_id as customer_public_id, customer.customer_code, customer.full_name as customer_name,
          customer.phone as customer_phone, vehicle.public_id as vehicle_public_id,
          vehicle.chassis_number, vehicle.engine_number, vehicle.stock_status,
          model.public_id as model_public_id, model.model_code, model.model_name, model.variant_name, model.colour_name,
          creator.full_name as created_by_name
        from sales_booking booking
        join sales_enquiry enquiry on enquiry.dealership_id = booking.dealership_id and enquiry.id = booking.enquiry_id
        join customer on customer.dealership_id = booking.dealership_id and customer.id = booking.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = booking.dealership_id and vehicle.id = booking.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        join staff_user creator on creator.dealership_id = booking.dealership_id and creator.id = booking.created_by_staff_user_id
        where booking.dealership_id = ? and booking.public_id = ?
        """, (rs, rowNum) -> new BookingView(
            rs.getObject("public_id", UUID.class), rs.getString("booking_code"),
            rs.getObject("enquiry_public_id", UUID.class), rs.getString("enquiry_code"),
            rs.getObject("customer_public_id", UUID.class), rs.getString("customer_code"),
            rs.getString("customer_name"), rs.getString("customer_phone"),
            rs.getObject("vehicle_public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
            rs.getString("variant_name"), rs.getString("colour_name"), rs.getString("chassis_number"),
            rs.getString("engine_number"), rs.getString("stock_status"), rs.getString("status"),
            rs.getString("notes"), rs.getString("created_by_name"), rs.getTimestamp("created_at").toInstant(),
            instantOrNull(rs.getTimestamp("cancelled_at")), rs.getString("cancellation_reason")),
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Sales booking was not found in this dealership.");
    return rows.getFirst();
  }

  public TestRideView getTestRide(StaffPrincipal actor, UUID publicId) {
    List<TestRideView> rows = jdbc.query("""
        select ride.public_id, ride.test_ride_code, ride.status, ride.scheduled_start, ride.scheduled_end,
          ride.notes, ride.checked_out_at, ride.completed_at, ride.cancelled_at, ride.cancellation_reason,
          creator.full_name as created_by_name, checkout_staff.full_name as checked_out_by_name,
          completer.full_name as completed_by_name,
          enquiry.public_id as enquiry_public_id, enquiry.enquiry_code,
          customer.full_name as customer_name, vehicle.public_id as vehicle_public_id,
          vehicle.chassis_number, vehicle.engine_number, model.model_code, model.model_name,
          model.variant_name, model.colour_name
        from sales_test_ride ride
        join sales_enquiry enquiry on enquiry.dealership_id = ride.dealership_id and enquiry.id = ride.enquiry_id
        join customer on customer.dealership_id = enquiry.dealership_id and customer.id = enquiry.customer_id
        join vehicle_unit vehicle on vehicle.dealership_id = ride.dealership_id and vehicle.id = ride.vehicle_unit_id
        join vehicle_model model on model.dealership_id = vehicle.dealership_id and model.id = vehicle.vehicle_model_id
        join staff_user creator on creator.dealership_id = ride.dealership_id and creator.id = ride.created_by_staff_user_id
        left join staff_user checkout_staff on checkout_staff.dealership_id = ride.dealership_id
          and checkout_staff.id = ride.checked_out_by_staff_user_id
        left join staff_user completer on completer.dealership_id = ride.dealership_id
          and completer.id = ride.completed_by_staff_user_id
        where ride.dealership_id = ? and ride.public_id = ?
        """, (rs, rowNum) -> new TestRideView(
            rs.getObject("public_id", UUID.class), rs.getString("test_ride_code"), rs.getString("status"),
            rs.getObject("enquiry_public_id", UUID.class), rs.getString("enquiry_code"), rs.getString("customer_name"),
            rs.getObject("vehicle_public_id", UUID.class), rs.getString("model_code"), rs.getString("model_name"),
            rs.getString("variant_name"), rs.getString("colour_name"), rs.getString("chassis_number"),
            rs.getString("engine_number"), rs.getTimestamp("scheduled_start").toInstant(),
            rs.getTimestamp("scheduled_end").toInstant(), rs.getString("notes"), rs.getString("created_by_name"),
            rs.getString("checked_out_by_name"), rs.getString("completed_by_name"),
            instantOrNull(rs.getTimestamp("checked_out_at")), instantOrNull(rs.getTimestamp("completed_at")),
            instantOrNull(rs.getTimestamp("cancelled_at")), rs.getString("cancellation_reason")),
        actor.dealershipId(), publicId);
    if (rows.isEmpty()) throw notFound("Test ride was not found in this dealership.");
    return rows.getFirst();
  }

  public List<TestRideView> listTestRidesForEnquiry(StaffPrincipal actor, long enquiryId) {
    List<UUID> ids = jdbc.query("""
        select public_id from sales_test_ride
        where dealership_id = ? and enquiry_id = ?
        order by scheduled_start desc, id desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), enquiryId);
    return ids.stream().map(id -> getTestRide(actor, id)).toList();
  }

  private List<BookingView> listBookingsForEnquiry(StaffPrincipal actor, long enquiryId) {
    List<UUID> ids = jdbc.query("""
        select public_id from sales_booking
        where dealership_id = ? and enquiry_id = ?
        order by created_at desc, id desc
        """, (rs, rowNum) -> rs.getObject(1, UUID.class), actor.dealershipId(), enquiryId);
    return ids.stream().map(id -> getBooking(actor, id)).toList();
  }

  private Map<String, Object> lockTestRide(StaffPrincipal actor, UUID publicId) {
    List<Map<String, Object>> refs = jdbc.queryForList("""
        select id, enquiry_id, status, scheduled_start, scheduled_end
        from sales_test_ride where dealership_id = ? and public_id = ?
        for update
        """, actor.dealershipId(), publicId);
    if (refs.isEmpty()) throw notFound("Test ride was not found in this dealership.");
    long id = number(refs.getFirst().get("id"));
    // Load public IDs and vehicle/enquiry context after the lock; all subsequent writes remain dealership-scoped.
    List<Map<String, Object>> rows = jdbc.queryForList("""
        select ride.id, ride.enquiry_id, ride.status, ride.scheduled_start, ride.scheduled_end,
          enquiry.public_id as enquiry_public_id, vehicle.public_id as vehicle_public_id
        from sales_test_ride ride
        join sales_enquiry enquiry on enquiry.dealership_id = ride.dealership_id and enquiry.id = ride.enquiry_id
        join vehicle_unit vehicle on vehicle.dealership_id = ride.dealership_id and vehicle.id = ride.vehicle_unit_id
        where ride.dealership_id = ? and ride.id = ?
        """, actor.dealershipId(), id);
    if (rows.isEmpty()) throw notFound("Test ride was not found in this dealership.");
    return rows.getFirst();
  }

  private long requireEnquiryId(StaffPrincipal actor, UUID publicId) {
    List<Long> ids = jdbc.query("""
        select id from sales_enquiry where dealership_id = ? and public_id = ?
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), publicId);
    if (ids.isEmpty()) throw notFound("Sales enquiry was not found in this dealership.");
    return ids.getFirst();
  }

  private long requireCustomerId(StaffPrincipal actor, UUID publicId) {
    List<Long> ids = jdbc.query("""
        select id from customer where dealership_id = ? and public_id = ? and status = 'ACTIVE'
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), publicId);
    if (ids.isEmpty()) throw notFound("Active customer was not found in this dealership.");
    return ids.getFirst();
  }

  private long requireModelId(StaffPrincipal actor, UUID publicId) {
    List<Long> ids = jdbc.query("""
        select id from vehicle_model where dealership_id = ? and public_id = ? and active = true
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), publicId);
    if (ids.isEmpty()) throw notFound("Active vehicle model was not found in this dealership.");
    return ids.getFirst();
  }

  private long requireActiveStaffId(StaffPrincipal actor, UUID publicId) {
    List<Long> ids = jdbc.query("""
        select id from staff_user where dealership_id = ? and public_id = ? and status = 'ACTIVE'
        """, (rs, rowNum) -> rs.getLong(1), actor.dealershipId(), publicId);
    if (ids.isEmpty()) throw notFound("Active staff member was not found in this dealership.");
    return ids.getFirst();
  }

  private void addActivity(
      StaffPrincipal actor, long enquiryId, String type, String from, String to,
      String note, Instant followUpAt, String referenceType, String referenceId) {
    jdbc.update("""
        insert into sales_enquiry_activity(
          dealership_id, enquiry_id, activity_type, from_status, to_status, note, follow_up_at,
          reference_type, reference_id, actor_staff_user_id)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, actor.dealershipId(), enquiryId, type, from, to, note,
        followUpAt == null ? null : Timestamp.from(followUpAt), referenceType, referenceId, actor.staffUserId());
  }

  private void audit(StaffPrincipal actor, String action, String type, String id, String summary) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, ?, ?, jsonb_build_object('summary', ?))
        """, actor.dealershipId(), actor.staffUserId(), action, type, id, summary);
  }

  private static boolean allowedStatusTransition(String from, String to) {
    return switch (from) {
      case "NEW" -> Set.of("CONTACTED", "QUALIFIED", "LOST", "CLOSED").contains(to);
      case "CONTACTED" -> Set.of("QUALIFIED", "TEST_RIDE_SCHEDULED", "LOST", "CLOSED").contains(to);
      case "QUALIFIED" -> Set.of("CONTACTED", "TEST_RIDE_SCHEDULED", "LOST", "CLOSED").contains(to);
      case "TEST_RIDE_SCHEDULED" -> Set.of("CONTACTED", "QUALIFIED", "LOST", "CLOSED").contains(to);
      case "LOST", "CLOSED" -> Set.of("CONTACTED", "QUALIFIED").contains(to);
      default -> false;
    };
  }

  private static String normalizeChoice(String raw, String label, Set<String> allowed, String fallback) {
    String value = raw == null || raw.isBlank() ? fallback : raw.trim().toUpperCase(Locale.ROOT);
    if (value == null || !allowed.contains(value)) throw badRequest("Choose a supported " + label.toLowerCase(Locale.ROOT) + ".");
    return value;
  }

  private static String required(String value, String label, int maxLength) {
    String cleaned = optional(value, maxLength);
    if (cleaned == null) throw badRequest(label + " is required.");
    return cleaned;
  }

  private static String optional(String value, int maxLength) {
    if (value == null) return null;
    String cleaned = value.trim();
    if (cleaned.isEmpty()) return null;
    if (cleaned.length() > maxLength || cleaned.chars().anyMatch(Character::isISOControl)) {
      throw badRequest("One of the submitted fields is invalid.");
    }
    return cleaned;
  }

  private static String cleanSearch(String raw) {
    if (raw == null || raw.isBlank()) return null;
    String value = raw.trim();
    return value.substring(0, Math.min(100, value.length()));
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  private static PageWindow window(int requestedPage, int requestedSize) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int size = Math.max(1, Math.min(requestedSize, 100));
    return new PageWindow(page, size, (long) page * size);
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static Instant instantOrNull(Timestamp value) {
    return value == null ? null : value.toInstant();
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

  public record EnquiryRequest(
      UUID customerPublicId, UUID interestedModelPublicId, UUID assignedStaffPublicId,
      String leadSource, String contactPreference, Instant nextFollowUpAt, String note) {}
  public record StatusRequest(String status, String note) {}
  public record FollowUpRequest(Instant followUpAt, String note) {}
  public record TestRideRequest(UUID vehicleUnitPublicId, Instant scheduledStart, Instant scheduledEnd, String notes) {}
  public record BookingRequest(UUID vehicleUnitPublicId, String notes) {}
  public record BookingCancelRequest(String reason) {}
  public record EnquiryView(
      UUID publicId, String enquiryCode, UUID customerPublicId, String customerCode,
      String customerName, String customerPhone, String customerEmail,
      UUID interestedModelPublicId, String modelCode, String modelName, String variantName, String colourName,
      UUID assignedStaffPublicId, String assignedStaffName, String status, String leadSource,
      String contactPreference, Instant nextFollowUpAt, Instant lastContactedAt, String notes,
      Instant createdAt, Instant updatedAt) {}
  public record ActivityView(
      UUID publicId, String activityType, String fromStatus, String toStatus, String note, Instant followUpAt,
      String referenceType, String referenceId, String actorName, Instant createdAt) {}
  public record EnquiryDetailView(
      EnquiryView enquiry, List<ActivityView> activities, List<TestRideView> testRides, List<BookingView> bookings) {}
  public record TestRideView(
      UUID publicId, String testRideCode, String status, UUID enquiryPublicId, String enquiryCode, String customerName,
      UUID vehiclePublicId, String modelCode, String modelName, String variantName, String colourName,
      String chassisNumber, String engineNumber, Instant scheduledStart, Instant scheduledEnd, String notes,
      String createdByName, String checkedOutByName, String completedByName,
      Instant checkedOutAt, Instant completedAt, Instant cancelledAt, String cancellationReason) {}
  public record BookingView(
      UUID publicId, String bookingCode, UUID enquiryPublicId, String enquiryCode,
      UUID customerPublicId, String customerCode, String customerName, String customerPhone,
      UUID vehiclePublicId, String modelCode, String modelName, String variantName, String colourName,
      String chassisNumber, String engineNumber, String vehicleStockStatus, String status, String notes,
      String createdByName, Instant createdAt, Instant cancelledAt, String cancellationReason) {}
  public record Page<T>(List<T> items, int page, int pageSize, long total) {}
  private record PageWindow(int page, int size, long offset) {}
}
