package com.quantaedge.bajaj.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableMethodSecurity
public class StaffSecurityConfiguration {
  /**
   * Keep first-owner bootstrap on a dedicated anonymous chain.
   *
   * The controller still validates a one-time high-entropy token and serializes
   * competing requests, but setup must not depend on an existing staff session.
   */
  @Bean
  @Order(1)
  SecurityFilterChain anonymousBootstrapSecurityFilterChain(
      HttpSecurity http, CorsConfigurationSource corsConfigurationSource) throws Exception {
    http
        .securityMatcher("/api/v1/system/bootstrap", "/api/v1/system/bootstrap/status")
        .cors(cors -> cors.configurationSource(corsConfigurationSource))
        .csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
    return http.build();
  }

  @Bean
  @Order(2)
  SecurityFilterChain securityFilterChain(HttpSecurity http, StaffBearerTokenFilter bearerFilter, CustomerBearerTokenFilter customerBearerFilter, CorsConfigurationSource corsConfigurationSource) throws Exception {
    http
        .cors(cors -> cors.configurationSource(corsConfigurationSource))
        .csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .exceptionHandling(errors -> errors
            .authenticationEntryPoint((request, response, exception) -> {
              response.setStatus(401);
              response.setContentType("application/json");
              response.setCharacterEncoding("UTF-8");
              response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"Sign in is required.\"}");
            })
            .accessDeniedHandler((request, response, exception) -> {
              response.setStatus(403);
              response.setContentType("application/json");
              response.setCharacterEncoding("UTF-8");
              response.getWriter().write("{\"error\":\"forbidden\",\"message\":\"You do not have permission for this action.\"}");
            }))
        .authorizeHttpRequests(auth -> auth
            // Let Spring render the original HTTP error response instead of turning
            // controller errors (for example an invalid bootstrap token's 404) into a 401.
            // The original request is still authorized normally before any error dispatch.
            .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            .requestMatchers("/", "/api/v1/system/health", "/actuator/health", "/actuator/health/**").permitAll()
            // Fallback for bootstrap if the dedicated chain is bypassed by a servlet-path customization.
            // Keep the scope to these two setup endpoints; all dealership business APIs stay authenticated.
            .requestMatchers(HttpMethod.POST, "/api/v1/system/bootstrap").permitAll()
            .requestMatchers(HttpMethod.GET, "/api/v1/system/bootstrap/status").permitAll()
            .requestMatchers(HttpMethod.POST, "/api/v1/auth/staff/login", "/api/v1/auth/staff/activate", "/api/v1/customer/auth/login", "/api/v1/customer/auth/activate").permitAll()
            .requestMatchers("/api/v1/auth/staff/me", "/api/v1/auth/staff/logout").authenticated()
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            .anyRequest().authenticated())
        .addFilterBefore(bearerFilter, UsernamePasswordAuthenticationFilter.class)
        .addFilterBefore(customerBearerFilter, StaffBearerTokenFilter.class);
    return http.build();
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource(
      @Value("${app.cors.allowed-origins:}") String configuredOrigins,
      @Value("${app.cors.allowed-origin-1:}") String originOne,
      @Value("${app.cors.allowed-origin-2:}") String originTwo) {
    List<String> allowedOrigins = new ArrayList<>();
    addOrigins(allowedOrigins, configuredOrigins);
    addOrigins(allowedOrigins, originOne);
    addOrigins(allowedOrigins, originTwo);

    CorsConfiguration configuration = new CorsConfiguration();
    configuration.setAllowedOrigins(allowedOrigins.stream().distinct().toList());
    configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    configuration.setAllowedHeaders(Arrays.asList(
        "Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With", "Idempotency-Key", "X-Bootstrap-Token"));
    configuration.setExposedHeaders(List.of("Retry-After"));
    configuration.setAllowCredentials(false);
    configuration.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", configuration);
    source.registerCorsConfiguration("/actuator/**", configuration);
    return source;
  }

  private static void addOrigins(List<String> origins, String raw) {
    if (raw == null || raw.isBlank()) return;
    for (String candidate : raw.split(",")) {
      String origin = candidate.trim();
      if (!origin.isEmpty()) origins.add(origin);
    }
  }

  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  @Bean
  BootstrapTokenVerifier bootstrapTokenVerifier(@Value("${app.bootstrap.token:}") String configuredToken) {
    return supplied -> {
      if (configuredToken == null || configuredToken.isBlank() || supplied == null || supplied.isBlank()) {
        return false;
      }
      return MessageDigest.isEqual(
          configuredToken.getBytes(StandardCharsets.UTF_8),
          supplied.getBytes(StandardCharsets.UTF_8));
    };
  }

  @FunctionalInterface
  public interface BootstrapTokenVerifier {
    boolean matches(String suppliedToken);
  }
}
