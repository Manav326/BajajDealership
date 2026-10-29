package com.quantaedge.bajaj.catalogue;

import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/public/catalogue")
public class BajajCatalogueController {
  private final BajajCatalogueService catalogue;

  public BajajCatalogueController(BajajCatalogueService catalogue) {
    this.catalogue = catalogue;
  }

  /** Public browsing returns only published Bajaj models and safe stock aggregates. */
  @GetMapping("/bikes")
  public BajajCatalogueService.CatalogueView bikes(
      @RequestParam(required = false) @Size(max = 32) String category) {
    return catalogue.listPublicBikes(category);
  }
}
