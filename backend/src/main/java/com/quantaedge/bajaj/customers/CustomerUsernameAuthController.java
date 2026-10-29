package com.quantaedge.bajaj.customers;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Username/password customer flows. Legacy customer-code login is retained separately. */
@RestController
@RequestMapping("/api/v1/customer/auth")
public class CustomerUsernameAuthController {
  private final CustomerAlternativeAuthService authentication;

  public CustomerUsernameAuthController(CustomerAlternativeAuthService authentication) {
    this.authentication = authentication;
  }

  @PostMapping("/activate-with-username")
  public CustomerPortalService.PortalSession activate(
      @Valid @RequestBody ActivateRequest request, HttpServletRequest httpRequest) {
    return authentication.activateWithUsername(request.activationToken(), request.username(), request.password(),
        httpRequest.getRemoteAddr(), httpRequest.getHeader("User-Agent"));
  }

  @PostMapping("/username-login")
  public CustomerPortalService.PortalSession login(
      @Valid @RequestBody UsernameLoginRequest request, HttpServletRequest httpRequest) {
    return authentication.loginWithUsername(request.dealershipCode(), request.username(), request.password(),
        httpRequest.getRemoteAddr(), httpRequest.getHeader("User-Agent"));
  }

  public record ActivateRequest(
      @NotBlank @Size(min = 32, max = 128) String activationToken,
      @NotBlank @Size(min = 3, max = 40) @Pattern(regexp = "[A-Za-z0-9._-]{3,40}") String username,
      @NotBlank @Size(min = 12, max = 128) String password) {}

  public record UsernameLoginRequest(
      @NotBlank @Size(max = 40) String dealershipCode,
      @NotBlank @Size(min = 3, max = 40) @Pattern(regexp = "[A-Za-z0-9._-]{3,40}") String username,
      @NotBlank @Size(max = 128) String password) {}
}
