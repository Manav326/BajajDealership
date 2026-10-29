package com.quantaedge.bajaj.catalogue;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Public quotes are shown only for active, published models with a current sourced location profile. */
@RestController
@RequestMapping("/api/v1/public/catalogue/quotes")
public class BajajOnRoadQuoteController {
  private final BajajOnRoadQuoteService quotes;

  public BajajOnRoadQuoteController(BajajOnRoadQuoteService quotes) {
    this.quotes = quotes;
  }

  @GetMapping
  public BajajOnRoadQuoteService.QuoteView quote(
      @RequestParam @NotBlank @Size(max = 60) String modelCode,
      @RequestParam @NotBlank @Size(max = 80) String city,
      @RequestParam @NotBlank @Size(max = 80) String state) {
    return quotes.quote(modelCode, city, state);
  }
}
