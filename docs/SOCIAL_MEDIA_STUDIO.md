# Social Media Studio — implementation design and resume checkpoint

Tracked implementation: [Issue #9](https://github.com/Manav326/BajajDealership/issues/9)

## Scope and current boundary

The Social Media Studio is being added beside the existing staff Notification Studio. The existing LogoGraphicsLab and Notification Studio remain the foundation for internal rich notifications; they must not be conflated with external social posts.

The first vertical slice is a browser-local artwork composer:
- platform/placement presets with explicit pixel dimensions;
- editable dealership brand, headline, supporting message, call-to-action, caption and hashtags;
- optional campaign photo and brand/accent colours;
- live canvas preview, PNG/JPEG download and caption copy;
- browser-native share-sheet handoff when supported, with manual download/copy fallback;
- named drafts stored in this browser's IndexedDB, with load/update/delete and photo persistence;
- clear UI copy that export/share handoff does not publish automatically or send messages.

Artwork composition in this slice stays local to the browser. It does not upload campaign photos, store external credentials, or send customer messages.

## Channel contracts

### Facebook / Instagram

Publish through official Meta APIs only. First supported vertical slice should target Facebook Page posts and eligible Instagram professional-account feed publishing. Account linking must use an authenticated OAuth state/CSRF flow; the server stores encrypted credentials, maps provider account IDs to the authenticated dealership, and checks destination permissions. Access tokens never reach the browser or logs. Publishing results are only successful after provider confirmation and must persist the external post ID and status.

Media delivery is a deployment concern: Meta may need to fetch media from an accessible URL. Existing notification media is private and on the preview app filesystem, so do not reuse it as a permanent public URL. Design signed, short-lived media access or durable object storage as a separate, audited publishing asset path.

### WhatsApp Business messaging

Use the official WhatsApp Business Platform / Cloud API for outbound messaging, not a generic social-post endpoint. Keep message templates, media components, opt-in/opt-out, policy/template constraints, provider message IDs and webhook-backed delivery statuses distinct from in-app notifications.

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
- **Phase 2 — Meta publishing:** Meta app prerequisites, account connection, Facebook Page photo/text posts, Instagram feed publishing, provider confirmation and disconnection/revocation.
- **Phase 3 — WhatsApp:** Cloud API setup, approved templates, media support, consent/opt-out, message status webhooks and explicit channel approval.
- **Phase 4 — operations:** scheduled jobs, outbox/idempotency, bounded retries, status reconciliation, audit, permissions and production media storage.

## Configuration and release gates

Keep provider secrets out of source control and browser responses. Production sending/publishing remains disabled until provider credentials, account permissions, privacy/security review, webhook verification, durable media storage and end-to-end acceptance are complete. CI must use fake accounts and provider mocks; no live posts/messages are permitted in tests.

## Current implementation checkpoint

- [x] GitHub tracking issue created.
- [x] Work branch created: feature/issue-9-social-media-studio.
- [x] Add browser-local composer, format presets, PNG/JPEG download, caption copy and share-sheet handoff (CI validation pending).
- [x] Add named IndexedDB drafts with load, update, delete and optional photo persistence (browser-local, not synced across staff devices).
- [ ] Confirm web typecheck/build and full CI on the latest revision.
- [ ] Implement and test Meta account connection/publishing.
- [ ] Implement and test WhatsApp Business messaging; keep Status on manual share/export unless official API capability is verified.
