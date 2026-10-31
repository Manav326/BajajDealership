# QuantaEdge Notification Studio — Dealership Adaptation

**Status reconciled:** 31 October 2026  
**Detailed product status:** [PRODUCT_STATUS.md](PRODUCT_STATUS.md)

## Design reference

The dealership implementation adapts the rich content, media, preview and approval patterns from QuantaEdge. It does not copy education-specific identity authorization. The dealership audience is customers and staff, and every API operation derives dealership scope from the authenticated principal.

## Current implementation

- Versioned JSON rich-content document with a strict block allow-list and unsafe markup/URL rejection.
- Staff editor and renderer for supported hero, text, image, CTA, vehicle/service, highlight, badge, icon, divider, spacer and footer blocks.
- Private PNG/JPEG upload with size/type/dimension checks and media authorization.
- Immutable template versions; edits create a new version rather than overwriting history.
- Server-resolved staff/customer audience, marketing-consent filter, selected-only audience, exclusions, audience preview and recipient-set snapshot.
- Short-lived hashed preview proof and content fingerprint; approval requires the current content and eligible audience to match the preview.
- Explicit persisted approval by a staff member with notification.approve before send or scheduling.
- Campaign history, schedule/cancel, exact saved preview, Send now, dispatch-attempt state, audit and retry status.
- Durable in-app recipient/inbox rows and delivery-attempt records; staff and customer inbox APIs/UIs support paging, unread count, read/unread and dismiss.
- Controller-level permissions for notification read/create/send/approve and private media access; client-side controls are supplementary only.

## API contract

- GET /api/v1/admin/notifications/options
- GET /api/v1/admin/notifications/templates
- POST /api/v1/admin/notifications/templates
- PUT /api/v1/admin/notifications/templates/{publicId} — creates a new immutable version
- GET /api/v1/admin/notifications/recipients?kind=CUSTOMER|STAFF&query=...
- POST /api/v1/admin/notifications/preview
- POST /api/v1/admin/notifications/campaigns/{publicId}/approve — requires notification.approve and an unexpired preview token
- POST /api/v1/admin/notifications/send — requires persisted APPROVED status
- GET /api/v1/admin/notifications/campaigns
- GET /api/v1/admin/notifications/campaigns/{publicId}/preview — exact persisted content plus privacy-safe audience/eligibility summary
- POST /api/v1/admin/notifications/campaigns/{publicId}/send-now — requires notification.send
- POST /api/v1/admin/notifications/campaigns/{publicId}/cancel
- GET /api/v1/admin/notifications/inbox
- POST /api/v1/admin/notifications/inbox/{recipientPublicId}/read
- POST /api/v1/admin/notifications/inbox/{recipientPublicId}/unread
- POST /api/v1/admin/notifications/inbox/{recipientPublicId}/dismiss
- POST /api/v1/admin/notifications/inbox/read-all
- POST /api/v1/admin/notifications/media and GET /api/v1/admin/notifications/media/{assetId}

The backend validator and permission checks are authoritative. Do not use a client-supplied dealership ID as an authorization boundary.

## Scheduled dispatch and Send now reliability

- The scheduled worker polls at a configurable interval (15 seconds by default).
- Due campaigns are claimed using database row locking with skip-locked semantics. Each due campaign runs in its own transaction so one malformed or ineligible campaign does not roll back unrelated campaigns in the batch.
- Dispatch attempts, next retry time and sanitized failure class are persisted. Automatic retries are bounded (maximum five attempts); a terminal failure can be reviewed/retried manually through the authorized Send now action when eligible.
- Send now shares the scheduler's transaction/locking boundary. A manual Send now racing the scheduler produces one durable in-app delivery, not duplicate recipient rows.
- Saved preview returns the saved rich-content document and privacy-safe summary of the original/current eligible audience. Send now verifies approved content fingerprint, expiry, current state and current audience eligibility again.
- Cancellation, expiry, zero eligible recipients, retry exhaustion and failed manual dispatch are represented as explicit states/audit events.

The service-level integration suite includes saved preview, Send now once/replay, expiry, concurrent manual/scheduled dispatch, isolated campaign failure in a batch and persisted retry-state cases. The latest Notification Studio browser regression run on baseline 6941940 passed (run 41164397291).

## Delivery semantics and external channels

A campaign marked SENT means the durable in-app recipient/inbox records were persisted. It does **not** mean Firebase push, SMS, email or WhatsApp was delivered.

- The in-app inbox is the durable first channel; staff and customer portal inbox experiences exist.
- Firebase Cloud Messaging still requires configured service credentials, device registration lifecycle and real-device delivery proof. FCM push is not enabled by this implementation status.
- Meta/WhatsApp have separate provider-specific implementations documented in SOCIAL_MEDIA_STUDIO.md. They remain disabled by default until credentials, account permissions, webhook/public-media validation and authorized provider E2E acceptance pass.
- SMS and email provider integrations are not implemented/configured.
- Provider failures must never delete durable in-app inbox records. External retries must be channel-specific and idempotent; uncertain provider outcomes must not be blindly resent.
- CI uses synthetic test identities and never sends real customer messages.

## Remaining work before production use

- Run real-backend customer and staff inbox journeys, role-denial checks and device acceptance against the production-like deployment.
- Configure FCM in a test Firebase project and prove actual push delivery before enabling push.
- Keep the API always available and monitor scheduled dispatch, retry exhaustion and stuck campaigns. The free Render preview sleeps and cannot provide a delivery-time SLA.
- Add media retention/orphan cleanup and operational monitoring policy.
- Run the exact Social Studio provider acceptance separately from the in-app notification tests.
- Confirm the campaign dispatch/query patterns and retry policy under the intended production scale.

Do not mark this module production-ready solely because its UI, API or integration tests exist. Require exact-head CI, production-like runtime acceptance and operational ownership for dispatch monitoring.
