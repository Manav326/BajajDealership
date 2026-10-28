package com.quantaedge.bajaj.security;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth/staff")
public class StaffActivationController {
  private final StaffAccessManagementService access;

  public StaffActivationController(StaffAccessManagementService access) {
    this.access = access;
  }

  @PostMapping("/activate")
  public StaffAccessManagementService.ActivationResult activate(@Valid @RequestBody ActivationRequest request) {
    return access.activate(request.activationToken(), request.password());
  }

  public record ActivationRequest(
      @NotBlank @Size(max = 128) String activationToken,
      @NotBlank @Size(min = 12, max = 72) String password) {}
}
