-- Repeated customer submissions must resolve to the original request, not create duplicates.
alter table customer_sales_request
  add column idempotency_key varchar(120),
  add column request_fingerprint char(64);

update customer_sales_request
set idempotency_key = 'legacy-' || id::text,
    request_fingerprint = repeat('0', 64)
where idempotency_key is null or request_fingerprint is null;

alter table customer_sales_request
  alter column idempotency_key set not null,
  alter column request_fingerprint set not null,
  add constraint uq_customer_sales_request_idempotency
    unique (dealership_id, customer_portal_account_id, idempotency_key);
