# Lucky Bajaj Android editions

Two independently installable customer Android apps live in this repository:

| Edition | Project | Application ID | Scheme |
|---|---|---|---|
| Standard | `apps/android` | `com.quantaedge.luckybajaj` | `luckybajaj` |
| Liquid Glass | `apps/android-liquid-glass` | `com.quantaedge.luckybajajlg` | `luckybajajlg` |

Both use the same Lucky Bajaj API, dealership scope and customer records. Each has its own Expo config, identity, theme, GlassEffects implementation, native build output, CI artifact and download/install script. The Liquid Glass app is a complete source and test copy; it is not a Gradle/Expo build flavour that can overwrite Standard.

Shared screen and functionality code (`CustomerExperience.tsx`), entry points and Maestro workflows must stay identical. Only `theme.ts` and `GlassEffects.tsx` intentionally differ among the Android app sources. `scripts/check-android-edition-parity.ps1` checks source parity, Maestro flow parity, shared dependency versions and distinct package/deep-link identities. Common customer features and bug fixes must update both copies in the same change; CI fails on source drift.

Standard downloader: `scripts/android-fetch-latest-apk.ps1`. Liquid Glass downloader: `scripts/android-lg-fetch-latest-apk.ps1`. Both download only their own CI artifact, check package identity when Android SDK build-tools are installed, and install with `adb install -r`; they do not uninstall the other edition. Physical-device Maestro runners are `scripts/test-android-maestro.ps1` and `scripts/test-android-liquid-glass-maestro.ps1`.

## Google OAuth

The public web client ID remains shared. Android OAuth registrations are separate because the application IDs differ:
- Standard: `GOOGLE_ANDROID_CLIENT_ID`.
- Liquid Glass: `GOOGLE_ANDROID_LIQUID_GLASS_CLIENT_ID`.

The API returns the client ID matching the `applicationId` query from the app and verifies tokens against both configured Android client IDs. Register each Android package with the SHA-1 of its actual signing certificate; debug and release signing keys may require separate registrations. Until the Liquid Glass OAuth client is configured, Google sign-in in that edition will report as unavailable; password sign-in and all other customer workflows remain unaffected.

## UI

Standard retains its current presentation. Liquid Glass uses Android-native `expo-blur` overlays on the top and bottom navigation on Android 12+, with translucent fallback on older Android, plus frosted translucent cards, edge highlights and ambient colour fields. Text, prices, forms, legal content and financial/service records remain readable.

CI produces two independent, self-contained arm64 release-variant Maestro test APK artifacts when the relevant Android paths change. These are test artifacts, not signed Play Store releases. The current main CI run may legitimately skip both Android jobs when Android paths are unchanged. Production signing, OAuth registrations for the release certificates, push delivery credentials and physical-device acceptance remain separate release-readiness tasks.
