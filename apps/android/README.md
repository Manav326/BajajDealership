# Lucky Bajaj Customer — Android app

**Product owner:** Lucky Bajaj Agency  
**Software provider:** QuantaEdge  
**UI direction:** Mobile-first Liquid Glass, adaptive layouts and native Android interaction patterns.

## Customer workflows

The Android customer app uses the shared Spring Boot customer API and authenticated dealership-scoped records. It includes:

- Public Bajaj showroom with search, category filters, published offers, model details/specifications and comparison for up to three models.
- Sourced on-road estimate when the API has an active location price profile. Prices and availability remain references; showroom requests do not reserve a motorcycle.
- Customer-code/password and username/password sign-in; invitation activation with username; Google sign-in when the required OAuth client IDs are configured.
- Secure device-local access-token storage, session restoration, logout/revocation and recoverable saved test-ride/purchase requests.
- Customer dashboard, linked motorcycles, workshop service history and recorded invoice/balance summaries.
- Service requests with motorcycle selection, native date/time pickers, duration and cancellation reason.
- Profile/contact/language editing and native photo picker for profile image upload/removal.
- Saved address book with add/edit/remove and default delivery address.
- Motorcycle purchase history, test-ride/purchase request progress and sales pipeline records when present.
- Spare-parts catalogue search, category/type/model/availability/price filters and sorting, a customer-specific cart that survives app restarts, pickup/delivery order requests, delivery quote acceptance/decline, cancellation and return-state explanations.
- Android share sheet for the same published-offer deep links available on the customer website.
- Customer notification inbox with mark-read/unread/dismiss, plus privacy policy and terms.
- Pull-to-refresh, responsive phone/tablet layout, keyboard-aware authentication and native confirmations for destructive actions.

All prices, inventory state, orders, ownership and appointment status come from backend records. The app does not invent stock, mark a test ride as confirmed, reserve a bike, or initiate/claim online payment where the backend only supports request-and-collect workflows.

## API configuration

The app and Expo Android manifest use one effective API address. Default API: `https://lucky-bajaj-api.onrender.com/`. Default customer website share target: `https://lucky-bajaj-customer-web.onrender.com/`.

Set `EXPO_PUBLIC_API_BASE_URL` at build time to target a local API and `EXPO_PUBLIC_CUSTOMER_WEB_URL` to change the customer website used by offer sharing:
- Physical Android phone on the same Wi-Fi: `http://YOUR_COMPUTER_LAN_IP:8080/`
- Android Studio emulator: `http://10.0.2.2:8080/`
- Hosted preview: `https://lucky-bajaj-api.onrender.com/`

Cleartext HTTP is permitted only if an explicit local-development URL is configured; use HTTPS for shared/public builds.

## Google sign-in setup

Configure both public OAuth client IDs on the API deployment when Google sign-in is required:
- `GOOGLE_WEB_CLIENT_ID`: the existing web OAuth client ID used by QuantaEdge and the customer website.
- `GOOGLE_ANDROID_CLIENT_ID`: an Android OAuth client registered for package `com.quantaedge.luckybajaj` and the SHA-1 fingerprint of the applicable debug/release signing certificate.

The API verifies ID-token audiences against the configured client IDs. The Android app reports when native Google sign-in is not configured rather than silently falling back to password login. Never place an OAuth client secret in the mobile app.

For local Docker, set both values in the ignored root `.env` file; `compose.yaml` forwards them to the API. For Render, configure the corresponding environment variables in the API service. Register the deployed customer website origin in the web client's Authorized JavaScript origins.

## Build and validation

Requirements: Node.js 24, Java 17, Android Studio / Android SDK, and a device or emulator.

```sh
cd apps/android
npm install
npx expo install --check
npm run typecheck
npx expo run:android
```

CI builds an installable Android debug APK whenever `apps/android/**` changes. See [GitHub Actions](https://github.com/Manav326/BajajDealership/actions). The APK is a debug artifact and is not a signed Play Store release.

### Download and install the latest CI APK (Windows)

Run this from the repository root after `git pull origin main`:

```powershell
.\scripts\android-fetch-latest-apk.ps1
```

Prerequisites: GitHub CLI (`gh auth login`), Android SDK Platform-Tools (`adb`), and an authorized USB or Wireless debugging connection. The script finds the newest successful `main` CI run containing an APK, downloads it to `artifacts/lucky-bajaj-latest.apk`, then prompts before installing. It skips successful runs without a new Android artifact, so commits that only change the web/backend do not stop APK downloads.

Use `-DownloadOnly` to download without installing, or `-DeviceSerial <adb-serial>` to choose a specific phone. It installs with `adb install -r`, which updates the app without clearing its local data. It never uninstalls automatically after a signature mismatch.


## Release limitations

The following remain separate release tasks unless their external setup and acceptance are completed:
- Firebase Cloud Messaging credentials and verified real-device push delivery.
- Production signing keys, signed release APK/AAB, store listing and Play Store release.
- Physical-device acceptance across supported Android versions, accessibility checks and network edge cases.
- Live Render API verification; a successful CI build alone is not proof that every external service is configured or reachable.


## Local physical-device Maestro testing (LAN HTTP)

The normal test target is a **physical Android phone on the same Wi-Fi/LAN as the Windows development PC**. Local testing intentionally uses HTTP, not HTTPS or Render:

- QuantaEdge's documented physical-device LAN API address: `http://192.168.31.47:8080/`.
- The customer website share target in the local Android build is `http://192.168.31.47:3000`.
- The phone must be able to reach the PC on TCP port 8080. Start the local Docker stack first, allow inbound TCP 8080 on the Windows Private firewall profile, and disable Wi-Fi client/AP isolation if the router enables it.
- This local HTTP configuration is compiled only by the dedicated test runner. Normal Expo / production builds continue to default to the hosted HTTPS API.

### One-time Windows setup

1. Install Node.js 24, JDK 17+, Android Studio / Android SDK platform-tools and make sure `adb` is on PATH.
2. Enable Developer options and USB debugging on the physical phone. Connect it by USB and accept the RSA debugging prompt. Verify with `adb devices -l`.
3. Install Maestro CLI for native Windows from its [official releases](https://github.com/mobile-dev-inc/Maestro/releases/latest): download `maestro.zip`, extract it to a stable directory such as `C:\\maestro`, add `C:\\maestro\\bin` to PATH, then reopen PowerShell. Maestro requires Java 17 or newer.
4. Copy `.maestro/local.env.example` to `.maestro/local.env`. Use a dedicated **local test customer**, not a real customer's account. Fill in the credentials and notification fixture values. This private file is ignored by Git.

### Run tests from the repository root (PowerShell)

```powershell
# Public showroom + login/activation entry screens
.\scripts\test-android-maestro.ps1 -Suite Public

# Authenticated account navigation + customer inbox
.\scripts\test-android-maestro.ps1 -Suite Authenticated

# Authenticated notification tests; requires the notification fixtures below
.\scripts\test-android-maestro.ps1 -Suite Notifications

# All suites
.\scripts\test-android-maestro.ps1 -Suite All

# Override the saved LAN address if the PC/router IP changes
.\scripts\test-android-maestro.ps1 -LanIp 192.168.31.47 -Suite All
```

The runner detects the single connected physical Android device, verifies the local API health endpoint, installs or updates a debug APK built with `http://192.168.31.47:8080/`, runs the selected Maestro flows and saves JUnit XML plus screenshots/debug output under `apps/android/maestro-results/<timestamp>/`. It refuses to silently test an emulator or hosted API. When multiple phones are connected, pass `-DeviceId <adb-serial>`.

### Notification test data

The customer notification fixture flows intentionally do not create or send campaigns on their own. Create and send these through the staff Notification Studio to the dedicated local test customer:

- A rich-content campaign with a hero, a PNG/JPEG image block uploaded by the Studio, and a CTA whose target is `/appointments`.
- A separate campaign with title matching `MAESTRO_NOTIFICATION_ACTION_TITLE`, so read → unread → dismiss is tested without deleting the rich-content fixture.
- A campaign with title matching `MAESTRO_NOTIFICATION_UNSAFE_TARGET_TITLE` containing a CTA labelled `MAESTRO_UNSAFE_CTA_LABEL` that targets an unsupported internal route such as `/admin`; the app must not display that CTA.
- At least 26 total sent notifications, with the value in `MAESTRO_NOTIFICATION_PAGE_TWO_TITLE` on page 2 (items 26–50), to exercise real pagination.

The local test customer also needs one currently linked motorcycle whose displayed model name exactly matches `MAESTRO_CUSTOMER_VEHICLE_NAME`, and at least one available, priced parts-catalogue item for the cart test. The service appointment test creates a short-lived request and then cancels it; use a dedicated test customer and ensure it has no conflicting appointment at the app's default future slot.

The notification title, image alt text, CTA label and destination heading must match the exact strings in `.maestro/local.env`. The test checks that the authenticated customer can fetch the image referenced by their sent notification; it does not weaken the separate staff media permission.

### What Maestro covers

Maestro is end-to-end UI coverage, not source-code line coverage. The current suite contains 10 runnable flows plus one shared login subflow. It exercises the public showroom and search, login/activation entry, authenticated navigation, profile/address/service screens, service appointment request and cancellation, parts cart persistence across app restart, portrait/landscape layout adaptation, inbox unread filtering, rich notification rendering, CTA navigation, notification read/unread/dismiss, customer-authorized image loading and page-2 pagination. Three notification fixture flows require the sent campaigns described above. A test run produces pass/fail counts in JUnit; no percentage of Java/TypeScript lines is claimed by Maestro.

The physical phone and local API are not available to GitHub-hosted CI. CI continues to run backend tests/migrations, web builds, Docker smoke tests and Android typecheck/native APK build. Run Maestro on the connected phone from the local PC to validate the device + LAN + API combination.
