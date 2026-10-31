# Implementation Plan — Lucky Bajaj Agency

**Provider:** QuantaEdge  
**Product scope:** one dealership outlet, with owner/staff portal, public/customer website, two customer Android editions and Windows staff desktop.  
**Last reconciled:** 31 October 2026  
**Inspected implementation baseline:** caff228c47358a8cc40178e0ce1f0eb5ad85bc02  
**Canonical feature status:** [PRODUCT_STATUS.md](PRODUCT_STATUS.md)

This document records current domain invariants and the remaining implementation sequence. It replaces older checkpoints that described sales as the next vertical slice or referenced pre-V46/V47 code.

## Product invariants — preserve these

1. This deployment is one dealership. Every customer, staff member, vehicle, stock row, booking, job, campaign and financial record belongs to a dealership.
2. Derive dealership scope from the authenticated principal or explicitly configured public-dealership resolver. Never trust a customer-supplied dealership ID as authorization.
3. Keep the motorcycle catalogue model separate from an individual physical vehicle unit. A public listing must never manufacture chassis/engine identifiers or available stock.
4. Keep consumable spare-parts stock separate from motorcycle-unit inventory. The staff stock ledger is the source of truth for both retail availability and workshop reservations.
5. Treat customer test-ride/purchase submissions as requests until staff confirms a real available vehicle/time or converts the request into the audited sales workflow.
6. State transitions must be transactional and auditable. Use idempotency for retries and protect irreversible operations against concurrent requests.
7. An approved estimate and issued invoice are snapshots. Stock movement or later edits must not silently rewrite historic approved customer terms or issued financial documents.
8. Manual payment and payout attestations are operational records, not gateway/bank settlement evidence. An operational invoice is not a statutory GST invoice.
9. In-app inbox persistence is independent of push/social transports. Mark external delivery only on provider evidence.
10. Released Flyway migrations are immutable. Use additive migrations and rehearse upgrades against a copy of any persistent database.

## Delivered foundation and tested slices

### Platform, access and data boundaries

- Spring Boot API, PostgreSQL, additive Flyway schema and CI using a real PostgreSQL service.
- Staff login, hashed bearer sessions, server-side revocation, password hashing, login throttling, one-time owner bootstrap, role/permission enforcement and audited staff access administration.
- Dealership-scoped customer, staff, inventory, workshop, sales, notification, social and finance records.
- Customer portal identities/sessions, invitation activation, password/alternative authentication, server-verified Google ID-token integration when client IDs are configured.
- Server-side dealership licensing and desktop installation activation support through migrations V46/V47. The licence console is vendor-only and requires its own deployment secret.

### Staff and customer experiences

- Staff portal with Overview, Customers, Sales pipeline, Bike inventory, Workshop, Spare parts, Billing & expenses, Team & access, Notification Studio, Social Media Studio and Reports workspaces.
- Responsive customer website and two separately installable Android customer apps: Standard and Liquid Glass. Shared customer workflows and Maestro flow parity are checked by the repository parity script.
- Customer profile/contact/language, private profile photo, named saved addresses/default address, linked motorcycles, sales request progress, purchase history, service history, appointment requests and in-app notification inbox.
- Public Bajaj showroom with browse-before-login, model detail/specification, comparison/share links, sourced offer announcements, source/date price disclosures, and staff-managed model images.
- Staff customer history view joins the actual saved CRM, sales, ownership, service and retail-parts records.

### Motorcycle catalogue and inventory

- Individual vehicle-unit inventory, model/variant/colour/year, expected-stock receiving, unique chassis/engine references, stock status and auditable stock movement.
- Bajaj-only public catalogue master seeded with 20 model listings; this creates catalogue model definitions only, not physical vehicle units.
- Staff-managed effective-dated regional on-road estimate profiles and sourced promotional announcements. Missing/conflicting regional profiles return an unavailable/error state rather than a fabricated number.
- Model image gallery upload/removal with content validation and dealership scope.
- Public API excludes supplier cost, physical vehicle identifiers and customer/private inventory records.

### Sales and delivery

- Staff sales enquiries, lead source/contact preference, follow-up and activity history.
- Test-ride scheduling/check-in/completion/cancellation, bookings tied to a physical available unit, atomic inventory reservation, cancellation release and sales conversion workflows.
- Customer-originated test-ride and purchase requests with idempotency and visible downstream state when converted by staff.
- Operational vehicle invoice, manual receipt/payment allocation, adjustments/reversals and acknowledged handover; ownership history is attached only after the authorized delivery transaction.
- Important boundary: customer request is not a confirmed booking; a manual payment record is not gateway verification. Full real-backend customer-to-staff end-to-end acceptance and broader concurrency testing remain open.

### Workshop and service

- Appointment create/list/confirm/cancel with customer/vehicle ownership checks.
- Exactly-once job-card check-in, seven-item inspection, estimate revisions and decision evidence, technician assignment, work start and assigned-inspector quality pass.
- Workshop operational invoice, partial manual receipts, reversals and receiver-acknowledged paid handover.
- Customer service requests, appointment history and status views.
- Remaining: customer-facing estimate detail plus revision-bound approve/reject/request-change actions; richer mechanic work/labour/parts completion entries; customer-visible progress improvements; complaints/feedback and follow-up ownership; deeper cross-workflow transition/concurrency testing.

### Spare-parts inventory and retail shop

- Dealership-scoped supplier catalogue, receipt lines/unit cost, weighted-average cost, on-hand/reserved/available quantities, stock movement history and low-stock/reorder-to policy.
- Job-card reservation, issue, return and release; idempotency, quantity checks and approved-estimate cost snapshots protect workshop stock and customer pricing.
- Retail catalogue master with 50 generic reference products, a dealership-controlled listing/price/fitment declaration and explicit optional mapping to an existing stock SKU.
- Customer parts catalogue/search/filter, cart, immutable order-line snapshots, stock reservation, pickup or delivery request, staff-entered delivery quote with customer acceptance/decline, cancellation/release, collection record and return/inspection/refund-review lifecycle.
- The BGP-#### values are internal QuantaEdge catalogue identifiers, not OEM part numbers. The 50 reference entries have no seeded stock, prices, verified fitment or orderability. Staff must verify each listing and map a real SKU before enabling sales.
- No online payment provider is connected. Collection and return/refund records are manual operational attestations, not provider-confirmed money movement.

### Finance and reporting

- Operational invoices/receipts, partial payment allocation, reversals, expenses, expense approvals/reversals, immutable daily close by dealership business date, operational credit-adjustment/refund requests, payout attestation and date-bounded operations/finance reports.
- CSV/printable/PDF outputs clearly distinguish operational documents from statutory tax documents.
- GST/tax-profile/HSN-SAC screens are readiness configuration and staff source attestation only. No GST is calculated, no statutory GST invoice/credit note/IRN is produced and no IRP is integrated.
- No online payment/settlement or automatic refund provider is integrated. Remaining: explicit report-total reconciliation to source records, expensive-query/pagination review, and an agreed external statutory-finance/payment process.

### Notifications and social channels

- In-app Notification Studio supports rich content validation, immutable template versions, audience selection/exclusions, server preview, hashed expiring preview proof, explicit approval, scheduled send/cancel, campaign history, durable customer/staff inbox and audit.
- Saved-campaign preview and Send now are now present. The scheduled worker isolates campaigns into separate transactions, uses row locking/skip-locked claiming, saves bounded retry state and protects the manual-send/scheduler race. Integration tests cover saved preview, Send now idempotency, expiry, race, batch isolation and failure retry state.
- Campaign SENT means durable in-app delivery records were written. It does not imply FCM, SMS, email or WhatsApp delivery. The in-process scheduler polls at a configurable interval (15 seconds by default); a sleeping free API has no reliable timing SLA.
- Backend and UI support disabled-by-default Meta connection, destination discovery, approval-controlled publishing requests, Facebook Page photo posts, Instagram feed publishing/status polling, signed artwork URLs and database-backed campaign images.
- WhatsApp support includes saved opt-in/opt-out and evidence, approved-template checks, single-recipient sends, idempotency, scheduling, signed provider webhooks and inbound opt-out processing. WhatsApp Status is export/native-share handoff only.
- Live Meta/WABA credentials, permissions, provider review and authorized E2E are not configured/proven by the repository. FCM credentials/device delivery are also outstanding.
- Creative Studio uses browser IndexedDB plus optional local-folder storage; it is not a shared server-side staff library. The advanced editor/timeline/render workflow remains tracked in issue #45.

### Desktop and mobile distribution

- Standard and Liquid Glass Android editions have independent package identities, downloader scripts and arm64 self-contained release-variant Maestro test APK pipelines. A main push that does not change Android paths can skip APK rebuilds; the downloader searches prior successful runs with an APK artifact.
- Windows Tauri desktop includes hosted/local API target selection, server-side licence validation and installation registration support. CI builds EXE/MSI and has an MSIX packaging path.
- The current Windows EXE/MSI/MSIX pipeline outputs are unsigned. Android CI APKs are test artifacts, not a signed Play Store AAB/release. Store identity/certification, signing keys, clean-device/upgrade acceptance and FCM remain release tasks.

## Current test evidence and limitations

- The source baseline inspected for this update is `caff228c47358a8cc40178e0ce1f0eb5ad85bc02`. The evidence below intentionally retains the exact commit associated with each test run; it must not be read as a claim that every suite ran on `caff228`.
- Backend/PostgreSQL, Finance coverage, both web production builds, Docker smoke, Windows installer packaging and GHCR publish/pull evidence passed in [main CI run 41174598318](https://github.com/Manav326/BajajDealership/actions/runs/41174598318), on application/Finance baseline `f94d46b56698e17c67f7ef61bc96383420a3cd62`. Backend: 236 tests, 0 failures/errors/skips across 49 test classes; JaCoCo: 69.63% line / 44.76% branch overall. Finance: 76.53% / 50.60%; Social remains low at 15.85% / 10.57%.
- Full Chromium browser run [41173480435](https://github.com/Manav326/BajajDealership/actions/runs/41173480435) passed 97/97 cases. Social Media Studio regression [41172140838](https://github.com/Manav326/BajajDealership/actions/runs/41172140838) passed 42/42 but overlaps the full 97-case suite. Cross-browser showroom smoke [41171414198](https://github.com/Manav326/BajajDealership/actions/runs/41171414198) passed 6/6 narrowly scoped cases across Chromium, Firefox and WebKit.
- Android strict-validator run [41178367640](https://github.com/Manav326/BajajDealership/actions/runs/41178367640) passed both matrix jobs on test-harness commit `51c937a204f2cdd31b5e791bd0272e66aa3e707d`: Standard 2/2 and Liquid Glass 2/2 public Maestro flows; each JUnit summary reported 2 tests, 0 failures, 0 errors and 0 skips. It does not cover the other nine flow definitions per edition.
- The later `caff228` source commit added stable testIDs and scroll/keyboard handling to the authenticated service-appointment flow in both Android editions. That flow is more deterministic in source but has not been run by the current public-only CI workflow; no pass is claimed.
- Repository inventory: 49 Java backend test classes, 9 Playwright spec files, and 11 runnable Maestro flow files per Android edition (2 public, 5 authenticated and 4 notification-fixture flows) plus shared login subflows. File counts are not code-coverage measures.
- Most browser journeys use mocked/intercepted API fixtures. They verify client behavior but do not prove complete real-database browser acceptance. The full authenticated/notification Android All suite still needs deterministic synthetic customer, vehicle and notification fixtures before reliable CI execution.

## Prioritized remaining work

### P0 — production safety and acceptance

1. Move from the free Render preview to persistent production-grade PostgreSQL and always-available API capacity. Configure private durable media storage, managed secrets, restricted database access, health/monitoring/alerting.
2. Perform read-only Flyway history preflight on the actual target. The historic V30 name collision is documented in DEPLOY_PREVIEW.md; clone/rehearse a safe upgrade and verify a restorable backup before applying.
3. Rehearse backup restore and prove that app access, media and migrations recover correctly. Document owner, recovery point/time objectives and operational procedure.
4. Run the read-only staging smoke script and manual public URL checks; record deployed version/SHA, timestamp and result. Current docs do not assert live URLs were reachable during the repository audit.
5. Run full synthetic end-to-end journeys against the actual API/PostgreSQL: customer → sales request → staff conversion → test ride/booking/stock reservation → invoice/manual payment/adjustment → handover/ownership → service appointment → job card/estimate/parts/quality → invoice/settlement → report.
6. Complete route-by-route responsive/accessibility review and staff acceptance. Keep Issues #1, #3, #4 and #22 open until evidence is recorded.
7. Agree and document the external statutory invoicing and payment/settlement operating model before using finance records for real transactions.

### P1 — complete core customer/workshop flows

1. Build customer-facing estimate detail and explicit approval/rejection/change-request tied to the exact estimate revision.
2. Add mechanic job entries, labour/parts completion notes, progress events and customer-visible statuses.
3. Add customer complaints/feedback and assigned follow-up.
4. Add missing cross-domain concurrency, rollback, retries, permission-denial and finance-report reconciliation tests.
5. Complete customer app/web parity and session/ownership/privacy acceptance.
6. Configure a test Firebase project and prove physical-device FCM delivery if push is in the promised release.
7. Create signed Android release AAB/APK with production OAuth certificate registration; separately validate Windows installer signing, clean install, upgrade and uninstall if Windows distribution is required.
8. Complete the SEO foundation for public showroom pages: crawlable sitemap/robots policy, canonical/share metadata, model/offer metadata and structured data only where facts are verified.

### P2 — externally gated capabilities and extended creative tooling

1. Complete issue #45's editor, timeline, audio/video render, preview and download lifecycle. Keep local browser projects distinct from any future shared cloud library.
2. Enable Meta/WhatsApp only after authorized provider accounts, current permissions, app review, webhook/public-media tests, consent and authorized test-recipient E2E pass.
3. Add a payment provider, refunds and gateway reconciliation only after provider account/credential/webhook/idempotency rules are agreed.
4. Add GST/e-invoicing only after qualified legal/tax validation and an approved IRP/provider design.
5. Implement Bajaj/OEM integrations only with documented partner authorization and sandbox/live confirmation.

## Release gates

- Every controller mutation has server-side authorization; tenant/customer/private-media boundaries are covered by tests.
- Every irreversible business transition is transactional, audited and safe under duplicate/retry/concurrent requests.
- Source transaction totals reconcile with reports and exports, including reversals and adjustments.
- Customer and staff journeys complete against a production-like PostgreSQL backend; mocked browser fixtures are not the only evidence.
- Clean database migrations and upgrade-from-existing-data migrations pass. Persistent target migration history is inspected and backup-restored.
- HTTPS, secrets, durable private media, always-on scheduler capacity, monitoring and alerts are verified.
- Android/Windows packages are correctly signed and verified for their intended distribution channels.
- Staff training and written acceptance sign-off exist before real dealership rollout.

## Explicit external dependencies

OEM APIs, payment gateways, GST/e-invoicing/IRP, SMS/email/FCM and Meta/WhatsApp require approved accounts/access, credentials, legal/commercial scope, pricing and channel-specific testing. Internal records must never be represented as an OEM submission, gateway settlement, statutory tax document or provider-confirmed delivery unless the relevant provider confirms it.
