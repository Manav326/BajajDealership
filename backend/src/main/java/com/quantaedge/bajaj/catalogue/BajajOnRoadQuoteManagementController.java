package com.quantaedge.bajaj.catalogue;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Dealership-scoped editor for sourced, effective-dated public estimate inputs. */
@RestController
@RequestMapping("/api/v1/admin/catalogue/pricing-profiles")
public class BajajOnRoadQuoteManagementController {
  private final BajajOnRoadQuoteService quotes;

  public BajajOnRoadQuoteManagementController(BajajOnRoadQuoteService quotes) {
    this.quotes = quotes;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('catalogue.read')")
  public ProfileList list(@AuthenticationPrincipal StaffPrincipal principal) {
    return new ProfileList(quotes.listProfiles(principal));
  }

  @PostMapping
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajOnRoadQuoteService.PriceProfileView create(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody PriceProfileRequest request) {
    return quotes.saveProfile(principal, null, request.toServiceRequest());
  }

  @PutMapping("/{publicId}")
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajOnRoadQuoteService.PriceProfileView update(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody PriceProfileRequest request) {
    return quotes.saveProfile(principal, publicId, request.toServiceRequest());
  }

  public record ProfileList(List<BajajOnRoadQuoteService.PriceProfileView> profiles) {}

  public record PriceProfileRequest(
      @NotBlank @Size(max = 60) String modelCode,
      @NotBlank @Size(max = 80) String city,
      @NotBlank @Size(max = 80) String state,
      @NotNull LocalDate effectiveFrom,
      LocalDate effectiveTo,
      @NotNull @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal exShowroomPrice,
      @NotNull @DecimalMin(value = "0") @Digits(integer = 12, fraction = 2) BigDecimal registrationFee,
      @NotNull @DecimalMin(value = "0") @DecimalMax(value = "100") @Digits(integer = 3, fraction = 4) BigDecimal roadTaxPercent,
      @NotNull @DecimalMin(value = "0") @Digits(integer = 12, fraction = 2) BigDecimal insuranceFee,
      @NotNull @DecimalMin(value = "0") @Digits(integer = 12, fraction = 2) BigDecimal handlingFee,
      @NotNull @DecimalMin(value = "0") @Digits(integer = 12, fraction = 2) BigDecimal otherCharges,
      @Size(max = 120) String otherChargesLabel,
      @NotBlank @Size(max = 1000) String sourceUrl,
      @Size(max = 500) String priceNote) {
    BajajOnRoadQuoteService.PriceProfileRequest toServiceRequest() {
      return new BajajOnRoadQuoteService.PriceProfileRequest(
          modelCode, city, state, effectiveFrom, effectiveTo, exShowroomPrice, registrationFee,
          roadTaxPercent, insuranceFee, handlingFee, otherCharges, otherChargesLabel, sourceUrl, priceNote);
    }
  }
}
