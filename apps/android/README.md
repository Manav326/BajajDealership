# Lucky Bajaj Customer — Android app

**Product owner:** Lucky Bajaj Agency  
**Software provider:** QuantaEdge  
**UI direction:** Liquid Glass — translucent layered surfaces, subtle borders, high-contrast controls and restrained depth.

## Customer workflows implemented

- Customer sign-in using dealership code, customer code and password.
- One-time invitation-token account activation.
- Secure device-local token storage and logout/revocation through the shared backend.
- Linked-bike view and chassis/engine details scoped by the customer APIs.
- Workshop service-history list with recorded invoice/balance summary.
- Appointment request with date, time, bike, duration and concern; cancellation requires a reason.
- Customer notification inbox with mark-read/unread and dismiss actions.
- Uses the same Spring Boot customer APIs as the customer website; the mobile UI does not make dealership-wide queries.

## Run the Android app locally

Requirements: Node.js 24, Java 17, Android Studio/Android SDK and an Android emulator or device.

For the Android emulator, the backend running on the same development computer is normally reachable at `http://10.0.2.2:8080`:

```sh
cd apps/android
npm install
npx expo install --fix
```

Set the API address before generating native configuration or starting the build:

**PowerShell**
```powershell
$env:EXPO_PUBLIC_API_BASE_URL = "http://10.0.2.2:8080"
npx expo run:android
```

**macOS/Linux**
```sh
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080 npx expo run:android
```

The generated Android configuration permits cleartext HTTP only if the configured API address starts with `http://`. For shared devices and production, use an HTTPS API URL, then rebuild.

## CI APK

The CI workflow runs TypeScript checks, generates the native Android project with Expo prebuild, runs Gradle `assembleDebug`, and uploads:

`lucky-bajaj-android-debug-apk-<commit-sha>`

Open GitHub Actions → CI → choose the latest successful run → Artifacts. Download the artifact ZIP and install the contained `app-debug.apk` on a compatible Android device or emulator.

**Important:** the CI APK is configured for the Android emulator's `10.0.2.2:8080` development API target. It will not reach a developer's computer when installed on a physical phone. For physical-device testing, build with `EXPO_PUBLIC_API_BASE_URL` set to a reachable API address; use HTTPS for any production-like deployment.

## Not yet enabled

- Firebase Cloud Messaging credentials and verified real-device push delivery.
- Production API domain and release environment configuration.
- Signed release APK/AAB, store listing, Play Store upload and release signing keys.
- Mobile device / accessibility acceptance tests on supported Android OS versions.

A visible build artifact does not mean the app has been released or that the API is hosted publicly.
