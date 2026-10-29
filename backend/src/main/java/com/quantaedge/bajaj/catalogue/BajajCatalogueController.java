package com.quantaedge.bajaj.catalogue;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
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
}
