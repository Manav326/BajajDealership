# Lucky Bajaj Public Showroom

**Implementation status (31 October 2026):** the public catalogue, browse/detail/compare/share surfaces, source/date price disclosures, dealership-managed promotions, model image gallery and customer request handoff are implemented in current main code. This is a code-status statement, not live-deployment acceptance. See [PRODUCT_STATUS.md](PRODUCT_STATUS.md) for the release matrix and [DEPLOY_PREVIEW.md](DEPLOY_PREVIEW.md) for preview limitations.


## Product/data boundary
The public motorcycle catalogue is sourced from `bajaj_catalogue_model`; physical stock remains sourced from dealership-scoped `vehicle_model` and `vehicle_unit`. The catalogue migration creates 20 current Bajaj Auto motorcycle listings (Freedom, Pulsar, Dominar, Avenger, Platina and CT families) with manufacturer-constrained records. It deliberately does not create fake vehicle units, chassis/engine identifiers or available stock.

Every public endpoint enforces `manufacturer = 'BAJAJ'` and never emits purchase cost, vehicle identifiers, supplier data or customer information. Catalogue rows include safe aggregate counts of available, expected and reserved physical units. If there is no real available unit, the UI says availability must be confirmed; a catalogue entry is not represented as in-stock.

## Price disclosure
Initial ex-showroom reference prices and specification highlights were populated from Bajaj Auto India's public motorcycle range, https://www.bajajauto.com/bikes, checked on 2026-10-29. `price_city` is New Delhi and `price_verified_at` records the source-check date. These are reference prices, not guaranteed offers. They can change and must be verified before an order.

Location on-road amounts use `bajaj_location_price_profile` records created by staff under Bike inventory → Location on-road estimate profiles. Each profile is model-specific and stores local ex-showroom price, registration fee, road-tax percentage, insurance estimate, handling fee, optional labelled other charges, an HTTPS source URL, effective dates, and an optional note. The public endpoint `/api/v1/public/catalogue/quotes?modelCode=...&city=...&state=...` returns a breakdown only when exactly one effective, published profile exists for that model/location. Missing or conflicting profiles return an explicit error; no sample regional rates are seeded. Percent road tax is calculated against the configured local ex-showroom price. The result is a dealership-maintained estimate, not a guaranteed offer or statutory invoice. Staff must use verified values and correct the profile when authority/insurer inputs change. Ride-character labels are discovery guidance and do not claim any model is an off-road motorcycle.

## Migration sequence
Customer Google identity keeps migration `V30__customer_portal_google_identity.sql`. The showroom sequence is V31–V37 for catalogue/publication/stock/images/customer requests and retail orders, V38 for effective-dated location price profiles, V39 for sourced showroom promotions, V40 for retail returns and refund-review records, V41 for customer-approved delivery quotes, and V42 for model-specific official sources and current-lineup correction. V43 adds a permanent Bajaj spare-parts master catalogue, dealership-level retail settings, an explicit optional link to a live inventory SKU, 50 generic reference entries, and durable product identity on order-line snapshots. V44 adds private customer profile-photo storage and the multi-address book. V45 snapshots purchaser name and phone on new retail orders so later profile edits do not rewrite historic order identity; legacy orders without those snapshots continue to use the currently linked customer record for display. V44 adds a customer-owned private profile photo and a multi-address Home/Work/Other address book with a single default delivery address; editing these records never rewrites historical order delivery-address snapshots. Do not restore the old showroom V30 filename, which conflicts with customer identity. Before deploying to a persistent preview whose Flyway history may already include the former showroom version names, inspect its `flyway_schema_history` before applying this branch; do not blindly repair or delete schema history.

## Images
`hero_image_url` points to model-specific image assets served on Bajaj Auto's official CDN; `official_model_url` and `official_specs_url` identify the source pages. Keep image usage consistent with permitted dealership/OEM usage; optimize/proxy assets if the OEM/CDN policy or production performance requires it.

## Public dealership resolution
Set `app.dealership.public-code` to the exact active dealership code on deployments with more than one active dealership. When unset, the API resolves a dealer only if there is at most one active dealership. It does not silently expose another dealership's stock.

## Initial delivery slice
- Anonymous public GET catalogue API.
- 20 Bajaj models with source-checked specs/highlight facts and dated New Delhi ex-showroom references.
- On bootstrap, insert catalogue model rows for the dealership as model definitions only. Individual units must still be received using the normal stock-receiving workflow.
- Premium animated responsive showroom landing and catalogue cards with modal specs, model filter/search, pricing caveats, motion-reduction support, and sign-in handoff carrying selected model/action in session storage.
- Customer portal now displays actual enquiry, test-ride, booking, operational invoice, recorded payments/balance and vehicle handover values from dealership records. Customer requests still are not themselves a confirmed booking, verified quote, provider payment, or delivery.
- Staff can configure source-backed effective-dated location estimates; a public estimate is unavailable until a matching profile is saved. Do not seed or infer legal/insurance fees.
- Notification saved-preview/Send now/scheduler race, expiry, batch isolation and retry exhaustion are covered by integration tests. Retail parts checkout supports pickup or a delivery request with a staff-entered fee and explicit customer acceptance/decline; stock is released and cancellation is audited when a pending order is cancelled. Integration and browser regressions cover checkout/cancellation/concurrency, collection, delivery quoting and full-order returns. Returns restock only after staff confirms inspection/resaleability and create a refund-review state; the system does not issue an automatic refund or imply an online payment occurred.
- The synthetic showroom browser suite checks the 20-card catalogue, model search, sourced-offer display, absent/unsourced quote state, test-ride/purchase intent handoff, 320/390/768/1280 viewport layouts, reduced-motion preference and keyboard-accessible modal behavior. These tests use synthetic fixtures and do not substitute for live preview verification or dealership-supplied source/pricing records.
- Full customer transaction/workshop journey QA remains tracked in issues #20 and #22. The customer retail-parts ordering implementation is present (issue #21), but dealership fitment/price/SKU setup and full acceptance remain. Notification saved-preview/Send now/retry/race code and tests are present (issue #17), but production scheduler operation still requires an always-available runtime and operational monitoring. Do not declare production readiness until live smoke checks, verified dealership data, payment-provider decisions (if online payments are required), deployment database-history review and all acceptance evidence are complete.


### Sourced public promotions

Staff can manage date-effective showroom announcements at `/api/v1/admin/catalogue/promotions` using the existing `catalogue.read` / `catalogue.manage` permission boundary. Each record may cover all published Bajaj models or one dealership-configured Bajaj model and includes a title, factual summary, terms/exclusions, validity dates and an HTTPS source URL. A record appears on the public showroom only when it is published and its effective dates include today's India date. No promotions are seeded. These announcements are not automatic price adjustments, guaranteed discounts or substitute statutory terms; staff must verify the underlying source and eligibility.

The public endpoint is `/api/v1/public/catalogue/promotions`. Empty data explicitly displays that no offer is currently published; the storefront does not create filler promotions. Admin edits and publication changes are audited.

### Public dealership selection

The public on-road estimate endpoint has no customer-supplied dealership selector. Set `APP_PUBLIC_DEALERSHIP_CODE` to the configured `dealership.code` when an API runtime hosts multiple active dealerships. If it is blank, the service only serves estimates when exactly one active dealership exists; it refuses to guess when multiple active dealerships are present. This selector does not grant customer or staff access and never accepts a code from the browser as authorization.


### Retail parts payment, delivery and returns

Retail parts checkout supports pickup or a delivery request. Pickup reserves stock and remains payable at collection. Delivery starts with the parts subtotal only; a staff member must enter the actual delivery charge, then the customer explicitly accepts or declines it. Declining cancels the order and releases reserved stock. Delivery cannot be completed before acceptance. Staff records collection/payment at pickup or delivery as a manual operational attestation; this is not proof of bank/UPI settlement and no online payment is initiated. A full-order return is recorded once against the collected order; returned units are added to sellable stock only after explicit staff confirmation that all returned lines are inspected and resaleable. Every return is marked `REFUND_REVIEW_REQUIRED`; no refund is issued automatically, and any payout must go through an authorised, audited refund/credit workflow.

### Catalogue source correction (V42)

V42 replaces generic public catalogue links with model-specific Bajaj source pages, deactivates/unpublishes Avenger 220 Street (the manufacturer marks it discontinued), and adds the current Freedom 125 NG04 Drum LED variant at the listed Delhi ex-showroom reference price ₹1,04,058. The migration adds only the model master; it does not create physical vehicle units.

The official Dominar 400 price page and Bajaj's April 2026 announcement currently show conflicting ex-showroom amounts. The public catalogue therefore suppresses that model's price until the dealership verifies a single current source. This does not block browsing or imply the bike is out of stock.


### Durable spare-parts catalogue (V43)

The permanent spare-parts product master is `bajaj_spare_part_catalogue`. It has no foreign key to inventory rows or stock balances, so a catalogue product and historical order identity do not depend on a current stock SKU. `retail_part_catalogue_listing` stores dealership-controlled price, retail description, image override, fitment-model list and a staff confirmation flag. `retail_part_catalogue_stock_map` is the optional, explicitly managed bridge to an existing inventory SKU. It is unique per dealership and stock SKU, and never generates on-hand quantity.

Staff control the bridge only in **Inventory → Customer retail shop** using the authenticated `parts.manage` permission. The selector reads existing inventory SKUs and shows on-hand, reserved and sellable quantities; mapping does not create inventory. Link changes are audited. The retail editor separately controls customer price, image, compatibility and ordering. A listing cannot be enabled for ordering until fitment has been confirmed. Customer screens do not expose the mapping selector, purchase cost or staff notes, and the endpoints enforce these permission boundaries.

The initial 50 entries are category-level reference products, not verified part numbers. Their `BGP-####` values are QuantaEdge catalogue identifiers—not OEM numbers. The official Bajaj spares page provides representative product images/details for brake shoes, control cables, chain/sprocket kits, clutch friction plates, cylinder/piston components, filters, headlamps, shocks, spark plugs and engine-oil grades: https://www.bajajauto.com/customer-service/spares. Where the page does not confirm an exact OEM part number or application, those values remain blank and `source_data_status` is `NAME_REFERENCE_ONLY`. No stock, retail price or fitment is seeded. Every global reference remains non-orderable until staff links the right real SKU, enters the retail price and confirms fitment.

The customer shop supports part-category filtering, motorcycle type/family, specific motorcycle model, in-stock/out-of-stock/check-with-dealer status, price range, text/part-reference search and sorting. Product availability is derived from the linked SKU's actual `quantity_on_hand - quantity_reserved`. An unlinked or unverified product remains in the reference catalogue but cannot be purchased. Price/availability are not fabricated where staff configuration is absent. The existing pickup/delivery quote workflow, stock reservation, staff-attested collection, returns and refund-review handling remain the only retail order lifecycle.

Retail order lines now hold `catalogue_product_id` alongside the immutable order-time SKU/name/unit/quantity/price values. The product identity is independent of current stock mapping. The existing inventory `part_id` remains for operational reservation, fulfilment and restocking; unlinking a catalogue product does not rewrite the saved order snapshot.

New inventory SKUs receive a durable local catalogue candidate and remain mapped to that local product by default, preserving the existing retail workflow. Staff can deliberately move the SKU to the correct global product in **Customer retail shop**; the UI requires explicit confirmation if the SKU is already linked elsewhere or if the target product's current SKU link would be replaced. Moving a SKU disables the old local product's retail listing to avoid duplicates; order snapshots retain their original product identity. Existing SKU mappings are migrated for continuity and can be explicitly changed in the retail workspace. Existing listings that staff had already published retain that prior fitment declaration; new or unpublished local candidates remain unverified until staff confirms fitment.


### Shareable showroom links and bike comparison

The public showroom and signed-in **Explore bikes** tab use the same backend catalogue. Opening model details adds the model code to the `bike` query parameter; closing the dialog and browser Back/Forward keep the URL and visible dialog in sync. Comparison state is stored as a comma-separated `compare` parameter, supports at most three catalogue models, and compares only the fields provided by the verified catalogue API (unknown values remain labelled as not published). Active promotions have stable card anchors and an `offer` parameter so a shared offer URL can scroll to and highlight the exact announcement. Existing `view` and other query parameters are preserved when these showroom parameters change.


### Staff-managed motorcycle images

Staff with `catalogue.read` can inspect each Bajaj model's image gallery in **Bike inventory**. `catalogue.manage` permits upload and removal. Uploads accept validated JPEG, PNG or WebP up to 4.5 MiB, become the primary dealer-owned image, and remain scoped to the dealership/model. Removing an image promotes another saved image when available; otherwise the official Bajaj image is used. Image edits never create, receive, reserve, sell or otherwise mutate physical vehicle inventory.


## Customer profile and lifetime history

- Customers open **My profile** from the signed-in portal header avatar/name control, or the **My profile** portal tab. The screen supports editable contact details, preferred language, a private profile photo (JPEG/PNG/WebP, maximum 2 MiB), and multiple named delivery addresses with one default.
- Customer profile photographs are stored privately and served only through authenticated dealership/customer-scoped endpoints with no-store headers. Invalid image signatures/types and oversized uploads are rejected.
- Editing the address book affects future checkout selection only; a placed spare-parts order retains its own delivery-address snapshot. Customer profile edits do not modify motorcycle invoice, payment, handover, spare-parts order, collection, return or refund-review records.
- The **Purchases** tab shows completed motorcycle handovers and the full spare-parts order state history, including cancellation/return states and recorded totals. Website bike requests remain available under **Bike requests**.
- Staff use Customers → **View profile** to inspect contact details, private profile photo, saved addresses, notes/marketing-consent metadata, delivered motorcycle invoice/payment summaries, all spare-parts orders/return states, and website enquiry/test-ride/booking links. The customer.read permission governs the dealership-scoped detail/photo/history endpoints; customer.update controls contact record editing and portal access. Marketing consent remains separately recorded.
- The customer history is a read view over saved records, not a fabricated single checkout. A motorcycle enquiry is not a booked motorcycle; a recorded dealership payment is not a payment-provider success; refund review is not an issued refund. Transaction and address snapshots remain the source of truth for historic fulfilment.
