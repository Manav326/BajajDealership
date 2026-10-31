# Product and release status — Lucky Bajaj Dealership

**Status reconciled:** 31 October 2026  
**Repository:** Manav326/BajajDealership  
**Code baseline inspected:** main at a5457abaa0e517fac2b53558a3d53e3fa02fda24 (testing-infrastructure changes; see current main for later commits)  
**Decision:** active implementation; not approved for full production rollout.

This document is the canonical product-status snapshot. The root README is the short project entry point. Domain details stay in the linked specialist documents. GitHub issues track implementation and acceptance work; an open issue does not automatically mean its entire feature is absent from the current code.

## How to read status

- **Implemented in code** means the current main tree contains the described UI/API/data model and, where applicable, automated tests. It does not by itself mean the hosted deployment is configured or a human has accepted the workflow.
- **Partially implemented** means a usable slice exists but one or more business workflows, user-facing steps, integrations or acceptance tests remain.
- **Disabled / externally gated** means code or configuration support exists, but the provider/account/legal/credential prerequisites are not enabled or verified.
- **Not implemented / planned** means the required product capability is not yet present to the agreed scope.

## Current engineering evidence

The full measured testing inventory and release-quality assessment are maintained in [TESTING_COVERAGE.md](TESTING_COVERAGE.md). The latest audited test-infrastructure baseline is:

| Check | Latest evidence | Result / qualification |
|---|---|---|
| Main CI | [Run 41172140918](https://github.com/Manav326/BajajDealership/actions/runs/41172140918) | Passed: backend/PostgreSQL, staff/customer builds, Docker smoke, Windows installers and GHCR publish/pull |
| Backend tests | Same CI run | 233 passed; 0 failures, errors or skips |
| Backend JaCoCo | Same CI run; [coverage artifact](https://github.com/Manav326/BajajDealership/actions/runs/41172140918/artifacts/13031915147) | 66.69% line / 42.82% branch; package-level gaps are called out in the testing report |
| Full Chromium browser suite | [Run 41173480435](https://github.com/Manav326/BajajDealership/actions/runs/41173480435) | 97 passed; 0 failed, skipped or flaky |
| Browser function execution | Same browser run | Staff 61.23%; customer site 64.34%; loaded modules only, not line/branch or whole-repository coverage |
| Social Media Studio browser regression | [Run 41172140838](https://github.com/Manav326/BajajDealership/actions/runs/41172140838) | 42 passed; this overlaps the full web suite |
| Cross-browser showroom smoke | [Run 41171414198](https://github.com/Manav326/BajajDealership/actions/runs/41171414198) | 6 passed across Chromium, Firefox and WebKit; narrow public-showroom smoke only |
| Android emulator public smoke | [Run 41172140850](https://github.com/Manav326/BajajDealership/actions/runs/41172140850) | Did not reach Maestro scenarios: emulator ADB transport remained offline during installation. An ADB readiness/retry correction is being added; no mobile pass is claimed from this run |
| Physical Android acceptance | Not yet evidenced | Standard and Liquid Glass still require a complete All Maestro run and real-device acceptance |

The Android source/test-flow inventory is 11 runnable Maestro flows per edition; this is not an execution or pass count. The normal main CI Android build is path-filtered. The separate emulator workflow builds x86_64 test APKs and is responsible for its explicitly reported device smoke.

## Product capability status

| Area | Current implementation | What is still needed before full rollout |
|---|---|---|
| Staff and owner portal | Staff authentication, dealership-scoped workspaces, role/permission controls, team administration, operational UI and route handling exist. Server-side permission checks and negative authorization tests cover many privileged routes. | Complete route-by-route browser/device acceptance, verify every role against the production role matrix, and close remaining visual/accessibility checks. |
| Customer and CRM | Customer records, staff customer workspace/history, customer portal identities and sessions, Google sign-in support, private profile photos and saved addresses are implemented. | Verify account recovery, identity matching, session expiry, ownership change and cross-account cases in a live staging journey. |
| Motorcycle inventory | Model and physical-unit inventory, unique chassis/engine identifiers, receiving and stock movements are implemented. | Complete dealership data import/reconciliation and real staff acceptance. Do not treat catalogue records as physical stock. |
| Public Bajaj showroom | Public Bajaj-only catalogue, 20 model records, model details, source/date price disclosures, promotions, image management, comparisons, shareable links and dealer-configured on-road estimates are implemented. | Verify live catalogue/source accuracy, dealership pricing profiles, published images/offers and availability with the dealership; run deployed-browser smoke tests. |
| Sales | Staff enquiry, test-ride, booking, vehicle reservation, operational invoice/payment and handover workflows exist. Customer-originated test-ride/purchase requests link to the staff workflow and display downstream progress. | A customer request is not itself a confirmed ride or booking. Finish customer-to-staff-to-database journey acceptance and remaining transaction/concurrency tests. |
| Workshop | Appointment, check-in, job card, inspection, estimate revision, decision evidence, technician assignment, work/quality gates and operational billing/handover exist. | Customer-facing estimate approve/reject/change flow, richer mechanic work entries/progress, customer complaints/feedback and full cross-workflow acceptance remain. |
| Spare parts | Staff SKU/supplier/receipt/ledger/reorder workflow and workshop reservation/issue/return/release are implemented. A customer retail shop supports catalogue filtering, stock-safe orders, pickup/delivery quotes, cancellation, collection and returns. | The 50 seeded catalogue items are reference names, not verified OEM part numbers or fitments. Staff must verify fitment, prices and inventory links. Customer order/checkout records are implemented, but online card/UPI payment gateway settlement and automatic provider refund processing are not implemented. |
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
