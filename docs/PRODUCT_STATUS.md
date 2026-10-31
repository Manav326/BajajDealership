# Product and release status — Lucky Bajaj Dealership

**Status reconciled:** 31 October 2026  
**Repository:** Manav326/BajajDealership  
**Code baseline inspected:** main at 6941940b625a7e7ca818687df80deb3421247c15  
**Decision:** active implementation; not approved for full production rollout.

This document is the canonical product-status snapshot. The root README is the short project entry point. Domain details stay in the linked specialist documents. GitHub issues track implementation and acceptance work; an open issue does not automatically mean its entire feature is absent from the current code.

## How to read status

- **Implemented in code** means the current main tree contains the described UI/API/data model and, where applicable, automated tests. It does not by itself mean the hosted deployment is configured or a human has accepted the workflow.
- **Partially implemented** means a usable slice exists but one or more business workflows, user-facing steps, integrations or acceptance tests remain.
- **Disabled / externally gated** means code or configuration support exists, but the provider/account/legal/credential prerequisites are not enabled or verified.
- **Not implemented / planned** means the required product capability is not yet present to the agreed scope.

## Current engineering evidence

The latest inspected code baseline was commit 6941940. The following GitHub Actions results were attached to that baseline:

| Check | Result | Evidence and qualification |
|---|---|---|
| Backend tests and PostgreSQL migrations | Passed | [CI run 41164397252](https://github.com/Manav326/BajajDealership/actions/runs/41164397252) |
| Staff and customer web production builds | Passed | Same CI run |
| Docker image build and full-stack smoke test | Passed | Same CI run |
| Windows EXE/MSI installer build | Passed | Same CI run; output is unsigned |
| GHCR publication and pull smoke test | Passed | Same CI run |
| Notification Studio browser regressions | Passed | [Run 41164397291](https://github.com/Manav326/BajajDealership/actions/runs/41164397291) on the inspected baseline |
| Android APK jobs | Skipped | Android source paths were unchanged; this is not an Android failure and is not a current-head Android build result |
| Dedicated Social Media Studio browser regression | Last observed pass on an earlier main commit | [Run 41157066812](https://github.com/Manav326/BajajDealership/actions/runs/41157066812); the path-filtered workflow was not rerun on 6941940 |

The repository tree contains 49 backend Java test classes, 9 Playwright browser specifications and 11 runnable Maestro flow files in each Android edition (plus a shared customer-login subflow in each edition and the top-level customer-auth smoke flow). These are test-file counts, not line-coverage percentages. The normal GitHub CI builds Android test APKs when Android-related paths change; it does not run the complete physical-device Maestro suite.

## Product capability status

| Area | Current implementation | What is still needed before full rollout |
|---|---|---|
| Staff and owner portal | Staff authentication, dealership-scoped workspaces, role/permission controls, team administration, operational UI and route handling exist. Server-side permission checks and negative authorization tests cover many privileged routes. | Complete route-by-route browser/device acceptance, verify every role against the production role matrix, and close remaining visual/accessibility checks. |
| Customer and CRM | Customer records, staff customer workspace/history, customer portal identities and sessions, Google sign-in support, private profile photos and saved addresses are implemented. | Verify account recovery, identity matching, session expiry, ownership change and cross-account cases in a live staging journey. |
| Motorcycle inventory | Model and physical-unit inventory, unique chassis/engine identifiers, receiving and stock movements are implemented. | Complete dealership data import/reconciliation and real staff acceptance. Do not treat catalogue records as physical stock. |
| Public Bajaj showroom | Public Bajaj-only catalogue, 20 model records, model details, source/date price disclosures, promotions, image management, comparisons, shareable links and dealer-configured on-road estimates are implemented. | Verify live catalogue/source accuracy, dealership pricing profiles, published images/offers and availability with the dealership; run deployed-browser smoke tests. |
| Sales | Staff enquiry, test-ride, booking, vehicle reservation, operational invoice/payment and handover workflows exist. Customer-originated test-ride/purchase requests link to the staff workflow and display downstream progress. | A customer request is not itself a confirmed ride or booking. Finish customer-to-staff-to-database journey acceptance and remaining transaction/concurrency tests. |
| Workshop | Appointment, check-in, job card, inspection, estimate revision, decision evidence, technician assignment, work/quality gates and operational billing/handover exist. | Customer-facing estimate approve/reject/change flow, richer mechanic work entries/progress, customer complaints/feedback and full cross-workflow acceptance remain. |
| Spare parts | Staff SKU/supplier/receipt/ledger/reorder workflow and workshop reservation/issue/return/release are implemented. A customer retail shop supports catalogue filtering, stock-safe orders, pickup/delivery quotes, cancellation, collection and returns. | The 50 seeded catalogue items are reference names, not verified OEM part numbers or fitments. Staff must verify fitment, prices and inventory links. Online checkout/payment is not implemented. |
| Operational finance and reports | Operational invoices, manual receipts, expense approval/reversal, daily close, adjustment/refund-review records, reports and CSV/PDF exports exist. | Report-to-source reconciliation and full financial acceptance remain. No gateway settlement verification, GST calculation, statutory GST invoice/credit note, IRN or IRP integration is provided. |
| In-app Notification Studio | Rich content, immutable template versions, audience preview, approval, durable inbox, schedule/cancel, exact saved preview, Send now, idempotency, independent scheduled-campaign transactions, retry state and scheduler/manual-send race tests are implemented. | Validate on an always-available production runtime, observe real dispatch/recovery, complete device acceptance and configure FCM only when ready. A sleeping free API cannot provide a timing SLA. |
| Meta and WhatsApp | Disabled-by-default Meta OAuth/token handling, dealership destinations, approval-controlled Facebook/Instagram publishing jobs, database-backed media, WhatsApp template sends, consent/opt-out, scheduling and signed webhook processing are present in code. | Credentials, Meta app review/permissions, authorized Page/Instagram/WABA setup, public media URL, webhook verification and provider-confirmed end-to-end tests remain external gates. |
| Creative Studio | A browser-local IndexedDB project/resource library, optional local-folder persistence, artwork editing/export and video/audio timeline capabilities exist in the UI. | The advanced editor/render workflow remains open in issue #45. Browser-local projects are not a shared server-side staff library. |
| Android | Standard and Liquid Glass customer apps are separate installable editions sharing the customer API, with parity checks and self-contained arm64 Maestro test APK pipelines. | Current main CI may skip APK rebuilds when Android paths are unchanged. Full physical-device acceptance, production signing, broader Play Store AAB, OAuth signing registration and FCM delivery proof remain. |
| Windows desktop | Tauri staff desktop, local/hosted API selection, server-side licensing/device activation support and EXE/MSI/MSIX packaging scripts exist. | Direct EXE/MSI and MSIX are unsigned; Store package identity/certification, trusted signing, clean-machine install/upgrade/uninstall and production release verification remain. |
| SEO and acquisition | Customer site has basic title/description metadata and the public showroom has shareable model/offer URLs. | Dedicated sitemap/robots/structured data/canonical/metadata strategy and search-performance validation remain. |
| Bajaj/OEM integration | No approved manufacturer integration is claimed. | Obtain documented authorized partner/API access before implementing any warranty, claim, coupon, stock or submission workflow. |

## Deployment status and data safety

The Render URLs documented in this repository are a **preview**, not production approval:

- Staff: https://lucky-bajaj-staff-web.onrender.com/
- Customer: https://lucky-bajaj-customer-web.onrender.com/
- API: https://lucky-bajaj-api.onrender.com/

The checked-in Render Blueprint uses free preview resources. The repository documentation records that the free PostgreSQL database expires after 30 days, free API instances can sleep, and container filesystems are ephemeral. Do not put real customer, employee, vehicle identity, service or financial data into this preview.

Production requires a persistent database plan with backups, an always-available API runtime, durable private media storage, database/network access restrictions, managed secrets, monitoring/alerting and a successful backup-restore rehearsal. The existing persistent preview database must undergo the read-only Flyway history preflight in DEPLOY_PREVIEW.md before any schema deployment because of the historical V30 migration-name collision. Never delete or rewrite migration history as a shortcut.

The public URLs are deployment references supplied for this project. A code audit and green CI do not prove that the hosted services are currently healthy, correctly configured or running the latest main commit. Perform a live read-only smoke test and record timestamp, service versions and results before production approval.

## Required release gates

### P0 — production safety and acceptance

- [ ] Choose and configure production-grade database, API capacity, durable private media and monitoring.
- [ ] Inspect the target database Flyway history; rehearse the required upgrade against a clone and take a restorable backup.
- [ ] Prove backup restoration and document recovery ownership/runbook.
- [ ] Run live read-only staging smoke tests and verify that deployed service versions match the intended commit.
- [ ] Complete the end-to-end customer → sales → vehicle handover → ownership → service → parts → invoice/payment record → report journey on the real backend using synthetic acceptance accounts first.
- [ ] Complete manual staff acceptance and route-by-route mobile/tablet/desktop/accessibility review.
- [ ] Reconcile finance reports to immutable source transactions and obtain written confirmation of the external statutory-accounting/payment process.

### P1 — complete the core dealership product

- [ ] Add customer-facing estimate presentation and revision-bound approve/reject/request-change evidence.
- [ ] Add mechanic work entries, labour/parts completion notes and customer-visible progress where permitted.
- [ ] Add complaints/feedback and assigned follow-up workflows.
- [ ] Expand cross-domain concurrency, rollback, retry and report reconciliation tests.
- [ ] Decide and implement a verified payment provider if online payments/refunds are in scope.
- [ ] Define and validate GST/statutory invoice and e-invoicing integration with an approved provider if the product is expected to issue statutory documents.
- [ ] Finish physical Android device acceptance, production signing and OAuth registrations for release certificates.
- [ ] Configure FCM and prove real-device push delivery if push is part of the promised customer experience.
- [ ] Configure and verify the Windows distribution route, signing and Store submission if desktop distribution is required.

### P2 — gated extensions

- [ ] Complete issue #45's Creative Studio editor, timeline, render and output workflow.
- [ ] Perform authorized Meta and WhatsApp live-provider acceptance before enabling those channels.
- [ ] Implement the technical SEO backlog.
- [ ] Add authorized Bajaj/OEM partner integrations only after access and contracts are confirmed.

## Documentation ownership and update rule

- This file is the canonical snapshot of delivered vs. incomplete product capabilities.
- README.md is the concise navigation and release entry point; it must not contradict this document.
- IMPLEMENTATION_PLAN.md records domain invariants, delivered slices and the ordered engineering backlog.
- BAJAJ_SHOWROOM.md, SOCIAL_MEDIA_STUDIO.md and NOTIFICATION_STUDIO_REUSE.md own detailed domain behavior and limitations.
- DEPLOY_PREVIEW.md owns hosting, bootstrap, migration and recovery instructions.
- LOCAL_UI_TESTING.md and the Android edition READMEs own local test/build/install instructions.

Every feature PR must update the relevant domain documentation and this status snapshot when implementation state changes. Update GitHub issue descriptions so their baseline and acceptance lists match the actual code. Do not close an issue solely because an endpoint or screen exists; close it only when its stated acceptance evidence exists.
