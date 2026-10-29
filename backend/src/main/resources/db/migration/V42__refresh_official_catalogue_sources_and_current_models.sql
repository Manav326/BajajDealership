-- Refresh public source links to model-specific manufacturer pages and correct the current lineup.
-- This migration modifies catalogue metadata only. It does not create physical vehicle units.
with official_sources(model_code, model_url, specs_url, price_url) as (
  values
    ('BAJAJ_FREEDOM_125_NG04',
      'https://www.bajajauto.com/bikes/bajaj-freedom/bajaj-freedom-125-ng04',
      'https://www.bajajauto.com/bikes/bajaj-freedom/bajaj-freedom-125-ng04',
      'https://www.bajajauto.com/bikes/bajaj-freedom'),
    ('BAJAJ_PULSAR_N125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n125'),
    ('BAJAJ_PULSAR_N160',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n160-price',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n160-price',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n160-price'),
    ('BAJAJ_PULSAR_N250',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n250',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n250',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-n250'),
    ('BAJAJ_PULSAR_NS125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns125'),
    ('BAJAJ_PULSAR_NS160',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns160',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns160',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns160'),
    ('BAJAJ_PULSAR_NS200',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns200',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns200/specifications',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns200'),
    ('BAJAJ_PULSAR_NS400Z',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns400z',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns400z',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-ns400z-price'),
    ('BAJAJ_PULSAR_RS200',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-rs200',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-rs200',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-rs200'),
    ('BAJAJ_PULSAR_125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-125',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-125'),
    ('BAJAJ_PULSAR_150',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-150',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-150',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-150'),
    ('BAJAJ_PULSAR_180',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-180-2026',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-180-2026',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-180-2026'),
    ('BAJAJ_PULSAR_220F',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-220f',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-220f',
      'https://www.bajajauto.com/bikes/pulsar/pulsar-220f'),
    ('BAJAJ_DOMINAR_250',
      'https://www.bajajauto.com/bikes/dominar/dominar-250',
      'https://www.bajajauto.com/bikes/dominar/dominar-250/specifications',
      'https://www.bajajauto.com/bikes/dominar/dominar-250'),
    ('BAJAJ_DOMINAR_400',
      'https://www.bajajauto.com/bikes/dominar/dominar-400',
      'https://www.bajajauto.com/bikes/dominar/dominar-400',
      'https://www.bajajauto.com/bikes/dominar/dominar-400-price'),
    ('BAJAJ_AVENGER_220_CRUISE',
      'https://www.bajajauto.com/bikes/avenger/avenger-cruise-220',
      'https://www.bajajauto.com/bikes/avenger/avenger-cruise-220',
      'https://www.bajajauto.com/bikes/avenger/avenger-cruise-220'),
    ('BAJAJ_AVENGER_220_STREET',
      'https://www.bajajauto.com/bikes/avenger',
      'https://www.bajajauto.com/bikes/avenger',
      'https://www.bajajauto.com/bikes/avenger'),
    ('BAJAJ_PLATINA_100',
      'https://www.bajajauto.com/bikes/platina/platina-100',
      'https://www.bajajauto.com/bikes/platina/platina-100',
      'https://www.bajajauto.com/bikes/platina/platina-100'),
    ('BAJAJ_PLATINA_110_DRUM',
      'https://www.bajajauto.com/bikes/platina/platina-110',
      'https://www.bajajauto.com/bikes/platina/platina-110',
      'https://www.bajajauto.com/bikes/platina/platina-110'),
    ('BAJAJ_CT_110X',
      'https://www.bajajauto.com/bikes/ct/ct-110x',
      'https://www.bajajauto.com/bikes/ct/ct-110x',
      'https://www.bajajauto.com/bikes/ct/ct-110x')
)
update bajaj_catalogue_model c
set official_model_url = s.model_url,
    official_specs_url = s.specs_url,
    price_source_url = s.price_url,
    updated_at = now()
from official_sources s
where c.model_code = s.model_code;

-- Current official Dominar 400 page and April 2026 release disagree on the ex-showroom
-- figure. Keep the model, but suppress the public price until a staff member verifies it.
update bajaj_catalogue_model
set ex_showroom_price = null,
    price_verified_at = null,
    price_source_url = 'https://www.bajajauto.com/bikes/dominar/dominar-400-price',
    updated_at = now()
where model_code = 'BAJAJ_DOMINAR_400';

-- The manufacturer explicitly labels Avenger 220 Street as discontinued. Keep its history,
-- but remove it from current catalogue publication and prevent bootstrap from treating it active.
update bajaj_catalogue_model
set active = false, updated_at = now()
where model_code = 'BAJAJ_AVENGER_220_STREET';

update bajaj_catalogue_dealership_model
set is_published = false,
    marked_out_of_stock = false,
    expected_available_on = null,
    internal_note = 'Manufacturer marks Avenger 220 Street as discontinued; it is not in the current public lineup.',
    updated_at = now()
where model_code = 'BAJAJ_AVENGER_220_STREET';

-- Current official listing: Freedom 125 NG04 Drum LED, ₹1,04,058 ex-showroom Delhi.
-- Add a model definition only; actual stock must still be received through inventory.
insert into bajaj_catalogue_model(
  model_code, model_name, family, category, engine_cc, max_power, max_torque,
  gearbox, braking, front_suspension, rear_suspension, fuel_tank_l, ground_clearance_mm,
  kerb_weight_kg, ride_character, highlights, hero_image_url, official_model_url,
  official_specs_url, ex_showroom_price, price_city, price_source_url, price_verified_at,
  active, featured_rank
) values (
  'BAJAJ_FREEDOM_125_NG04_DRUM_LED',
  'Freedom 125 NG04 Drum LED',
  'Freedom', 'COMMUTER', 124.60, '9.5 PS', '9.7 Nm',
  null, null, null, null, null, null, null,
  'Everyday dual-fuel commuting',
  array['Official NG04 Drum LED variant', '125 cc CNG and petrol motorcycle'],
  'https://cdn.bajajauto.com/-/media/assets/bajajauto/bikes/web-header-navigator-images/freedom-125-ng04-drum-led.webp',
  'https://www.bajajauto.com/bikes/bajaj-freedom/bajaj-freedom-125-ng04',
  'https://www.bajajauto.com/bikes/bajaj-freedom/bajaj-freedom-125-ng04',
  104058, 'New Delhi',
  'https://www.bajajauto.com/bikes/bajaj-freedom',
  date '2026-10-29', true, 11
)
on conflict (model_code) do update set
  manufacturer = 'BAJAJ',
  model_name = excluded.model_name,
  family = excluded.family,
  category = excluded.category,
  engine_cc = excluded.engine_cc,
  max_power = excluded.max_power,
  max_torque = excluded.max_torque,
  ride_character = excluded.ride_character,
  highlights = excluded.highlights,
  hero_image_url = excluded.hero_image_url,
  official_model_url = excluded.official_model_url,
  official_specs_url = excluded.official_specs_url,
  ex_showroom_price = excluded.ex_showroom_price,
  price_city = excluded.price_city,
  price_source_url = excluded.price_source_url,
  price_verified_at = excluded.price_verified_at,
  active = true,
  featured_rank = excluded.featured_rank,
  updated_at = now();

insert into vehicle_model(dealership_id, model_code, model_name, variant_name, colour_name, model_year, active)
select d.id, c.model_code, c.model_name, null, null, null, true
from dealership d
cross join bajaj_catalogue_model c
where d.status = 'ACTIVE'
  and c.model_code = 'BAJAJ_FREEDOM_125_NG04_DRUM_LED'
  and c.active = true
  and not exists (
    select 1 from vehicle_model existing
    where existing.dealership_id = d.id and existing.model_code = c.model_code
  );

insert into bajaj_catalogue_dealership_model(
  dealership_id, model_code, is_published, marked_out_of_stock, expected_available_on, internal_note)
select d.id, c.model_code, true, false, null, null
from dealership d
cross join bajaj_catalogue_model c
where d.status = 'ACTIVE'
  and c.model_code = 'BAJAJ_FREEDOM_125_NG04_DRUM_LED'
  and c.active = true
on conflict (dealership_id, model_code) do update set
  is_published = true,
  marked_out_of_stock = false,
  expected_available_on = null,
  internal_note = null,
  updated_at = now();
