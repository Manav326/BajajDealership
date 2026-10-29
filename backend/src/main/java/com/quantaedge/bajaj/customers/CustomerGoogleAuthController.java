package com.quantaedge.bajaj.customers;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Customer Google sign-in using the same public OAuth client ID and token-verification pattern as QuantaEdge. */
@RestController
@RequestMapping("/api/v1/customer/auth")
public class CustomerGoogleAuthController {
  private final CustomerGoogleIdentityService identities;
  private final CustomerAlternativeAuthService authentication;

  public CustomerGoogleAuthController(CustomerGoogleIdentityService identities, CustomerAlternativeAuthService authentication) {
    this.identities = identities;
    this.authentication = authentication;
  }

  @GetMapping("/google/config")
  public ResponseEntity<Map<String, Object>> config() {
    String clientId = identities.publicClientId();
    return ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .body(Map.of("configured", !clientId.isBlank(), "clientId", clientId));
  }

  @PostMapping("/google")
  public CustomerPortalService.PortalSession login(
      @Valid @RequestBody GoogleRequest request, HttpServletRequest httpRequest) {
    CustomerGoogleIdentityService.VerifiedIdentity identity = identities.verify(request.credential());
    return authentication.loginWithGoogle(request.dealershipCode(), identity,
        httpRequest.getRemoteAddr(), httpRequest.getHeader("User-Agent"));
  }

  public record GoogleRequest(
      @NotBlank @Size(max = 40) String dealershipCode,
      @NotBlank @Size(max = 12000) String credential) {}
}
