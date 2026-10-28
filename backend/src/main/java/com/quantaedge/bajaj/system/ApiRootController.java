package com.quantaedge.bajaj.system;

import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public API entry point: discover health and sign-in routes without exposing business data. */
@RestController
public class ApiRootController {
  @GetMapping("/")
  public Map<String, Object> root() {
    return Map.of(
        "service", "Lucky Bajaj Agency API",
        "status", "available",
        "message", "The API is reachable. Business endpoints require an authenticated session.",
        "health", List.of("/actuator/health", "/api/v1/system/health"),
        "staffSignIn", "/api/v1/auth/staff/login",
        "customerSignIn", "/api/v1/customer/auth/login");
  }
}
