package com.quantaedge.bajaj.sales;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/sales/customer-requests")
public class CustomerSalesRequestAdminController {
  private final CustomerSalesRequestService requests;

  public CustomerSalesRequestAdminController(CustomerSalesRequestService requests) {
    this.requests = requests;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('sales.read')")
  public List<CustomerSalesRequestService.RequestView> list(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
      @RequestParam(required = false) @Size(max = 20) String status) {
    return requests.listForStaff(principal, limit, status);
  }

  @PostMapping("/{publicId}/convert")
  @PreAuthorize("hasAuthority('sales.manage')")
  public CustomerSalesRequestService.RequestView convert(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return requests.convertToEnquiry(principal, publicId);
  }
}
