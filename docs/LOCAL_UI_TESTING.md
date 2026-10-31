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

The default target is Web. -Target Web opens Playwright UI Mode, where you choose the tests to run. -Target Both runs the web suite in headed Chromium and then builds/installs the Standard Android app and runs the configured Maestro suite.

## What the script prepares automatically

- Installs npm dependencies for each app only when their expected package is missing.
- Installs Playwright's Chromium browser if needed.
- Downloads the free Maestro CLI into the current Windows user's local tools directory if it is missing, older than the configured minimum version, or cannot report its version. It does not change the machine-wide PATH.
- Starts the first configured Android Virtual Device if no device is already online.
- Builds and installs the Android release variant, targeting the shell's `EXPO_PUBLIC_API_BASE_URL` override first, then `apps/android/.env`, then the deployed preview API fallback. It targets the same selected device in both Expo and Maestro, and disables Metro because the release bundle is self-contained.
- Keeps generated Expo native project files out of Git status.

Initial dependency and browser/CLI downloads need an internet connection.

## One-time Android machine prerequisites

To run `-Target Android` or `-Target Both`, install **Node.js 24**, **JDK 17 or 21**, and **Android Studio with Android SDK/platform-tools**. The Android SDK Manager must also contain **Android SDK Platform 36**, **Build Tools 36.0.0**, and **NDK 27.1.12297006**; the runner checks these up front and reports any missing package. Ensure `JAVA_HOME` points to the JDK (the script also checks Android Studio's bundled JBR in its standard install location). Create an Android Virtual Device once in Android Studio's Device Manager, or connect a physical Android phone with USB debugging enabled. The script can boot an existing AVD automatically; it cannot create an Android SDK/system image before Android Studio has been installed and licensed.

The app is built in release mode so the test does not depend on a persistent Metro window. The emulator or phone remains visible while Maestro performs the UI actions.

## Test safety and current coverage

- The Playwright suite contains 97 executed browser cases across 9 spec files in the latest full Chromium run. It uses synthetic fixtures and intercepts APIs in many customer and staff scenarios; it proves browser behavior, not every live-backend business transaction.
- A dedicated cross-browser smoke suite covers the public showroom in Chromium, Firefox and WebKit (two scenarios per browser). It is intentionally a narrow compatibility/accessibility smoke, not a full three-browser run of all 97 cases or a WCAG audit.
- The Social Media Studio regression has its own 42-case workflow. Those cases overlap the full 97-case suite and must not be added to it as additional unique scenarios.
- Each Android edition has 11 runnable Maestro flows: 2 public, 5 authenticated customer and 4 notification-fixture flows, plus a shared login subflow. The Standard and Liquid Glass trees are checked for parity.
- The dedicated Android emulator workflow builds a self-contained x86_64 test APK, starts an isolated PostgreSQL-backed API and seeds a synthetic published showroom. Its first execution reached the emulator but failed before APK installation because ADB still reported the emulator as offline. The workflow is being updated to wait for the ADB transport, Android boot completion and package manager readiness, then retry installation. Do not count a Maestro flow as passed until its JUnit result exists.
- The full authenticated/fixture Maestro suite is available locally through the Android test helper's All selection. It requires a dedicated synthetic customer account and notification fixtures; never substitute a real customer account or credentials.
- Backend/API tests run against PostgreSQL and currently include 233 passing tests. JaCoCo records line and branch coverage; web V8 instrumentation records function execution only for staff/customer source modules loaded during the browser scenarios. These metrics are not interchangeable.

See [TESTING_COVERAGE.md](TESTING_COVERAGE.md) for the current measured percentages, workflow evidence, per-module weaknesses and release decision. The report distinguishes passed execution from scenario definitions and pending device acceptance.

A passing test proves only its stated assertions. Use synthetic test accounts on a production-like API for business acceptance, and record device, API version, app build and flow-suite result.

## Web test ports

Playwright starts isolated Vite test servers:

- Staff portal test instance: `http://127.0.0.1:3101`
- Customer website test instance: `http://127.0.0.1:4173`

The staff test instance uses port 3101 to avoid clashing with the local Docker staff portal on port 3001. The current customer showroom scenarios use port 4173, so that port must be available.
