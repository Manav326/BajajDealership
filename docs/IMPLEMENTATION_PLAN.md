# Implementation Plan — Lucky Bajaj Agency

**Provider:** QuantaEdge  
**Scope:** one outlet for bike sales and service; owner/staff web portal, customer website and Android app.  
**Status:** active implementation. The root README is the roadmap and current scope/status source.

## Delivered foundation and tested slices

- Spring Boot API, PostgreSQL, additive Flyway migrations and GitHub Actions CI with an actual PostgreSQL service.
- Staff login using dealership code + email/mobile + password; hashed bearer sessions, server-side revocation, password hashing, login-attempt throttling, one-time owner bootstrap and role/permission checks.
- Dealership-specific customer list/search/create/update, validation, marketing-consent source handling, explicit consent-change audit and tests for cross-dealership isolation.
- Vehicle model and individual-unit inventory; unique chassis/engine references; expected stock is not available stock until a receiving action; append-only stock movement events; receiving is transactional and tested.
- Notification block-document validator; private PNG/JPEG upload and integrity checks; immutable template versions; customer/staff audience resolution; marketing-consent filter; selected-recipient and exclusion modes; one-time, expiring preview proof; idempotent send request; scheduled campaign dispatcher; durable in-app recipient records; staff inbox read/unread/dismiss APIs; campaign and notification audit.
- React web sign-in; responsive owner shell; customer and inventory screens; Notification Studio with block editing, template save/versioning, audience selection/preview, scheduling/send, campaign history and Logo & Graphics export/upload.
- CI checks for backend tests and Flyway migrations against PostgreSQL plus React typecheck/production build.

## Immediate validation focus

1. Keep latest-head CI green after role-aware Notification Studio changes.
2. Finish the in-app staff inbox interface and verify unread counts, mark-read, dismiss, and dealership/user isolation.
3. Add security and integration tests for template version history, preview expiry, stale audience changes, cancellation/scheduling races, media access and role denial.
4. Re-check notification APIs for transaction boundaries and safe error handling before enabling real campaigns.

## Next business vertical slice: workshop intake

Implement a complete thin vertical slice before building many disconnected forms:
1. Appointment create/list/detail with status, customer and owned vehicle references, preferred slot, customer concern, source and requested language.
2. Server checks that both customer and vehicle belong to the signed-in dealership and that the vehicle has a valid ownership/history relationship.
3. Check-in creates one job card transactionally; repeated check-in requests must not duplicate cards.
4. Inspection checklist and estimate revisions; capture explicit approval/decline with actor, timestamp and revision.
5. Job assignment and state transitions validated on the server; quality check required before completion/handover.
6. Persisted audit trail, API contract tests and realistic negative-path tests before the frontend is marked done.
7. Keep spare-parts consumption disabled until job-card reservation/issue/return ledger and concurrent stock protection are implemented.

## Follow-on vertical slices

- Sales: enquiry -> test ride -> booking -> reservation -> documents/finance tracking -> invoice/payment allocations -> delivery and customer/vehicle ownership.
- Parts: supplier/purchase -> receiving -> stock ledger -> job-card reservation/issue/return -> valuation and reorder threshold.
- Finance: operational invoice/receipt, partial payment, refunds/adjustments, expenses, due balances, daily close and reconciliations.
- Customer web/Android: authenticated ownership-scoped appointments, service status/history, invoices, feedback and the durable customer inbox.
- Production: responsive and accessibility audit for each route/component, API permission matrix review, performance/retry tests, secure deployment, backup restore rehearsal and staff acceptance.

## Release gates

- Every DB change uses an additive Flyway migration; never rewrite a released migration or reset production data.
- Every query and write is dealership-scoped from the authenticated principal, not client-provided IDs.
- Customer/vehicle/job ownership is enforced in service logic and relational constraints.
- All state transitions are transactionally guarded and audited; high-risk writes are idempotent.
- Role-denial tests cover every mutation route. UI hiding improves UX but never replaces API authorization.
- Tests use synthetic identities only; no external messages are sent by CI.
- External sends report delivery only when that provider confirms it. Durable in-app records are not erased on provider failure.
- Verify fresh migrations, existing-schema upgrade, backups and restore before any production rollout.
- Feature status remains in progress until integration tests and user acceptance demonstrate its full business journey.

## Explicit external dependencies

Bajaj/OEM APIs, live payment gateway, GST/e-invoicing and WhatsApp/SMS/email providers require approved access, credentials, contractual scope, pricing and compliance checks. No internal record may be represented as an official OEM submission or provider-confirmed delivery.
