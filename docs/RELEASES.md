# Lucky Bajaj versioned releases

## Release model

Lucky Bajaj uses one stable semantic-version tag for all desktop and Android packages:

- Tag format: `vMAJOR.MINOR.PATCH` (for example `v0.2.0`).
- The tag points to the exact source commit used for every package.
- The release workflow validates the production origins, builds the two Android editions and Windows desktop installers, calculates SHA-256 checksums, uploads to an unpublished GitHub draft, verifies the uploaded assets, then publishes the release.
- Published releases are immutable in the workflow. Do not replace a published version; create the next semantic version.

The initial stable tag `v0.2.0` has been allocated to the first release attempt. Because that attempt failed validation and the tag is immutable, the next source commit will receive `v0.2.1` after CI and the release preflight pass.

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

## Centralized deployment configuration

The only production endpoint source of truth is `config/deployment.json`. It identifies the production topology as the local Docker stack exposed through Cloudflare Tunnel and stores the API, customer website and staff portal origins together. The Standard Android app, Liquid Glass app, release workflow, desktop release workflow and Windows release/deployment publisher all read this file. The CI validator rejects malformed origins and stale Render hostnames under `apps/`.

When a production hostname changes, update `config/deployment.json` once. Do not separately edit Android defaults, release-workflow environment variables or the Windows publisher. The customer website uses its same-origin Nginx `/api` proxy in Docker, so it does not need a second hard-coded public API URL. Local development can still override Android endpoints through `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_CUSTOMER_WEB_URL.

Create a dedicated Lucky Bajaj Android upload keystore and store a secure offline backup. Never commit the keystore or paste its passwords into a chat or issue. Configure these four repository Actions secrets:

- `BAJAJ_ANDROID_SIGNING_KEYSTORE_BASE64` — Base64 of the binary JKS/PKCS12 keystore.
- `BAJAJ_ANDROID_SIGNING_KEYSTORE_PASSWORD`
- `BAJAJ_ANDROID_SIGNING_KEY_ALIAS`
- `BAJAJ_ANDROID_SIGNING_KEY_PASSWORD`

Keep the same upload keystore for every update of both Android package IDs. Losing or changing this key prevents ordinary in-place updates of APKs signed with the previous certificate.

After creating the keystore, register the signing certificate SHA-1 fingerprint for both Android OAuth clients:
- Standard: package `com.quantaedge.luckybajaj`.
- Liquid Glass: package `com.quantaedge.luckybajajlg`.

Configure the corresponding IDs in the Lucky Bajaj API environment:
- `GOOGLE_ANDROID_CLIENT_ID` — Standard Android OAuth client.
- `GOOGLE_ANDROID_LIQUID_GLASS_CLIENT_ID` — Liquid Glass Android OAuth client.
- `GOOGLE_WEB_CLIENT_ID` — shared web OAuth client.

Before deploying a stable release, run `scripts/publish-luckybajaj-release.ps1` from the authorized Windows machine. It calls `/api/v1/customer/auth/google/config` for both package IDs and requires both the web and matching Android clients. This check runs from the owner's terminal because Cloudflare can return HTTP 403 to GitHub-hosted runner traffic.

## Gated versioning and publishing

The **Publish Lucky Bajaj after green main CI** workflow is explicitly dispatched by the Windows publisher. It is not an automatic `workflow_run` listener, because the live Google OAuth check must first succeed from the owner's network (GitHub-hosted runners can receive Cloudflare HTTP 403 responses).

1. The publisher verifies GitHub CLI access, all four Android signing-secret names, and the hosted Standard and Liquid Glass web/Android OAuth configuration from the Windows machine.
2. It waits for the main **CI** workflow to complete successfully for the exact current `main` commit.
3. Only after those checks pass, it dispatches the version-allocation workflow with that exact source SHA.
4. The workflow independently confirms that `main` has not advanced, confirms a successful push-triggered CI run for that SHA, loads and validates the canonical Cloudflare origins from `config/deployment.json`, and confirms all four Android signing secrets are populated.
5. With no stable tags, it bootstraps from `apps/android/app.config.ts`; later releases increment the patch version. The tag is never moved or overwritten.
6. It explicitly dispatches **Release Lucky Bajaj** for that tag. That workflow builds the two upload-keystore-signed Android APKs plus Windows EXE/MSI, verifies all nine expected assets and SHA-256 checksums, uploads a draft, then marks it published only after verification.
7. The publisher verifies the public release and only then deploys the exact `sha-<commit>` GHCR images and checks the public download API.

The public download service reads GitHub's latest stable published release. It deliberately rejects drafts, prereleases and incomplete asset sets. Therefore, a successful Docker image deployment by itself cannot make APKs available: the stable GitHub Release must be published before the web download cards can expose them.

For a recovery or manual retry, open **Actions → Release Lucky Bajaj → Run workflow** and provide an existing stable tag whose release is still an unpublished draft. The workflow refuses to overwrite a published release. The normal one-command publisher runs the OAuth preflight before dispatching version allocation.

After publication, verify the release page and SHA-256 checksums before installing. Customer and staff download cards discover only a complete published stable release; draft assets and partial releases are never offered.

## One-command Windows release verification and deployment

From the repository root in PowerShell:

```powershell
git pull --ff-only origin main
.\scripts\publish-luckybajaj-release.ps1
```

The script loads production endpoint origins from `config/deployment.json`, then verifies the current `main` commit, GitHub CLI access, the four repository Actions secret names, and both hosted Android Google OAuth configurations. It waits for CI, automatic version allocation and the stable release; then it verifies all four binaries, three build-metadata files, checksums and manifest.

By default it deploys the exact `sha-<commit>` GHCR images using the existing local `compose.edge.yaml` overlay, then checks the local services, Cloudflare customer/staff sites, public release status and all four byte-range download endpoints. Use `-SkipDeployment` to verify a published release without changing local containers.

The script deliberately does not stage, stash, reset, clean or commit local files. It does not edit `.env` or `compose.edge.yaml`, change secrets, create/move tags, restart PostgreSQL or the Cloudflare tunnel, or delete/recreate Docker volumes. The local untracked `compose.edge.yaml` must remain present for tunnel-aware deployment.

## Version-code mapping

Android `versionName` is derived from the tag. Android `versionCode` is derived as:

`major * 1,000,000 + minor * 1,000 + patch`

For example, `v0.2.0` becomes versionCode `2000`. This ensures increasing version codes for normal semantic-version increments and avoids reusing the current internal test code.

## Separate release gates

This workflow does not claim Google Play or Microsoft Store publication:

- Google Play distribution still requires Play Console setup, Play App Signing/AAB policy, OAuth registration and store review. The current release workflow publishes signed arm64 APKs only.
- Windows packages remain unsigned. Configure an Authenticode signing certificate and add a signature-verification release gate before describing them as trusted public installers.
- Physical-device acceptance, customer/sales/workshop business acceptance, backup restoration, monitoring and visual/accessibility acceptance remain separate operational gates.
