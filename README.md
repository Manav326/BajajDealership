# QuantaEdge — Bajaj Dealership Management System

**Customer:** Lucky Bajaj Agency  
**Product owner / software company:** QuantaEdge  
**Branch:** `main`  
**Status:** Active implementation — core dealership workflows exist; production rollout is not yet approved.

This repository contains the implementation roadmap and application code for a dealership management system that connects new-bike sales, customers, workshop servicing, spare parts, staff, operational finance and notifications.

## Product roadmap

### Product experiences
- **Owner and staff web portal:** ReactJS, responsive for desktop, tablet and mobile.
- **Customer website:** service requests, owned vehicles, permitted service history, notifications and feedback.
- **Android applications:** independently installable Standard and Liquid Glass customer editions share the dealership API; signed store distribution and FCM push are separate release gates.
- **One shared backend:** Spring Boot REST APIs and PostgreSQL. Web and mobile clients must use the same authoritative records and permission rules.

### Business modules
1. **Foundation and access control** — dealership scoping, staff identities, role-based permissions, secure sessions, audit events, database migrations and backup strategy.
2. **Customers and CRM** — customer profiles, contact preferences, linked vehicles, follow-ups, complaints and consent history.
3. **Bike inventory** — model/variant catalogue, individual vehicle units, chassis/engine identifiers, stock receiving and auditable stock movement.
4. **Sales and delivery** — enquiries, test rides, bookings, vehicle allocation, finance/insurance/registration follow-ups, invoice links and delivery.
5. **Workshop and service** — appointments, check-in, inspection, estimates and customer approval, job cards, mechanic assignment, work status, quality check, billing and handover.
6. **Spare parts** — suppliers, purchases, receiving, stock ledger, job-card issue/return, damage adjustments and reorder alerts.
7. **Billing and business controls** — invoices/receipts, payments, partial settlements, refunds/adjustments, expenses, outstanding balances and daily closing.
8. **Employees** — staff identities, roles, permissions, invitations and assignments are implemented; attendance/leave and verified performance workflows remain future scope.
9. **Notification Studio** — reusable rich templates, version history, Logo & Graphics workspace, audience search, server-side preview and exclusions, scheduling, durable inbox, audit and delivery history.
10. **Reports** — sales, servicing, collections, expenses and inventory reports reconciled to source records.
11. **Customer web and Android** — bookings, vehicle/service views, updates, feedback and appropriately scoped customer notifications.
12. **Production readiness** — exact-head CI, full business acceptance, responsive/accessibility review, persistent hosting, backup restoration, monitoring, signed releases and staff training.

## Technical baseline
- Web: ReactJS + TypeScript + Vite
- Android: React Native + Expo SDK 57, targeting React Native 0.86 / React 19.2; CI builds self-contained arm64 release-variant Maestro test APKs when Android paths change. Signed public releases, OAuth certificate registration, Play Store submission and push delivery remain separate release steps
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

This is an active implementation, not a production release. The codebase already contains substantial staff, customer, showroom, sales, workshop, spare-parts, finance, notification, social-channel, Android and Windows functionality. Several operational workflows are implemented but still need live-backend/human acceptance; external channels and statutory integrations remain gated.

### Implemented foundations

- Staff/owner portal, dealership-scoped identities and permissions, customer CRM, vehicle-unit inventory, stock ledgers, audit history and database migrations.
- Public Bajaj showroom with 20 catalogue model records, model details, sourced price disclosures, promotions, comparisons and shareable links; physical stock is sourced separately from vehicle units.
- Customer website and two Android customer editions with account access, profile/address book, owned bikes, service views, customer sales requests, spare-parts ordering and in-app notifications.
- Staff sales pipeline, test rides, bookings, physical-unit reservation, operational invoices/manual receipts, delivery handover and ownership history.
- Workshop appointments, check-in/job cards, inspection, estimate revisions/decision evidence, technician assignment, quality controls and operational billing/handover.
- Spare-parts supplier receipts, weighted-average cost, stock reservation/issue/return/release, low-stock policies, customer retail orders, delivery quotes, cancellation and return/refund-review lifecycle.
- Expenses, approvals/reversals, immutable daily closing, operational adjustments, date-bounded reports and CSV/PDF/printable documents.
- Rich in-app notification templates, exact audience preview, approval, scheduling/cancellation, saved preview, Send now, durable inbox, idempotency and scheduler race/retry controls.
- Disabled-by-default Meta/WhatsApp publishing and messaging foundations; Windows staff desktop and server-side licensing/device activation; browser-local Creative Studio.

### Incomplete or externally gated

- End-to-end customer/sales/workshop acceptance against the real PostgreSQL-backed API, broader cross-workflow concurrency/failure recovery and manual dealership sign-off.
- Customer-facing workshop estimate approval/change workflow, richer mechanic work entries/progress and complaints/feedback.
- Verify model pricing/offers, retail part fitment/prices and real inventory mapping with dealership staff. The 50 BGP reference items are not OEM part numbers and are not orderable by default.
- Online payment settlement/refunds and statutory GST/e-invoicing are not implemented. Manual receipts, payout attestations and operational invoices must not be described as verified settlement or statutory documents.
- FCM push, real Meta/WhatsApp provider acceptance, SMS/email providers and authorized Bajaj/OEM integrations.
- Signed Android/Windows public releases, live device acceptance, backup restore, monitoring and production-grade hosting.
- Advanced Creative Studio editor/render work (issue #45), shared server-side project library and full technical SEO.

The detailed current-state matrix, CI evidence, deployment limits and release gates are maintained in [docs/PRODUCT_STATUS.md](docs/PRODUCT_STATUS.md). Domain details are in the specialist documents listed there.

## Implementation roadmap & resume checkpoint

Use [docs/PRODUCT_STATUS.md](docs/PRODUCT_STATUS.md) as the authoritative capability/release checklist and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for domain invariants and the ordered engineering backlog. The following sequence prevents further stale milestone checklists.

### Current code baseline

- Inspected main baseline: 6941940b625a7e7ca818687df80deb3421247c15.
- [CI run 41164397252](https://github.com/Manav326/BajajDealership/actions/runs/41164397252): backend/PostgreSQL tests, staff/customer web builds, Docker stack smoke test, Windows EXE/MSI build and GHCR publication/pull test passed.
- [Notification browser run 41164397291](https://github.com/Manav326/BajajDealership/actions/runs/41164397291) passed on that baseline.
- Android jobs were skipped because Android paths had not changed. The skipped jobs are not a failure and must not be represented as a current-head APK build. The downloader scripts find the latest successful main run that actually contains the requested edition's artifact.
- Dedicated Social Media Studio browser workflow last passed on an earlier main commit in [run 41157066812](https://github.com/Manav326/BajajDealership/actions/runs/41157066812); it was not rerun on the inspected baseline.
- These facts describe the code baseline before the documentation update. Recheck the latest Actions run and SHA after documentation lands.

### Execution rules

1. Work in small reviewable vertical slices; keep unrelated refactors separate.
2. Preserve business, customer, financial and audit history. Never reset production data to make tests pass.
3. Keep released Flyway migrations immutable; use additive migrations and test both clean creation and upgrade paths.
4. Derive dealership scope from authenticated principals or an explicitly configured public resolver; never treat client-supplied IDs as authorization.
5. Treat manual payment/payout records as operational attestations, not gateway settlement. Treat operational invoices as distinct from statutory GST documents.
6. Use synthetic recipients and accounts in CI. Never send real customer messages or make real payments from automated tests.
7. Update the relevant specialist document, PRODUCT_STATUS.md and the affected GitHub issue whenever implementation status changes.

### Next work, in order

1. **P0 — Production foundation:** select durable database/API/media hosting; inspect and rehearse Flyway upgrade history; validate secrets, CORS, monitoring and backup restoration.
2. **P0 — Business acceptance:** run full real-API/PostgreSQL customer → sales → handover → ownership → workshop → parts → billing/report journeys; finish role, privacy and viewport acceptance.
3. **P1 — Core workflow closure:** customer-facing estimate decisions, richer mechanic work entries, complaints/feedback, transaction/concurrency tests and financial report reconciliation.
4. **P1 — Mobile/desktop release:** physical-device Maestro acceptance, FCM test delivery, Android signing/OAuth setup, Windows signing/clean-machine install and release channel validation.
5. **P2 — External and extended capabilities:** Meta/WhatsApp authorized E2E, payment/GST integrations, Creative Studio issue #45, SEO and any approved OEM integrations.

No milestone is complete because a screen/API exists. Require tests, real-backend workflow evidence, operational configuration and human acceptance for the relevant exit gate.

## Build outputs and where to find them

The CI workflow builds the backend, both websites and the Docker stack on main. Android APK jobs are conditional on Android-related source changes; when they run, the artifacts are self-contained, arm64-only, release-variant Maestro test APKs. They are not signed Play Store releases.

Open [GitHub Actions → CI](https://github.com/Manav326/BajajDealership/actions/workflows/ci.yml), select a successful run and inspect the build summary/artifacts:

- staff-portal-web-<commit> — compiled staff website files.
- customer-portal-web-<commit> — compiled customer website files.
- lucky-bajaj-android-maestro-apk-<commit> — Standard edition Android test APK when the Standard job ran.
- lucky-bajaj-android-liquid-glass-maestro-apk-<commit> — Liquid Glass edition Android test APK when its job ran.
- lucky-bajaj-windows-builds-<commit> — Windows installer artifacts when the Windows build job ran.

### Download and install the latest Standard APK

From the repository root in Windows PowerShell, run **scripts/android-fetch-latest-apk.ps1**.

The script searches successful main CI runs for the newest run containing the Standard APK, skipping successful runs where Android did not rebuild. It validates the downloaded artifact/metadata, stores one current copy under artifacts/, displays the source commit and SHA-256, then offers ADB installation. It does not automatically uninstall the existing app or clear local data after a signing mismatch.

### Download and install the Liquid Glass APK

Run **scripts/android-lg-fetch-latest-apk.ps1** from the repository root.

This targets only package com.quantaedge.luckybajajlg and saves its own artifact. Standard uses com.quantaedge.luckybajaj. Both editions can coexist.

GitHub Actions artifacts are retained for a limited period (currently 14 days). Both Android artifacts are test builds; a public Android release still needs a production signing key, correct OAuth registration for that certificate, broader ABI/AAB packaging, device acceptance and Play Store release steps.

### Windows installer artifacts

The CI Windows job builds unsigned EXE/MSI installers; a separate tag-triggered workflow can create a draft unsigned EXE/MSI/MSIX release candidate when its identity variables are configured. These are not trusted/signed public installers. See the Windows desktop distribution section below before sharing an installer.

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

The latest tag tracks the latest successful main build that passed the GHCR publish job. The immutable sha-<full-commit-sha> tag lets you reproduce a specific build. GHCR publishing is gated on backend/PostgreSQL tests, both web builds and Docker image/stack smoke tests; Android APK jobs are conditional and are not a prerequisite for GHCR publication.

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

Both Android editions use `EXPO_PUBLIC_API_BASE_URL`. The existing startup script prepares `apps/android/.env` for the Standard app; the Liquid Glass Maestro runner builds from `apps/android-liquid-glass` and sets the same computer LAN API URL for that separate app. The URL must serve this BajajDealership API, not another backend.

- **Physical phone:** connect the phone and computer to the same Wi-Fi and use `http://<computer-LAN-IP>:8080/`; allow port 8080 through the computer firewall if needed.
- **Android Studio emulator:** set `BAJAJ_ANDROID_API_BASE_URL=http://10.0.2.2:8080/` before running the startup script.
- **Override:** set `BAJAJ_ANDROID_API_BASE_URL` before startup; the helper writes it to the ignored Android `.env`.

Neither Android edition is a Docker service. CI conditionally builds independent self-contained arm64 release-variant Maestro test APKs for Standard and Liquid Glass; neither is a signed Play Store release.

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

## Dealership licensing and expiry policy

Licensing is enforced by the Spring Boot API, not the website or desktop executable alone. The staff portal queries `/api/v1/system/license/status` to display current state, while the bearer-token filter independently checks license state before each authenticated staff request.

- New and existing dealerships receive an automatic 30-day `TRIAL` record from Flyway V46, with a seven-day renewal grace period and 20 staff seats. Configure real commercial terms before the trial expires.
- `ACTIVE` grants normal access. `GRACE` preserves access and returns a renewal warning. After expiry plus grace, `READ_ONLY` allows safe GET/read operations and existing role-authorized exports while rejecting create/update/delete requests.
- `SUSPENDED`, `REVOKED`, `NOT_YET_ACTIVE` and missing-license states block operational reads and writes. Staff may still check license status, verify the current session and sign out.
- Staff invitations reserve a seat while their account is `INVITED`; `ACTIVE` and `INVITED` accounts count against the seat limit. Deactivated staff do not consume an active seat.
- The restricted vendor console is hosted at `/license-admin.html`. Configure `APP_LICENSE_ADMIN_TOKEN` as a high-entropy API deployment secret; generate one with `openssl rand -base64 48`. The console sends it in `X-License-Admin-Token` and holds it in page memory only. If the secret is unset, API license-management endpoints remain unavailable.
- After expiry plus grace, dealership owners can use `GET /api/v1/admin/data-export` to download a ZIP of dealership-owned JSON Lines business records. The route requires the OWNER role, is audit-logged, and omits authentication, session, licensing and secret-like data.
- Every license update records an audit event with the requested plan, state, dates, grace period, staff-seat limit and change reason. The token itself is never written to the database or audit trail.
- Before deploying this migration to a live customer, configure the API secret and commercial license terms. The migration trial is a safety transition, not proof of a paid subscription.

The licensing model enforces server-side dealership state, staff-seat limits and registered desktop-installation limits. Each desktop session is tied to its installation registration; device IDs remain installation identities rather than cryptographic hardware attestation.

### Desktop installation activation

The Windows build registers an installation UUID on staff login. The API stores only a SHA-256 digest of that UUID, ties the resulting staff session to that installation and checks the registered-device state on each request. The identity is an installation identifier, not hardware attestation; it improves licensing/accountability but should not be described as impossible to tamper with. Existing registered desktop installations can retain read-only access after license expiry; new device activations are rejected after expiry+grace. A device administrator can revoke/re-activate installations in the license console.


## Windows desktop client

The staff portal is packaged as a Tauri 2 Windows desktop app. CI builds both an NSIS setup executable and an MSI on Windows and uploads them as a 14-day GitHub Actions artifact. The staff sign-in page links to `/download.html`; once a reviewed public release is published, it exposes the intentionally unsigned direct-download EXE/MSI with security-warning guidance and SHA-256 checksums.

To produce a draft release candidate, create and push a tag such as `desktop-v0.1.0`. The Windows release workflow creates a **draft** release with the intentionally unsigned EXE/MSI and Store MSIX, plus SHA-256 checksums. The EXE/MSI can be published without a paid certificate, with expected Windows trust warnings; clean-Windows install, login, licensing, upgrade and uninstall checks are still required.

The Tauri app registers a persistent random installation UUID at sign-in. The server stores the UUID's digest and binds the session to that device registration. This is an installation identity and device cap, not hardware attestation; device IDs can be copied by a determined user. Active registrations can be reviewed or revoked from the license console. Expired dealerships retain read-only access and allowed exports from existing registered devices; new desktop activation is blocked after grace expires.


### Windows desktop distribution packages

The Windows desktop release builds two distinct distribution paths from the same Tauri staff application.

- Direct customer download: LuckyBajajDesktopSetup.exe and LuckyBajajDesktop.msi are intentionally unsigned. No paid certificate or signing secret is used. Windows may show an Unknown Publisher or SmartScreen warning. The download page publishes SHA-256 checksums. Customers must download only from the official release and must not disable Windows Defender or SmartScreen.
- Microsoft Store: LuckyBajajDesktopStore.msix is a separate MSIX package with the runFullTrust capability for the Tauri desktop process. It is unsigned at upload time; Microsoft signs Store-distributed MSIX packages after certification. Never provide this unsigned MSIX as a direct download.

Tauri natively builds EXE and MSI installers. The Store MSIX is assembled from the MSI application payload with Windows SDK MakeAppx.exe and unpacked again to verify its manifest and executable. The package is x64 and targets Windows 10 version 1809 or later. Store acceptance and runtime behavior must still be verified using the Windows App Certification Kit and clean Windows devices, especially WebView2 runtime availability and package identity.

Before a Store release, reserve Lucky Bajaj Desktop in Microsoft Partner Center and copy the exact values from the app's Package/Identity section into repository Actions → Variables:

- MSIX_PACKAGE_IDENTITY_NAME — exact Package/Identity Name assigned by Partner Center.
- MSIX_PUBLISHER — exact Publisher distinguished name from Partner Center (not a guessed company name).
- MSIX_PUBLISHER_DISPLAY_NAME — approved publisher display name shown to customers.

The stable release workflow stops if any identity value is missing. It creates a draft GitHub release with unsigned direct EXE/MSI, unsigned Store MSIX and SHA256SUMS.txt. Review the draft and test installation, sign-in, server-side licensing, upgrades and uninstall on clean Windows 10/11 devices before publishing the direct-download release or submitting the MSIX to Partner Center.

For pull-request validation, CI produces a development-identity MSIX solely as a packaging smoke-test artifact. It is not valid for Microsoft Store submission. The Store package must be rebuilt from a stable desktop-vX.Y.Z tag using exact Partner Center identity values.


### Desktop API connectivity — local Docker vs hosted customer build

The installed Tauri executable is a desktop frontend only. It does not contain PostgreSQL, the Spring Boot API or a second database. It sends requests to the API URL compiled into the frontend bundle, using the configured staff authentication and desktop-installation headers.

There are two different Windows build targets, and they must not be mixed:

- **Local Docker test installer** (the `lucky-bajaj-windows-local-docker-*` CI artifact): compiled with `VITE_API_BASE_URL=http://127.0.0.1:8080/`. On the same Windows PC, Docker Compose publishes the API container's port 8080 to host port 8080 (`API_PORT` defaults to 8080). Start the Docker stack first and verify `http://127.0.0.1:8080/actuator/health` reports `UP`; then install and run this local-only EXE. The installed desktop process is on Windows, outside the Docker network, so it must use the host loopback address—not the Docker service DNS name `http://api:8080`.

- **Hosted customer installer** (the normal `windows-desktop` build and tagged release): compiled with `VITE_API_BASE_URL` set from the repository Actions variable `BAJAJ_API_BASE_URL`, defaulting to the currently deployed Lucky Bajaj API URL. It connects to that remote API over HTTPS; the customer does not need Docker or a local API container. Change the Actions variable before building when the API moves to its production hostname.

The Docker staff website at `http://localhost:3001` uses its Nginx/Vite `/api` reverse proxy. A packaged Tauri desktop app bypasses that staff-web reverse proxy and talks directly to the API base URL above. The Tauri Content Security Policy explicitly permits the local loopback API as well as the hosted API. The PR backend CORS configuration permits the Tauri Windows app origins and the `X-Desktop-Installation-Id` / `X-Desktop-App-Version` headers used for device registration and session binding.

**Backend version prerequisite for local testing:** PR #37 adds Tauri CORS support, device-bound staff login, and database migrations V46/V47. The current `main` branch / GHCR `latest` image only includes migrations through V45 and does not yet include those Tauri CORS/device changes. Because PR #37 is not merged, a local desktop test must run the API built from this PR branch. From a working copy checked out to `feature/dealership-licensing-readonly`, use `docker compose build api` followed by `docker compose up -d --no-build api`; then check `http://127.0.0.1:8080/actuator/health`. Do not switch back to `-Mode Pull` until PR #37 is merged and CI has published the updated GHCR image. The additive V46/V47 migrations then run against the existing local PostgreSQL volume at API startup.

Keep the two desktop artifacts clearly labelled. Never give the local-Docker build to a customer on a different PC: `127.0.0.1` always means that customer's own computer. For a customer installer, use the hosted API build, and deploy the PR backend before releasing that installer.

## Download and install the local Windows test build

Open `/download.html` from the staff portal and download `Download-LuckyBajajDesktop.ps1`. While PR #37 is open, the helper follows `feature/dealership-licensing-readonly`; once PR #37 is merged, it automatically follows `main`. It requires a successful Windows desktop build for the exact current branch commit, downloads only the corresponding `lucky-bajaj-windows-local-docker-<sha>` Actions artifact, verifies the GitHub SHA-256 digest and archive size, and confirms the ZIP contains exactly one EXE and one MSI. It does not fall back to an older build.

Right-click the script and choose **Run with PowerShell**. If Windows blocks scripts under the local execution policy, open PowerShell and run this process-scoped command (it does not change the saved machine or user policy):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& "$env:USERPROFILE\Downloads\Download-LuckyBajajDesktop.ps1"
```

If your administrator enforces a policy that prevents scripts from running, do not try to override it; ask the administrator for an approved installer workflow. GitHub artifact access may also require GitHub CLI sign-in or a fine-grained `GH_TOKEN` with Actions read access.

The installers are saved beneath `%USERPROFILE%\Downloads\LuckyBajajDesktopLocalDocker` in a folder named for the source commit. Only after both installers pass validation does the helper remove older version folders created by this helper in that dedicated location. It never uninstalls the app, modifies Docker data, or deletes unrelated files. It opens the new folder and writes `INSTALL.txt` with the exact source commit and setup steps.

This local test build is compiled to use `http://127.0.0.1:8080` and must be installed on the same computer as Docker Desktop. Follow the backend branch and health-check commands printed in `INSTALL.txt`; do not delete the existing PostgreSQL volume. Choose either the EXE or MSI, not both, and keep using the same installer type for later upgrades. The cleanup removes old downloaded installer files only; it does not uninstall the application. Local-Docker builds are for same-machine testing and must not be distributed to customers.