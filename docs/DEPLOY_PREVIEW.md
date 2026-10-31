# Public preview deployment — Lucky Bajaj Agency

**Documentation reconciled:** 31 October 2026  
**Related status:** [PRODUCT_STATUS.md](PRODUCT_STATUS.md)

## Current public URLs

The dealership owner has confirmed the following Render preview deployments:

- **Staff portal:** https://lucky-bajaj-staff-web.onrender.com/
- **Customer website:** https://lucky-bajaj-customer-web.onrender.com/
- **API:** https://lucky-bajaj-api.onrender.com

The URLs below are the project's documented Render preview targets, not a declaration that the services are currently healthy, that they run the latest main commit, or that the environment is production-ready. A repository/source audit does not replace a live smoke test. Keep real customer, vehicle, employee and financial data out of the free preview until the hosting/data-retention limitations are addressed.

This repository includes the Render Blueprint at `render.yaml`. It describes three public HTTPS services and one PostgreSQL database:

- **Staff web portal** — React/Vite static site.
- **Customer website** — React/Vite static site.
- **Spring Boot API** — Docker web service.
- **PostgreSQL** — relational database; Flyway applies repository migrations at API startup.

The web clients receive the API URL at build time through `VITE_API_BASE_URL`. The API CORS allowlist is linked to the exact public origins Render assigns to those two sites. The database host, port, database, user and password are supplied through Render's database references, not committed credentials.

## Render configuration and recovery

1. Sign in to Render using the account that should own the preview environment.
2. If recreating the preview, choose **New → Blueprint**, connect `Manav326/BajajDealership`, choose the `main` branch, and select the root `render.yaml`. For the already-deployed services, inspect the existing service configuration rather than creating duplicate resources.
3. Review the four resources. This Blueprint intentionally uses free preview plans; create the resources only if you accept the temporary-data limitations below.
4. When Render prompts for `APP_BOOTSTRAP_TOKEN`, generate a long random secret, store it in a password manager, and enter it directly in Render. Never commit it or paste it into a public issue/chat.
5. Wait for the API health check and both static-site deployments to pass. Render will show the actual URL for each service in its dashboard; use those assigned URLs rather than guessing from service names.
6. Bootstrap the initial dealership owner once, then remove/rotate `APP_BOOTSTRAP_TOKEN` in the API service environment and redeploy.

## Create the first dealership owner

Send one request to the deployed API. Replace all placeholders locally; do not store the real secret or password in this repository.

```bash
curl --fail-with-body -X POST "https://YOUR-API-URL/api/v1/system/bootstrap" \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Token: YOUR_ONE_TIME_BOOTSTRAP_TOKEN" \
  -d '{
    "dealershipCode": "LUCKYBAJAJ",
    "dealershipName": "Lucky Bajaj Agency",
    "ownerName": "DEALERSHIP_OWNER_NAME",
    "email": "OWNER_EMAIL",
    "phone": "OPTIONAL_PHONE",
    "password": "CHOOSE_A_UNIQUE_PASSWORD"
  }'
```

Use a unique password of 12–72 UTF-8 bytes. Supply an owner email or phone (both are allowed). The dealership code must use letters, numbers, underscores or hyphens and start with a letter or number. Store the owner's credentials securely.

## Build Android against the hosted API

The Android app config and CI workflow now default to `https://lucky-bajaj-api.onrender.com/`. The build summary prints the API base compiled into the APK. Set `BAJAJ_API_BASE_URL` only when intentionally creating a local LAN, emulator or staging build. A physical phone's private LAN URL is not publicly reachable. The API's Render environment also has a separate manual `GOOGLE_ANDROID_LIQUID_GLASS_CLIENT_ID` setting for the `com.quantaedge.luckybajajlg` app; configure the matching Android OAuth client and signing-certificate SHA-1 before enabling Google sign-in in that edition. Standard retains `GOOGLE_ANDROID_CLIENT_ID`.

To intentionally build against a different environment:

1. Open GitHub → **Settings → Secrets and variables → Actions → Variables** for this repository.
2. Set `BAJAJ_API_BASE_URL` to the chosen HTTPS URL ending in `/` (or the local LAN/emulator base for development).
3. Re-run the CI workflow. Confirm its build summary reports the intended API URL before distributing that APK. For the deployed preview, no variable override is required.

Local development can override the default by setting `EXPO_PUBLIC_API_BASE_URL` to the mPAY-style LAN address; only use that when the device and API host can reach one another.

## Important: preview only, not production

This Blueprint intentionally uses free-tier resources to provide a low-cost preview. Render documents that free web services spin down after 15 minutes without traffic and free PostgreSQL databases expire 30 days after creation. The free web filesystem is ephemeral, so private notification media uploaded to the API container is not durable.

- Do **not** enter real customer, employee, motorcycle chassis/engine, payment or service records in this preview.
- Do **not** treat a manually recorded payment as a verified bank/UPI settlement.
- Before production, move to an appropriate paid database plan with backups, paid/warm backend capacity, durable private object storage for notification media, a backup-restore rehearsal and monitoring.
- Keep the database private; only web/API services should access it.
- Public website URLs do not make authenticated pages or private API records public; API permission and dealership-isolation checks still apply.

References: [Render Blueprint specification](https://render.com/docs/blueprint-spec), [Render free-tier limitations](https://render.com/docs/free), and [Render static sites](https://render.com/docs/static-sites).

## Read-only local-stack smoke check

Run this on the same machine where Docker Compose services are running. Defaults match `scripts/start.ps1` and `scripts/start.sh`: customer web `http://localhost:3000`, staff portal `http://localhost:3001`, API `http://localhost:8080`. The script verifies each frontend's same-origin Nginx `/api/` proxy, as the browser uses it:

```bash
node scripts/smoke-test-local.mjs
```

It performs only GET requests and does not log in, mutate records, send notifications/social posts or move money. It checks API health, both static-site HTML shells and their JavaScript/CSS assets, at least ten published Bajaj models, source/date consistency for displayed prices and promotions, Google sign-in configuration, both same-origin API proxies, and unauthenticated customer/staff-data denial. It exits non-zero for any failed check and prints missing configuration explicitly.

Optional host overrides for an environment with different assigned URLs:

```bash
LOCAL_API_URL=http://localhost:8080 \
LOCAL_CUSTOMER_URL=http://localhost:3000 \
LOCAL_STAFF_URL=http://localhost:3001 \
node scripts/smoke-test-local.mjs
```

A passing local result is not production approval. Hosted deployments still require separate public smoke testing. Before applying schema changes to a persistent database, inspect its `flyway_schema_history`.

## Persistent database: read-only Flyway preflight

Before applying the showroom branch to any persistent PostgreSQL database, connect through an approved secure session using the database credentials stored in the hosting dashboard. Do not paste the database URL/password into a GitHub issue or commit it.

First confirm that Flyway history exists:

```sql
SELECT to_regclass('public.flyway_schema_history') AS flyway_history_table;
```

If it returns `public.flyway_schema_history`, inspect the showroom/auth versions and their exact migration filenames/checksums:

```sql
SELECT installed_rank, version, description, script, checksum, installed_on, success
FROM public.flyway_schema_history
WHERE version IS NULL
   OR version IN ('30','31','32','33','34','35','36','37','38','39','40','41')
ORDER BY installed_rank;

SELECT installed_rank, version, description, script, checksum, installed_on
FROM public.flyway_schema_history
WHERE success = false
ORDER BY installed_rank;

SELECT version, count(*) AS history_rows
FROM public.flyway_schema_history
GROUP BY version
HAVING count(*) > 1
ORDER BY version;
```

These queries are read-only. Save their output with the environment name and capture time. A clean CI database passing all 41 migrations does **not** establish the state of this persistent database.

### V30 collision decision

- Current code reserves V30 for `V30__customer_portal_google_identity.sql`; showroom catalogue migrations start at V31 and continue through V41.
- If history shows an earlier showroom V30 script such as `V30__bajaj_public_catalogue.sql`, **stop before deploying**: the current V31 catalogue migration may repeat table/data creation. Do not delete history rows, change checksums, rename old files to disguise the applied migration, or run `flyway repair` as a guess.
- Compare the recorded script/checksum to the exact historical release, verify that the expected catalogue tables/data exist, take a restorable backup, and rehearse a deliberately scoped transition against a database clone. The transition must preserve the old history as evidence and be reviewed against the actual schema/data; it cannot be safely generated without inspecting that target.
- Proceed only after the recorded history and deployed schema agree with the chosen transition plan. If the history is unexpected or contains failed/duplicate entries, keep deployment blocked until reconciled.

Do not run write statements copied from a generic checklist to change `flyway_schema_history`. The transition, if needed, depends on what has actually been applied to that database.


## Current code and rollout boundary

The current main source includes the public showroom, customer portal, sales/workshop/parts workflows, operational finance, server-side licensing and the notification/social capabilities described in PRODUCT_STATUS.md. This does not imply that live Render credentials, migration state, provider accounts, durable storage or end-to-end business acceptance have been verified.

The documented Render Blueprint remains a free preview configuration. Production rollout must use persistent PostgreSQL with backups, an always-available API runtime, durable private media storage, managed secrets, restricted database access, monitoring/alerts and a completed restore rehearsal. Scheduled in-app notifications depend on the API process being available; a sleeping free service cannot provide a delivery SLA.

When recording a live preview/production verification, capture the UTC timestamp, each service URL, API version/commit if exposed, smoke-script output, database migration state and any missing external configuration. Do not write secrets or customer data into the report.
