-- Per-dealership storefront visibility and stock forecast. Forecasts never create physical stock.
create table bajaj_catalogue_dealership_model (
  dealership_id bigint not null references dealership(id) on delete cascade,
  model_code varchar(60) not null references bajaj_catalogue_model(model_code) on delete cascade,
  is_published boolean not null default false,
  marked_out_of_stock boolean not null default false,
  expected_available_on date,
  internal_note varchar(500),
  updated_by_staff_user_id bigint,
  updated_at timestamptz not null default now(),
  primary key (dealership_id, model_code),
  constraint fk_bajaj_catalogue_settings_actor_same_dealership
    foreign key (dealership_id, updated_by_staff_user_id)
    references staff_user(dealership_id, id),
  constraint ck_bajaj_catalogue_expected_date
    check (expected_available_on is null or marked_out_of_stock)
);
create index ix_bajaj_catalogue_dealership_published
  on bajaj_catalogue_dealership_model(dealership_id, is_published, model_code);

insert into permission(code, description) values
  ('catalogue.read', 'View public showroom catalogue settings and availability'),
  ('catalogue.manage', 'Publish or unpublish Bajaj models and manage out-of-stock forecasts')
on conflict (code) do nothing;

insert into role_permission(role_id, permission_id)
select r.id, p.id from role r cross join permission p
where r.code = 'OWNER' and p.code in ('catalogue.read','catalogue.manage')
on conflict do nothing;

insert into role_permission(role_id, permission_id)
select r.id, p.id from role r cross join permission p
where r.code = 'MANAGER' and p.code in ('catalogue.read','catalogue.manage')
on conflict do nothing;

-- New dealerships begin with the seeded Bajaj catalogue explicitly published.
-- Physical vehicle units are not created here; inventory state remains factual.
insert into bajaj_catalogue_dealership_model(dealership_id, model_code, is_published)
select d.id, c.model_code, true
from dealership d cross join bajaj_catalogue_model c
where d.status = 'ACTIVE' and c.active
on conflict (dealership_id, model_code) do nothing;
