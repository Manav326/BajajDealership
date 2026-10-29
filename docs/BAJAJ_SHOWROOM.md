# Lucky Bajaj Public Showroom

## Product/data boundary
The public motorcycle catalogue is sourced from `bajaj_catalogue_model`; physical stock remains sourced from dealership-scoped `vehicle_model` and `vehicle_unit`. The catalogue migration creates 20 current Bajaj Auto motorcycle listings (Freedom, Pulsar, Dominar, Avenger, Platina and CT families) with manufacturer-constrained records. It deliberately does not create fake vehicle units, chassis/engine identifiers or available stock.

Every public endpoint enforces `manufacturer = 'BAJAJ'` and never emits purchase cost, vehicle identifiers, supplier data or customer information. Catalogue rows include safe aggregate counts of available, expected and reserved physical units. If there is no real available unit, the UI says availability must be confirmed; a catalogue entry is not represented as in-stock.

## Price disclosure
Initial ex-showroom reference prices and specification highlights were populated from Bajaj Auto India's public motorcycle range, https://www.bajajauto.com/bikes, checked on 2026-10-29. `price_city` is New Delhi and `price_verified_at` records the source-check date. These are reference prices, not guaranteed offers. They can change and must be verified before an order.

No on-road amount is shown as an official quote until the application has effective-dated location/registration/insurance/other charge configuration. The showroom asks for a current location-specific on-road quote instead of inventing taxes or fees. Ride-character labels are discovery guidance and do not claim any model is an off-road motorcycle.

## Images
`hero_image_url` points to model-specific image assets served on Bajaj Auto's official CDN; `official_model_url` and `official_specs_url` identify the source pages. Keep image usage consistent with permitted dealership/OEM usage; optimize/proxy assets if the OEM/CDN policy or production performance requires it.

## Public dealership resolution
Set `app.dealership.public-code` to the exact active dealership code on deployments with more than one active dealership. When unset, the API resolves a dealer only if there is at most one active dealership. It does not silently expose another dealership's stock.

## Initial delivery slice
- Anonymous public GET catalogue API.
- 20 Bajaj models with source-checked specs/highlight facts and dated New Delhi ex-showroom references.
- On bootstrap, insert catalogue model rows for the dealership as model definitions only. Individual units must still be received using the normal stock-receiving workflow.
- Premium animated responsive showroom landing and catalogue cards with modal specs, model filter/search, pricing caveats, motion-reduction support, and sign-in handoff carrying selected model/action in session storage.
- Purchase and test-ride customer execution, notification Send now, retail parts checkout and full journey QA remain tracked in issues #17, #20, #21 and #22 and must not be claimed complete until their respective acceptance checks pass.
