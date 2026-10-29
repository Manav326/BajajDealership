package com.quantaedge.bajaj.catalogue;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/catalogue/models")
public class BajajCatalogueManagementController {
  private final BajajCatalogueService catalogue;

  public BajajCatalogueManagementController(BajajCatalogueService catalogue) {
    this.catalogue = catalogue;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('catalogue.read')")
  public AdminModelList list(@AuthenticationPrincipal StaffPrincipal principal) {
    return new AdminModelList(catalogue.listAdminModels(principal));
  }

  @PutMapping("/{modelCode}")
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajCatalogueService.AdminBikeView update(
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
