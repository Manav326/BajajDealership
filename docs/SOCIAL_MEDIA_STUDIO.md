# Social Media Studio — implementation and release boundary

**Status reconciled:** 31 October 2026  
**Tracking:** [Issue #9](https://github.com/Manav326/BajajDealership/issues/9)  
**Creative editor backlog:** [Issue #45](https://github.com/Manav326/BajajDealership/issues/45)

The repository contains both a browser-local creative workspace and backend/provider workflows for external channels. They are distinct capabilities and neither should be described as proof that live Meta/WhatsApp accounts are connected.


Tracked implementation: [Issue #9](https://github.com/Manav326/BajajDealership/issues/9)

## Scope and current boundary

The Social Media Studio sits beside the existing staff Notification Studio. LogoGraphicsLab and Notification Studio remain the internal rich-notification tools; they must not be conflated with external social posts. The current Creative Studio stores projects/resources in this browser's IndexedDB and optional local folder. It is not a central shared staff library.

The browser-local artwork composer and named project/resource storage are implemented as a local editing/export slice:
- platform/placement presets with explicit pixel dimensions;
- editable dealership brand, headline, supporting message, call-to-action, caption and hashtags;
- optional campaign photo and brand/accent colours;
- live canvas preview, PNG/JPEG download and caption copy;
- browser-native share-sheet handoff when supported, with manual download/copy fallback;
- named drafts stored in this browser's IndexedDB, with load/update/delete and photo persistence;
- clear UI copy that export/share handoff does not publish automatically or send messages.

Artwork composition in this slice stays local to the browser. It does not upload campaign photos, store external credentials, or send customer messages.

## Channel contracts

### Meta account connection foundation now in code

The backend now has a disabled-by-default Meta OAuth connection foundation: a 10-minute random state whose hash is persisted and consumed once; an allowlisted, server-configured completion URL; server-to-server authorization-code and long-lived-token exchange; AES-GCM encryption of provider tokens with a required 32-byte Base64 key; dealership-scoped Page/Instagram destination records; and an audit trail that excludes tokens and provider response bodies. Owner/Manager roles receive dedicated `social_media.read` and `social_media.manage` permissions. A `SOCIAL_MEDIA_COORDINATOR` role lets an Owner assign another staff member permission to view destinations, publish posts, manage recorded WhatsApp consent, and send approved templates, without allowing that staff member to connect or disconnect Meta accounts. This role is available through the existing Staff Management role selector. Provider credentials and a real Meta app are not configured in this repository by default, so connection remains unavailable until explicit deployment configuration is supplied. Staff actions remain controlled by the authenticated dealership scope and role permissions. Do not claim the flow is production-verified until it passes Meta app review/configuration and authorized-account E2E testing. The staff Meta panel now lists the exact missing or invalid environment-variable names separately for account connection and direct publishing. It never returns secret values. The API responds with an explicit configuration error when an action requires an unset key; it does not silently pretend the feature is ready.

The WhatsApp workspace likewise reports missing messaging and webhook configuration keys independently. Configure the API environment from the root `.env.example`; local Compose forwards these settings into the API container. Meta and WhatsApp remain disabled by default, and no test or preview environment should use live provider credentials.

### Facebook / Instagram

Publish through official Meta APIs only. First supported vertical slice should target Facebook Page posts and eligible Instagram professional-account feed publishing. Account linking must use an authenticated OAuth state/CSRF flow; the server stores encrypted credentials, maps provider account IDs to the authenticated dealership, and checks destination permissions. Access tokens never reach the browser or logs. Publishing results are only successful after provider confirmation and must persist the external post ID and status.

Media delivery is a deployment concern: Meta must be able to fetch media from an accessible URL. The publishing path serves assets from the existing API through short-lived HMAC-signed URLs. By default, image bytes are stored in the existing PostgreSQL database, so storage is shared across API instances and no separate paid object-storage service is required. This uses database capacity, so keep campaign images small and maintain normal database backup/retention. Filesystem mode remains for local development only because hosted free web-service filesystems can be ephemeral. Existing bare local-disk asset keys remain readable in filesystem mode.

### WhatsApp Business messaging

The implementation now includes dealership-scoped customer consent records, Meta-approved template discovery, sequential body-placeholder validation, optional image headers, idempotent single-recipient sends, signed delivery webhooks and inbound opt-out handling. Each send rechecks that the saved opt-in matches the customer's current E.164 phone. Dynamic text headers and button-bearing templates are rejected until their parameter workflows are implemented. Provider acceptance is distinct from sent/delivered/read/failed status. WhatsApp Status stays on manual export/share. Live provider end-to-end validation still requires an authorized test WABA and a consented internal recipient.

This deployment intentionally uses one WhatsApp Business account and phone number for the Lucky Bajaj dealership. Staff with the relevant WhatsApp permissions can use that shared connection; the provider token stays on the backend, and each request is scoped to the authenticated staff member's dealership and permissions. Per-dealership credential management for a multi-dealership deployment is out of scope unless the product scope changes.

### WhatsApp Status

Do not advertise direct Status publishing from the server unless a supported official publishing API is verified and available for this use. The initial behavior is export and native share/download handoff.

## Required platform-neutral lifecycle

1. Draft and save editable artwork/caption.
2. Choose channel and actual connected destination; show channel-specific preview/validation.
3. Resolve eligible audience for messaging destinations; require consent and exclusions checks.
4. Show a final preview and capture explicit authorized approval.
5. Create an idempotent publishing/message job. Report accepted, published, sent, delivered and failed states distinctly.
6. Store provider IDs, safe diagnostic code, attempted times and audit events. Verify webhook signatures and make webhook processing idempotent.
7. Use bounded retries only where safe; don't retry an uncertain post-creation request blindly if doing so could duplicate a public post.

## Delivery phases

- **Phase 1 — artwork foundation:** channel format presets, editable branded composer, PNG export and caption copy. No external API calls.
- **Phase 2 — Meta publishing:** JPEG upload, short-lived HMAC-signed media URLs, idempotent Facebook Page photo posts, Instagram media-container processing/polling, provider-confirmed job status and safe handling of uncertain outcomes are implemented in code. The feature remains disabled until a real Meta app, credentials, app review/permissions, authorized destination and provider E2E are configured and accepted; production media bytes use the existing persistent PostgreSQL database by default.
- **Phase 3 — WhatsApp:** single-recipient approved-template sends, consent/opt-out records, optional image headers, idempotency and signed delivery webhooks are implemented behind server configuration. Remaining work for this single-dealership deployment is authorized-provider E2E testing, plus review of bulk/audience controls and an explicit preview/approval workflow if those features are approved for scope. Owner/Manager can configure or disconnect the Meta connection; staff assigned the `SOCIAL_MEDIA_COORDINATOR` role can publish and send approved WhatsApp templates but cannot change the connected Meta account.
- **Phase 4 — operations:** durable scheduled queues, database-backed idempotency, lock-based dispatch, audit, permissions, delivery-status reconciliation and safe handling of uncertain provider outcomes are implemented. Do not blindly retry a request that may already have created a public post or sent a message.

## Configuration and release gates

Keep provider secrets out of source control and browser responses. Provider message delivery and publishing are allowed operating costs when configured and authorized; the application does not require a separate paid media-storage service. Production sending/publishing remains disabled until provider credentials, account permissions, privacy/security review, webhook verification, persistence/capacity checks for the existing PostgreSQL database and end-to-end acceptance are complete. CI must use fake accounts and provider mocks; no live posts/messages are permitted in tests.

## Current implementation checkpoint

- [x] GitHub tracking issue created.
- [x] Work branch created: feature/issue-9-social-media-studio.
- [x] Add browser-local composer, format presets, PNG/JPEG download, caption copy and share-sheet handoff (CI validation pending).
- [x] Add named IndexedDB drafts with load, update, delete and optional photo persistence (browser-local, not synced across staff devices).
- [x] Confirm web typecheck/build and CI for the implementation revisions. Current main's exact-head Notification browser suite passed; the dedicated Social Studio browser suite last passed on an earlier main commit and must be rerun after relevant Social Studio changes.
- [x] Add disabled-by-default Meta OAuth/account-discovery foundation and account-token encryption (provider E2E still pending configuration).
- [x] Add Facebook Page photo posts and Instagram feed media-container publishing with expiring signed media URLs, idempotent jobs and status polling (live Meta E2E still pending).
- [x] Add dealership-scoped Meta disconnect: attempt provider permission revocation, disable local destinations and clear locally stored token ciphertext; report when Meta does not confirm remote revocation.
- [x] Add filesystem/database storage behind the signed media route; PostgreSQL is the default shared store and filesystem mode remains for local development.
- [ ] Confirm the existing production PostgreSQL database is persistent and has sufficient capacity; validate image put/read/delete and signed-URL fetching.
- [x] Persisted, auditable publishing approval/rejection workflow with a dealership-scoped review queue; an authenticated private artwork preview must load before approving.
- [x] Backend-scheduled Meta publishing (2-minute minimum lead, 90-day horizon), lock-based dispatch, audited stale-lock recovery and no-blind-retry handling for uncertain outcomes.
- [x] Backend-scheduled WhatsApp sends with lock-based dispatch, manager-only cancellation while still scheduled, current opt-in/phone/template and current-role revalidation, webhook delivery states, and audited safe uncertain-outcome recovery.
- [ ] Complete authorized-account E2E tests and destination disconnect/revocation.
- [x] Add WhatsApp template sends, channel-specific opt-in/opt-out, approved-template parameter checks, optional image headers, idempotency and HMAC-verified webhooks (live provider E2E still pending).
- [x] Add unit coverage for exact WhatsApp webhook HMAC verification, altered request bodies, missing/invalid signatures, disabled configuration and webhook challenge tokens.
- [x] Keep one centrally configured WhatsApp Business connection for the Lucky Bajaj dealership; provider credentials remain backend-only.
- [x] Add the assignable `SOCIAL_MEDIA_COORDINATOR` staff role for social publishing and consent-checked WhatsApp messaging without Meta connection administration; integration test verifies permissions are present in the activated staff session.
- [ ] Keep WhatsApp Status on manual share/export unless an officially supported publishing API is verified.


## Current release interpretation

- **Implemented in code:** browser-local drafts and assets; Meta OAuth/state/token encryption and destination management; approval-controlled Facebook Page photo publishing and Instagram feed processing; signed media URLs and database-backed media; WhatsApp consent/opt-out records, approved-template send validation, idempotent scheduling/sends and signed webhooks.
- **Disabled or unverified:** the checked-in Render Blueprint sets Meta and WhatsApp feature flags to false. No provider credentials or authorized production account are assumed. Do not present a provider as connected or a post/message as delivered until the corresponding provider response/webhook proves it.
- **WhatsApp Status:** export/share handoff only. Do not claim server-side Status publishing.
- **Creative Studio:** project/resource data are browser-local (IndexedDB and optional local folder). The extensive editor/timeline/render/download completion checklist is tracked separately in issue #45 and is not a prerequisite claim that the provider backend is fully live.
- **Release gate:** configure an authorized test Meta app, Facebook Page, eligible Instagram professional account, test WABA and consented internal recipient. Validate OAuth, destination mapping, media fetch, approval, publish/send, callbacks/webhooks, retry/uncertain state and disconnect/revocation before enabling any live feature flag.
