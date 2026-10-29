package com.quantaedge.bajaj.catalogue;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/public/catalogue")
public class BajajCatalogueController {
  private final BajajCatalogueService catalogue;

  public BajajCatalogueController(BajajCatalogueService catalogue) {
    this.catalogue = catalogue;
  }

  /** Browseable before customer login. No unit identifiers, supplier cost, or customer data are returned. */
  @GetMapping("/bikes")
  public BajajCatalogueService.CatalogueView bikes() {
    return catalogue.listPublicBikes();
  }

  @GetMapping("/admin-models")
  @PreAuthorize("hasAuthority('catalogue.read')")
  public AdminModelList adminModels(@AuthenticationPrincipal StaffPrincipal principal) {
    return new AdminModelList(catalogue.listAdminModels(principal));
  }

  @PutMapping("/admin-models/{modelCode}")
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajCatalogueService.AdminBikeView updateAdminModel(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable String modelCode,
      @Valid @RequestBody CatalogueSettingsRequest request) {
    return catalogue.updateAdminModel(principal, modelCode,
        new BajajCatalogueService.CatalogueSettingsUpdate(
            request.published(), request.markedOutOfStock(), request.expectedAvailableOn(), request.internalNote()));
  }

  public record AdminModelList(List<BajajCatalogueService.AdminBikeView> models) {}

  public record CatalogueSettingsRequest(
      boolean published,
      boolean markedOutOfStock,
      LocalDate expectedAvailableOn,
      @Size(max = 500) String internalNote) {}
}
