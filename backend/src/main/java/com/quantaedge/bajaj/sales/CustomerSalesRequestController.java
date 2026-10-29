package com.quantaedge.bajaj.sales;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/customer/sales-requests")
@PreAuthorize("hasAuthority('customer.portal')")
public class CustomerSalesRequestController {
  private final CustomerSalesRequestService requests;

  public CustomerSalesRequestController(CustomerSalesRequestService requests) {
    this.requests = requests;
  }

  @GetMapping
  public List<CustomerSalesRequestService.RequestView> list(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return requests.listForCustomer(principal);
  }

  @PostMapping
  public CustomerSalesRequestService.RequestView create(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @Valid @RequestBody CreateRequest request) {
    return requests.create(principal, new CustomerSalesRequestService.CreateRequest(
        request.requestType(), request.modelCode(), request.preferredAt(), request.notes(), request.idempotencyKey()));
  }

  @PostMapping("/{publicId}/cancel")
  public CustomerSalesRequestService.RequestView cancel(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId) {
    return requests.cancelForCustomer(principal, publicId);
  }

  public record CreateRequest(
      @NotBlank @Pattern(regexp = "TEST_RIDE|PURCHASE") String requestType,
      @NotBlank @Size(max = 60) @Pattern(regexp = "[A-Za-z0-9][A-Za-z0-9._-]*") String modelCode,
      Instant preferredAt,
      @Size(max = 1000) String notes,
      @NotBlank @Size(max = 120) String idempotencyKey) {}
}
