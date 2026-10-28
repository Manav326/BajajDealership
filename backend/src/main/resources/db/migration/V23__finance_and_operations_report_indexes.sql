-- Cover dealership/time predicates used by operational reporting and close reconciliation.
-- All indexes are additive; no historical ledger rows or released migrations are changed.
create index if not exists ix_sales_enquiry_report_created_at
  on sales_enquiry (dealership_id, created_at);
create index if not exists ix_sales_booking_report_created_at
  on sales_booking (dealership_id, created_at);
create index if not exists ix_vehicle_sale_handover_report_delivered_at
  on vehicle_sale_handover (dealership_id, delivered_at);
create index if not exists ix_sales_test_ride_report_completed_at
  on sales_test_ride (dealership_id, completed_at)
  where status = 'COMPLETED' and completed_at is not null;
create index if not exists ix_service_job_card_report_checked_in_at
  on service_job_card (dealership_id, checked_in_at);
create index if not exists ix_vehicle_sale_invoice_report_issued_at
  on vehicle_sale_invoice (dealership_id, issued_at)
  where issued_at is not null;
create index if not exists ix_vehicle_sale_invoice_report_cancelled_at
  on vehicle_sale_invoice (dealership_id, cancelled_at)
  where cancelled_at is not null;
create index if not exists ix_service_invoice_report_issued_at
  on service_invoice (dealership_id, issued_at)
  where issued_at is not null;
create index if not exists ix_service_invoice_report_cancelled_at
  on service_invoice (dealership_id, cancelled_at)
  where cancelled_at is not null;
create index if not exists ix_part_purchase_receipt_report_received_at
  on part_purchase_receipt (dealership_id, received_at);
create index if not exists ix_spare_part_stock_movement_report_created_at
  on spare_part_stock_movement (dealership_id, created_at, movement_type);
create index if not exists ix_finance_adjustment_credit_review_report
  on finance_invoice_adjustment (dealership_id, reviewed_at, source_type)
  where adjustment_type = 'CREDIT_NOTE' and status = 'APPROVED' and reviewed_at is not null;
create index if not exists ix_finance_adjustment_paid_refund_invoice_report
  on finance_invoice_adjustment (dealership_id, source_type, sales_invoice_id, service_invoice_id, paid_at)
  where adjustment_type = 'REFUND' and status = 'PAID' and paid_at is not null;
