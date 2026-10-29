package com.quantaedge.bajaj.commerce;

import static org.assertj.core.api.Assertions.assertThat;

import com.quantaedge.bajaj.inventory.SparePartsService;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class RetailPartsServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SparePartsService spareParts;
  @Autowired private RetailPartsService retailParts;

  @Test
  void updatingRetailSettingsReturnsTheSavedDealershipScopedListing() {
    StaffPrincipal manager = createManager();
    var part = spareParts.createPart(manager,
        new SparePartsService.PartRequest("RETAIL-" + UUID.randomUUID().toString().substring(0, 8),
            "Front brake pad", "Genuine replacement brake pad", "EACH"));

    var saved = retailParts.updateRetailSettings(manager, part.publicId(),
        new RetailPartsService.RetailSettingsRequest(
            true, new BigDecimal("149.00"), "Bajaj front brake pad", List.of(), null));

    assertThat(saved.publicId()).isEqualTo(part.publicId());
    assertThat(saved.retailEnabled()).isTrue();
    assertThat(saved.retailPrice()).isEqualByComparingTo("149.00");
    assertThat(saved.retailDescription()).isEqualTo("Bajaj front brake pad");
    assertThat(saved.fitmentModelCodes()).isEmpty();

    var listed = retailParts.listRetailSettings(manager).stream()
        .filter(item -> item.publicId().equals(part.publicId()))
        .findFirst()
        .orElseThrow();
    assertThat(listed.retailPrice()).isEqualByComparingTo("149.00");
    assertThat(listed.quantityAvailable()).isEqualByComparingTo(BigDecimal.ZERO);
  }

  private StaffPrincipal createManager() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    String dealershipCode = "RET-" + suffix;
    Long dealershipId = jdbc.queryForObject(
        "insert into dealership(code, name) values (?, ?) returning id",
        Long.class, dealershipCode, "Retail Parts Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Retail Parts Manager', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "retail-manager-" + suffix.toLowerCase(java.util.Locale.ROOT) + "@example.test");
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
        dealershipCode, "Retail Parts Manager", Set.of("MANAGER"),
        Set.of("parts.read", "parts.manage"));
  }
}
