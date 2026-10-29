package com.quantaedge.bajaj.security;

import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * Public customer authentication endpoints only. This chain is deliberately narrow;
 * every customer-data endpoint continues through the standard authenticated chain.
 */
@Configuration
public class CustomerAnonymousAuthSecurityConfiguration {
  @Bean
  @Order(0)
  SecurityFilterChain customerAnonymousAuthFilterChain(
      HttpSecurity http, CorsConfigurationSource corsConfigurationSource) throws Exception {
    http
        .securityMatcher(
            "/api/v1/customer/auth/google/config",
            "/api/v1/customer/auth/google",
            "/api/v1/customer/auth/activate-with-username",
            "/api/v1/customer/auth/username-login")
        .cors(cors -> cors.configurationSource(corsConfigurationSource))
        .csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            .requestMatchers(HttpMethod.GET, "/api/v1/customer/auth/google/config").permitAll()
            .requestMatchers(HttpMethod.POST,
                "/api/v1/customer/auth/google",
                "/api/v1/customer/auth/activate-with-username",
                "/api/v1/customer/auth/username-login").permitAll()
            .anyRequest().denyAll());
    return http.build();
  }
}
