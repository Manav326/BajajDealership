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
- Sales pipeline and end-to-end booking/invoice/delivery transaction workflow.
- Workshop is partially complete: intake, inspection, estimate/decision evidence, assignment, work/quality gates, operational invoice/receipt records and paid/acknowledged handover exist. Spare-parts catalogue/receipts/ledger, job-card reservation/issue/return/release, per-SKU reorder policies and low-stock alerts are implemented. Estimate revisions can link same-job reservations and freeze reserved/issued/returned/released quantities plus a unit-cost snapshot, separately from customer price; part issue requires a matching approved estimate, return/release makes an old snapshot stale until a revision is approved, and invoice creation rejects stale part quantities. The previous approved revision remains auditable and is superseded only when a replacement is approved. PostgreSQL integration tests cover same-SKU concurrent reservations, receipt idempotency/weighted cost, released quantities, low-stock calculations and stale estimate quantities. Remaining work includes deeper concurrency testing across receipt/issue/return, customer-facing estimate approval, richer mechanic work entries, refunds/credit notes, financial reconciliation, tax-compliant GST/e-invoicing, and external payment-provider verification.
- Spare-parts purchasing and job-card stock movement integration.
- Complete operational finance, refunds, payment reconciliation, GST-specific configuration and invoice integrations.
- Production deployment of the staff portal/customer website and a signed Android release. CI artifacts are test builds, not public hosting or Play Store releases.
- Android Firebase Cloud Messaging delivery configuration and end-to-end proof of real push delivery.
- SMS, WhatsApp Business and email provider integrations, templates, consent/process verification and provider billing.
- Approved Bajaj/OEM APIs or official dealer integrations. No code may imply warranty/coupon/claim/inventory records were submitted to Bajaj unless an authorised integration confirms it.
- Full cross-browser/mobile acceptance tests, production load/security review and verified backup restoration.

The existence of a screen, table or API is not evidence that its whole business workflow is complete. Modules stay marked in progress until their acceptance tests pass.

## Build outputs and where to find them

Every CI run on `main` (and pull requests targeting `main`) validates the backend and builds the two React websites plus the Android debug APK. Open [GitHub Actions → CI](https://github.com/Manav326/BajajDealership/actions/workflows/ci.yml), select a successful run, then use the **build summary** at the bottom of the run page (or the Artifacts section) to download:

- `staff-portal-web-<commit>` — compiled staff/admin website in `dist/`.
- `customer-portal-web-<commit>` — compiled customer website in `dist/`.
- `lucky-bajaj-android-debug-apk-<commit>` — installable Android debug APK.

Artifacts are retained for 14 days. The web artifacts are static files, not hosted URLs; deploy their contents to HTTPS hosting to make them public. The Android artifact is a debug APK, not a Play Store-signed release. Android defaults to the mPAY-style physical-device LAN address `http://192.168.31.47:8080/`; that address must serve the BajajDealership API, not mPAY's own service. Override it with the Actions repository variable `BAJAJ_API_BASE_URL` (or `EXPO_PUBLIC_API_BASE_URL` for local builds). For an Android emulator, use `http://10.0.2.2:8080/`; production must use the deployed Bajaj API's HTTPS URL.

## Local development

Requirements: Java 21, Maven, Node.js 24+, npm, Docker with Compose.

1. Start the local PostgreSQL instance:

   ```sh
   docker compose up -d postgres
   ```

2. Run the backend:

   ```sh
   mvn -f backend/pom.xml spring-boot:run
   ```

3. Run the web client in another terminal:

   ```sh
   cd apps/web
   npm install
   npm run dev
   ```

The web dev server runs on port 3000 and proxies `/api` to the Spring Boot API on port 8080.

### Initial owner bootstrap

Owner bootstrap is disabled unless `APP_BOOTSTRAP_TOKEN` is configured. Generate a strong, temporary secret and configure it only in the backend environment. Call `POST /api/v1/system/bootstrap` over HTTPS with that secret in `X-Bootstrap-Token` to create the dealership and initial owner. The bootstrap route permits only the first owner for a dealership. Remove the bootstrap secret after setup and never commit real secrets to the repository.

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
