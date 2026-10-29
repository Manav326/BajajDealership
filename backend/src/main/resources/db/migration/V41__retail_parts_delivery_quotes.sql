-- Staff-quoted delivery for retail parts. No rate is invented, and delivery is never paid until staff records fulfilment.
alter table retail_part_order
  add column fulfillment_method varchar(16) not null default 'PICKUP',
  add column delivery_address varchar(1500),
  add column delivery_fee numeric(14,2) not null default 0,
  add column delivery_quote_status varchar(40) not null default 'NOT_REQUIRED',
  add column delivery_quote_note varchar(1000),
  add column delivery_quoted_by_staff_user_id bigint,
  add column delivery_quoted_at timestamptz,
  add column delivery_quote_idempotency_key varchar(120),
  add column delivery_quote_fingerprint char(64),
  drop constraint retail_part_order_payment_method_check,
  add constraint ck_retail_part_order_payment_method
    check (payment_method in ('PAY_AT_PICKUP', 'PAY_ON_DELIVERY')),
  drop constraint ck_retail_part_order_payment_status,
  add constraint ck_retail_part_order_payment_status
    check (payment_status in (
      'PAY_ON_PICKUP', 'PAID_AT_PICKUP', 'PAY_ON_DELIVERY', 'PAID_ON_DELIVERY', 'REFUND_REVIEW_REQUIRED'
    )),
  add constraint fk_retail_delivery_quote_staff_same_dealership
    foreign key (dealership_id, delivery_quoted_by_staff_user_id) references staff_user(dealership_id, id),
  add constraint ck_retail_order_delivery_fee
    check (delivery_fee >= 0),
  add constraint ck_retail_order_fulfillment_method
    check (fulfillment_method in ('PICKUP', 'DELIVERY')),
  add constraint ck_retail_order_delivery_quote_status
    check (delivery_quote_status in (
      'NOT_REQUIRED', 'AWAITING_STAFF_QUOTE', 'AWAITING_CUSTOMER_CONFIRMATION', 'ACCEPTED', 'DECLINED', 'CANCELLED'
    )),
  add constraint ck_retail_order_delivery_details
    check (
      (fulfillment_method = 'PICKUP'
        and delivery_address is null and delivery_fee = 0 and delivery_quote_status = 'NOT_REQUIRED'
        and delivery_quote_note is null and delivery_quoted_by_staff_user_id is null
        and delivery_quoted_at is null and delivery_quote_idempotency_key is null
        and delivery_quote_fingerprint is null)
      or
      (fulfillment_method = 'DELIVERY'
        and delivery_address is not null and length(trim(delivery_address)) > 0
        and delivery_quote_status in (
          'AWAITING_STAFF_QUOTE', 'AWAITING_CUSTOMER_CONFIRMATION', 'ACCEPTED', 'DECLINED', 'CANCELLED'
        )
        and (
          (delivery_quote_status = 'AWAITING_STAFF_QUOTE'
            and delivery_fee = 0 and delivery_quote_note is null and delivery_quoted_by_staff_user_id is null
            and delivery_quoted_at is null and delivery_quote_idempotency_key is null
            and delivery_quote_fingerprint is null)
          or
          (delivery_quote_status in ('AWAITING_CUSTOMER_CONFIRMATION', 'ACCEPTED', 'DECLINED')
            and delivery_quoted_by_staff_user_id is not null and delivery_quoted_at is not null
            and delivery_quote_idempotency_key is not null and delivery_quote_fingerprint is not null)
          or
          (delivery_quote_status = 'CANCELLED' and (
            (delivery_fee = 0 and delivery_quote_note is null and delivery_quoted_by_staff_user_id is null
              and delivery_quoted_at is null and delivery_quote_idempotency_key is null
              and delivery_quote_fingerprint is null)
            or
            (delivery_quoted_by_staff_user_id is not null and delivery_quoted_at is not null
              and delivery_quote_idempotency_key is not null and delivery_quote_fingerprint is not null)
          ))
        ))
    ),
  add constraint ck_retail_order_fulfillment_payment
    check (
      (fulfillment_method = 'PICKUP' and payment_method = 'PAY_AT_PICKUP'
        and payment_status in ('PAY_ON_PICKUP', 'PAID_AT_PICKUP', 'REFUND_REVIEW_REQUIRED'))
      or
      (fulfillment_method = 'DELIVERY' and payment_method = 'PAY_ON_DELIVERY'
        and payment_status in ('PAY_ON_DELIVERY', 'PAID_ON_DELIVERY', 'REFUND_REVIEW_REQUIRED'))
    );

create unique index uq_retail_part_order_delivery_quote_key
  on retail_part_order(dealership_id, delivery_quote_idempotency_key)
  where delivery_quote_idempotency_key is not null;
create index ix_retail_order_delivery_quote_queue
  on retail_part_order(dealership_id, fulfillment_method, delivery_quote_status, status, created_at desc);
