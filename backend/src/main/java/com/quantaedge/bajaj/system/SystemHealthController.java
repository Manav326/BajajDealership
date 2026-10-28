package com.quantaedge.bajaj.system;

import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class SystemHealthController {
  private final String appName;
  private final String version;

  public SystemHealthController(
      @Value("${spring.application.name:bajaj-dealership-api}") String appName,
      @Value("${app.version:development}") String version) {
    this.appName = appName;
    this.version = version;
  }

  @GetMapping("/health")
  public HealthResponse health() {
    return new HealthResponse("UP", appName, version, Instant.now());
  }

  public record HealthResponse(String status, String service, String version, Instant timestamp) {}
}
