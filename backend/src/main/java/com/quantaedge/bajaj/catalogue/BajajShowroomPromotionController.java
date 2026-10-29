package com.quantaedge.bajaj.catalogue;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Returns only currently published, date-valid dealer announcements with source links. */
@RestController
@RequestMapping("/api/v1/public/catalogue/promotions")
public class BajajShowroomPromotionController {
  private final BajajShowroomPromotionService promotions;

  public BajajShowroomPromotionController(BajajShowroomPromotionService promotions) {
    this.promotions = promotions;
  }

  @GetMapping
  public PromotionList promotions() {
    return new PromotionList(promotions.listPublicPromotions());
  }

  public record PromotionList(List<BajajShowroomPromotionService.PromotionView> promotions) {}
}
