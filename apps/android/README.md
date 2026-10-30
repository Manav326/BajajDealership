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
- Spare-parts catalogue search, category/availability/fitment filtering, cart, pickup/delivery order requests, delivery quote acceptance/decline and cancellation.
- Customer notification inbox with mark-read/unread/dismiss, plus privacy policy and terms.
- Pull-to-refresh, responsive phone/tablet layout, keyboard-aware authentication and native confirmations for destructive actions.

All prices, inventory state, orders, ownership and appointment status come from backend records. The app does not invent stock, mark a test ride as confirmed, reserve a bike, or initiate/claim online payment where the backend only supports request-and-collect workflows.

## API configuration

The app and Expo Android manifest use one effective API address. Default: `https://lucky-bajaj-api.onrender.com/`.

Set `EXPO_PUBLIC_API_BASE_URL` at build time to target a local API:
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

## Release limitations

The following remain separate release tasks unless their external setup and acceptance are completed:
- Firebase Cloud Messaging credentials and verified real-device push delivery.
- Production signing keys, signed release APK/AAB, store listing and Play Store release.
- Physical-device acceptance across supported Android versions, accessibility checks and network edge cases.
- Live Render API verification; a successful CI build alone is not proof that every external service is configured or reachable.
