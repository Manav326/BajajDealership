alter table service_job_part_reservation
  add column quantity_released numeric(12,3) not null default 0
    check (quantity_released >= 0);

alter table service_job_part_reservation
  add constraint ck_job_part_reservation_consumed_quantity
    check (quantity_issued + quantity_released <= quantity_reserved),
  add constraint ck_job_part_reservation_open_has_no_release
    check (status <> 'OPEN' or quantity_released = 0),
  add constraint ck_job_part_reservation_partial_issue_has_no_release
    check (status <> 'PARTIALLY_ISSUED' or quantity_released = 0),
  add constraint ck_job_part_reservation_issued_has_no_release
    check (status <> 'ISSUED' or quantity_released = 0),
  add constraint ck_job_part_reservation_cancelled_releases_all
    check (status <> 'CANCELLED' or quantity_released = quantity_reserved),
  add constraint ck_job_part_reservation_partial_cancel_releases_remainder
    check (
      status <> 'PARTIALLY_CANCELLED'
      or (
        quantity_released > 0
        and quantity_issued + quantity_released = quantity_reserved
      )
    );
