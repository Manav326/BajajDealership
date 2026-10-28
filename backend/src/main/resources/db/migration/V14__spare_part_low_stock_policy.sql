alter table spare_part_balance
  add column low_stock_threshold numeric(12,3) not null default 0
    check (low_stock_threshold >= 0),
  add column reorder_to_quantity numeric(12,3) not null default 0
    check (reorder_to_quantity >= 0),
  add constraint ck_spare_part_reorder_target
    check (reorder_to_quantity >= low_stock_threshold);
