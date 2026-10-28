# Lucky Bajaj Customer — Android app

**Product owner:** Lucky Bajaj Agency  
**Software provider:** QuantaEdge  
**UI direction:** Liquid Glass — translucent layered surfaces, subtle borders, high-contrast controls and restrained depth.

## Customer workflows implemented

- Customer sign-in using dealership code, customer code and password.
- One-time invitation-token account activation.
- Secure device-local token storage and logout/revocation through the shared backend.
- Linked-bike view and chassis/engine details scoped by customer APIs.
- Workshop service-history list with recorded invoice/balance summary.
- Appointment request with date, time, bike, duration and concern; cancellation requires a reason.
- Customer notification inbox with mark-read/unread and dismiss actions.
- Uses the same Spring Boot customer APIs as the customer website; the mobile UI does not make dealership-wide queries.

## API address

The default build address is the deployed Lucky Bajaj API. The same environment variable follows mPAY's convention so local device builds can override it:

`http://192.168.31.47:8080/`

The address above must serve the **BajajDealership Spring Boot API** for this app to work. Reusing mPAY's address format does not make mPAY's own backend compatible with Bajaj's endpoints. The computer running Bajaj's backend must be reachable from the phone, and its firewall/network must allow port 8080.

Override the address at build time with `EXPO_PUBLIC_API_BASE_URL` when the development computer has a different LAN IP or the API uses another port/domain.

- **Physical Android phone on the same Wi-Fi:** use the computer's LAN IP, for example `http://192.168.31.47:8080/`.
- **Android Studio emulator:** use `http://10.0.2.2:8080/` to reach the emulator host computer.
- **Production/shared external access:** use the deployed Bajaj API's HTTPS URL. A private LAN IP is not reachable from the public internet.

## Run the Android app locally

Requirements: Node.js 24, Java 17, Android Studio/Android SDK and an Android emulator or device.

```sh
cd apps/android
npm install
npx expo install --fix
```

**PowerShell — physical phone on the same Wi-Fi**
```powershell
$env:EXPO_PUBLIC_API_BASE_URL = "http://192.168.31.47:8080/"
npx expo run:android
```

**PowerShell — Android emulator**
```powershell
$env:EXPO_PUBLIC_API_BASE_URL = "http://10.0.2.2:8080/"
npx expo run:android
```

**macOS/Linux — physical phone**
```sh
EXPO_PUBLIC_API_BASE_URL=http://192.168.31.47:8080/ npx expo run:android
```

The generated Android manifest permits cleartext HTTP for the configured local development address. Production builds should use HTTPS and be rebuilt with the production API URL.

## CI builds and downloads

Open [GitHub Actions — CI](https://github.com/Manav326/BajajDealership/actions/workflows/ci.yml), choose a successful run, and inspect the **build summary** at the bottom of the run page. The summary contains direct download links for:

- `staff-portal-web-<commit>` — compiled staff/admin static website.
- `customer-portal-web-<commit>` — compiled customer website.
- `lucky-bajaj-android-debug-apk-<commit>` — installable Android debug APK.

Web files are static build artifacts, not live public website URLs. Deploy them to HTTPS hosting to make them available on the internet. The APK is a debug build, not a Play Store-signed release. Artifacts are retained for 14 days.

The workflow variable `BAJAJ_API_BASE_URL` can override the deployed API default. Configure it under **Repository → Settings → Secrets and variables → Actions → Variables** only for a different target (LAN, emulator, or staging). With no override, the APK uses `https://lucky-bajaj-api.onrender.com/`.

## Not yet enabled

- Firebase Cloud Messaging credentials and verified real-device push delivery.
- Production API domain and release environment configuration.
- Signed release APK/AAB, store listing, Play Store upload and release signing keys.
- Mobile device/accessibility acceptance tests on supported Android OS versions.

A successful build verifies compilation and automated tests; it does not mean the API is publicly hosted or the app has been released.
