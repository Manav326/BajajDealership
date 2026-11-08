-- Synthetic customer fixture for disposable Android emulator CI databases only.
-- Password: CI-Maestro-Only-Password-123 (BCrypt cost 12; never a production credential).
-- This fixture is deliberately scoped to the CI-LUCKY-BAJAJ dealership created by the workflow.

do $$
declare
  v_dealership_id bigint;
  v_customer_id bigint;
  v_model_id bigint;
  v_vehicle_id bigint;
  v_fixture_actor_id bigint;
  v_part_id bigint;
  v_catalogue_id bigint;
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

  -- Disabled CI-only actor lets the synthetic opening-stock record retain the normal
  -- same-dealership staff FK without creating a login or granting application permissions.
  insert into staff_user (
    dealership_id, full_name, email, password_hash, status
  ) values (
    v_dealership_id, 'GitHub CI Fixture Seeder', 'ci-fixture-seeder@lucky-bajaj.invalid',
    '$2a$12$y5SrQewlvglJiK1tFCPaOOYs2gUNE2iDLOLeBgDze/GHWgKXfo56e', 'DISABLED'
  )
  on conflict do nothing;

  select id into v_fixture_actor_id
  from staff_user
  where dealership_id = v_dealership_id
    and email = 'ci-fixture-seeder@lucky-bajaj.invalid';

  if v_fixture_actor_id is null then
    raise exception 'Unable to create the disabled CI fixture audit actor.';
  end if;

  -- One explicit synthetic inventory SKU is linked to a dealership-scoped retail listing.
  -- The global BGP catalogue master remains reference-only; only this disposable dealership
  -- receives synthetic price, fitment, stock and ordering availability for the emulator test.
  insert into spare_part (
    dealership_id, sku_code, part_name, description, unit_of_measure, created_by_staff_user_id
  ) values (
    v_dealership_id, 'CI-MAESTRO-BRAKE-SHOE', 'CI Maestro brake shoe',
    'Synthetic CI-only stock fixture; not a real Bajaj OEM SKU.', 'SET', v_fixture_actor_id
  )
  on conflict (dealership_id, sku_code) do update
    set part_name = excluded.part_name,
        description = excluded.description,
        unit_of_measure = excluded.unit_of_measure,
        active = true,
        updated_at = now()
  returning id into v_part_id;

  insert into spare_part_balance (
    dealership_id, part_id, quantity_on_hand, quantity_reserved, average_unit_cost
  ) values (
    v_dealership_id, v_part_id, 3.000, 0.000, 80.00
  )
  on conflict (dealership_id, part_id) do update
    set quantity_on_hand = 3.000,
        quantity_reserved = 0.000,
        average_unit_cost = 80.00,
        updated_at = now();

  insert into spare_part_stock_movement (
    dealership_id, part_id, movement_type, quantity_delta, reserved_delta,
    quantity_on_hand_after, quantity_reserved_after, unit_cost, reference_type,
    reference_id, operation_key, request_fingerprint, actor_staff_user_id
  ) values (
    v_dealership_id, v_part_id, 'STOCK_CORRECTION', 3.000, 0.000,
    3.000, 0.000, 80.00, 'CI_FIXTURE', 'CI-MAESTRO-BRAKE-SHOE',
    'CI-MAESTRO-PART-OPENING', repeat('0', 64), v_fixture_actor_id
  )
  on conflict (dealership_id, operation_key) do update
    set quantity_delta = excluded.quantity_delta,
        reserved_delta = excluded.reserved_delta,
        quantity_on_hand_after = excluded.quantity_on_hand_after,
        quantity_reserved_after = excluded.quantity_reserved_after,
        unit_cost = excluded.unit_cost,
        request_fingerprint = excluded.request_fingerprint,
        actor_staff_user_id = excluded.actor_staff_user_id;

  select id into v_catalogue_id
  from bajaj_spare_part_catalogue
  where catalogue_code = 'BGP-0001' and is_global_catalogue = true and active = true;

  if v_catalogue_id is null then
    raise exception 'Expected the reference-only BGP-0001 brake-shoe catalogue master for the CI fixture.';
  end if;

  -- The trigger creates a local product mapping for every new inventory SKU. Move this
  -- synthetic stock SKU to the matching brake-shoe reference, only within the CI dealership.
  delete from retail_part_catalogue_stock_map
  where dealership_id = v_dealership_id and stock_part_id = v_part_id;

  insert into retail_part_catalogue_listing (
    dealership_id, catalogue_product_id, retail_enabled, retail_price, retail_description,
    fitment_model_codes, fitment_verified, updated_by_staff_user_id
  ) values (
    v_dealership_id, v_catalogue_id, true, 199.00,
    'Synthetic CI-only listing. Not a published dealership price or OEM fitment claim.',
    jsonb_build_array('BAJAJ_PULSAR_NS200'), true, v_fixture_actor_id
  )
  on conflict (dealership_id, catalogue_product_id) do update
    set retail_enabled = excluded.retail_enabled,
        retail_price = excluded.retail_price,
        retail_description = excluded.retail_description,
        fitment_model_codes = excluded.fitment_model_codes,
        fitment_verified = excluded.fitment_verified,
        updated_by_staff_user_id = excluded.updated_by_staff_user_id,
        updated_at = now();

  insert into retail_part_catalogue_stock_map (
    dealership_id, catalogue_product_id, stock_part_id, updated_by_staff_user_id
  ) values (
    v_dealership_id, v_catalogue_id, v_part_id, v_fixture_actor_id
  )
  on conflict (dealership_id, catalogue_product_id) do update
    set stock_part_id = excluded.stock_part_id,
        updated_by_staff_user_id = excluded.updated_by_staff_user_id,
        updated_at = now();
end;
$$;
