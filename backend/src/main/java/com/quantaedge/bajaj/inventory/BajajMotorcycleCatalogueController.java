package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/public/motorcycles")
public class BajajMotorcycleCatalogueController {
  private final BajajMotorcycleCatalogueService catalogue;

  public BajajMotorcycleCatalogueController(BajajMotorcycleCatalogueService catalogue) {
    this.catalogue = catalogue;
  }

  @GetMapping("/api/v1/admin/bajaj-catalogue")
  @PreAuthorize("hasAuthority('vehicle.read')")
  public BajajMotorcycleCatalogueService.CatalogueResponse adminList(
      @AuthenticationPrincipal StaffPrincipal actor,
      @RequestParam(required = false) @Size(max = 24) String family,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return catalogue.list(actor.dealershipCode(), family, q);
  }

  @GetMapping
  public BajajMotorcycleCatalogueService.CatalogueResponse list(
      @RequestParam(required = false) @Size(max = 40) String dealershipCode,
      @RequestParam(required = false) @Size(max = 24) String family,
      @RequestParam(required = false) @Size(max = 100) String q) {
    return catalogue.list(dealershipCode, family, q);
  }

  @GetMapping("/{modelCode}")
  public BajajMotorcycleCatalogueService.Motorcycle detail(
      @RequestParam(required = false) @Size(max = 40) String dealershipCode,
      @PathVariable @Size(max = 60) String modelCode) {
    return catalogue.detail(dealershipCode, modelCode);
  }
}
