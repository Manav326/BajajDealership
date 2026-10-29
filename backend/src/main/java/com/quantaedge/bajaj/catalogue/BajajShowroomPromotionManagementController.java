package com.quantaedge.bajaj.catalogue;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
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

/** Scoped management of truthful, sourced showcase announcements. */
@RestController
@RequestMapping("/api/v1/admin/catalogue/promotions")
public class BajajShowroomPromotionManagementController {
  private final BajajShowroomPromotionService promotions;

  public BajajShowroomPromotionManagementController(BajajShowroomPromotionService promotions) {
    this.promotions = promotions;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('catalogue.read')")
  public PromotionList list(@AuthenticationPrincipal StaffPrincipal actor) {
    return new PromotionList(promotions.listStaffPromotions(actor));
  }

  @PostMapping
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajShowroomPromotionService.PromotionView create(
      @AuthenticationPrincipal StaffPrincipal actor,
      @Valid @RequestBody PromotionRequest request) {
    return promotions.save(actor, null, request.toServiceRequest());
  }

  @PutMapping("/{publicId}")
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajShowroomPromotionService.PromotionView update(
      @AuthenticationPrincipal StaffPrincipal actor,
      @PathVariable UUID publicId,
      @Valid @RequestBody PromotionRequest request) {
    return promotions.save(actor, publicId, request.toServiceRequest());
  }

  public record PromotionList(List<BajajShowroomPromotionService.PromotionView> promotions) {}

  public record PromotionRequest(
      String modelCode,
      @NotBlank @Size(max = 120) String title,
      @NotBlank @Size(max = 400) String summary,
      @Size(max = 2000) String terms,
      @NotNull LocalDate startsOn,
      LocalDate endsOn,
      @NotBlank @Size(max = 1000) String sourceUrl,
      boolean isPublished) {
    BajajShowroomPromotionService.PromotionRequest toServiceRequest() {
      return new BajajShowroomPromotionService.PromotionRequest(
          modelCode, title, summary, terms, startsOn, endsOn, sourceUrl, isPublished);
    }
  }
}
