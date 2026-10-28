-- Add permissions for the operational invoice/payment and evidence-backed handover APIs.
insert into permission (code, description) values
  ('billing.invoice.read', 'Read operational service invoices and balances'),
  ('billing.invoice.issue', 'Issue an operational invoice from an approved estimate after quality check'),
  ('billing.payment.record', 'Record an operational service payment and receipt'),
  ('billing.payment.reverse', 'Reverse a previously recorded payment with an audited reason'),
  ('workshop.jobcard.deliver', 'Hand over a vehicle only when its operational invoice balance is zero')
on conflict (code) do nothing;

insert into role_permission (role_id, permission_id)
select r.id, p.id
from role r join permission p on p.code in (
  'billing.invoice.read', 'billing.invoice.issue', 'billing.payment.record',
  'billing.payment.reverse', 'workshop.jobcard.deliver'
)
where r.code in ('OWNER', 'MANAGER')
on conflict do nothing;

insert into role_permission (role_id, permission_id)
select r.id, p.id
from role r join permission p on p.code in (
  'billing.invoice.read', 'billing.invoice.issue', 'billing.payment.record',
  'workshop.jobcard.deliver'
)
where r.code = 'SERVICE_ADVISOR'
on conflict do nothing;
