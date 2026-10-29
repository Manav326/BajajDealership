package com.quantaedge.bajaj.catalogue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = "app.dealership.public-code=PROMOTION-TEST-DEALER")
@ActiveProfiles("test")
@Transactional
class BajajShowroomPromotionServiceIntegrationTest {
  private static final String MODEL_CODE = "BAJAJ_PULSAR_NS200";

  @Autowired private JdbcTemplate jdbc;
  @Autowired private BajajShowroomPromotionService promotions;

  @Test
  void publicListingContainsOnlyPublishedCurrentPromotionsForConfiguredDealership() {
    StaffPrincipal manager = createManager("PROMOTION-TEST-DEALER");
    publishModel(manager);
    LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));

    var current = promotions.save(manager, null, new BajajShowroomPromotionService.PromotionRequest(
        MODEL_CODE, "Verified accessory offer", "Eligible customers may ask the dealership about this offer.",
        "Terms vary by location and eligibility.", today, today.plusDays(10),
        "https://example.test/offers/current", true));
    promotions.save(manager, null, new BajajShowroomPromotionService.PromotionRequest(
        MODEL_CODE, "Future offer", "Not active yet.", null, today.plusDays(5), today.plusDays(15),
        "https://example.test/offers/future", true));
    promotions.save(manager, null, new BajajShowroomPromotionService.PromotionRequest(
        MODEL_CODE, "Expired offer", "No longer active.", null, today.minusDays(10), today.minusDays(1),
        "https://example.test/offers/expired", true));
    promotions.save(manager, null, new BajajShowroomPromotionService.PromotionRequest(
        null, "Draft announcement", "Not published.", null, today, null,
        "https://example.test/offers/draft", false));

    var publicItems = promotions.listPublicPromotions();
    assertThat(publicItems).extracting(BajajShowroomPromotionService.PromotionView::publicId)
        .containsExactly(current.publicId());
    assertThat(publicItems.getFirst().modelCode()).isEqualTo(MODEL_CODE);
    assertThat(publicItems.getFirst().published()).isTrue();
    assertThat(publicItems.getFirst().sourceUrl()).isEqualTo("https://example.test/offers/current");
    assertThat(publicItems.getFirst().disclaimer()).contains("does not change catalogue prices automatically");
    assertThat(promotions.listStaffPromotions(manager)).hasSize(4);
  }

  @Test
  void promotionsRequireHttpsSourceAndRejectInvalidEffectivePeriod() {
    StaffPrincipal manager = createManager("PROMOTION-TEST-DEALER");
    publishModel(manager);
    LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));

    assertThatThrownBy(() -> promotions.save(manager, null, new BajajShowroomPromotionService.PromotionRequest(
        MODEL_CODE, "Bad source", "This should be rejected.", null, today, null,
        "http://example.test/offers", true)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    assertThatThrownBy(() -> promotions.save(manager, null, new BajajShowroomPromotionService.PromotionRequest(
        MODEL_CODE, "Bad dates", "This should be rejected.", null, today, today.minusDays(1),
        "https://example.test/offers", true)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void aPromotionCannotBeEditedAcrossDealershipBoundaries() {
    StaffPrincipal owner = createManager("PROMOTION-TEST-DEALER");
    publishModel(owner);
    LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
    var saved = promotions.save(owner, null, new BajajShowroomPromotionService.PromotionRequest(
        MODEL_CODE, "Private dealer promotion", "Private test data.", null, today, null,
        "https://example.test/offers/private", false));

    StaffPrincipal other = createManager("OTHER-PROMOTION-" + UUID.randomUUID().toString().substring(0, 6));
    publishModel(other);
    assertThatThrownBy(() -> promotions.save(other, saved.publicId(),
        new BajajShowroomPromotionService.PromotionRequest(
            MODEL_CODE, "Attempted edit", "Cross-dealership edit must fail.", null, today, null,
            "https://example.test/offers/other", false)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private void publishModel(StaffPrincipal manager) {
    jdbc.update("""
        insert into bajaj_catalogue_dealership_model(dealership_id, model_code, is_published)
        values (?, ?, true)
        on conflict (dealership_id, model_code) do update set is_published = true
        """, manager.dealershipId(), MODEL_CODE);
  }

  private StaffPrincipal createManager(String dealershipCode) {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Promotion Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Promotion Manager', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "promotion-manager-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    Long managerRoleId = jdbc.queryForObject("select id from role where code = 'MANAGER'", Long.class);
    jdbc.update("insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)",
        dealershipId, staffId, managerRoleId);
    return new StaffPrincipal(1, staffId, staffPublicId.toString(), dealershipId,
        dealershipPublicId.toString(), dealershipCode, "Promotion Manager", Set.of("MANAGER"),
        Set.of("catalogue.read", "catalogue.manage"));
  }
}
