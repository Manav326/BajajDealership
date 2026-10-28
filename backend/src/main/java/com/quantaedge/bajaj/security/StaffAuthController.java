package com.quantaedge.bajaj.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/auth/staff")
public class StaffAuthController {
  private final StaffAuthenticationService authenticationService;

  public StaffAuthController(StaffAuthenticationService authenticationService) {
    this.authenticationService = authenticationService;
  }

  @PostMapping("/login")
  public LoginResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
    StaffAuthenticationService.IssuedSession issued = authenticationService.login(
        request.dealershipCode(), request.login(), request.password(),
        httpRequest.getRemoteAddr(), httpRequest.getHeader("User-Agent"));
    StaffPrincipal principal = issued.principal();
    return new LoginResponse(issued.accessToken(), "Bearer", issued.expiresAt(),
        new StaffSummary(principal.staffPublicId(), principal.fullName(),
            principal.dealershipPublicId(), principal.dealershipCode(),
            principal.roles(), principal.permissions()));
  }

  @GetMapping("/me")
  public StaffSummary me(@AuthenticationPrincipal StaffPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A staff session is required.");
    }
    return new StaffSummary(principal.staffPublicId(), principal.fullName(),
        principal.dealershipPublicId(), principal.dealershipCode(),
        principal.roles(), principal.permissions());
  }

  @PostMapping("/logout")
  public void logout(@AuthenticationPrincipal StaffPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A staff session is required.");
    }
    authenticationService.revoke(principal);
  }

  public record LoginRequest(
      @NotBlank @Size(max = 40) String dealershipCode,
      @NotBlank @Size(max = 320) String login,
      @NotBlank @Size(max = 72) String password) {}

  public record StaffSummary(
      String staffPublicId,
      String fullName,
      String dealershipPublicId,
      String dealershipCode,
      Set<String> roles,
      Set<String> permissions) {}

  public record LoginResponse(String accessToken, String tokenType, Instant expiresAt, StaffSummary staff) {}
}
