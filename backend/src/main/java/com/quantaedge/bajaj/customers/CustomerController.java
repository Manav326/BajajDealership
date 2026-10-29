package com.quantaedge.bajaj.customers;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/customers")
public class CustomerController {
  private final CustomerService customers;

  public CustomerController(CustomerService customers) {
    this.customers = customers;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('customer.read')")
  public CustomerService.Page<CustomerService.CustomerView> list(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int pageSize,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return customers.list(principal, page, pageSize, q);
  }

  @GetMapping("/{publicId}")
  @PreAuthorize("hasAuthority('customer.read')")
  public CustomerService.CustomerView get(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return customers.get(principal, publicId);
  }

  @GetMapping("/{publicId}/saved-addresses")
  @PreAuthorize("hasAuthority('customer.read')")
  public java.util.List<CustomerService.CustomerAddressView> savedAddresses(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return customers.savedAddresses(principal, publicId);
  }

  @GetMapping("/{publicId}/profile-photo")
  @PreAuthorize("hasAuthority('customer.read')")
  public ResponseEntity<byte[]> profilePhoto(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    CustomerService.CustomerProfilePhoto photo = customers.profilePhoto(principal, publicId);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(photo.contentType()))
        .contentLength(photo.bytes().length).cacheControl(CacheControl.noStore())
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
        .header("X-Content-Type-Options", "nosniff").body(photo.bytes());
  }

  @GetMapping("/{publicId}/history")
  @PreAuthorize("hasAuthority('customer.read')")
  public CustomerService.CustomerHistoryView history(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return customers.history(principal, publicId);
  }

  @PostMapping
  @PreAuthorize("hasAuthority('customer.create')")
  public CustomerService.CustomerView create(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody CustomerRequest request) {
    return customers.create(principal, request.toServiceRequest());
  }

  @PutMapping("/{publicId}")
  @PreAuthorize("hasAuthority('customer.update')")
  public CustomerService.CustomerView update(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody CustomerRequest request) {
    return customers.update(principal, publicId, request.toServiceRequest());
  }

  public record CustomerRequest(
      @NotBlank @Size(min = 2, max = 160) String fullName,
      @Size(max = 32) @Pattern(regexp = "[+0-9() .-]*") String phone,
      @Size(max = 32) @Pattern(regexp = "[+0-9() .-]*") String alternatePhone,
      @Email @Size(max = 320) String email,
      @Pattern(regexp = "hi|en|hinglish") String preferredLanguage,
      Boolean marketingConsent,
      @Size(max = 80) String consentSource,
      @Size(max = 3000) String notes) {
    CustomerService.CustomerRequest toServiceRequest() {
      return new CustomerService.CustomerRequest(fullName, phone, alternatePhone, email,
          preferredLanguage, marketingConsent, consentSource, notes);
    }
  }
}
