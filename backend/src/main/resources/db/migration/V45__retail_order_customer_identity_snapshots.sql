-- Preserve the purchaser identity at retail checkout. These fields intentionally remain NULL
-- for legacy orders because their true order-time contact details cannot be reconstructed safely.
alter table retail_part_order
  add column customer_name_snapshot varchar(160),
  add column customer_phone_snapshot varchar(32);
