-- Public product catalogue is Bajaj-only; stock quantities remain sourced from vehicle_model/vehicle_unit.
create table bajaj_motorcycle_catalog (
  model_code varchar(60) primary key,
  manufacturer varchar(20) not null default 'BAJAJ' check (manufacturer = 'BAJAJ'),
  display_name varchar(160) not null,
  family varchar(24) not null check (family in ('CNG', 'SPORT', 'TOURING', 'CRUISER', 'COMMUTER')),
  short_description varchar(500) not null,
  displacement_cc numeric(8,2) not null check (displacement_cc > 0),
  max_power_ps numeric(7,2) not null check (max_power_ps > 0),
  max_torque_nm numeric(7,2) not null check (max_torque_nm > 0),
  ex_showroom_price numeric(12,2) not null check (ex_showroom_price > 0),
  price_region varchar(80) not null default 'Delhi, India',
  price_verified_on date not null,
  official_source_url text not null,
  image_url text,
  image_source_url text,
  terrain_note varchar(300),
  feature_tags text[] not null default '{}',
  published boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (official_source_url like 'https://%'),
  check (image_url is null or image_url like 'https://%')
);
create index ix_bajaj_motorcycle_catalog_public on bajaj_motorcycle_catalog(published, sort_order, display_name);

insert into bajaj_motorcycle_catalog
(model_code,display_name,family,short_description,displacement_cc,max_power_ps,max_torque_nm,ex_showroom_price,price_verified_on,official_source_url,image_url,image_source_url,terrain_note,feature_tags,published,featured,sort_order)
values
('FREEDOM_125_NG04','Bajaj Freedom 125 NG04','CNG','A distinctive dual-fuel commuter built for everyday city rides.',124.60,9.50,9.70,117499,'2026-10-29','https://www.bajajauto.com/bikes','https://venkataramanabajaj.com/images/bajaj/Freedom/TV_Blue.jpg','https://www.venkataramanabajaj.com/bajaj-freedom-125.php','Road-focused commuter; fuel-system details vary by variant.',ARRAY['CNG + petrol','Everyday commute','Long seat'],true,false,10),
('PULSAR_N125','Bajaj Pulsar N125','SPORT','Light, lively city performance with sharp street styling.',124.59,12.00,11.00,92270,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-n125','https://asset.autocarindia.com/static/models/colors/20260203_083140_7be00815.webp','https://www.autocarindia.com/bikes/bajaj/pulsar-n125/colours/ebony-black-purple-fury','Road-focused urban motorcycle.',ARRAY['LED lighting','Digital console','Monoshock'],true,true,20),
('PULSAR_N160','Bajaj Pulsar N160','SPORT','A muscular streetfighter with confident road manners.',164.82,16.00,14.65,122106,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-n160','https://cdn.bajajauto.com/-/media/assets/bajajauto/360degreeimages/bikes/pulsar/pulsar-n-160/pulsar-250-black-360/black-red/00.png','https://www.bajajauto.com/bikes/pulsar/pulsar-n160','Road-focused; N160 S/SS feature set differs by variant.',ARRAY['Projector LED','Disc brakes','Assist and slipper clutch'],true,false,30),
('PULSAR_N250','Bajaj Pulsar N250','SPORT','Quarter-litre performance in a bold naked profile.',249.07,24.50,21.50,142202,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-n250','https://publimotosmagazine.nyc3.cdn.digitaloceanspaces.com/%E2%81%A0publimotos_tienda_production/uploads/2025/12/Pulsar-N250-miniatura-3.webp','https://publimotos.com/actualidad/comparativa-de-motos-250-en-colombia-2026-precios-potencia-y-cual-vale-la-pena-comprar/','Road-focused naked sports motorcycle.',ARRAY['Oil-cooled engine','USD forks','Dual-channel ABS'],true,false,40),
('PULSAR_NS125','Bajaj Pulsar NS125','SPORT','Compact naked sport styling for the daily ride.',124.45,12.00,11.00,99622,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-ns125','https://cdn.cars24.com/prod/new-bike-cms/Bajaj/Pulsar-Ns125/2025/01/03/bdc23bba-eaa8-4a21-bf83-15b750da7737-Bajaj_Pulsar-Ns125_Bike-Image.png','https://www.bikes24.com/bajaj/pulsar-ns125/specifications/','Road-focused naked sports motorcycle.',ARRAY['Sport styling','Disc front brake','Lightweight feel'],true,false,50),
('PULSAR_NS160','Bajaj Pulsar NS160','SPORT','A performance-oriented street bike with planted stance.',160.30,17.00,14.60,126301,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-ns160','https://somosmoto.pe/images/models/thumbnails/colors/bajaj-pulsar-ns160-td-abs-2023-gris-cdcbb7.png','https://somosmoto.pe/motos/bajaj-pulsar/5G','Road-focused naked sports motorcycle.',ARRAY['Perimeter frame','Disc brakes','Digital instrumentation'],true,false,60),
('PULSAR_NS200','Bajaj Pulsar NS200','SPORT','A sharp, performance-led streetfighter with a liquid-cooled engine.',199.50,24.50,18.74,138302,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-ns200','https://cdn.bajajauto.com/-/media/assets/bajajauto/360degreeimages/bikes/pulsar/pulsar-ns-200/blue/00.png','https://www.bajajauto.com/bikes/pulsar/pulsar-ns200','Road-focused naked sports motorcycle.',ARRAY['Liquid-cooled engine','6-speed gearbox','Dual-channel ABS'],true,true,70),
('PULSAR_NS400Z','Bajaj Pulsar NS400Z','SPORT','The flagship Pulsar streetfighter with advanced rider technology.',350.00,40.60,33.00,190015,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-ns400z','https://asset.autocarindia.com/static/news/images/20261001_124659_01b34df9.jpg?fm=auto&q=75&w=728','https://www.autocarindia.com/bike-news/bajaj-pulsar-ns400z-with-tft-console-launched-at-rs-190-lakh-440901','Off-road ride mode is available; verify the selected configuration and rider handbook.',ARRAY['Ride-by-wire','Selectable ride modes','TFT console on updated variant'],true,true,1),
('PULSAR_RS200','Bajaj Pulsar RS200','SPORT','Fully-faired sport styling with a focused riding position.',199.50,24.50,18.70,180528,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-rs200','https://static.wixstatic.com/media/4db059_e9f9b09265a24bbbb9c49082b8be3366~mv2.png/v1/fit/w_500%2Ch_500%2Cq_90/file.png','https://www.motosbajaj.com.mx/product-page/pulsar-rs-200','Road-focused fully-faired sports motorcycle.',ARRAY['Full fairing','Liquid-cooled engine','Dual-channel ABS'],true,false,80),
('DOMINAR_400','Bajaj Dominar 400','TOURING','A muscular sports tourer for long-distance road journeys.',349.13,40.60,33.20,208270,'2026-10-29','https://www.bajajauto.com/bikes/dominar/dominar-400','https://ambabajaj.com/wp-content/uploads/2017/12/Dominar-400-Ambabajaj-6.png','https://ambabajaj.com/inventory/dominar-400/','Off-road ride mode is listed by Bajaj; this is not a separate off-road price.',ARRAY['Liquid-cooled DOHC','Touring ergonomics','Selectable ride modes'],true,false,90),
('DOMINAR_250','Bajaj Dominar 250','TOURING','A balanced sports tourer for weekend escapes and everyday roads.',248.77,27.00,23.50,186835,'2026-10-29','https://www.bajajauto.com/bikes/dominar/dominar-250',null,null,'Road-focused touring motorcycle.',ARRAY['Liquid-cooled engine','Touring design','Disc brakes'],true,false,100),
('AVENGER_220_CRUISE','Bajaj Avenger 220 Cruise','CRUISER','Low-slung cruiser ergonomics and relaxed highway character.',220.00,19.03,17.55,133617,'2026-10-29','https://www.bajajauto.com/bikes/avenger/avenger-220-cruise','https://kursk-moto.ru/image/cache/catalog/28c6f608eaac1eb82bea9eeacb9762dc-1000x700.jpg','https://kursk-moto.ru/index.php?product_id=2055&route=product/product','Road-focused cruiser.',ARRAY['Cruiser ergonomics','Long seat','Relaxed riding posture'],true,false,110),
('AVENGER_220_STREET','Bajaj Avenger 220 Street','CRUISER','Street-style cruiser proportions for relaxed urban riding.',220.00,19.03,17.55,133617,'2026-10-29','https://www.bajajauto.com/bikes/avenger/avenger-220-street',null,null,'Road-focused cruiser.',ARRAY['Cruiser ergonomics','Street styling','Comfort-focused ride'],true,false,120),
('PLATINA_100','Bajaj Platina 100','COMMUTER','A practical commuter made for everyday mobility.',99.59,8.20,8.30,72942,'2026-10-29','https://www.bajajauto.com/bikes',null,null,'Road-focused commuter.',ARRAY['Commuter ergonomics','Simple daily use','Lightweight class'],true,false,130),
('PLATINA_110','Bajaj Platina 110 Drum','COMMUTER','Comfort-led commuter design for everyday riding.',115.06,9.50,9.90,75797,'2026-10-29','https://www.bajajauto.com/bikes','https://auto.hindustantimes.com/cms-images/bajaj_platina110/images/exterior_bajaj-platina-110_right-view_450x300.jpg','https://auto.hindustantimes.com/new-bikes/bajaj/platina110','Road-focused commuter.',ARRAY['Comfort suspension','Long seat','Tubeless tyres'],true,false,140),
('CT_110X','Bajaj CT 110X','COMMUTER','Rugged commuter styling for everyday road conditions.',115.45,9.50,9.90,74930,'2026-10-29','https://www.bajajauto.com/bikes',null,null,'Road-focused rugged commuter; not a dedicated off-road motorcycle.',ARRAY['Rugged commuter','Protective styling','Daily utility'],true,false,150),
('PULSAR_125','Bajaj Pulsar 125','SPORT','Classic Pulsar styling in an accessible displacement class.',124.38,11.80,10.80,104318,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-125',null,null,'Road-focused commuter-sport motorcycle.',ARRAY['Pulsar styling','Everyday usability','Disc option by variant'],true,false,160),
('PULSAR_150','Bajaj Pulsar 150','SPORT','An established everyday sport commuter with familiar Pulsar character.',149.50,14.00,13.40,128650,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-150',null,null,'Road-focused sport commuter.',ARRAY['Everyday performance','Pulsar styling','Variant-dependent braking'],true,false,170),
('PULSAR_220F','Bajaj Pulsar 220F','SPORT','Half-faired touring-sport styling and strong mid-range character.',220.00,20.90,18.55,135582,'2026-10-29','https://www.bajajauto.com/bikes/pulsar/pulsar-220f',null,null,'Road-focused sport tourer.',ARRAY['Half fairing','Sport touring','Digital console'],true,false,180),
('FREEDOM_125_NG04_DRUM_LED','Bajaj Freedom 125 NG04 Drum LED','CNG','Dual-fuel commuter with a feature set that varies by variant.',124.60,9.50,9.70,104058,'2026-10-29','https://www.bajajauto.com/bikes',null,null,'Road-focused commuter.',ARRAY['CNG + petrol','Dual-fuel system','Daily commute'],true,false,190),
('FREEDOM_125_NG04_DRUM','Bajaj Freedom 125 NG04 Drum','CNG','A practical dual-fuel commuter variant.',124.60,9.50,9.70,107159,'2026-10-29','https://www.bajajauto.com/bikes',null,null,'Road-focused commuter.',ARRAY['CNG + petrol','Dual-fuel system','Daily commute'],true,false,200);

-- Add the master model rows to existing dealership inventory only when absent.
-- These are model definitions and do not assert physical stock is available.
insert into vehicle_model(dealership_id,model_code,model_name,variant_name,colour_name,model_year,active)
select d.id,c.model_code,c.display_name,null,null,null,true
from dealership d cross join bajaj_motorcycle_catalog c
where c.published = true
  and not exists (
    select 1 from vehicle_model existing
    where existing.dealership_id = d.id and upper(existing.model_code) = c.model_code
  )
on conflict do nothing;
