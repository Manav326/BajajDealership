package com.quantaedge.bajaj.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
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

@Configuration
@EnableMethodSecurity
public class StaffSecurityConfiguration {
  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http, StaffBearerTokenFilter bearerFilter) throws Exception {
    http
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
            .requestMatchers("/api/v1/system/health", "/actuator/health", "/actuator/health/**").permitAll()
            .requestMatchers(HttpMethod.POST, "/api/v1/system/bootstrap", "/api/v1/auth/staff/login").permitAll()
            .requestMatchers("/api/v1/auth/staff/me", "/api/v1/auth/staff/logout").authenticated()
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            .anyRequest().authenticated())
        .addFilterBefore(bearerFilter, UsernamePasswordAuthenticationFilter.class);
    return http.build();
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
