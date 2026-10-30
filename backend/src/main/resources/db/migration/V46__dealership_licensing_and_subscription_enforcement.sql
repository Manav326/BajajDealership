create table dealership_license (
  dealership_id bigint primary key references dealership(id) on delete cascade,
  plan_code varchar(80) not null default 'TRIAL',
  status varchar(20) not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  grace_period_days integer not null default 7 check (grace_period_days between 0 and 90),
  max_staff_seats integer not null default 20 check (max_staff_seats between 1 and 1000),
  last_changed_reason varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index ix_dealership_license_status_expiry
  on dealership_license (status, expires_at);

-- Existing dealerships receive a trial so first deployment is not immediately blocked.
-- Configure real commercial terms before the migration trial expires.
insert into dealership_license(
  dealership_id, plan_code, status, starts_at, expires_at,
  grace_period_days, max_staff_seats, last_changed_reason)
select id, 'TRIAL', 'ACTIVE', now(), now() + interval '30 days',
       7, 20, 'Automatic 30-day migration trial; configure commercial license terms.'
from dealership
on conflict (dealership_id) do nothing;

create function seed_default_dealership_license() returns trigger
language plpgsql
as $$
begin
  insert into dealership_license(
    dealership_id, plan_code, status, starts_at, expires_at,
    grace_period_days, max_staff_seats, last_changed_reason)
  values (
    new.id, 'TRIAL', 'ACTIVE', now(), now() + interval '30 days',
    7, 20, 'Automatic 30-day trial; configure commercial license terms.')
  on conflict (dealership_id) do nothing;
  return new;
end;
$$;

create trigger trg_seed_default_dealership_license
after insert on dealership
for each row execute function seed_default_dealership_license();
