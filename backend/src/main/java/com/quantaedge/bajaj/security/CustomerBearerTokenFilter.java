package com.quantaedge.bajaj.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Resolves customer portal sessions only on customer portal routes. */
@Component
public class CustomerBearerTokenFilter extends OncePerRequestFilter {
  private final JdbcTemplate jdbc;

  public CustomerBearerTokenFilter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getServletPath().startsWith("/api/v1/customer/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String authorization = request.getHeader("Authorization");
    if (authorization == null || !authorization.startsWith("Bearer ")) {
      chain.doFilter(request, response);
      return;
    }

    String token = authorization.substring(7).trim();
    if (token.isEmpty() || token.length() > 200) {
      reject(response);
      return;
    }

    List<Map<String, Object>> rows = jdbc.queryForList("""
        select session.id as session_id, account.id as account_id,
          account.public_id::text as account_public_id,
          customer.id as customer_id, customer.public_id::text as customer_public_id,
          dealership.id as dealership_id, dealership.public_id::text as dealership_public_id,
          dealership.code as dealership_code, dealership.name as dealership_name,
          customer.customer_code, customer.full_name, customer.preferred_language,
          customer.phone, customer.email
        from customer_portal_session session
        join customer_portal_account account
          on account.dealership_id = session.dealership_id and account.id = session.account_id
        join customer
          on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = session.dealership_id
        where session.token_hash = ? and session.revoked_at is null and session.expires_at > now()
          and account.status = 'ACTIVE' and customer.status = 'ACTIVE' and dealership.status = 'ACTIVE'
        """, TokenDigests.sha256(token));

    if (rows.size() != 1) {
      reject(response);
      return;
    }

    Map<String, Object> row = rows.getFirst();
    CustomerPrincipal principal = new CustomerPrincipal(
        number(row.get("session_id")), number(row.get("account_id")),
        String.valueOf(row.get("account_public_id")), number(row.get("customer_id")),
        String.valueOf(row.get("customer_public_id")), number(row.get("dealership_id")),
        String.valueOf(row.get("dealership_public_id")), String.valueOf(row.get("dealership_code")),
        String.valueOf(row.get("dealership_name")), String.valueOf(row.get("customer_code")),
        String.valueOf(row.get("full_name")), String.valueOf(row.get("preferred_language")),
        row.get("phone") == null ? null : String.valueOf(row.get("phone")),
        row.get("email") == null ? null : String.valueOf(row.get("email")));

    SecurityContextHolder.getContext().setAuthentication(
        UsernamePasswordAuthenticationToken.authenticated(
            principal, null, List.of(new SimpleGrantedAuthority("customer.portal"))));

    jdbc.update("""
        update customer_portal_session set last_seen_at = now()
        where id = ? and last_seen_at < now() - interval '5 minutes'
        """, principal.sessionId());
    chain.doFilter(request, response);
  }

  private static long number(Object value) {
    return ((Number) value).longValue();
  }

  private static void reject(HttpServletResponse response) throws IOException {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    response.setContentType("application/json");
    response.setCharacterEncoding("UTF-8");
    response.getWriter().write(
        "{\"error\":\"unauthorized\",\"message\":\"A valid customer portal session is required.\"}");
  }
}
