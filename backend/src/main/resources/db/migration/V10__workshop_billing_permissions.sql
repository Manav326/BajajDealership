-- Permissions used by the consolidated BillingOperationsController.
insert into permission (code, description) values
  ('finance.read', 'Read workshop invoices, balances, receipts and handover records'),
  ('finance.invoice', 'Create and issue operational service invoices'),
  ('finance.payment', 'Record manual operational payment entries and receipts'),
  ('finance.payment.reverse', 'Reverse an operational payment record with an audited reason'),
  ('workshop.jobcard.deliver', 'Hand over a vehicle only after invoice settlement and acknowledgement')
on conflict (code) do nothing;

insert into role_permission (role_id, permission_id)
select r.id, p.id
from role r join permission p on p.code in (
  'finance.read', 'finance.invoice', 'finance.payment',
  'finance.payment.reverse', 'workshop.jobcard.deliver'
)
where r.code in ('OWNER', 'MANAGER')
on conflict do nothing;

insert into role_permission (role_id, permission_id)
select r.id, p.id
from role r join permission p on p.code in (
  'finance.read', 'finance.invoice', 'finance.payment', 'workshop.jobcard.deliver'
)
where r.code = 'SERVICE_ADVISOR'
on conflict do nothing;
