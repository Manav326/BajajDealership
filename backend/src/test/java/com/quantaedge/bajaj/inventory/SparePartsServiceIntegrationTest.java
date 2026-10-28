package com.quantaedge.bajaj.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.workshop.ServiceOperationsService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.springframework.transaction.annotation.Propagation;
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
  @Autowired private ServiceOperationsService workshop;

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
  @org.springframework.transaction.annotation.Transactional(propagation = Propagation.NOT_SUPPORTED)
  void failedMultiLineReceiptRollsBackEarlierSkuChangesAndLedgerRows() {
    Fixture fixture = createFixture("RECEIPT-ROLLBACK", "IN_PROGRESS");
    var firstPart = createPart(fixture, "ROLLBACK-FIRST", "First receipt line");
    var overflowingPart = createPart(fixture, "ROLLBACK-LAST", "Overflowing receipt line");
    var supplier = createSupplier(fixture);
    jdbc.update("""
        update spare_part_balance
        set quantity_on_hand = ?, quantity_reserved = 0, average_unit_cost = 0, updated_at = now()
        where dealership_id = ? and part_id = (
          select id from spare_part where dealership_id = ? and public_id = ?)
        """, new BigDecimal("999999999.999"), fixture.dealershipId(),
        fixture.dealershipId(), overflowingPart.publicId());

    String key = "rollback-receipt-" + UUID.randomUUID();
    var receiptRequest = new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-ROLLBACK", key, "Second line deliberately exceeds supported balance",
        List.of(
            new SparePartsService.ReceiptLineRequest(
                firstPart.publicId(), BigDecimal.ONE, new BigDecimal("10.00")),
            new SparePartsService.ReceiptLineRequest(
                overflowingPart.publicId(), BigDecimal.ONE, BigDecimal.ZERO)));

    assertThatThrownBy(() -> parts.receiveStock(fixture.owner(), receiptRequest))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    assertThat(parts.getPart(fixture.owner(), firstPart.publicId()).quantityOnHand()).isEqualByComparingTo("0.000");
    assertThat(parts.getPart(fixture.owner(), overflowingPart.publicId()).quantityOnHand())
        .isEqualByComparingTo("999999999.999");
    assertThat(jdbc.queryForObject("""
        select count(*) from part_purchase_receipt
        where dealership_id = ? and idempotency_key = ?
        """, Integer.class, fixture.dealershipId(), key)).isZero();
    assertThat(jdbc.queryForObject("""
        select count(*) from spare_part_stock_movement
        where dealership_id = ? and part_id = (
          select id from spare_part where dealership_id = ? and public_id = ?)
        """, Integer.class, fixture.dealershipId(), fixture.dealershipId(), firstPart.publicId())).isZero();
    assertThat(parts.listMovements(fixture.owner(), overflowingPart.publicId(), 0, 25).total()).isZero();
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

    approveReservationEstimate(fixture, reservation, "Initial part quantity approved.");

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
    assertThatThrownBy(() -> parts.issuePart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            BigDecimal.ONE, "stale-issue-" + UUID.randomUUID(), "Must wait for revised approval.")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("7.000");

    approveReservationEstimate(fixture, afterReturn, "Approved updated quantity after the returned unit.");
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
    var partialReservation = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("3.000"), "partial-reserve-" + UUID.randomUUID(), null));
    approveReservationEstimate(fixture, partialReservation, "Approve the partial reservation before issuing it.");
    parts.issuePart(fixture.owner(), partialReservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("1.000"), "partial-issue-" + UUID.randomUUID(), null));
    var partiallyReleased = parts.releaseReservation(fixture.owner(), partialReservation.publicId(),
        new SparePartsService.OperationRequest("partial-release-" + UUID.randomUUID(), "Only one unit was needed."));
    assertThat(partiallyReleased.status()).isEqualTo("PARTIALLY_CANCELLED");
    assertThat(partiallyReleased.quantityReserved()).isEqualByComparingTo("3.000");
    assertThat(partiallyReleased.quantityIssued()).isEqualByComparingTo("1.000");
    assertThat(partiallyReleased.quantityReleased()).isEqualByComparingTo("2.000");
    assertThat(partiallyReleased.quantityRemainingToIssue()).isEqualByComparingTo("0.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("0.000");
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
    var closedPart = createPart(closed, "CLOSED-PART", "Part for closed job");
    var closedSupplier = createSupplier(closed);
    receive(closed, closedPart.publicId(), closedSupplier.publicId(),
        "closed-opening-" + UUID.randomUUID(), "2.000", "5.00");
    assertThatThrownBy(() -> parts.reservePart(closed.owner(), closed.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            closedPart.publicId(), BigDecimal.ONE, "closed-job-" + UUID.randomUUID(), null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void lowStockAlertsUseAvailableQuantityAndZeroThresholdDisablesAlert() {
    Fixture fixture = createFixture("LOW-STOCK", "IN_PROGRESS");
    var part = createPart(fixture, "LOW-TEST", "Low-stock test part");
    var supplier = createSupplier(fixture);
    receive(fixture, part.publicId(), supplier.publicId(), "low-opening-" + UUID.randomUUID(),
        "10.000", "8.00");

    var configured = parts.updateReorderPolicy(fixture.owner(), part.publicId(),
        new SparePartsService.ReorderPolicyRequest(
            new BigDecimal("5.000"), new BigDecimal("12.000")));
    assertThat(configured.lowStockThreshold()).isEqualByComparingTo("5.000");
    assertThat(configured.reorderToQuantity()).isEqualByComparingTo("12.000");
    assertThat(parts.listLowStockAlerts(fixture.owner(), 0, 25).total()).isZero();

    parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("6.000"), "low-reserve-" + UUID.randomUUID(),
            "Reserved stock should count against availability."));
    var alerts = parts.listLowStockAlerts(fixture.owner(), 0, 25);
    assertThat(alerts.total()).isEqualTo(1);
    var alert = alerts.items().getFirst();
    assertThat(alert.publicId()).isEqualTo(part.publicId());
    assertThat(alert.quantityOnHand()).isEqualByComparingTo("10.000");
    assertThat(alert.quantityReserved()).isEqualByComparingTo("6.000");
    assertThat(alert.quantityAvailable()).isEqualByComparingTo("4.000");
    assertThat(alert.lowStockThreshold()).isEqualByComparingTo("5.000");
    assertThat(alert.suggestedOrderQuantity()).isEqualByComparingTo("8.000");

    assertThatThrownBy(() -> parts.updateReorderPolicy(fixture.owner(), part.publicId(),
        new SparePartsService.ReorderPolicyRequest(
            new BigDecimal("6.000"), new BigDecimal("5.000"))))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));

    var disabled = parts.updateReorderPolicy(fixture.owner(), part.publicId(),
        new SparePartsService.ReorderPolicyRequest(BigDecimal.ZERO, BigDecimal.ZERO));
    assertThat(disabled.lowStockThreshold()).isEqualByComparingTo("0.000");
    assertThat(parts.listLowStockAlerts(fixture.owner(), 0, 25).total()).isZero();
  }

  @Test
  @org.springframework.transaction.annotation.Transactional(propagation = Propagation.NOT_SUPPORTED)
  void concurrentIssuesCannotExceedReservationQuantity() throws Exception {
    Fixture fixture = createFixture("CONCURRENT-ISSUE", "IN_PROGRESS");
    var part = createPart(fixture, "ISSUE-RACE", "Concurrent issue part");
    var supplier = createSupplier(fixture);
    receive(fixture, part.publicId(), supplier.publicId(), "issue-race-opening-" + UUID.randomUUID(),
        "10.000", "9.00");

    var reservation = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("6.000"), "issue-race-reserve-" + UUID.randomUUID(), null));
    approveReservationEstimate(fixture, reservation, "Approved for concurrent issue test.");

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<Object> first = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start barrier timed out.");
        try {
          return parts.issuePart(fixture.owner(), reservation.publicId(),
              new SparePartsService.QuantityOperationRequest(
                  new BigDecimal("4.000"), "issue-race-a-" + UUID.randomUUID(), "Concurrent issue A"));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      Future<Object> second = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start barrier timed out.");
        try {
          return parts.issuePart(fixture.owner(), reservation.publicId(),
              new SparePartsService.QuantityOperationRequest(
                  new BigDecimal("4.000"), "issue-race-b-" + UUID.randomUUID(), "Concurrent issue B"));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      Object firstResult = first.get(15, TimeUnit.SECONDS);
      Object secondResult = second.get(15, TimeUnit.SECONDS);
      assertThat(List.of(firstResult, secondResult).stream()
          .filter(SparePartsService.ReservationView.class::isInstance).count()).isEqualTo(1);
      assertThat(List.of(firstResult, secondResult).stream()
          .filter(HttpStatus.CONFLICT::equals).count()).isEqualTo(1);
    } finally {
      start.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }

    var stored = parts.getReservation(fixture.owner(), reservation.publicId());
    assertThat(stored.quantityIssued()).isEqualByComparingTo("4.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("6.000");
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("2.000");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
        .filteredOn(movement -> movement.movementType().equals("ISSUED_TO_JOB"))
        .hasSize(1);
  }

  @Test
  @org.springframework.transaction.annotation.Transactional(propagation = Propagation.NOT_SUPPORTED)
  void concurrentRetryOfSameSupplierReceiptAddsStockOnlyOnce() throws Exception {
    Fixture fixture = createFixture("CONCURRENT-RECEIPT", "IN_PROGRESS");
    var part = createPart(fixture, "RACE-RECEIPT", "Concurrent receipt part");
    var supplier = createSupplier(fixture);
    var request = new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-RACE", "same-receipt-" + UUID.randomUUID(), "Concurrent duplicate submit",
        List.of(new SparePartsService.ReceiptLineRequest(
            part.publicId(), new BigDecimal("8.000"), new BigDecimal("11.50"))));

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<SparePartsService.ReceiptView> first = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start barrier timed out.");
        return parts.receiveStock(fixture.owner(), request);
      });
      Future<SparePartsService.ReceiptView> second = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start barrier timed out.");
        return parts.receiveStock(fixture.owner(), request);
      });
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      var resultOne = first.get(15, TimeUnit.SECONDS);
      var resultTwo = second.get(15, TimeUnit.SECONDS);
      assertThat(resultOne.publicId()).isEqualTo(resultTwo.publicId());
      assertThat(resultOne.receiptNumber()).isEqualTo(resultTwo.receiptNumber());
    } finally {
      start.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }

    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("8.000");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
        .filteredOn(movement -> movement.movementType().equals("PURCHASE_RECEIPT"))
        .hasSize(1);
    assertThat(parts.listReceipts(fixture.owner(), 0, 100).total()).isEqualTo(1);
  }

  @Test
  @org.springframework.transaction.annotation.Transactional(propagation = Propagation.NOT_SUPPORTED)
  void concurrentReturnsAndReleasesCannotDoubleIncreaseOrReleaseStock() throws Exception {
    Fixture fixture = createFixture("CONCURRENT-RETURN", "IN_PROGRESS");
    var part = createPart(fixture, "RETURN-RACE", "Concurrent return part");
    var supplier = createSupplier(fixture);
    receive(fixture, part.publicId(), supplier.publicId(), "return-race-opening-" + UUID.randomUUID(),
        "10.000", "14.00");
    var reservation = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("6.000"), "return-race-reserve-" + UUID.randomUUID(), null));
    approveReservationEstimate(fixture, reservation, "Approved before issue/return concurrency test.");
    parts.issuePart(fixture.owner(), reservation.publicId(),
        new SparePartsService.QuantityOperationRequest(
            new BigDecimal("4.000"), "return-race-issue-" + UUID.randomUUID(), "Issue four units"));

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      CountDownLatch returnsReady = new CountDownLatch(2);
      CountDownLatch returnsStart = new CountDownLatch(1);
      Future<Object> firstReturn = pool.submit(() -> {
        returnsReady.countDown();
        if (!returnsStart.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Return start barrier timed out.");
        try {
          return parts.returnPart(fixture.owner(), reservation.publicId(),
              new SparePartsService.QuantityOperationRequest(
                  new BigDecimal("3.000"), "return-race-a-" + UUID.randomUUID(), "Concurrent return A"));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      Future<Object> secondReturn = pool.submit(() -> {
        returnsReady.countDown();
        if (!returnsStart.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Return start barrier timed out.");
        try {
          return parts.returnPart(fixture.owner(), reservation.publicId(),
              new SparePartsService.QuantityOperationRequest(
                  new BigDecimal("3.000"), "return-race-b-" + UUID.randomUUID(), "Concurrent return B"));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      assertThat(returnsReady.await(10, TimeUnit.SECONDS)).isTrue();
      returnsStart.countDown();
      Object returnA = firstReturn.get(15, TimeUnit.SECONDS);
      Object returnB = secondReturn.get(15, TimeUnit.SECONDS);
      assertThat(List.of(returnA, returnB).stream()
          .filter(SparePartsService.ReservationView.class::isInstance).count()).isEqualTo(1);
      assertThat(List.of(returnA, returnB).stream().filter(HttpStatus.CONFLICT::equals).count()).isEqualTo(1);

      var afterReturnRace = parts.getReservation(fixture.owner(), reservation.publicId());
      assertThat(afterReturnRace.quantityReturned()).isEqualByComparingTo("3.000");
      assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("9.000");
      assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
          .filteredOn(movement -> movement.movementType().equals("RETURNED_FROM_JOB"))
          .hasSize(1);

      CountDownLatch releasesReady = new CountDownLatch(2);
      CountDownLatch releasesStart = new CountDownLatch(1);
      Future<Object> firstRelease = pool.submit(() -> {
        releasesReady.countDown();
        if (!releasesStart.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Release start barrier timed out.");
        try {
          return parts.releaseReservation(fixture.owner(), reservation.publicId(),
              new SparePartsService.OperationRequest("release-race-a-" + UUID.randomUUID(), "Concurrent release A"));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      Future<Object> secondRelease = pool.submit(() -> {
        releasesReady.countDown();
        if (!releasesStart.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Release start barrier timed out.");
        try {
          return parts.releaseReservation(fixture.owner(), reservation.publicId(),
              new SparePartsService.OperationRequest("release-race-b-" + UUID.randomUUID(), "Concurrent release B"));
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      assertThat(releasesReady.await(10, TimeUnit.SECONDS)).isTrue();
      releasesStart.countDown();
      Object releaseA = firstRelease.get(15, TimeUnit.SECONDS);
      Object releaseB = secondRelease.get(15, TimeUnit.SECONDS);
      assertThat(List.of(releaseA, releaseB).stream()
          .filter(SparePartsService.ReservationView.class::isInstance).count()).isEqualTo(1);
      assertThat(List.of(releaseA, releaseB).stream().filter(HttpStatus.CONFLICT::equals).count()).isEqualTo(1);

      var afterReleaseRace = parts.getReservation(fixture.owner(), reservation.publicId());
      assertThat(afterReleaseRace.quantityReleased()).isEqualByComparingTo("2.000");
      assertThat(afterReleaseRace.quantityRemainingToIssue()).isEqualByComparingTo("0.000");
      assertThat(afterReleaseRace.status()).isEqualTo("PARTIALLY_CANCELLED");
      assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("0.000");
      var movements = parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items();
      assertThat(movements).filteredOn(movement -> movement.movementType().equals("RESERVATION_RELEASED"))
          .hasSize(1);
      assertThat(movements).extracting(SparePartsService.StockMovementView::movementType)
          .contains("PURCHASE_RECEIPT", "RESERVATION_CREATED", "ISSUED_TO_JOB",
              "RETURNED_FROM_JOB", "RESERVATION_RELEASED");
    } finally {
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }
  }

  @Test
  @org.springframework.transaction.annotation.Transactional(propagation = Propagation.NOT_SUPPORTED)
  void concurrentReservationsOnSameSkuCannotOversellAvailableStock() throws Exception {
    Fixture fixture = createFixture("CONCURRENT", "IN_PROGRESS");
    Fixture extraJob = createAnotherJobCard(fixture, "IN_PROGRESS");
    var part = createPart(fixture, "CONCURRENT-PART", "Concurrent reservation part");
    var supplier = createSupplier(fixture);
    receive(fixture, part.publicId(), supplier.publicId(), "concurrent-opening-" + UUID.randomUUID(),
        "10.000", "15.00");

    String keyA = "concurrent-reserve-a-" + UUID.randomUUID();
    String keyB = "concurrent-reserve-b-" + UUID.randomUUID();
    var requestA = new SparePartsService.ReservationRequest(
        part.publicId(), new BigDecimal("7.000"), keyA, "Concurrent reservation A");
    var requestB = new SparePartsService.ReservationRequest(
        part.publicId(), new BigDecimal("7.000"), keyB, "Concurrent reservation B");

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<Object> a = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start barrier timed out.");
        try {
          return parts.reservePart(fixture.owner(), fixture.jobCardPublicId(), requestA);
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      Future<Object> b = pool.submit(() -> {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start barrier timed out.");
        try {
          return parts.reservePart(fixture.owner(), extraJob.jobCardPublicId(), requestB);
        } catch (ResponseStatusException conflict) {
          return conflict.getStatusCode();
        }
      });
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      Object resultA = a.get(15, TimeUnit.SECONDS);
      Object resultB = b.get(15, TimeUnit.SECONDS);
      long successes = List.of(resultA, resultB).stream()
          .filter(SparePartsService.ReservationView.class::isInstance).count();
      long conflicts = List.of(resultA, resultB).stream()
          .filter(HttpStatus.CONFLICT::equals).count();
      assertThat(successes).isEqualTo(1);
      assertThat(conflicts).isEqualTo(1);
    } finally {
      start.countDown();
      pool.shutdownNow();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }

    var balance = parts.getPart(fixture.owner(), part.publicId());
    assertThat(balance.quantityOnHand()).isEqualByComparingTo("10.000");
    assertThat(balance.quantityReserved()).isEqualByComparingTo("7.000");
    assertThat(balance.quantityAvailable()).isEqualByComparingTo("3.000");
    assertThat(jdbc.queryForObject("""
        select count(*) from service_job_part_reservation
        where dealership_id = ? and part_id = (
          select id from spare_part where dealership_id = ? and public_id = ?)
        """, Integer.class, fixture.dealershipId(), fixture.dealershipId(), part.publicId())).isEqualTo(1);
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
        .filteredOn(movement -> movement.movementType().equals("RESERVATION_CREATED"))
        .hasSize(1);
  }

  @Test
  @org.springframework.transaction.annotation.Transactional(propagation = Propagation.NOT_SUPPORTED)
  void receiptAndReservationIdempotencyIsSharedAcrossStaffSessions() {
    Fixture fixture = createFixture("CROSS-STAFF", "IN_PROGRESS");
    var part = createPart(fixture, "CROSS-STAFF-PART", "Cross-staff idempotency part");
    var supplier = createSupplier(fixture);
    String receiptKey = "cross-staff-receipt-" + UUID.randomUUID();
    var receiptRequest = new SparePartsService.ReceiptRequest(
        supplier.publicId(), "PO-CROSS-STAFF", receiptKey, "Retry across staff login",
        List.of(new SparePartsService.ReceiptLineRequest(
            part.publicId(), new BigDecimal("8.000"), new BigDecimal("10.00"))));
    var originalReceipt = parts.receiveStock(fixture.owner(), receiptRequest);

    StaffPrincipal secondStaff = createAdditionalStaffPrincipal(fixture);
    var receiptReplay = parts.receiveStock(secondStaff, receiptRequest);
    assertThat(receiptReplay.publicId()).isEqualTo(originalReceipt.publicId());
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityOnHand()).isEqualByComparingTo("8.000");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
        .filteredOn(movement -> movement.movementType().equals("PURCHASE_RECEIPT"))
        .hasSize(1);

    String reservationKey = "cross-staff-reserve-" + UUID.randomUUID();
    var reservationRequest = new SparePartsService.ReservationRequest(
        part.publicId(), new BigDecimal("3.000"), reservationKey, "One reservation, two staff sessions");
    var originalReservation = parts.reservePart(fixture.owner(), fixture.jobCardPublicId(), reservationRequest);
    var reservationReplay = parts.reservePart(secondStaff, fixture.jobCardPublicId(), reservationRequest);
    assertThat(reservationReplay.publicId()).isEqualTo(originalReservation.publicId());
    assertThat(parts.getPart(fixture.owner(), part.publicId()).quantityReserved()).isEqualByComparingTo("3.000");
    assertThat(parts.listMovements(fixture.owner(), part.publicId(), 0, 100).items())
        .filteredOn(movement -> movement.movementType().equals("RESERVATION_CREATED"))
        .hasSize(1);

    assertThatThrownBy(() -> parts.reservePart(secondStaff, fixture.jobCardPublicId(),
        new SparePartsService.ReservationRequest(
            part.publicId(), new BigDecimal("2.000"), reservationKey, "Different payload")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));
  }

  private StaffPrincipal createAdditionalStaffPrincipal(Fixture fixture) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toLowerCase();
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Second Parts Owner', ?, 'test-hash-not-used', 'ACTIVE')
        returning id
        """, Long.class, fixture.dealershipId(), "second-parts-owner-" + unique + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, fixture.dealershipId(), staffId, ownerRoleId);
    UUID staffPublicId = jdbc.queryForObject("""
        select public_id from staff_user where dealership_id = ? and id = ?
        """, UUID.class, fixture.dealershipId(), staffId);
    return new StaffPrincipal(
        fixture.owner().sessionId() + 1, staffId, staffPublicId.toString(),
        fixture.owner().dealershipId(), fixture.owner().dealershipPublicId(),
        fixture.owner().dealershipCode(), "Second Parts Owner",
        fixture.owner().roles(), fixture.owner().permissions());
  }

  private Fixture createAnotherJobCard(Fixture fixture, String jobStatus) {
    var row = jdbc.queryForMap("""
        select customer_id, vehicle_unit_id from service_job_card
        where dealership_id = ? and public_id = ?
        """, fixture.dealershipId(), fixture.jobCardPublicId());
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    UUID jobPublicId = jdbc.queryForObject("""
        insert into service_job_card(
          dealership_id, job_card_code, customer_id, vehicle_unit_id, status,
          customer_concern, checked_in_by_staff_user_id)
        values (?, ?, ?, ?, ?, 'Concurrent parts reservation test', ?)
        returning public_id
        """, UUID.class, fixture.dealershipId(), "JC-" + unique,
        ((Number) row.get("customer_id")).longValue(),
        ((Number) row.get("vehicle_unit_id")).longValue(),
        jobStatus, fixture.owner().staffUserId());
    return new Fixture(fixture.owner(), fixture.dealershipId(), jobPublicId);
  }

  private ServiceOperationsService.EstimateView approveReservationEstimate(
      Fixture fixture, SparePartsService.ReservationView reservation, String message) {
    BigDecimal plannedQuantity = reservation.quantityReserved()
        .subtract(reservation.quantityReturned()).subtract(reservation.quantityReleased());
    var estimate = workshop.createEstimate(fixture.owner(), fixture.jobCardPublicId(),
        new ServiceOperationsService.EstimateRequest(List.of(
            new ServiceOperationsService.EstimateLineInput(
                "PART", reservation.skuCode() + " — " + reservation.partName(),
                plannedQuantity, new BigDecimal("100.00"), reservation.publicId())
        ), BigDecimal.ZERO, message));
    return workshop.recordEstimateDecision(fixture.owner(), fixture.jobCardPublicId(), estimate.publicId(),
        new ServiceOperationsService.EstimateDecisionRequest(
            "APPROVED", "SIGNED_FORM", "PART-ESTIMATE-" + UUID.randomUUID(), message));
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
        Set.of("parts.read", "parts.manage", "parts.receive", "parts.reserve", "parts.issue", "parts.return",
            "workshop.read", "workshop.appointment.read", "workshop.appointment.manage",
            "workshop.jobcard.checkin", "workshop.manage", "workshop.estimate.create",
            "workshop.approve_estimate", "workshop.jobcard.work", "workshop.quality_check",
            "workshop.jobcard.assign"));

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
