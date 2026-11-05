# Lucky Bajaj versioned releases

## Release model

Lucky Bajaj uses one stable semantic-version tag for all desktop and Android packages:

- Tag format: `vMAJOR.MINOR.PATCH` (for example `v0.2.0`).
- The tag points to the exact source commit used for every package.
- The release workflow validates the production origins, builds the two Android editions and Windows desktop installers, calculates SHA-256 checksums, uploads to an unpublished GitHub draft, verifies the uploaded assets, then publishes the release.
- Published releases are immutable in the workflow. Do not replace a published version; create the next semantic version.

The current app-config baseline is `0.2.0`, so the intended first versioned release is `v0.2.0`, provided the release prerequisites below are complete and the tagged commit passes all required CI.

## Release assets

Each stable release contains:

- `LuckyBajaj-Android.apk` — Standard customer app, signed, arm64-v8a.
- `LuckyBajaj-LiquidGlass-Android.apk` — Liquid Glass customer app, signed, arm64-v8a.
- `LuckyBajajDesktopSetup.exe` — Windows staff desktop installer.
- `LuckyBajajDesktop.msi` — Windows Installer package.
- Build metadata JSON for each platform.
- `SHA256SUMS.txt` — SHA-256 checksums for all four binary packages.
- `release-manifest.json` — version, source commit, public origins and package inventory.

Android packages are signed with the dedicated Lucky Bajaj upload keystore. These are signed sideload APKs, not Play Store AAB submissions. Windows EXE/MSI packages are intentionally unsigned in this initial release workflow; they must be described as controlled-pilot installers until Authenticode signing is configured. Do not disable Windows SmartScreen or other security protections.

## Required GitHub Actions configuration

Repository variables:

| Name | Value |
|---|---|
| `BAJAJ_API_BASE_URL` | `https://api-luckybajaj.quantaedge.in/` |
| `BAJAJ_CUSTOMER_WEB_URL` | `https://luckybajaj.quantaedge.in` |

The workflow rejects non-canonical/Render origins. The values above are also the source defaults.

Create a dedicated Lucky Bajaj Android upload keystore and store a secure offline backup. Never commit the keystore or paste its passwords into a chat or issue. Configure these four repository Actions secrets:

- `BAJAJ_ANDROID_SIGNING_KEYSTORE_BASE64` — Base64 of the binary JKS/PKCS12 keystore.
- `BAJAJ_ANDROID_SIGNING_KEYSTORE_PASSWORD`
- `BAJAJ_ANDROID_SIGNING_KEY_ALIAS`
- `BAJAJ_ANDROID_SIGNING_KEY_PASSWORD`

Keep the same upload keystore for every update of both Android package IDs. Losing or changing this key prevents ordinary in-place updates of APKs signed with the previous certificate.

After creating the keystore, register the signing certificate SHA-1 fingerprint for both Android OAuth clients:
- Standard: package `com.quantaedge.luckybajaj`.
- Liquid Glass: package `com.quantaedge.luckybajajlg`.

Configure the corresponding Android OAuth client IDs in the Lucky Bajaj API environment. A valid web OAuth client alone does not establish Android sign-in for these packages.

## Create and publish a release

1. Merge/commit the intended release source to `main`; ensure the latest CI, Android emulator regression and browser regression runs succeed on that exact commit.
2. Confirm the Android signing secrets and production Actions variables are configured.
3. From a clean checkout, create and push the version tag. For the first planned release:

   ```powershell
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   git tag -a v0.2.0 -m "Lucky Bajaj v0.2.0"
   git push origin v0.2.0
   ```

4. Follow the **Release Lucky Bajaj** workflow in GitHub Actions. It must finish all three package jobs and publish only after uploaded asset names, sizes and SHA-256 digests are verified.
5. Verify the release page and download/check `SHA256SUMS.txt` before installing.

For a retry, use workflow dispatch with the existing unpublished draft's tag. The workflow refuses to mutate a published release. Never reuse a published version tag.

## Version-code mapping

Android `versionName` is derived from the tag. Android `versionCode` is derived as:

`major * 1,000,000 + minor * 1,000 + patch`

For example, `v0.2.0` becomes versionCode `2000`. This ensures increasing version codes for normal semantic-version increments and avoids reusing the current internal test code.

## Separate release gates

This workflow does not claim Google Play or Microsoft Store publication:

- Google Play distribution still requires Play Console setup, Play App Signing/AAB policy, OAuth registration and store review. The current release workflow publishes signed arm64 APKs only.
- Windows packages remain unsigned. Configure an Authenticode signing certificate and add a signature-verification release gate before describing them as trusted public installers.
- Physical-device acceptance, customer/sales/workshop business acceptance, backup restoration, monitoring and visual/accessibility acceptance remain separate operational gates.
