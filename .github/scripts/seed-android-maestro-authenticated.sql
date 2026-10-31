-- Synthetic customer fixture for disposable Android emulator CI databases only.
-- Password: CI-Maestro-Only-Password-123 (BCrypt cost 12; never a production credential).
-- This fixture is deliberately scoped to the CI-LUCKY-BAJAJ dealership created by the workflow.

do $$
declare
  v_dealership_id bigint;
  v_customer_id bigint;
  v_model_id bigint;
  v_vehicle_id bigint;
begin
  select id into v_dealership_id
  from dealership
  where code = 'CI-LUCKY-BAJAJ' and status = 'ACTIVE';

  if v_dealership_id is null then
    raise exception 'Expected the disposable CI-LUCKY-BAJAJ dealership to exist before seeding mobile fixtures.';
  end if;

  insert into customer (
    dealership_id, customer_code, full_name, phone, email, preferred_language, status, notes
  ) values (
    v_dealership_id, 'CI-MAESTRO-CUSTOMER', 'CI Maestro Customer',
    '919800000001', 'ci-maestro@example.invalid', 'en', 'ACTIVE',
    'Synthetic customer used only by the Android emulator Maestro suite.'
  )
  on conflict (dealership_id, customer_code) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        email = excluded.email,
        preferred_language = excluded.preferred_language,
        status = 'ACTIVE',
        notes = excluded.notes,
        updated_at = now()
  returning id into v_customer_id;

  insert into customer_portal_account (
    dealership_id, customer_id, password_hash, status
  ) values (
    v_dealership_id, v_customer_id,
    '$2a$12$y5SrQewlvglJiK1tFCPaOOYs2gUNE2iDLOLeBgDze/GHWgKXfo56e', 'ACTIVE'
  )
  on conflict (dealership_id, customer_id) do update
    set password_hash = excluded.password_hash,
        status = 'ACTIVE',
        failed_login_count = 0,
        locked_until = null,
        password_changed_at = now(),
        updated_at = now();

  insert into vehicle_model (
    dealership_id, model_code, model_name, variant_name, colour_name, model_year, active
  ) values (
    v_dealership_id, 'CI-MAESTRO-MODEL', 'CI Maestro Motorcycle', 'Standard', 'Black', 2026, true
  )
  on conflict (dealership_id, model_code, variant_name, colour_name, model_year) do update
    set model_name = excluded.model_name,
        active = true,
        updated_at = now()
  returning id into v_model_id;

  insert into vehicle_unit (
    dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status
  ) values (
    v_dealership_id, v_model_id, 'CI-MAESTRO-CHASSIS', 'CI-MAESTRO-ENGINE', 'SOLD'
  )
  on conflict (dealership_id, chassis_number) do update
    set vehicle_model_id = excluded.vehicle_model_id,
        engine_number = excluded.engine_number,
        stock_status = 'SOLD',
        updated_at = now()
  returning id into v_vehicle_id;

  insert into customer_vehicle (dealership_id, customer_id, vehicle_unit_id)
  values (v_dealership_id, v_customer_id, v_vehicle_id)
  on conflict (vehicle_unit_id) where ownership_ended_at is null do update
    set dealership_id = excluded.dealership_id,
        customer_id = excluded.customer_id,
        ownership_ended_at = null;
end;
$$;
