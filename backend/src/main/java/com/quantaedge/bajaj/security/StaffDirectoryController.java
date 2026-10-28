package com.quantaedge.bajaj.security;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Read-only staff directory. Account-changing operations belong in a separate audited slice.
 * Every query is scoped from the authenticated staff principal, never from client input.
 */
@RestController
@RequestMapping("/api/v1/admin/staff")
@Validated
public class StaffDirectoryController {
  private final JdbcTemplate jdbc;

  public StaffDirectoryController(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('staff.read')")
  public StaffPage list(
      @AuthenticationPrincipal StaffPrincipal actor,
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q) {
    SearchFilter filter = searchFilter(actor, q);
    Long totalValue = jdbc.queryForObject(
        "select count(*) from staff_user u" + filter.where(), Long.class, filter.args().toArray());
    long total = totalValue == null ? 0 : totalValue;
    long offset = (long) page * pageSize;
    List<Object> args = new ArrayList<>(filter.args());
    args.add(pageSize);
    args.add(offset);

    List<StaffRecord> items = jdbc.query("""
        select u.public_id::text as public_id, u.full_name, u.email, u.phone, u.status,
          u.last_login_at, u.created_at,
          coalesce(string_agg(distinct r.code, ',' order by r.code), '') as roles
        from staff_user u
        left join staff_user_role ur
          on ur.dealership_id = u.dealership_id and ur.staff_user_id = u.id
        left join role r on r.id = ur.role_id
        """ + filter.where() + """
        group by u.id
        order by lower(u.full_name), u.id
        limit ? offset ?
        """, STAFF_ROW_MAPPER, args.toArray());

    return new StaffPage(items, page, pageSize, total);
  }

  @GetMapping("/{staffPublicId}")
  @PreAuthorize("hasAuthority('staff.read')")
  public StaffDetail detail(
      @AuthenticationPrincipal StaffPrincipal actor,
      @PathVariable UUID staffPublicId) {
    List<StaffAccount> accounts = jdbc.query("""
        select u.id, u.public_id::text as public_id, u.full_name, u.email, u.phone,
          u.status, u.last_login_at, u.created_at
        from staff_user u
        where u.dealership_id = ? and u.public_id = ?
        """, (rs, rowNum) -> new StaffAccount(
            rs.getLong("id"),
            UUID.fromString(rs.getString("public_id")),
            rs.getString("full_name"),
            rs.getString("email"),
            rs.getString("phone"),
            rs.getString("status"),
            instant(rs, "last_login_at"),
            instant(rs, "created_at")),
        actor.dealershipId(), staffPublicId);

    if (accounts.isEmpty()) {
      // Do not reveal whether an identifier belongs to another dealership.
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Staff record was not found.");
    }

    StaffAccount account = accounts.getFirst();
    List<String> roles = jdbc.query("""
        select r.code
        from staff_user_role ur
        join role r on r.id = ur.role_id
        where ur.dealership_id = ? and ur.staff_user_id = ?
        order by r.code
        """, (rs, rowNum) -> rs.getString(1), actor.dealershipId(), account.id());

    List<String> permissions = jdbc.query("""
        select distinct p.code
        from staff_user_role ur
        join role_permission rp on rp.role_id = ur.role_id
        join permission p on p.id = rp.permission_id
        where ur.dealership_id = ? and ur.staff_user_id = ?
        order by p.code
        """, (rs, rowNum) -> rs.getString(1), actor.dealershipId(), account.id());

    return new StaffDetail(account.publicId(), account.fullName(), account.email(), account.phone(),
        account.status(), roles, permissions, account.lastLoginAt(), account.createdAt());
  }

  private SearchFilter searchFilter(StaffPrincipal actor, String query) {
    String trimmed = query == null ? "" : query.trim();
    StringBuilder where = new StringBuilder(" where u.dealership_id = ? ");
    List<Object> args = new ArrayList<>();
    args.add(actor.dealershipId());

    if (!trimmed.isEmpty()) {
      String escaped = escapeLike(trimmed.toLowerCase(Locale.ROOT));
      String pattern = "%" + escaped + "%";
      where.append("""
          and (
            lower(u.full_name) like ? escape '!'
            or lower(coalesce(u.email, '')) like ? escape '!'
            or coalesce(u.phone, '') like ? escape '!'
          )
          """);
      args.add(pattern);
      args.add(pattern);
      args.add("%" + escapeLike(trimmed) + "%");
    }

    return new SearchFilter(where.toString(), args);
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    Timestamp value = rs.getTimestamp(column);
    return value == null ? null : value.toInstant();
  }

  private static List<String> splitRoles(String value) {
    if (value == null || value.isBlank()) return List.of();
    return Arrays.stream(value.split(",")).filter(part -> !part.isBlank()).toList();
  }

  private static final RowMapper<StaffRecord> STAFF_ROW_MAPPER = (rs, rowNum) -> new StaffRecord(
      UUID.fromString(rs.getString("public_id")),
      rs.getString("full_name"),
      rs.getString("email"),
      rs.getString("phone"),
      rs.getString("status"),
      splitRoles(rs.getString("roles")),
      instant(rs, "last_login_at"),
      instant(rs, "created_at"));

  private record SearchFilter(String where, List<Object> args) {}
  private record StaffAccount(
      long id, UUID publicId, String fullName, String email, String phone, String status,
      Instant lastLoginAt, Instant createdAt) {}

  public record StaffPage(List<StaffRecord> items, int page, int pageSize, long total) {}
  public record StaffRecord(
      UUID publicId, String fullName, String email, String phone, String status,
      List<String> roles, Instant lastLoginAt, Instant createdAt) {}
  public record StaffDetail(
      UUID publicId, String fullName, String email, String phone, String status,
      List<String> roles, List<String> permissions, Instant lastLoginAt, Instant createdAt) {}
}
