alter table service_estimate
  add column source_job_status varchar(24) not null default 'ESTIMATE_PENDING'
    check (source_job_status in ('ESTIMATE_PENDING', 'APPROVED', 'IN_PROGRESS'));

alter table service_estimate_line
  add column source_reservation_id bigint,
  add column source_quantity_reserved numeric(12,3),
  add column source_quantity_issued numeric(12,3),
  add column source_quantity_returned numeric(12,3),
  add column source_quantity_released numeric(12,3),
  add column source_unit_cost_snapshot numeric(14,2),
  add column source_snapshot_at timestamptz,
  add constraint fk_estimate_line_source_reservation_same_dealership
    foreign key (dealership_id, source_reservation_id)
    references service_job_part_reservation(dealership_id, id),
  add constraint ck_estimate_line_part_snapshot_completeness
    check (
      (source_reservation_id is null
        and source_quantity_reserved is null
        and source_quantity_issued is null
        and source_quantity_returned is null
        and source_quantity_released is null
        and source_unit_cost_snapshot is null
        and source_snapshot_at is null)
      or
      (source_reservation_id is not null
        and source_quantity_reserved is not null
        and source_quantity_issued is not null
        and source_quantity_returned is not null
        and source_quantity_released is not null
        and source_unit_cost_snapshot is not null
        and source_snapshot_at is not null)
    ),
  add constraint ck_estimate_line_part_snapshot_quantities
    check (
      source_reservation_id is null
      or (
        source_quantity_reserved >= 0
        and source_quantity_issued >= 0
        and source_quantity_returned >= 0
        and source_quantity_released >= 0
        and source_quantity_issued + source_quantity_released <= source_quantity_reserved
        and source_quantity_returned <= source_quantity_issued
        and quantity = source_quantity_reserved - source_quantity_returned - source_quantity_released
      )
    ),
  add constraint ck_estimate_line_part_snapshot_cost
    check (source_unit_cost_snapshot is null or source_unit_cost_snapshot >= 0);

create unique index uq_estimate_line_reservation_source
  on service_estimate_line (dealership_id, estimate_id, source_reservation_id)
  where source_reservation_id is not null;

create index ix_estimate_line_reservation_history
  on service_estimate_line (dealership_id, source_reservation_id, estimate_id)
  where source_reservation_id is not null;
