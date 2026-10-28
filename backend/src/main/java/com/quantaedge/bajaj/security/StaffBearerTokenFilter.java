package com.quantaedge.bajaj.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class StaffBearerTokenFilter extends OncePerRequestFilter {
  private final JdbcTemplate jdbc;

  public StaffBearerTokenFilter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String authorization = request.getHeader("Authorization");
    if (authorization == null || !authorization.startsWith("Bearer ")) {
      chain.doFilter(request, response);
      return;
    }

    String rawToken = authorization.substring(7).trim();
    if (rawToken.isEmpty() || rawToken.length() > 200) {
      reject(response);
      return;
    }

    try {
      String tokenHash = TokenDigests.sha256(rawToken);
      List<Map<String, Object>> rows = jdbc.queryForList("""
          select ss.id as session_id, u.id as staff_user_id, u.public_id::text as staff_public_id,
                 u.dealership_id, d.public_id::text as dealership_public_id,
                 d.code as dealership_code, u.full_name
          from staff_session ss
          join staff_user u on u.id = ss.staff_user_id and u.dealership_id = ss.dealership_id
          join dealership d on d.id = ss.dealership_id
          where ss.token_hash = ? and ss.revoked_at is null and ss.expires_at > now()
            and u.status = 'ACTIVE' and d.status = 'ACTIVE'
          """, tokenHash);

      if (rows.size() != 1) {
        reject(response);
        return;
      }

      Map<String, Object> row = rows.getFirst();
      long staffId = number(row.get("staff_user_id"));
      long dealershipId = number(row.get("dealership_id"));
      Set<String> roles = new LinkedHashSet<>(jdbc.query(
          """
          select r.code from staff_user_role ur
          join role r on r.id = ur.role_id
          where ur.staff_user_id = ? and ur.dealership_id = ?
          order by r.code
          """,
          (result, index) -> result.getString(1), staffId, dealershipId));
      Set<String> permissions = new LinkedHashSet<>(jdbc.query(
          """
          select distinct p.code
          from staff_user_role ur
          join role_permission rp on rp.role_id = ur.role_id
          join permission p on p.id = rp.permission_id
          where ur.staff_user_id = ? and ur.dealership_id = ?
          order by p.code
          """,
          (result, index) -> result.getString(1), staffId, dealershipId));

      StaffPrincipal principal = new StaffPrincipal(
          number(row.get("session_id")),
          staffId,
          String.valueOf(row.get("staff_public_id")),
          dealershipId,
          String.valueOf(row.get("dealership_public_id")),
          String.valueOf(row.get("dealership_code")),
          String.valueOf(row.get("full_name")),
          Set.copyOf(roles),
          Set.copyOf(permissions));

      List<SimpleGrantedAuthority> authorities = new java.util.ArrayList<>();
      roles.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
      permissions.forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
      SecurityContextHolder.getContext().setAuthentication(
          UsernamePasswordAuthenticationToken.authenticated(principal, null, authorities));
      jdbc.update("""
          update staff_session set last_seen_at = now()
          where id = ? and last_seen_at < now() - interval '5 minutes'
          """, principal.sessionId());
      chain.doFilter(request, response);
    } catch (RuntimeException failure) {
      SecurityContextHolder.clearContext();
      reject(response);
    }
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static void reject(HttpServletResponse response) throws IOException {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    response.setContentType("application/json");
    response.setCharacterEncoding("UTF-8");
    response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"A valid staff session is required.\"}");
  }
}
