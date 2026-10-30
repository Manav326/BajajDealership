# Local UI testing: Playwright + Maestro

This repository provides two local, free UI-testing paths:

- **Playwright** drives the staff/owner portal and public customer website in Chromium. UI Mode is interactive and lets you select tests, inspect steps, and examine traces.
- **Maestro** drives the real Lucky Bajaj Android app on an emulator or a USB-connected device.

Neither path requires a paid cloud-testing service. The Android path does require local Android tooling and a target device.

## Windows PowerShell commands

Run these from the repository root after pulling the branch containing this setup:

```powershell
# Interactive web test runner (recommended for investigating UI behaviour)
.\scripts\test-ui.ps1

# Native Android smoke test
.\scripts\test-ui.ps1 -Target Android

# Run the complete web suite in a visible browser, then test Android
.\scripts\test-ui.ps1 -Target Both
```

The default target is `Web`. `-Target Web` opens Playwright UI Mode, where you choose the tests to run. `-Target Both` runs the web suite in headed Chromium and then builds/installs the Android app and runs the Maestro flow.

## What the script prepares automatically

- Installs npm dependencies for each app only when their expected package is missing.
- Installs Playwright's Chromium browser if needed.
- Downloads the free Maestro CLI into the current Windows user's local tools directory if the CLI is not already available. It does not change the machine-wide PATH.
- Starts the first configured Android Virtual Device if no device is already online.
- Builds and installs the Android release variant using the repository's deployed preview API URL, then runs the native UI smoke test.
- Keeps generated Expo native project files out of Git status.

Initial dependency and browser/CLI downloads need an internet connection.

## One-time Android machine prerequisites

To run `-Target Android` or `-Target Both`, install **Node.js 24**, **JDK 17 or 21**, and **Android Studio with Android SDK/platform-tools**. Ensure `JAVA_HOME` points to the JDK. Create an Android Virtual Device once in Android Studio's Device Manager, or connect a physical Android phone with USB debugging enabled. The script can boot an existing AVD automatically; it cannot create an Android SDK/system image before Android Studio has been installed and licensed.

The app is built in release mode so the test does not depend on a persistent Metro window. The emulator or phone remains visible while Maestro performs the UI actions.

## Test safety and current coverage

- The Playwright scenarios use synthetic UI fixtures and intercepted API responses where defined in the tests. They do not require the local PostgreSQL/database stack and must not be treated as proof that live backend business flows work.
- The Maestro smoke flow `.maestro/flows/customer-auth-smoke.yaml` launches the real Android app, checks the sign-in screen, switches to account activation and back, and checks the expected fields. It does **not** submit credentials, activate an account, send notifications, or write customer data.
- A passing smoke test proves only the covered UI checks. Extend the flow and acceptance suite as each native customer workflow is validated.

## Web test ports

Playwright starts isolated Vite test servers:

- Staff portal test instance: `http://127.0.0.1:3101`
- Customer website test instance: `http://127.0.0.1:4173`

The staff test instance uses port 3101 to avoid clashing with the local Docker staff portal on port 3001. The current customer showroom scenarios use port 4173, so that port must be available.
