package com.quantaedge.bajaj.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.math.BigDecimal;
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

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SparePartsServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private SparePartsService parts;

  @Test
  void receiptIsIdempotentAndUpdatesWeightedAverageCostAndMovementLedger() {
    Fixture fixture = createFixture("RECEIPT", "IN_PROGRESS");
    var part = createPart(fixture, "FILTER", "Oil filter");
    var supplier = createSupplier(fixture);

    var firstRequest = new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-100", "receipt-" + UUID.randomUUID(), "First delivery",
        List.of(new SparePartsService.ReceiptLineRequest(
            part.publicId(), new BigDecimal("10.000"), new BigDecimal("12.00"))));
    var first = parts.receiveStock(fixture.owner(), firstRequest);

    assertThat(first.status()).isEqualTo("RECEIVED");
    assertThat(first.totalCost()).isEqualByComparingTo("120.00");
    assertThat(first.lines()).hasSize(1);
    assertThat(first.lines().getFirst().lineTotal()).isEqualByComparingTo("120.00");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("10.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).averageUnitCost()).isEqualByComparingTo("12.00");

    var replay = parts.receiveStock(fixture.owner(), firstRequest);
    assertThat(replay.publicId()).isEqualTo(first.publicId());
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 25).total()).isEqualTo(1);
    assertThatThrownBy(() -> parts.receiveStock(fixture.owner(),
        new SparePartsService.ReceiptRequest(
            supplier.publicId(), "PO-100", firstRequest.idempotencyKey(), "Changed receipt",
            List.of(new SparePartsService.ReceiptLineRequest(
                part.publicId(), new BigDecimal("11.000"), new BigDecimal("12.00"))))))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var second = parts.receiveStock(fixture.owner(), new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-101", "receipt-" + UUID.randomUUID(), null,
        List.of(new SparePartsService.ReceiptLineRequest(
            part.publicId(), new BigDecimal("10.000"), new BigDecimal("20.00")))));
    var updatedPart = parts.getPart(fixture.owner(), part.publicId());
    assertThat(second.totalCost()).isEqualByComparingTo("200.00");
    assertThat(updatedPart.quantityOnHand()).isEqualByComparingTo("20.000");
    assertThat(updatedPart.quantityReserved()).isEqualByComparingTo("0.000");
    assertThat(updatedPart.quantityAvailable()).isEqualByComparingTo("20.000");
    assertThat(updatedPart.averageUnitCost()).isEqualByComparingTo("16.00");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 25).total()).isEqualTo(2);
  }

  @Test
  void reservationIssueReturnAndReleaseKeepStockAndHistoryConsistent() {
    Fixture fixture = createFixture("WORKFLOW", "IN_PROGRESS");
    var part = createPart(fixture, "BRAKE-PAD", "Front brake pad set");
    var supplier = createSupplier(fixture);
    receive(fixture, part.publicId(), supplier.publicId(), "opening-" + UUID.randomUUID(),
        "10.000", "30.00");

    String reserveKey = "reserve-" + UUID.randomUUID();
    var reservationRequest = new SparePartsService.ReservationRequest(
        part.publicId(), new BigDecimal("6.000"), reserveKey, "Reserve for approved repair");
    var reservation = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(), reservationRequest);
    assertThat(reservation.status()).isEqualTo("OPEN");
    assertThat(reservation.quantityReserved()).isEqualByComparingTo("6.000");
    assertThat(reservation.quantityRemainingToIssue()).isEqualByComparingTo("6.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityAvailable()).isEqualByComparingTo("4.000");

    var replayReservation = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(), reservationRequest);
    assertThat(replayReservation.publicId()).isEqualTo(reservation.publicId());
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("6.000");
    assertThatThrownBy(() -> parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("5.000"), reserveKey, "Different quantity")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    assertThatThrownBy(() -> parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("4.001"), "over-reserve-" + UUID.randomUUID(), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    String issueKey = "issue-" + UUID.randomUUID();
    var issueRequest = new SparePartsService.QuantityOperationRequest(
        new BigDecimal("4.000"), issueKey, "Issue first batch");
    var partialIssue = parts.issuePart(fixture.owner(), reservation.publicId(), issueRequest);
    assertThat(partialIssue.status()).isEqualTo("PARTIALLY_ISSUED");
    assertThat(partialIssue.quantityIssued()).isEqualByComparingTo("4.000");
    assertThat(partialIssue.quantityRemainingToIssue()).isEqualByComparingTo("2.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("6.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("2.000");

    var issueReplay = parts.issuePart(fixture.owner(), reservation.publicId(), issueRequest);
    assertThat(issueReplay.publicId()).isEqualTo(reservation.publicId());
    assertThat(issueReplay.quantityIssued()).isEqualByComparingTo("4.000");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 25).items())
        .filteredOn(movement -> movement.movementType().equals("ISSUED_TO_JOB"))
        .hasSize(1);

    var afterReturn = parts.returnPart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("1.000"), "return-" + UUID.randomUUID(), "Unused part returned"));
    assertThat(afterReturn.quantityReturned()).isEqualByComparingTo("1.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("7.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("2.000");

    var fullyIssued = parts.issuePart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("2.000"), "issue-last-" + UUID.randomUUID(), null));
    assertThat(fullyIssued.status()).isEqualTo("ISSUED");
    assertThat(fullyIssued.quantityIssued()).isEqualByComparingTo("6.000");
    assertThat(fullyIssued.quantityRemainingToIssue()).isEqualByComparingTo("0.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("5.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("0.000");

    var finalReturn = parts.returnPart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("2.000"), "return-last-" + UUID.randomUUID(), null));
    assertThat(finalReturn.quantityReturned()).isEqualByComparingTo("3.000");
    assertThatThrownBy(() -> parts.returnPart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("4.000"), "over-return-" + UUID.randomUUID(), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("7.000");

    var releasable = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("2.000"), "release-reserve-" + UUID.randomUUID(), null));
    var released = parts.releaseReservation(fixture.owner(), releasable.publicId(),
        new SparePartsService.OperationRequest("release-" + UUID.randomUUID(), "Repair plan changed"));
    assertThat(released.status()).isEqualTo("CANCELLED");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("0.000");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
        .extracting(SparePartsService.StockMovementView::movementType)
        .contains("PURCHASE_RECEIPT", "RESERVATION_CREATED", "ISSUED_TO_JOB", "RETURNED_FROM_JOB", "RESERVATION_RELEASED");
  }

  @Test
  void partsAndJobCardsAreNotVisibleAcrossDealershipsAndClosedJobsCannotReserve() {
    Fixture first = createFixture("ISOLATION-A", "IN_PROGRESS");
    Fixture second = createFixture("ISOLATION-B", "IN_PROGRESS");
    var part = createPart(first, "CHAIN", "Drive chain");
    var otherSupplier = createSupplier(first);
    receive(first, part.publicId(), otherSupplier.publicId(), "isolation-opening-" + UUID.randomUUID(),
        "4.000", "80.00");

    assertThatThrownBy(() -> parts.getPart(second.owner(), part.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
    assertThatThrownBy(() -> parts.reservePart(first.owner(), second.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("1.000"), "foreign-job-" + UUID.randomUUID(), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));

    Fixture closed = createFixture("CLOSED", "READY_FOR_COLLECTION");
    assertThatThrownBy(() -> parts.reservePart(closed.owner(), closed.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), BigDecimal.ONE, "closed-job-" + UUID.randomUUID(), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isIn(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT));
  }

  private SparePartsService.SparePartView createPart(Fixture fixture, String prefix, String name) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    return parts.createPart(fixture.owner(), new SparePartsService.PartRequest(
        prefix + "-" + unique, name, "Integration-test spare part", "EACH"));
  }

  private SparePartsService.SupplierView createSupplier(Fixture fixture) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    return parts.createSupplier(fixture.owner(), new SparePartsService.SupplierRequest(
        "SUP-" + unique, "Test Parts Supplier " + unique, "Supplier Contact",
        "9198" + unique.substring(0, 6), "supplier-" + unique.toLowerCase() + "@example.test",
        null, "Supplier for integration tests"));
  }

  private SparePartsService.ReceiptView receive(
      Fixture fixture, UUID partPublicId, UUID supplierPublicId, String key, String quantity, String unitCost) {
    return parts.receiveStock(fixture.owner(), new SparePartsService.ReceiptRequest(
        supplierPublicId, "PO-" + UUID.randomUUID(), key, "Test receipt",
        List.of(new SparePartsService.ReceiptLineRequest(
            partPublicId, new BigDecimal(quantity), new BigDecimal(unitCost)))));
  }

  private Fixture createFixture(String label, String jobStatus) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String dealershipCode = "PART-" + label.replaceAll("[^A-Z0-9]", "") + "-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Spare Part Test " + label);

    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, ?, ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "Parts Test Owner", "owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?", UUID.class, dealershipId, staffId);
    StaffPrincipal principal = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Parts Test Owner", Set.of("OWNER"),
        Set.of("parts.read", "parts.manage", "parts.receive", "parts.reserve", "parts.issue", "parts.return"));

    Long customerId = jdbc.queryForObject("""
        insert into customer(dealership_id, customer_code, full_name, phone, status)
        values (?, ?, 'Parts Test Customer', ?, 'ACTIVE') returning id
        """, Long.class, dealershipId, "CUS-" + unique, "9197" + unique.substring(0, 6));
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(dealership_id, model_code, model_name, variant_name, colour_name, model_year)
        values (?, ?, 'Parts Test Bike', 'Standard', 'Black', 2026) returning id
        """, Long.class, dealershipId, "BIKE-" + unique);
    Long vehicleId = jdbc.queryForObject("""
        insert into vehicle_unit(dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status)
        values (?, ?, ?, ?, 'SOLD') returning id
        """, Long.class, dealershipId, modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    jdbc.update("""
        insert into customer_vehicle(dealership_id, customer_id, vehicle_unit_id, linked_by_staff_user_id)
        values (?, ?, ?, ?)
        """, dealershipId, customerId, vehicleId, staffId);
    UUID jobCardPublicId = jdbc.queryForObject("""
        insert into service_job_card(
          dealership_id, job_card_code, customer_id, vehicle_unit_id, status,
          customer_concern, checked_in_by_staff_user_id, checkin_notes)
        values (?, ?, ?, ?, ?, 'Spare part integration test', ?, 'Synthetic test fixture')
        returning public_id
        """, UUID.class, dealershipId, "JC-" + unique, customerId, vehicleId,
        jobStatus, staffId);
    return new Fixture(principal, dealershipId, jobCardPublicId);
  }

  private record Fixture(StaffPrincipal owner, long dealershipId, UUID jobCardPublicId) {}
}
