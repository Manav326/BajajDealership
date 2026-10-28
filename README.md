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
- Sales enquiry, test-ride, booking, sale-invoice, manual-payment and handover flows are implemented in the current source tree. They are not accepted as complete until the current backend CI failure is resolved and transaction security, concurrency and end-to-end acceptance gates pass.
- Workshop is partially complete: intake, inspection, estimate/decision evidence, assignment, work/quality gates, operational invoice/receipt records and paid/acknowledged handover exist. Spare-parts catalogue/receipts/ledger, job-card reservation/issue/return/release, per-SKU reorder policies and low-stock alerts are implemented. Estimate revisions can link same-job reservations and freeze reserved/issued/returned/released quantities plus a unit-cost snapshot, separately from customer price; part issue requires a matching approved estimate, return/release makes an old snapshot stale until a revision is approved, and invoice creation rejects stale part quantities. The previous approved revision remains auditable and is superseded only when a replacement is approved. PostgreSQL integration tests cover same-SKU concurrent reservations, receipt idempotency/weighted cost, released quantities, low-stock calculations and stale estimate quantities. Remaining work includes deeper concurrency testing across receipt/issue/return, customer-facing estimate approval, richer mechanic work entries, refunds/credit notes, financial reconciliation, tax-compliant GST/e-invoicing, and external payment-provider verification.
- Spare-parts catalogue, supplier receipts, weighted-average cost, stock ledger, job-card reservation/issue/return/release, reorder policy and low-stock alerts are implemented. Broader cross-workflow concurrency, failure-recovery and financial reconciliation tests remain.
- Complete operational finance, refunds, payment reconciliation, GST-specific configuration and invoice integrations.
- Production deployment of the staff portal/customer website and a signed Android release. CI artifacts are test builds, not public hosting or Play Store releases.
- Android Firebase Cloud Messaging delivery configuration and end-to-end proof of real push delivery.
- SMS, WhatsApp Business and email provider integrations, templates, consent/process verification and provider billing.
- Approved Bajaj/OEM APIs or official dealer integrations. No code may imply warranty/coupon/claim/inventory records were submitted to Bajaj unless an authorised integration confirms it.
- Full cross-browser/mobile acceptance tests, production load/security review and verified backup restoration.

The existence of a screen, table or API is not evidence that its whole business workflow is complete. Modules stay marked in progress until their acceptance tests pass.


## Implementation roadmap & resume checkpoint

**Purpose:** This section is the actionable handoff for continuing implementation. Follow the phases in order, update the checkboxes only after evidence exists, and keep this file synchronized with actual code and CI. A page, endpoint or table alone does not satisfy a phase.

### Last audited baseline

- Baseline commit inspected: `4367501eadac3ab8069498041456fba73c9a7347` on `main`.
- CI run [#334](https://github.com/Manav326/BajajDealership/actions/runs/40717938068) on that commit **failed**. The staff/customer web build and Android debug APK jobs passed; the PostgreSQL-backed backend test job failed.
- Failure: `SalesTransactionServiceIntegrationTest.issueAndPaymentRejectInvalidBookingAndExcessPayment`. The test expects a ₹15,001 payment to exceed the balance, but its fixture also adds two helmets at ₹750 each with a ₹100 discount; with the ₹15,000 bike line, the invoice total is ₹16,400. First verify the intended business rule, then correct the fixture or expected amount so the test truly tests overpayment. Do not weaken or remove the server-side balance guard.
- Repository baseline had only `main` listed, no open PRs/issues, and no branch protection/rulesets visible in the inspected GitHub endpoints. Confirm governance settings before treating direct pushes as protected release workflow.
- Do not call the project production-ready from a successful build alone. External integrations and launch checks below are still outstanding.

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

- [ ] Implement the Billing & Expenses workspace against source records; do not show fabricated counts/totals.
- [ ] Deliver expense creation, category, evidence/reference, approval controls, reversals and auditable history.
- [ ] Implement daily closing and cash/UPI/bank reconciliation with opening balance, receipts, reversals, expenses, counted balance, variance, reason and approving actor.
- [ ] Implement refund/credit-note/adjustment workflows as separate authorized transactions with immutable reversal history. Do not rewrite or delete issued invoices/receipts.
- [ ] Keep sale and workshop billing paths consistent where appropriate while respecting their different lifecycle/state rules.
- [ ] Define the legal dealership entity and GST requirements before implementing tax calculations or e-invoicing; validate invoice numbering, tax breakup, customer details, cancellation/credit-note rules and provider response handling with the approved integration.
- [ ] Add payment-provider integration only after credentials, webhook/signature verification, idempotency, duplicate callback handling, refund semantics and reconciliation are defined. Never treat a manually entered reference as provider verification.
- [ ] Add downloadable invoice/receipt/closing records only after the underlying data, permissions and calculations are verified. Use a proper PDF layout and test its totals against database transactions.

**Exit gate:** financial balances reconcile to source transactions; duplicate/replayed events cannot double-post; refunds are auditable; statutory documents are enabled only when their legal/provider rules are implemented and verified.

### Phase 4 — Implement Reports (P1)

- [ ] Add backend report endpoints based on authoritative saved transactions, with consistent dealership scoping, permission checks, date range and timezone handling.
- [ ] Implement sales/enquiry conversion, bookings/deliveries, workshop jobs/status, parts movement/low-stock, collections/payment reversals, expenses and daily closing reports.
- [ ] Define each metric explicitly (source table/event, inclusion/exclusion rules, time zone, reversal handling and status semantics) so the UI does not invent business definitions.
- [ ] Add pagination/filtering where necessary and protect expensive queries; use indexes or pre-aggregation only where measurements justify them.
- [ ] Add CSV/export permissions and reconciliation tests that compare report totals with source transaction queries.
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

Artifacts are retained for 14 days. The web artifacts are static files, not hosted URLs; deploy their contents to HTTPS hosting to make them public. The Android artifact is a debug APK, not a Play Store-signed release. Android defaults to the mPAY-style physical-device LAN address `http://192.168.31.47:8080/`; that address must serve the BajajDealership API, not mPAY's own service. Override it with the Actions repository variable `BAJAJ_API_BASE_URL` (or `EXPO_PUBLIC_API_BASE_URL` for local builds). For an Android emulator, use `http://10.0.2.2:8080/`; production must use the deployed Bajaj API's HTTPS URL.

## Local development — one command

The supported local workflow is Docker Compose. You do not need to install Java, Maven, PostgreSQL, or Node.js on the host to run the backend and websites; Docker builds the services and starts them together.

### Windows (PowerShell)

From the repository root:

```powershell
git pull origin main
.\scripts\start.ps1
```

If Windows blocks local script execution, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

### macOS / Linux

```sh
git pull origin main
sh ./scripts/start.sh
```

The script validates the Compose configuration, builds the Spring Boot API and both React websites, starts PostgreSQL, waits for the API and websites to respond, and prints the service status. The first run generates a private ignored `.env` with local settings and a random one-time owner bootstrap token. Keep that token private. After initial owner setup, set `APP_BOOTSTRAP_TOKEN=` (leave the key present but blank) in `.env` and recreate the API with `docker compose up -d --force-recreate api`; the startup script will not re-enable bootstrap while the key is explicitly blank.

### Local URLs

| Service | Address |
|---|---|
| Customer website | http://localhost:3000 |
| Staff / owner portal | http://localhost:3001 |
| Spring Boot API | http://localhost:8080 |
| API health | http://localhost:8080/actuator/health |
| PostgreSQL | localhost:5432 |

Both websites forward `/api/` requests to the shared Spring Boot API inside Docker. This keeps browser requests same-origin and avoids needing a separate CORS configuration for local development. Port defaults can be changed in the ignored root `.env`.

**Port conflict note:** this stack intentionally uses the QuantaEdge-style ports 3000, 3001, 8080 and 5432. Stop any other local QuantaEdge/mPAY/Docker stack using these same ports before starting this one. The script will report a bind error rather than stopping another project automatically.

To stop the containers without deleting database or private-media data, run `.\scripts\stop.ps1` on Windows or `docker compose -f compose.yaml down` on macOS/Linux. Do **not** append `-v` unless intentionally deleting local data. Useful commands:

```sh
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs -f api
docker compose -f compose.yaml logs -f customer-web staff-web
```

To rebuild Docker images without the build cache on Windows, run `.\scripts\start.ps1 -Rebuild`.

### Android API address (mPAY-style)

The Android app uses `EXPO_PUBLIC_API_BASE_URL`, matching mPAY's Gradle/environment configuration convention. On startup, the helper creates `apps/android/.env` for the physical-device API URL using the computer's detected LAN IP, for example `http://192.168.31.47:8080/`. That URL must serve **this BajajDealership API**, not the mPAY service.

- **Physical phone:** connect the phone and development computer to the same Wi-Fi and use `http://<computer-LAN-IP>:8080/`. Allow inbound port 8080 through the computer's firewall if required.
- **Android Studio emulator:** set `BAJAJ_ANDROID_API_BASE_URL=http://10.0.2.2:8080/` before running the startup script, or update `apps/android/.env`.
- **Override:** set `BAJAJ_ANDROID_API_BASE_URL` before starting the stack; the helper writes the selected value to the ignored Android `.env` so Expo includes it in the next build.

The Android app itself is not a Docker service. It runs in an emulator/device; CI builds an installable Android debug APK artifact. A local API URL or APK build does not mean the API is publicly hosted.

### Local setup notes

- The root `.env.example` documents override variables; the startup script creates the ignored `.env` as needed.
- `scripts/stop.ps1` and `docker compose down` preserve named database and media volumes. Do not use `docker compose down -v` for normal stopping.
- These credentials and defaults are for a development machine only. Do not expose this Compose stack to the public internet or reuse its database credentials in production.
- The separate manual Vite workflow remains available if you intentionally want hot-reload development, but Docker Compose is the default workflow for bringing up the complete stack.

### Initial owner bootstrap

The local startup script generates a random temporary `APP_BOOTSTRAP_TOKEN` in the ignored root `.env` on first run and prints it once. For local setup, call `POST http://localhost:8080/api/v1/system/bootstrap` with the token in the `X-Bootstrap-Token` header and the owner JSON below. The bootstrap route permits only the first owner for a dealership. After setup, set `APP_BOOTSTRAP_TOKEN=` in `.env` and run `docker compose up -d --force-recreate api` to disable it. Production setup must use HTTPS and a separately managed secret. Never commit real secrets.

Example request body (replace the values with the authorised owner's details):

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

Do not use `bajaj_local_only` outside the local Compose environment. Production requires separate credentials, HTTPS, secret management, private uploads, restricted database access, monitoring and verified backups.

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
