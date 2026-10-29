package com.quantaedge.bajaj.inventory;

import jakarta.validation.constraints.Size;
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
