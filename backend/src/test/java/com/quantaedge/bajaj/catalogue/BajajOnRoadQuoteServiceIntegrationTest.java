package com.quantaedge.bajaj.catalogue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = "app.dealership.public-code=PRICE-TEST-DEALER")
@ActiveProfiles("test")
@Transactional
class BajajOnRoadQuoteServiceIntegrationTest {
  private static final String MODEL_CODE = "BAJAJ_PULSAR_NS200";

  /**
   * Public quote resolution must be deterministic even when the migration fixture contains
   * multiple active dealerships. Dynamic properties take precedence over environment defaults.
   */
  @DynamicPropertySource
  static void configurePublicQuoteDealership(DynamicPropertyRegistry registry) {
    registry.add("app.dealership.public-code", () -> "PRICE-TEST-DEALER");
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private BajajOnRoadQuoteService quotes;

  @Test
  void calculatesEstimateOnlyFromCurrentSourcedModelAndLocationInputs() {
    StaffPrincipal manager = createManager();
    publishModel(manager);

    LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
    var saved = quotes.saveProfile(manager, null, new BajajOnRoadQuoteService.PriceProfileRequest(
        MODEL_CODE, "Bettiah", "Bihar", today, today.plusDays(30),
        new BigDecimal("150000.00"), new BigDecimal("1200.00"), new BigDecimal("10.0000"),
        new BigDecimal("8000.00"), new BigDecimal("500.00"), new BigDecimal("250.00"),
        "Document and other applicable charges", "https://example.test/pricing/bettiah",
        "Example values only; test fixture, not a real customer quote."));

    assertThat(saved.modelCode()).isEqualTo(MODEL_CODE);
    assertThat(saved.effectiveFrom()).isEqualTo(today);
    assertThat(saved.effectiveTo()).isEqualTo(today.plusDays(30));

    var quote = quotes.quote(MODEL_CODE, "bettiah", "BIHAR");
    assertThat(quote.quoteType()).isEqualTo("ESTIMATE");
    assertThat(quote.estimatedOnRoadTotal()).isEqualByComparingTo("174950.00");
    assertThat(quote.breakdown()).extracting(BajajOnRoadQuoteService.QuoteLine::label)
        .contains("Local ex-showroom price", "Registration fee", "Road tax (10%)", "Insurance estimate");
    assertThat(quote.sourceUrl()).isEqualTo("https://example.test/pricing/bettiah");
    assertThat(quote.disclaimer()).contains("not a guaranteed offer");
  }

  @Test
  void rejectsOverlappingEffectivePeriodsAndDoesNotReturnExpiredProfiles() {
    StaffPrincipal manager = createManager();
    publishModel(manager);
    LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
    var first = new BajajOnRoadQuoteService.PriceProfileRequest(
        MODEL_CODE, "Bettiah", "Bihar", today.minusDays(10), today.minusDays(1),
        new BigDecimal("150000.00"), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(4),
        BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2),
        null, "https://example.test/expired-price", null);
    quotes.saveProfile(manager, null, first);

    assertThatThrownBy(() -> quotes.saveProfile(manager, null, new BajajOnRoadQuoteService.PriceProfileRequest(
        MODEL_CODE, "BETTIAH", "bihar", today.minusDays(2), null,
        new BigDecimal("151000.00"), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(4),
        BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2),
        null, "https://example.test/overlapping-price", null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThatThrownBy(() -> quotes.quote(MODEL_CODE, "Bettiah", "Bihar"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void rejectsOtherChargesWithoutALabelAndRejectsNonHttpsSource() {
    StaffPrincipal manager = createManager();
    publishModel(manager);
    LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));

    assertThatThrownBy(() -> quotes.saveProfile(manager, null, new BajajOnRoadQuoteService.PriceProfileRequest(
        MODEL_CODE, "Bettiah", "Bihar", today, null,
        new BigDecimal("150000.00"), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(4),
        BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), new BigDecimal("10.00"),
        null, "https://example.test/price", null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    assertThatThrownBy(() -> quotes.saveProfile(manager, null, new BajajOnRoadQuoteService.PriceProfileRequest(
        MODEL_CODE, "Bettiah", "Bihar", today, null,
        new BigDecimal("150000.00"), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(4),
        BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2),
        null, "http://example.test/price", null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  private void publishModel(StaffPrincipal manager) {
    jdbc.update("""
        insert into bajaj_catalogue_dealership_model(dealership_id, model_code, is_published)
        values (?, ?, true)
        on conflict (dealership_id, model_code) do update set is_published = true
        """, manager.dealershipId(), MODEL_CODE);
  }

  private StaffPrincipal createManager() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    String dealershipCode = "PRICE-TEST-DEALER";
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Pricing Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Pricing Manager', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "pricing-manager-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    Long managerRoleId = jdbc.queryForObject("select id from role where code = 'MANAGER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, managerRoleId);
    return new StaffPrincipal(1, staffId, staffPublicId.toString(), dealershipId,
        dealershipPublicId.toString(), dealershipCode, "Pricing Manager", Set.of("MANAGER"),
        Set.of("catalogue.read", "catalogue.manage"));
  }
}
