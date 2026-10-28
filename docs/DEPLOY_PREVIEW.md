# Public preview deployment — Lucky Bajaj Agency

This repository includes a Render Blueprint at `render.yaml`. It describes three public HTTPS services and one PostgreSQL database:

- **Staff web portal** — React/Vite static site.
- **Customer website** — React/Vite static site.
- **Spring Boot API** — Docker web service.
- **PostgreSQL** — relational database; Flyway applies repository migrations at API startup.

The web clients receive the API URL at build time through `VITE_API_BASE_URL`. The API CORS allowlist is linked to the exact public origins Render assigns to those two sites. The database host, port, database, user and password are supplied through Render's database references, not committed credentials.

## One-time setup in Render

1. Sign in to Render using the account that should own the preview environment.
2. Choose **New → Blueprint**, connect `Manav326/BajajDealership`, choose the `main` branch, and select the root `render.yaml`.
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

## Publish the Android app against the hosted API

The Android CI build already accepts the GitHub Actions repository variable `BAJAJ_API_BASE_URL`; by default, it points to the local mPAY/LAN development address `http://192.168.31.47:8080/`. That LAN URL is **not publicly reachable** and must not be used in a hosted/customer build.

After the API is deployed:

1. Open GitHub → **Settings → Secrets and variables → Actions → Variables** for this repository.
2. Create/update the repository variable `BAJAJ_API_BASE_URL` with the actual HTTPS API URL ending in `/`, using the URL shown by Render followed by a slash.
3. Re-run the Android build workflow. Confirm its build summary reports the hosted HTTPS API URL before distributing that APK.

Local development continues to use the existing mPAY/LAN default; do not change it to the Render URL unless you intentionally want local builds to use the remote preview database.

## Important: preview only, not production

This Blueprint intentionally uses free-tier resources to provide a low-cost preview. Render documents that free web services spin down after 15 minutes without traffic and free PostgreSQL databases expire 30 days after creation. The free web filesystem is ephemeral, so private notification media uploaded to the API container is not durable.

- Do **not** enter real customer, employee, motorcycle chassis/engine, payment or service records in this preview.
- Do **not** treat a manually recorded payment as a verified bank/UPI settlement.
- Before production, move to an appropriate paid database plan with backups, paid/warm backend capacity, durable private object storage for notification media, a backup-restore rehearsal and monitoring.
- Keep the database private; only web/API services should access it.
- Public website URLs do not make authenticated pages or private API records public; API permission and dealership-isolation checks still apply.

References: [Render Blueprint specification](https://render.com/docs/blueprint-spec), [Render free-tier limitations](https://render.com/docs/free), and [Render static sites](https://render.com/docs/static-sites).
