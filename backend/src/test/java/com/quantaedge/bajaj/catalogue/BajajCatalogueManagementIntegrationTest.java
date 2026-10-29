package com.quantaedge.bajaj.catalogue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.LocalDate;
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

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class BajajCatalogueManagementIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private BajajCatalogueService catalogue;

  @Test
  void authorisedManagerCanPublishAndSetExpectedAvailabilityWithoutCreatingStock() {
    StaffPrincipal manager = createManager();
    String modelCode = "BAJAJ_PULSAR_NS200";
    LocalDate expectedDate = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(12);

    var updated = catalogue.updateAdminModel(manager, modelCode,
        new BajajCatalogueService.CatalogueSettingsUpdate(
            true, true, expectedDate, "OEM allocation confirmation pending"));

    assertThat(updated.published()).isTrue();
    assertThat(updated.markedOutOfStock()).isTrue();
    assertThat(updated.expectedAvailableOn()).isEqualTo(expectedDate);
    assertThat(updated.availableUnits()).isZero();
    assertThat(updated.internalNote()).isEqualTo("OEM allocation confirmation pending");
    assertThat(jdbc.queryForObject("""
        select count(*) from vehicle_unit vu
        join vehicle_model vm on vm.id = vu.vehicle_model_id
        where vm.dealership_id = ? and vm.model_code = ?
        """, Integer.class, manager.dealershipId(), modelCode)).isZero();
    assertThat(jdbc.queryForObject("""
        select count(*) from audit_event
        where dealership_id = ? and entity_type = 'BAJAJ_CATALOGUE_MODEL'
          and entity_id = ? and actor_kind = 'STAFF'
        """, Integer.class, manager.dealershipId(), modelCode)).isEqualTo(1);

    var unpublished = catalogue.updateAdminModel(manager, modelCode,
        new BajajCatalogueService.CatalogueSettingsUpdate(false, true, expectedDate, "Awaiting stock"));
    assertThat(unpublished.published()).isFalse();
  }

  @Test
  void cannotMarkModelOutOfStockWhilePhysicalUnitIsAvailable() {
    StaffPrincipal manager = createManager();
    String modelCode = "BAJAJ_PULSAR_NS200";
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(dealership_id, model_code, model_name, active)
        values (?, ?, 'Pulsar NS200', true) returning id
        """, Long.class, manager.dealershipId(), modelCode);
    jdbc.update("""
        insert into vehicle_unit(dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status)
        values (?, ?, 'CHASSIS-CAT-AVAILABLE-1', 'ENGINE-CAT-AVAILABLE-1', 'AVAILABLE')
        """, manager.dealershipId(), modelId);

    assertThatThrownBy(() -> catalogue.updateAdminModel(manager, modelCode,
        new BajajCatalogueService.CatalogueSettingsUpdate(
            true, true, LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(7), "Incorrect stock state")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThat(jdbc.queryForObject("""
        select count(*) from bajaj_catalogue_dealership_model
        where dealership_id = ? and model_code = ?
        """, Integer.class, manager.dealershipId(), modelCode)).isZero();
  }

  @Test
  void expectedDateCannotBeInThePastOrProvidedWithoutOutOfStockFlag() {
    StaffPrincipal manager = createManager();
    LocalDate yesterday = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).minusDays(1);

    assertThatThrownBy(() -> catalogue.updateAdminModel(manager, "BAJAJ_PULSAR_NS200",
        new BajajCatalogueService.CatalogueSettingsUpdate(true, true, yesterday, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    assertThatThrownBy(() -> catalogue.updateAdminModel(manager, "BAJAJ_PULSAR_NS200",
        new BajajCatalogueService.CatalogueSettingsUpdate(true, false,
            LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(1), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  private StaffPrincipal createManager() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String dealershipCode = "CAT-" + suffix;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Catalogue Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Catalogue Manager', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "catalogue-" + suffix.toLowerCase() + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    Long managerRoleId = jdbc.queryForObject("select id from role where code = 'MANAGER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, managerRoleId);

    return new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Catalogue Manager", Set.of("MANAGER"),
        Set.of("catalogue.read", "catalogue.manage", "vehicle.read"));
  }
}
