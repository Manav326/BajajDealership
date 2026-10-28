package com.quantaedge.bajaj.customers;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Dealership-scoped customer operations. Scope comes only from the authenticated staff principal. */
@Service
public class CustomerService {
  private static final RowMapper<CustomerView> CUSTOMER_ROW = (rs, rowNum) -> new CustomerView(
      rs.getObject("public_id", UUID.class),
      rs.getString("customer_code"),
      rs.getString("full_name"),
      rs.getString("phone"),
      rs.getString("alternate_phone"),
      rs.getString("email"),
      rs.getString("preferred_language"),
      rs.getString("status"),
      rs.getTimestamp("created_at").toInstant(),
      rs.getTimestamp("updated_at").toInstant());

  private final JdbcTemplate jdbc;

  public CustomerService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Page<CustomerView> list(
      StaffPrincipal principal, int requestedPage, int requestedPageSize, String query) {
    int page = Math.max(0, Math.min(requestedPage, 1_000_000));
    int pageSize = Math.max(1, Math.min(requestedPageSize, 100));
    long offset = (long) page * pageSize;
    String term = normalizeSearch(query);

    String where = " where dealership_id = ? ";
    Object[] filterArguments = new Object[] {principal.dealershipId()};
    if (!term.isEmpty()) {
      where += " and (lower(full_name) like ? escape '!' or phone like ? escape '!' "
          + "or customer_code ilike ? escape '!' or lower(coalesce(email, '')) like ? escape '!') ";
      String like = "%" + escapeLike(term.toLowerCase(Locale.ROOT)) + "%";
      String phoneLike = "%" + escapeLike(term) + "%";
      filterArguments = new Object[] {principal.dealershipId(), like, phoneLike, phoneLike, like};
    }

    Long totalValue = jdbc.queryForObject(
        "select count(*) from customer" + where, Long.class, filterArguments);
    long total = totalValue == null ? 0 : totalValue;

    Object[] pageArguments = java.util.Arrays.copyOf(filterArguments, filterArguments.length + 2);
    pageArguments[filterArguments.length] = pageSize;
    pageArguments[filterArguments.length + 1] = offset;
    List<CustomerView> items = jdbc.query(
        """
        select public_id, customer_code, full_name, phone, alternate_phone, email,
               preferred_language, status, created_at, updated_at
        from customer
        """ + where + " order by lower(full_name), id limit ? offset ?",
        CUSTOMER_ROW, pageArguments);
    return new Page<>(items, page, pageSize, total);
  }

  public CustomerView get(StaffPrincipal principal, UUID publicId) {
    List<CustomerView> rows = jdbc.query(
        """
        select public_id, customer_code, full_name, phone, alternate_phone, email,
               preferred_language, status, created_at, updated_at
        from customer
        where dealership_id = ? and public_id = ?
        """,
        CUSTOMER_ROW, principal.dealershipId(), publicId);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Customer was not found.");
    }
    return rows.getFirst();
  }

  @Transactional
  public CustomerView create(StaffPrincipal principal, CustomerRequest request) {
    NormalizedCustomer data = normalize(request);
    if (data.phone() == null && data.email() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide a phone number or email address.");
    }
    if (data.marketingConsent() && (data.consentSource() == null || data.consentSource().isBlank())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Record the consent source when marketing consent is granted.");
    }

    String customerCode = "CUS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    UUID publicId;
    try {
      publicId = jdbc.queryForObject("""
          insert into customer(
            dealership_id, customer_code, full_name, phone, alternate_phone, email,
            preferred_language, marketing_consent_at, marketing_consent_source, status, notes)
          values (?, ?, ?, ?, ?, ?, ?, case when ? then now() else null end,
                  case when ? then ? else null end, 'ACTIVE', ?)
          returning public_id
          """, UUID.class,
          principal.dealershipId(), customerCode, data.fullName(), data.phone(), data.alternatePhone(),
          data.email(), data.preferredLanguage(), data.marketingConsent(), data.marketingConsent(),
          data.consentSource(), data.notes());
    } catch (org.springframework.dao.DuplicateKeyException failure) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "A duplicate customer record was detected. Retry the operation.", failure);
    }

    audit(principal, "CUSTOMER_CREATED", publicId, "Customer contact and preference fields created.");
    return get(principal, publicId);
  }

  @Transactional
  public CustomerView update(StaffPrincipal principal, UUID publicId, CustomerRequest request) {
    NormalizedCustomer data = normalize(request);
    if (data.phone() == null && data.email() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide a phone number or email address.");
    }
    if (data.marketingConsent() && (data.consentSource() == null || data.consentSource().isBlank())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Record the consent source when marketing consent is granted.");
    }

    List<Map<String, Object>> existingRows = jdbc.queryForList("""
        select marketing_consent_at, marketing_consent_source
        from customer where dealership_id = ? and public_id = ? for update
        """, principal.dealershipId(), publicId);
    if (existingRows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Customer was not found.");
    }

    Map<String, Object> existing = existingRows.getFirst();
    boolean hadConsent = existing.get("marketing_consent_at") != null;
    boolean consentWasProvided = request.marketingConsent() != null;
    boolean nextConsent = consentWasProvided ? data.marketingConsent() : hadConsent;
    String nextConsentSource = consentWasProvided
        ? (nextConsent ? data.consentSource() : null)
        : (String) existing.get("marketing_consent_source");

    jdbc.update("""
        update customer set
          full_name = ?, phone = ?, alternate_phone = ?, email = ?,
          preferred_language = ?, notes = ?,
          marketing_consent_at = case
            when ? = false then null
            when marketing_consent_at is null then now()
            else marketing_consent_at end,
          marketing_consent_source = ?,
          updated_at = now()
        where dealership_id = ? and public_id = ?
        """,
        data.fullName(), data.phone(), data.alternatePhone(), data.email(),
        data.preferredLanguage(), data.notes(), nextConsent, nextConsentSource,
        principal.dealershipId(), publicId);

    String action = consentWasProvided && hadConsent != nextConsent
        ? (nextConsent ? "CUSTOMER_MARKETING_CONSENT_GRANTED" : "CUSTOMER_MARKETING_CONSENT_WITHDRAWN")
        : "CUSTOMER_UPDATED";
    audit(principal, action, publicId,
        consentWasProvided ? "Customer fields updated; explicit consent was recorded."
            : "Customer contact and preference fields updated.");
    return get(principal, publicId);
  }

  private void audit(StaffPrincipal principal, String action, UUID customerPublicId, String description) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, actor_staff_user_id, action, entity_type, entity_id, details)
        values (?, 'STAFF', ?, ?, 'CUSTOMER', ?, jsonb_build_object('summary', ?))
        """,
        principal.dealershipId(), principal.staffUserId(), action,
        customerPublicId.toString(), description);
  }

  private static NormalizedCustomer normalize(CustomerRequest request) {
    String fullName = clean(request.fullName());
    if (fullName == null || fullName.length() < 2) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Customer name must contain at least two characters.");
    }
    String phone = clean(request.phone());
    String alternatePhone = clean(request.alternatePhone());
    String email = clean(request.email());
    if (phone != null) phone = phone.replaceAll("[\\s()\\-]", "");
    if (alternatePhone != null) alternatePhone = alternatePhone.replaceAll("[\\s()\\-]", "");
    if (email != null) email = email.toLowerCase(Locale.ROOT);
    String language = clean(request.preferredLanguage());
    if (language == null) language = "hi";
    language = language.toLowerCase(Locale.ROOT);
    if (!List.of("hi", "en", "hinglish").contains(language)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Preferred language must be hi, en or hinglish.");
    }
    String notes = clean(request.notes());
    String consentSource = clean(request.consentSource());
    return new NormalizedCustomer(
        fullName, phone, alternatePhone, email, language,
        Boolean.TRUE.equals(request.marketingConsent()), consentSource, notes);
  }

  private static String clean(String value) {
    if (value == null) return null;
    String cleaned = value.trim();
    return cleaned.isEmpty() ? null : cleaned;
  }

  private static String normalizeSearch(String value) {
    if (value == null) return "";
    String cleaned = value.trim();
    return cleaned.substring(0, Math.min(cleaned.length(), 100));
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  public record CustomerRequest(
      String fullName,
      String phone,
      String alternatePhone,
      String email,
      String preferredLanguage,
      Boolean marketingConsent,
      String consentSource,
      String notes) {}

  public record CustomerView(
      UUID publicId,
      String customerCode,
      String fullName,
      String phone,
      String alternatePhone,
      String email,
      String preferredLanguage,
      String status,
      Instant createdAt,
      Instant updatedAt) {}

  public record Page<T>(List<T> items, int page, int pageSize, long total) {}

  private record NormalizedCustomer(
      String fullName, String phone, String alternatePhone, String email,
      String preferredLanguage, boolean marketingConsent, String consentSource, String notes) {}
}
