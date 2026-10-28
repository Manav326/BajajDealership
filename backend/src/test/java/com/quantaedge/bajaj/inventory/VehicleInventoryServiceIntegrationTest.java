package com.quantaedge.bajaj.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
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
class VehicleInventoryServiceIntegrationTest {
  @Autowired
  private JdbcTemplate jdbc;

  @Autowired
  private VehicleInventoryService inventory;

  @Test
  void expectedUnitBecomesAvailableOnlyThroughReceiptAndKeepsMovementHistory() {
    StaffPrincipal owner = createOwner();
    VehicleInventoryService.VehicleModelView model = inventory.createModel(owner,
        new VehicleInventoryService.VehicleModelRequest("PULSAR-150", "Pulsar 150", "Standard", "Black", 2026));

    VehicleInventoryService.VehicleUnitView expected = inventory.registerExpectedUnit(owner,
        new VehicleInventoryService.VehicleUnitRequest(
            model.publicId(), "MD2A00XXXX100001", "JX100001", "OEM-PO-1001", new BigDecimal("85000.00")));
    assertThat(expected.stockStatus()).isEqualTo("EXPECTED");
    assertThat(expected.receivedAt()).isNull();

    VehicleInventoryService.VehicleUnitView received =
        inventory.receiveUnit(owner, expected.publicId(), "GRN-1001", "Physical count verified");
    assertThat(received.stockStatus()).isEqualTo("AVAILABLE");
    assertThat(received.receivedAt()).isNotNull();

    assertThat(inventory.movements(owner, expected.publicId()))
        .extracting(VehicleInventoryService.StockMovementView::eventType)
        .containsExactly("STOCK_RECEIVED", "UNIT_REGISTERED");
    assertThat(inventory.listModels(owner, 0, 25, "Pulsar").items().getFirst().availableCount()).isEqualTo(1);
  }

  @Test
  void cannotReceiveTheSameUnitTwice() {
    StaffPrincipal owner = createOwner();
    VehicleInventoryService.VehicleModelView model = inventory.createModel(owner,
        new VehicleInventoryService.VehicleModelRequest("CT-125", "CT 125", null, null, 2026));
    VehicleInventoryService.VehicleUnitView unit = inventory.registerExpectedUnit(owner,
        new VehicleInventoryService.VehicleUnitRequest(model.publicId(), "CHASSIS-RECV-2",
            "ENGINE-RECV-2", "PO-2", BigDecimal.ZERO));
    inventory.receiveUnit(owner, unit.publicId(), "GRN-2", null);

    assertThatThrownBy(() -> inventory.receiveUnit(owner, unit.publicId(), "GRN-2", null))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(inventory.movements(owner, unit.publicId())).hasSize(2);
  }

  @Test
  void vehicleUnitIsNotVisibleToAnotherDealership() {
    StaffPrincipal agencyA = createOwner();
    StaffPrincipal agencyB = createOwner();
    VehicleInventoryService.VehicleModelView model = inventory.createModel(agencyA,
        new VehicleInventoryService.VehicleModelRequest("AVENGER-160", "Avenger 160", "Street", "Blue", 2026));
    VehicleInventoryService.VehicleUnitView unit = inventory.registerExpectedUnit(agencyA,
        new VehicleInventoryService.VehicleUnitRequest(model.publicId(), "CHASSIS-A-1",
            "ENGINE-A-1", null, null));

    assertThatThrownBy(() -> inventory.getUnit(agencyB, unit.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private StaffPrincipal createOwner() {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "INV-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Inventory Test Agency");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    return new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        code, "Test Owner", Set.of("OWNER"), Set.of("vehicle.read", "vehicle.manage"));
  }
}
