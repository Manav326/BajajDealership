# QuantaEdge Notification Studio — Dealership Adaptation

## Design reference

QuantaEdge reference files:
- Rich editor: `apps/web/app/components/NotificationStudio.tsx`
- Rich renderer: `apps/web/app/components/RichNotificationRenderer.tsx`
- Logo & Graphics editor: `apps/web/app/components/LogoGraphicsLab.tsx`
- Content validator: `services/api/src/main/java/com/quantaedge/api/NotificationContentValidator.java`
- Campaign service: `services/api/src/main/java/com/quantaedge/api/RichNotificationService.java`
- Android transport: `services/api/src/main/java/com/quantaedge/api/AndroidPushService.java`
- Product contract: `docs/product/rich-notification-platform-contract.md`

This repository adapts the content patterns and design workflow; it does **not** copy education-specific identity authorization. The dealership audience is customers and staff, and each API operation derives dealership scope from the authenticated staff principal.

## Current implementation

- Version 1 JSON content document with strict block allow-list and unsafe-markup/URL rejection.
- Web editor for hero, rich text, image, CTA, vehicle/service card, highlight, badge, icon, divider, spacer and footer blocks.
- Preview renderer uses the protected media API; private PNG/JPEG upload is size/type/dimension checked and file-integrity verified when read.
- Local Logo & Graphics editor composes the graphic and uploads a raster image. It is not an AI logo generator and must not upload arbitrary executable SVG/HTML.
- Immutable template versions; edits create new versions rather than overwriting historical content.
- Server-resolved customers/staff audience, marketing-consent filter, selected-only audience, exclusions, recipient preview, expiring hashed preview proof and request fingerprint.
- Send/schedule/cancel endpoints, idempotency key, scheduled-dispatch worker, campaign history and audit events.
- Durable in-app recipient rows and delivery-attempt records; staff inbox endpoints support paging, unread count, read/unread and dismiss.
- Route-level permissions for read, create, send and approve. Client-side permission-aware controls supplement server enforcement.

## Backend contract

- `GET /api/v1/admin/notifications/options`
- `GET /api/v1/admin/notifications/templates`
- `POST /api/v1/admin/notifications/templates`
- `PUT /api/v1/admin/notifications/templates/{publicId}` — creates a new immutable version
- `GET /api/v1/admin/notifications/recipients?kind=CUSTOMER|STAFF&query=...`
- `POST /api/v1/admin/notifications/preview`
- `POST /api/v1/admin/notifications/send`
- `GET /api/v1/admin/notifications/campaigns`
- `POST /api/v1/admin/notifications/campaigns/{publicId}/cancel`
- `GET /api/v1/admin/notifications/inbox`
- `POST /api/v1/admin/notifications/inbox/{recipientPublicId}/read`
- `POST /api/v1/admin/notifications/inbox/{recipientPublicId}/unread`
- `POST /api/v1/admin/notifications/inbox/{recipientPublicId}/dismiss`
- `POST /api/v1/admin/notifications/inbox/read-all`
- `POST /api/v1/admin/notifications/media` and `GET /api/v1/admin/notifications/media/{assetId}`

The supported content block set and URL rules are enforced by the backend validator; do not treat frontend validation as trusted. Do not pass user-supplied dealership IDs as an authorization boundary.

## Delivery semantics

- The in-app database recipient/inbox record is the durable first channel.
- A campaign marked `SENT` means the in-app recipient records were persisted, not that push/SMS/WhatsApp/email was delivered.
- Android push requires a configured Firebase service identity, device-registration lifecycle, minimal push payload, delivery worker and provider-confirmed status before it is enabled.
- SMS/WhatsApp Business/email require provider credentials, recipient consent, required template approval, budgets and opt-out processing.
- Retriable delivery channels must be separate attempts linked to the durable inbox; a provider failure must never delete an inbox record.
- Scheduled campaigns re-resolve eligibility at dispatch time. Expired previews cannot be sent. A preview change requires a fresh server-generated proof. A send idempotency key must not create duplicate recipients.
- No real customer messages are sent in CI.

## Remaining work before production use

- Complete staff inbox UI and notification badge/unread refresh behavior.
- Complete template-version history and richer asset library/graphics workflow.
- Harden concurrency tests for simultaneous send/cancel, scheduler retries, preview expiry and audience changes.
- Add customer-facing inbox API/UI with ownership-safe customer sessions.
- Configure and end-to-end test FCM before enabling push. Other external channels are not implemented until their providers and consent workflows are explicitly configured.
- Add media cleanup/reconciliation for orphaned private files and DB rows, retention policy and operational monitoring.
- Verify rate limits and audit log access; ensure no message body, token, or private media path is written to logs.

Schema or UI presence alone is not evidence of production readiness. Keep these gaps explicit in the README until each release gate has passing evidence.
