# QuantaEdge — Bajaj Dealership Management System

**Customer:** Lucky Bajaj Agency  
**Product owner / software company:** QuantaEdge  
**Branch:** `main`  
**Status:** Active implementation — not yet a production release.

This repository contains the implementation roadmap and application code for a dealership management system that connects new-bike sales, customers, workshop servicing, spare parts, staff, operational finance and notifications.

## Product roadmap

### Product experiences
- **Owner and staff web portal:** ReactJS, responsive for desktop, tablet and mobile.
- **Customer website:** service requests, owned vehicles, permitted service history, notifications and feedback.
- **Android application:** customer workflows and push notifications once the Android project and provider configuration are completed.
- **One shared backend:** Spring Boot REST APIs and PostgreSQL. Web and mobile clients must use the same authoritative records and permission rules.

### Business modules
1. **Foundation and access control** — dealership scoping, staff identities, role-based permissions, secure sessions, audit events, database migrations and backup strategy.
2. **Customers and CRM** — customer profiles, contact preferences, linked vehicles, follow-ups, complaints and consent history.
3. **Bike inventory** — model/variant catalogue, individual vehicle units, chassis/engine identifiers, stock receiving and auditable stock movement.
4. **Sales and delivery** — enquiries, test rides, bookings, vehicle allocation, finance/insurance/registration follow-ups, invoice links and delivery.
5. **Workshop and service** — appointments, check-in, inspection, estimates and customer approval, job cards, mechanic assignment, work status, quality check, billing and handover.
6. **Spare parts** — suppliers, purchases, receiving, stock ledger, job-card issue/return, damage adjustments and reorder alerts.
7. **Billing and business controls** — invoices/receipts, payments, partial settlements, refunds/adjustments, expenses, outstanding balances and daily closing.
8. **Employees** — staff access, assignments, attendance, leave, approvals and verified performance reports.
9. **Notification Studio** — reusable rich templates, version history, Logo & Graphics workspace, audience search, server-side preview and exclusions, scheduling, durable inbox, audit and delivery history.
10. **Reports** — sales, servicing, collections, expenses and inventory reports reconciled to source records.
11. **Customer web and Android** — bookings, vehicle/service views, updates, feedback and appropriately scoped customer notifications.
12. **Production readiness** — automated tests, responsive/accessibility checks, security verification, backup restoration rehearsal, staff training and staged launch.

## Technical baseline
- Web: ReactJS + TypeScript + Vite
- Android: React Native + Expo SDK 57, targeting React Native 0.86 / React 19.2; native Android APK built in CI. Release signing, public API URL configuration, Play Store submission and push delivery are separate release steps
- Backend: Java 21 + Spring Boot
- Database: PostgreSQL with additive Flyway migrations
- API: authenticated REST + JSON
- Hosting: conventional HTTPS web/API hosting, private media storage, monitoring and tested backups
- CI: GitHub Actions for backend/PostgreSQL migration tests and web typecheck/production build

## UI visual direction — Liquid Glass

The web application uses a restrained Liquid Glass treatment rather than flat white cards: translucent layered surfaces, subtle edge highlights, controlled backdrop blur, soft ambient gradients and shallow depth. The QuantaEdge/Bajaj orange accent remains for primary actions and important states; body text and form controls retain high contrast.

- Shared shell: glassy top bar, dark translucent sidebar, layered page background and responsive navigation.
- Workspace surfaces: overview metrics, workshop, spare-parts, sales and notification panels share the same surface/border/shadow language.
- Interaction surfaces: sign-in card, Notification Studio, inbox, tabs, inputs and primary/secondary buttons follow the same visual system.
- Accessibility and resilience: explicit focus-visible rings, readable opaque-enough input surfaces, reduced-motion handling and a non-backdrop-filter fallback.
- New screens should reuse existing component classes and visual tokens instead of introducing unrelated card, border, shadow or button styles. Keep data tables, errors, consent notices and financial status labels readable; glass effects must not reduce legibility or imply a business status.
- Shared tokens, accessibility rules, browser fallbacks and the release checklist are documented in `docs/LIQUID_GLASS_UI.md`.

## Public preview deployment

The Render preview is deployed. Current public URLs (provided by the dealership owner):

- **Staff web portal:** https://lucky-bajaj-staff-web.onrender.com/
- **Customer website:** https://lucky-bajaj-customer-web.onrender.com/
- **Spring Boot API:** https://lucky-bajaj-api.onrender.com

Both React sites use `VITE_API_BASE_URL`; the Render Blueprint binds them to the API service and configures the API CORS allowlist for the two site origins. The Android app and CI APK now default to the deployed API URL above. Local device/emulator development can override `EXPO_PUBLIC_API_BASE_URL` or the Actions variable `BAJAJ_API_BASE_URL`. See `docs/DEPLOY_PREVIEW.md` for bootstrap, recovery and safety guidance.

The Blueprint uses free preview resources only. Do not enter production customer or financial data: the free PostgreSQL database expires after 30 days, free API instances can sleep, and notification media on the container filesystem is not durable. Production hosting needs an appropriately sized paid database with backups and durable private media storage.

## Implementation status

### Implemented in the current foundation
- React staff portal and customer website both build successfully in CI; their static build outputs are uploaded as downloadable workflow artifacts. React Native Android customer app is built as an installable debug APK artifact by CI. See `apps/android/README.md` for configuration and install notes.
- React web application shell with premium responsive layout and a live API health indicator.
- Staff sign-in, server-created bearer sessions stored as hashes, logout/revocation, and initial role/permission catalogue.
- Dealership-scoped customer list/search/create/update APIs, audit trail, preferred language, and separate marketing-consent source handling.
- Vehicle model and individual vehicle inventory APIs; chassis/engine uniqueness; expected-stock receiving flow; dealership-scoped movement ledger. Consumable spare parts remain a separate SKU ledger, with supplier receipts, weighted-average cost, on-hand/reserved/available balances, idempotent job-card reservations, issue/return/release, auditable stock movements, per-SKU reorder policy and low-stock alerts calculated from available stock after reservations.
- PostgreSQL migrations for dealership identity, roles/permissions, audit events, customers, vehicle inventory, notification records and dealership-boundary constraints.
- Notification rich-document validator, versioned templates, server-resolved audience preview, expiring preview proof, explicit persisted approval by a permissioned staff member, recipient-set drift detection before approval, idempotent send requests, scheduled campaign dispatch, durable in-app recipient/inbox records, read/unread/archive operations, campaign audit and private PNG/JPEG media upload.
- Notification Studio web interface adapted from the QuantaEdge rich-notification contract: content blocks, previews, audience selection, consent-filtered marketing audience, template library, explicit approval gate before send/schedule, campaign history, inbox and a locally editable Logo & Graphics tool.
- Workshop slice: dealership-scoped appointment create/confirm/cancel, check-in exactly once into a job card, seven-item inspection checklist, immutable estimate revisions with recorded customer-decision evidence, technician assignment, work start and assigned-inspector quality checks. Billing now snapshots the approved estimate into an operational invoice draft, issues it only after quality pass, supports partial manual payment receipts with dealership-wide idempotency and audited reversals, and blocks vehicle handover until the invoice is fully settled and receiver acknowledgement is recorded. The invoice is explicitly not a GST tax invoice; recorded payments do not imply gateway verification.
- Automated tests for PostgreSQL migrations, authentication, customer isolation/consent, vehicle stock lifecycle, notification permission denial, appointment/check-in idempotency, estimate revision/approval rules, quality gates, spare-part receipt retries, weighted-average cost, reservation/issue/return/release quantities, closed-job rejection and cross-dealership isolation.

### Not yet complete — do not treat as production-ready
- Sales enquiry, test-ride, booking, operational-invoice, manual-payment, receipt reversal and acknowledged handover flows exist in the current source tree. Previous checked CI run #436 had passing backend tests/migrations, web builds and Docker smoke test; its Android APK build was still running at that checkpoint. Recheck CI on the exact new commit before declaring all checks green. Keep sales open until transaction/concurrency and full journey acceptance gates pass on the current commit.
- Workshop is partially complete: intake, inspection, estimate/decision evidence, assignment, work/quality gates, operational invoice/receipt records, printable operational documents, and paid/acknowledged handover exist. Spare-parts catalogue/receipts/ledger, job-card reservation/issue/return/release, per-SKU reorder policies and low-stock alerts are implemented. Estimate revisions link same-job reservations and freeze reserved/issued/returned/released quantities plus a unit-cost snapshot, separately from customer price; part issue requires a matching approved estimate, return/release makes an old snapshot stale until a revision is approved, and invoice creation rejects stale part quantities. The previous approved revision remains auditable and is superseded only when a replacement is approved. PostgreSQL integration tests cover same-SKU concurrent reservations, receipt idempotency/weighted cost, released quantities, low-stock calculations and stale estimate quantities. Remaining work includes deeper cross-workflow concurrency and full-journey acceptance testing, customer-facing estimate approval, richer mechanic work entries, external payment-provider verification, and legally verified GST/e-invoice issuance.
- Spare-parts catalogue, supplier receipts, weighted-average cost, stock ledger, job-card reservation/issue/return/release, reorder policy and low-stock alerts are implemented. Broader cross-workflow concurrency, failure-recovery and financial reconciliation tests remain.
- Billing & Expenses now has dealership-scoped expense approval/reversal, immutable daily closes, date-wise finance reports and CSV/PDF exports. V19 adds expenses, V20 immutable daily closes, V21 tax-readiness configuration, and V22 a separate operational credit-adjustment/refund ledger with idempotent requests, independent approval, payout attestation, append-only event history, outstanding-balance integration, and daily-close/report integration; V23 adds time-window indexes for reporting query patterns. Empty-tenant integration tests execute finance close, finance daily reports and operations report queries to prevent schema/SQL drift. Operations reporting covers enquiry/booking/delivery/test-ride activity, workshop invoice/job status, parts purchase/movement and current stock alerts. Tax-code review remains a staff attestation against a source, not government validation. No GST is calculated, no statutory GST credit note/IRN is issued, no IRP is connected, and refund payout entries do not initiate or verify provider money movement.
- Production hardening and acceptance for the deployed preview, plus a signed Android release. The three URLs above are the current public preview deployment; CI web/APK artifacts remain separate build outputs and do not constitute a Play Store release.
- Android Firebase Cloud Messaging delivery configuration and end-to-end proof of real push delivery.
- SMS, WhatsApp Business and email provider integrations, templates, consent/process verification and provider billing.
- Approved Bajaj/OEM APIs or official dealer integrations. No code may imply warranty/coupon/claim/inventory records were submitted to Bajaj unless an authorised integration confirms it.
- Full cross-browser/mobile acceptance tests, production load/security review and verified backup restoration.

The existence of a screen, table or API is not evidence that its whole business workflow is complete. Modules stay marked in progress until their acceptance tests pass.


## Implementation roadmap & resume checkpoint

**Purpose:** This section is the actionable handoff for continuing implementation. Follow the phases in order, update the checkboxes only after evidence exists, and keep this file synchronized with actual code and CI. A page, endpoint or table alone does not satisfy a phase.

### Last audited baseline

- Baseline commit inspected: `981c990e92202647851f5fbeed08827548792d48` on `main`.
- Latest CI run: [run 434](https://github.com/Manav326/BajajDealership/actions/runs/40742633220) on commit `981c990e92202647851f5fbeed08827548792d48`. Backend tests/PostgreSQL migrations, staff/customer web builds and Docker smoke test are green. At the time this checkpoint was refreshed, the Android debug APK job was still running; confirm its final outcome before declaring all CI green.
- The prior stale checkpoint describing a sales overpayment assertion as the current blocker has been superseded by subsequent green backend runs. Preserve the overpayment guard and keep the related boundary/transaction tests.
- Recent finance increments: V19 business expenses; V20 immutable daily close and daily reports; V21 tax-readiness catalogue; V22 operational credit adjustments/refund records and richer operations reports. Sales/workshop invoice and receipt print layouts remain operational-only documents. Statutory GST tax calculations/credit notes, IRN/IRP integration and provider settlement/refund integrations remain disabled external/legal gates.
- Current repository governance/branch protection settings should be checked in GitHub before treating direct pushes as a protected release workflow.
- Do not call the project production-ready from a successful build alone. External integrations and the launch checks below remain outstanding.

### Execution rules

1. Work in small, reviewable vertical slices; do not combine unrelated refactors with feature work.
2. Preserve existing business behavior and customer/financial/audit history. Never reset or delete data to make tests pass.
3. Keep released Flyway migrations immutable; use additive migrations and test both clean schema creation and upgrade from the current schema.
4. Derive dealership scope from the authenticated principal on every read and write. Never trust a client-supplied dealership identifier, role, recipient count, or acknowledgement as proof of authorization.
5. Treat recorded manual receipts as operational records, not payment-provider confirmation. Treat an operational invoice as distinct from a GST tax invoice until compliant tax requirements and provider integrations are implemented.
6. Automated tests use synthetic identities and recipients only. Do not send real customer notifications during QA.
7. After each phase, run the relevant PostgreSQL integration/security tests plus the web/Android builds affected by the change. Update this checklist only when the evidence is on the exact current commit.

### Phase 0 — Restore a green baseline (P0; do first)

- [ ] Reproduce and understand the sales overpayment assertion failure described above.
- [ ] Correct the test data or expectation so the amount genuinely exceeds the computed outstanding balance; preserve a separate passing assertion that a valid partial payment is accepted.
- [ ] Add/retain boundary checks for payment equal to balance, payment above balance, payment before invoice issue, cancelled invoice/booking, and idempotent retry with both same and changed payloads.
- [ ] Run the full backend suite against PostgreSQL and verify all Flyway migrations on a clean database.
- [ ] Confirm both web production builds and the Android debug APK build on the same exact commit.
- [ ] Re-check latest Actions run and record its URL and commit SHA here after the run completes.

**Exit gate:** all CI jobs pass on the same commit; no test was deleted or watered down to hide a business-rule failure.

### Phase 1 — Security and transactional invariants (P1)

- [ ] Build an endpoint inventory from every backend controller and map each route to its required permission and dealership-scope invariant.
- [ ] Add controller-level tests for sales transaction endpoints: invoice create/issue/cancel, payments, reversals, handover and history. Cover unauthenticated access, insufficient permissions, malformed inputs and forbidden state transitions.
- [ ] Expand equivalent negative-authorization coverage for workshop billing, estimates/quality gates, parts receiving/reservation/issue/return/release, customer portal actions, notification approval/send/cancel, and media retrieval.
- [ ] Verify that IDs from another dealership return safe not-found/denial responses and never reveal cross-dealership data.
- [ ] Add transaction/concurrency tests for duplicate booking attempts on one bike, simultaneous invoice payments, repeated delivery, retries with idempotency keys, and rollback after a rejected quantity/state change.
- [ ] Review session expiry/revocation, login throttling, password handling, bootstrap-secret removal, CORS/proxy configuration, upload size/type validation and private media access.

**Exit gate:** every state-changing route has a permission-denial test; high-risk workflows have dealership-isolation, idempotency and transactional/concurrency coverage.

### Phase 2 — Finish Team & Access (P1)

- [ ] Implement staff listing/search and staff detail with dealership-scoped APIs.
- [ ] Implement owner-authorized staff invitation/activation, disable/reactivation, and role assignment/revocation. Never expose passwords or raw session tokens.
- [ ] Provide a permission/role view that explains effective access and prevents privilege escalation; ensure owner-level actions cannot be granted by ordinary staff.
- [ ] Add staff assignments needed for sales follow-ups, test rides, mechanics and approval duties where the domain already supports them.
- [ ] Record auditable actor, target, before/after and reason for sensitive access changes; revoke or invalidate sessions when required by disablement/security policy.
- [ ] Add integration tests for each role, least-privilege defaults and privilege escalation denial.

**Exit gate:** the Team & Access navigation item opens a working screen, all actions have server-side permission checks, and tests demonstrate staff cannot administer their own permissions or cross dealership boundaries without explicit authority.

### Phase 3 — Complete billing and operational finance (P1)

- [x] Implement the Billing & Expenses workspace against saved source records; empty states do not invent sample totals.
- [x] Deliver expense creation, category/description/vendor/reference fields, approval/rejection, permissioned reversals and audit history in a separate expense ledger.
- [x] Implement daily closing/reconciliation by payment channel with opening balance, saved receipt movements, payment reversals, approved expenses, counted balance, variance, notes and closing actor. Each dealership/business date can be closed once; the saved snapshot cannot be overwritten.
- [x] Implement separate operational credit-adjustment and refund requests; idempotency, invoice/payment caps, independent approval/rejection, immutable event history, outstanding-balance effects and payout attestation are recorded without rewriting invoices/receipts. These records are not statutory GST credit notes and do not move/verify money with a provider.
- [x] Align the shared reversal permission boundary and provide common print layouts while preserving different sales and workshop invoice lifecycle rules.
- [x] Add dealership tax profile and a source-backed draft/verified HSN/SAC readiness catalogue with effective dates and review attribution. This is configuration readiness only: no tax is calculated or applied and no statutory document is generated.
- [ ] Define and legally verify the dealership’s GST obligations, tax treatment, invoice numbering, supply classification, customer fields, cancellation/credit-note rules and approved IRP integration before enabling tax calculations or e-invoicing.
- [ ] Add payment-provider integration only after credentials, webhook/signature verification, idempotency, duplicate callback handling, refund semantics and reconciliation are defined. Never treat a manually entered reference as provider verification.
- [x] Add print/save-as-PDF layouts for operational invoices, receipts and daily closes, plus CSV/printable date-wise finance reports. Documents clearly state their operational-only scope and are not GST tax invoices.

**Exit gate:** financial balances reconcile to source transactions; duplicate/replayed events cannot double-post; refunds are auditable; statutory documents are enabled only when their legal/provider rules are implemented and verified.

### Phase 4 — Implement Reports (P1)

- [x] Add dealership-scoped daily report endpoints for sales/workshop invoice issue/cancellation events, recorded collections, payment reversals, approved expenses and expense reversals; enforce date-range limits and use the configured dealership timezone.
- [x] Add dealership-scoped operations reports for enquiry creation, booking creation, delivered vehicles, completed test rides, workshop jobs checked in/status, issued workshop invoices, parts receipts/movements and current low/out-of-stock counts.
- [x] Define report semantics in the API/workspace: event metrics use timestamp boundaries in the configured dealership timezone; job statuses are the current status of job cards checked in during the selected period; low-stock/out-of-stock alerts are current snapshots.
- [x] Add bounded indexes for reporting event-time lookups, approved credit-note review events and recorded refund payout dates; validate report queries on an empty dealership using PostgreSQL integration tests.
- [x] Add an operations-report CSV export gated by the existing `report.export` permission, with metric definitions included in the export.
- [ ] Add pagination/filtering where necessary and protect expensive queries; use indexes or pre-aggregation only where measurements justify them.
- [ ] Keep CSV export gated by the report.export UI permission and add explicit report-total integration tests comparing endpoints with source transaction queries.
- [ ] Replace current overview placeholder cards with real API-backed metrics when reliable aggregate endpoints exist; otherwise display a clear “not available yet” state instead of implying live data.

**Exit gate:** report totals reconcile to source records and reversals; date boundaries use the dealership timezone; unauthorized exports are denied.

### Phase 5 — Complete customer and workshop end-to-end journeys (P1)

- [ ] Finish customer-facing estimate presentation and explicit approve/reject/request-change evidence, tied to the correct estimate revision. Customer decisions must not silently approve a stale revision.
- [ ] Implement richer mechanic work entries, labour/parts completion notes, progress events and customer-visible status where permitted.
- [ ] Complete customer complaints/feedback and follow-up workflows with consent handling and assigned ownership.
- [ ] Re-check appointment-to-job-card exactly-once behavior; inspection-completion, estimate approval, quality inspection and invoice/handover state transitions.
- [ ] Exercise parts reservations and estimate cost snapshots through issue, return, release, re-approval and invoice issue. Never silently mutate an already-approved estimate or issued invoice.
- [ ] Add full journey tests for customer → enquiry/booking → bike reservation → invoice/payment → acknowledged delivery → ownership history → service booking → job card → estimate/parts → quality check → invoice/payment → handover → report.
- [ ] Test failure/retry and concurrent requests at each irreversible transition, not just service happy paths.

**Exit gate:** each critical journey passes automated integration tests and documented user acceptance with no missing state transitions, ownership mismatch, double booking or unexplained balance discrepancy.

### Phase 6 — Notification delivery and lifecycle (P1/P2; providers are external dependencies)

- [ ] Harden concurrent approval/send/cancel and scheduled-dispatch races; recheck preview freshness, exclusions and recipient-set drift immediately before dispatch.
- [ ] Test private media authorization, content validation, upload limits and failure recovery.
- [ ] Configure Firebase Cloud Messaging in a test project and prove push delivery on a physical test device before enabling production push.
- [ ] Integrate SMS, WhatsApp Business and email only after approved provider accounts, templates, consent/legal process, opt-out, pricing and operational ownership are confirmed.
- [ ] Add bounded retry/backoff, provider response tracking, failed-delivery history and safe idempotency. Keep durable in-app inbox records even if external delivery fails.
- [ ] Label a message as externally delivered only when the provider's trustworthy response/status confirms it.

**Exit gate:** automated tests use synthetic recipients; delivery states reflect actual provider evidence; retries do not duplicate sends or erase the in-app record.

### Phase 7 — Customer app/web parity and release hardening (P1)

- [ ] Verify that customer website and Android use the same authenticated customer API rules and represent equivalent supported workflows.
- [ ] Test session expiry/logout, invitation activation, ownership changes, appointment changes, notification read/dismiss and empty/error/loading states on both clients.
- [ ] Resolve the production API base URL. The default `192.168.31.47:8080` value is local-network development only, and must serve this repository's API. Production must use the deployed HTTPS Bajaj API.
- [ ] Add automated and manual responsive/accessibility checks for each route/component at mobile, tablet and desktop sizes, with keyboard/focus visibility, readable contrast and reduced-motion behavior.
- [ ] Build, sign and securely store the Android release key; validate release APK/AAB installation and production API connectivity. Debug APK CI output is not a production release.
- [ ] Deploy backend and both static websites with HTTPS, managed secrets, private media/object storage, restricted database access, monitoring and alerting.
- [ ] Test database backup and restore in a separate rehearsal environment; document recovery procedure and verify restored application access.
- [ ] Run dependency/security review, load/performance tests and production-like smoke tests. Train staff and record acceptance sign-off before launch.

**Exit gate:** public URLs resolve securely, mobile release is signed, external services are verified, monitoring and restore procedures work, and all acceptance gates in this README pass.

### Phase 8 — Approved Bajaj/OEM integration (external dependency; do not simulate)

- [ ] Confirm authorized API/partner access, documented capabilities, credentials, contract and sandbox before implementation.
- [ ] Define per-operation request/response, idempotency, audit, retry and reconciliation behavior.
- [ ] Keep external submission status separate from internal dealership records; only show “submitted/accepted” when the approved integration confirms it.
- [ ] If no approved API exists, keep the integration explicitly unavailable; do not imply warranty, coupon, claim or stock data was sent to Bajaj.

**Exit gate:** a sandbox or authorized live integration proves the workflow, with auditable provider correlation IDs and safe failure handling.

### Final acceptance and definition of done

- [ ] Exact-head CI is green: backend/PostgreSQL migrations, staff web build, customer web build and Android build.
- [ ] All privileged routes have controller-level authorization tests; tenant isolation is covered for records and private media.
- [ ] Financial figures and report exports reconcile with source transactions, including reversals/refunds.
- [ ] Critical customer/sales/workshop journeys pass end-to-end tests and human acceptance.
- [ ] Responsive/accessibility, security and performance reviews have no unresolved release-blocking findings.
- [ ] Production HTTPS, provider integrations, monitoring and secret management are verified.
- [ ] Backup restoration is rehearsed; recovery steps are documented.
- [ ] README status and this checklist match actual merged code and test evidence.

### Resume instructions for the next implementation session

1. Read this section first, then read `docs/IMPLEMENTATION_PLAN.md` for the detailed domain constraints and acceptance history.
2. Check the current `main` SHA and latest [CI run](https://github.com/Manav326/BajajDealership/actions/workflows/ci.yml); do not rely on the baseline status above if new commits have landed.
3. Start with **Phase 0** if the exact current commit is not green. Otherwise start with the earliest unchecked phase whose dependencies are satisfied.
4. Implement one small slice, write/extend tests, run the relevant checks and full CI, then update this section with the exact commit/run evidence and checkboxes actually completed.
5. Do not mark a phase complete because a screen/API exists. Require all stated exit-gate evidence first.


## Build outputs and where to find them

Every CI run on `main` (and pull requests targeting `main`) validates the backend and builds the two React websites plus the Android debug APK. Open [GitHub Actions → CI](https://github.com/Manav326/BajajDealership/actions/workflows/ci.yml), select a successful run, then use the **build summary** at the bottom of the run page (or the Artifacts section) to download:

- `staff-portal-web-<commit>` — compiled staff/admin website in `dist/`.
- `customer-portal-web-<commit>` — compiled customer website in `dist/`.
- `lucky-bajaj-android-debug-apk-<commit>` — installable Android debug APK.

### Download and install the latest APK on an Android phone

From the repository root in Windows PowerShell, after pulling the latest `main`:

```powershell
.\scripts\android-fetch-latest-apk.ps1
```

The script uses the GitHub CLI to find the newest **successful** CI run on `main` that actually contains the Android APK (it automatically skips successful runs where Android was not rebuilt). It downloads the artifact, verifies the APK when Android SDK Build-Tools are available, replaces the single saved copy at `artifacts/lucky-bajaj-latest.apk`, displays the source commit and SHA-256, then offers to install it through ADB.

Install prerequisites: GitHub CLI authenticated with `gh auth login`, Android Platform-Tools/ADB, and a phone connected by USB or Wireless debugging with its authorization prompt accepted. When more than one phone is connected, the script asks which device to use; or pass `-DeviceSerial <adb-serial>`. Use `-DownloadOnly` to download without installing.

Installation uses `adb install -r`; it does not uninstall the existing app or clear its local data. A signing-key mismatch is reported without automatic uninstall. The script keeps only one current APK copy, plus its JSON source metadata and install-history log, under the ignored `artifacts/` directory. GitHub APK artifacts are retained for 14 days.


Artifacts are retained for 14 days. The web artifacts are static build files, separate from the live preview links above. The Android artifact is a debug APK, not a Play Store-signed release, and defaults to `https://lucky-bajaj-api.onrender.com/`. Override `BAJAJ_API_BASE_URL` in Actions or `EXPO_PUBLIC_API_BASE_URL` for local development; use `http://192.168.31.47:8080/` for a physical phone on the mPAY-style LAN setup and `http://10.0.2.2:8080/` for an Android Studio emulator. A local URL must serve the BajajDealership API, not mPAY's backend.

## Local development — build locally or pull from GHCR

Docker Compose runs PostgreSQL, the Spring Boot API, the customer website and the staff portal together. You can either build the API/web images from this checkout, or pull the prebuilt API/web images from GitHub Container Registry (GHCR). Both modes keep PostgreSQL and its named data/media volumes on your local machine.

### Windows (PowerShell)

Run from the repository root:

```powershell
git pull origin main

# Option 1: build the API and websites from source on this computer (default)
.\scripts\start.ps1

# Option 2: pull published images from GHCR and run them without building
.\scripts\start.ps1 -Mode Pull

# Pin to an exact successful main commit's images instead of the moving latest tag
.\scripts\start.ps1 -Mode Pull -Tag sha-<full-commit-sha>
```

To rebuild locally without Docker's layer cache, use ` .\scripts\start.ps1 -Rebuild` (without the leading space in PowerShell).

### macOS / Linux

```sh
git pull origin main

# Option 1: build locally (default)
sh ./scripts/start.sh

# Option 2: pull the prebuilt images from GHCR and run them without building
sh ./scripts/start.sh pull

# Pin to a successful main commit's images
sh ./scripts/start.sh pull sha-<full-commit-sha>
```

Published image tags are:

- API: `ghcr.io/manav326/bajajdealership-api`
- Customer web: `ghcr.io/manav326/bajajdealership-customer-web`
- Staff web: `ghcr.io/manav326/bajajdealership-staff-web`

The `latest` tag tracks the latest successful main build that passed the required CI jobs. The immutable `sha-<full-commit-sha>` tag lets you reproduce a specific build. GHCR publishing runs for `main` only and is gated on backend/PostgreSQL tests, both web builds, Docker smoke testing and Android build completion.

If GHCR packages are private, authenticate once before pull mode using a GitHub token with package-read access:

```sh
docker login ghcr.io
```

On Windows, run the same Docker login command in PowerShell. If the images are configured as public packages, no registry login is needed. If pull mode reports that an image could not be pulled, check the tag and registry access; the script will **not** fall back to a local build silently.

### What each mode does

- **Build mode**: builds the API and both web images from the local source, then starts all four services.
- **Pull mode**: pulls the API and two web images for the selected tag, then runs them with `--no-build`.
- **Both modes**: use the same local PostgreSQL database, the same persistent database/media volumes, health checks, bootstrap-token setup and local ports. The Android app itself runs on a phone/emulator rather than as a Compose service.
- Set `BAJAJ_IMAGE_TAG` in the root `.env` to pin a tag for direct `docker compose` usage; the scripts also accept a tag argument/parameter.

The first run generates a private ignored `.env` with local settings and a random one-time **owner bootstrap token**, shown in the startup terminal when generated. On `http://localhost:3001`, choose **First time here? Set up dealership owner**, then paste that token and complete the dealership/owner form. Do not paste this token into the staff-invitation activation form. After the first owner is created, the API permanently closes bootstrap for this application instance; the owner can sign in through the normal form and invite staff from the staff-management UI.

### Local URLs

| Service | Address |
|---|---|
| Customer website | http://localhost:3000 |
| Staff / owner portal | http://localhost:3001 |
| Spring Boot API | http://localhost:8080 |
| API health | http://localhost:8080/actuator/health |
| PostgreSQL | localhost:5432 |

Both websites forward `/api/` requests to the shared Spring Boot API inside Docker. This keeps browser requests same-origin and avoids needing a separate CORS configuration for local development. Change port defaults in the ignored root `.env`.

**Port conflict note:** this stack intentionally uses ports 3000, 3001, 8080 and 5432. Stop another local Docker stack that uses these ports before starting this one. The script will report a bind error rather than stopping another project automatically.

To stop containers without deleting database or private-media data, run ` .\scripts\stop.ps1` on Windows or `docker compose -f compose.yaml down` on macOS/Linux. Do **not** append `-v` unless intentionally deleting local data. Useful commands:

```sh
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs -f api
docker compose -f compose.yaml logs -f customer-web staff-web
```

### Android API address

The Android app uses `EXPO_PUBLIC_API_BASE_URL`. The startup script writes `apps/android/.env` for a physical device using the computer's detected LAN IP. That URL must serve this BajajDealership API, not another backend.

- **Physical phone:** connect the phone and computer to the same Wi-Fi and use `http://<computer-LAN-IP>:8080/`; allow port 8080 through the computer firewall if needed.
- **Android Studio emulator:** set `BAJAJ_ANDROID_API_BASE_URL=http://10.0.2.2:8080/` before running the startup script.
- **Override:** set `BAJAJ_ANDROID_API_BASE_URL` before startup; the helper writes it to the ignored Android `.env`.

The Android app is not a Docker service. CI builds an installable debug APK; it is not a signed Play Store release.

### Initial owner bootstrap

The local startup script generates a random temporary `APP_BOOTSTRAP_TOKEN` in the ignored root `.env` on first run and prints it once. Call `POST http://localhost:8080/api/v1/system/bootstrap` with the token in the `X-Bootstrap-Token` header and the owner JSON below. Bootstrap permits only the first owner for a dealership. After owner setup, blank `APP_BOOTSTRAP_TOKEN=` in `.env` and run `docker compose up -d --force-recreate api` to disable it.

```json
{
  "dealershipCode": "LUCKY-BAJAJ",
  "dealershipName": "Lucky Bajaj Agency",
  "ownerName": "Agency Owner",
  "email": "owner@example.com",
  "phone": "+91XXXXXXXXXX",
  "password": "replace-with-a-long-unique-password"
}
```

These credentials and defaults are for development only. Do not expose this Compose stack to the public internet or reuse its database credentials in production. Production requires HTTPS, separate secrets, restricted database access, durable private media, monitoring and verified backups.

## Local UI testing (Playwright + Maestro)

Run local web and native Android UI tests using the repository helper; see [docs/LOCAL_UI_TESTING.md](docs/LOCAL_UI_TESTING.md) for prerequisites, coverage and troubleshooting.

```powershell
.\scripts\test-ui.ps1                 # Playwright UI Mode for web tests
.\scripts\test-ui.ps1 -Target Android # Build/install app and run Maestro on emulator/device
.\scripts\test-ui.ps1 -Target Both    # Visible web suite, then native Android smoke test
```

The web test scenarios use synthetic fixtures where configured. Maestro preserves app state and checks the auth/activation UI when signed out or the home shell plus main-tab navigation when signed in; it does not submit credentials or write backend data. A green UI smoke test is not, by itself, acceptance evidence for every business workflow.

## Notification Studio design reference

The behaviour and safety requirements are adapted from QuantaEdge:
- `docs/product/rich-notification-platform-contract.md`
- `apps/web/app/components/NotificationStudio.tsx`
- `services/api/src/main/java/com/quantaedge/api/RichNotificationService.java`
- `services/api/src/main/java/com/quantaedge/api/NotificationContentValidator.java`
- `services/api/src/main/java/com/quantaedge/api/AndroidPushService.java`

The dealership implementation uses **customer/staff/dealership** audiences and derives scope from the authenticated dealership. Education-specific student, course, guardian and HRMS rules must not be copied into the dealership domain. In-app inbox is the first durable channel. No external channel is labelled delivered until a configured provider confirms it.

## Security and delivery rules
1. Never trust a dealership ID, recipient count or permission supplied by the client as proof of authority.
2. All customer, vehicle, campaign, media, stock and financial queries must be scoped to the authenticated dealership.
3. Record an auditable history for changes to customer consent, stock, financial records, approvals and campaigns.
4. Retryable writes and message sends must be idempotent; external delivery failures must not erase durable in-app notifications.
5. Use synthetic recipients in tests. Automated QA must never send notifications to real customers.
6. Preserve old Flyway migrations; schema changes are additive and tested on a clean PostgreSQL database.
7. A build being green does not certify business acceptance or production readiness.

## Acceptance and release gates
- Exact-head CI passes backend tests, clean/upgraded Flyway migration tests and React production build.
- Role/permission and dealership-isolation tests pass for every write and read workflow.
- Source transaction totals reconcile with dashboards and exports.
- Customer data and private media cannot be retrieved across dealership boundaries.
- In-app notification, audience preview, preview-token expiry, exclusions, idempotent retry and schedule/cancel transitions pass API integration tests.
- Android build and external push delivery are verified using a test Firebase project before external push is enabled.
- Critical customer→sale→vehicle history→service booking→job card→parts→bill/payment→owner-report flows pass end-to-end tests.
- Backups are actually restored in a rehearsal; no release is labelled production-ready until then.

## Commercial scope
The customer quote covers one outlet and up to 20 staff logins. It proposes a managed subscription option or a self-hosted licence option. Provider charges (SMS/WhatsApp/email, payment gateway), special OEM integrations, additional outlets and features beyond the signed scope must be agreed separately. Product code ownership, licence, source-code delivery and deployment rights must follow the signed contract.


### Customer Google sign-in

The customer portal uses the same Google Identity Services web client ID and server-side audience verification as QuantaEdge. Configure `GOOGLE_WEB_CLIENT_ID` on the Lucky Bajaj API service with the exact existing value from the QuantaEdge deployment (`APP_AUTH_GOOGLE_CLIENT_ID` inside the API container). The value is a public OAuth client identifier, not a client secret; keep it centrally managed and do not put a client secret in either web app. The Render Blueprint declares the variable as a manual deployment setting so it can be supplied without committing it to source. For Android sign-in, register separate Android OAuth clients for Standard (`com.quantaedge.luckybajaj`) and Liquid Glass (`com.quantaedge.luckybajajlg`) using the SHA-1 fingerprints of the corresponding APK signing certificates. Configure their public client IDs as `GOOGLE_ANDROID_CLIENT_ID` and `GOOGLE_ANDROID_LIQUID_GLASS_CLIENT_ID`, respectively. The Render Blueprint exposes both as manual API-service settings; local Compose forwards the same variables from the root `.env`. Debug and release signing certificates may require different Android OAuth registrations.

In Google Cloud Console, add `https://lucky-bajaj-customer-web.onrender.com` to the OAuth client’s **Authorized JavaScript origins** alongside the existing QuantaEdge origins. Once configured, check `https://lucky-bajaj-api.onrender.com/api/v1/customer/auth/google/config`; it should return `configured: true` and the same public `clientId` as QuantaEdge. This feature does not change customer-code/password login or staff authentication.
