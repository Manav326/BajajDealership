# Implementation Plan — Lucky Bajaj Agency

**Provider:** QuantaEdge  
**Scope:** one outlet for bike sales and service; owner/staff web portal, customer website and Android app.  
**Status:** active implementation. The root README is the roadmap and status source.

## Delivered foundation and tested slices

- Spring Boot API, PostgreSQL, additive Flyway migrations and GitHub Actions CI against a real PostgreSQL service.
- Staff login with dealership code + email/mobile + password; hashed bearer sessions, server-side revocation, password hashing, login-attempt throttling, one-time owner bootstrap and role/permission checks.
- Dealership-scoped customer list/search/create/update, validation, marketing-consent source handling, audit records and tests for cross-dealership isolation.
- Vehicle model and individual-unit inventory; unique chassis/engine references; explicit expected-stock receiving; append-only stock-movement history.
- Rich-notification validator; private PNG/JPEG upload and integrity checks; immutable templates; server-resolved customer/staff audience; consent-filtered marketing audience; selected-only recipients/exclusions; expiring one-time preview proof; idempotent send request; scheduling/cancellation; durable in-app records/inbox; read/unread/dismiss endpoints; audit.
- React web sign-in, owner shell, customer workspace, vehicle inventory workspace, Notification Studio editor/template/version/preview/scheduling UI, Logo & Graphics raster export/upload, and a topbar in-app inbox with unread badge.
- Workshop intake: create/list/confirm/cancel appointment; verify current dealership-scoped customer/vehicle ownership; check-in exactly once into a job card; create seven inspection items; checklist edits; require completed inspection before estimate; immutable estimate revisions with calculated line totals/discount; record approval/decline/revision request with evidence method/reference; technician assignment before work; only assigned quality inspector can complete the quality check.
- Workshop web workspace for appointment search/create/check-in, job-card queue, inspection checklist, estimate revisions/decision capture, technician assignment, start-work and quality-check UI. Final handover remains blocked pending billing/payment integration.
- Integration tests for migrations, authentication, customer consent/isolation, inventory receiving, notification contracts/inbox, workshop check-in idempotency, inspection completion, estimate calculations/revisions, approval evidence, technician assignment and quality-check gates.
- CI runs backend tests/migrations with PostgreSQL and TypeScript/React production build. Verify the latest run result before calling a newer commit green.

## Immediate validation work

1. Keep CI green on the exact latest main commit, including the persisted notification approval gate and its permission/audience-drift tests.
2. Review estimate/quality SQL and APIs for concurrent operations, overflow boundaries, role denial, customer-evidence wording and immutable history.
3. Add controller-level authorization tests for every workshop mutation (appointment cancel/check-in, estimate, assignment, start work and quality check).
4. Add robust concurrency tests for duplicate appointment check-in, concurrent estimate submissions, duplicate decisions and quality-check retries.
5. Harden Notification Studio concurrent approval/send/cancel semantics, permission split, scheduled cancel races, media access and preview freshness. Keep external providers disabled until configured and tested.

## Next business vertical slice: billing integration for workshop

1. Add an operational invoice snapshot linked to job card and the approved estimate revision (but do not assume estimate totals are a tax invoice).
2. Add invoice lines, tax/discount adjustments only after requirements are confirmed, customer-visible invoice numbering, issue/cancel/credit-note lifecycle, and audit history.
3. Add payment allocations with idempotency key and gateway/reference, partial-payment support, refunds/adjustments and balances due.
4. Gate READY_FOR_COLLECTION to invoiced/paid or explicitly authorised payment terms; then allow delivery/handover with customer, vehicle, staff and timestamp recorded.
5. Add daily cash/UPI/bank reconciliation and integration tests. No live gateway processing is enabled until credentials and scope are approved.

## Follow-on vertical slices

- Workshop spare parts: supplier/purchase -> receipt -> stock ledger -> reservation/issue/return against job card -> valuation and reorder thresholds.
- Sales: enquiry -> test ride -> booking -> vehicle reservation -> documents/finance -> invoice/payment allocation -> delivery and customer/vehicle ownership.
- Customer website/Android: account sign-in, verified current vehicle ownership, appointment requests, allowed job status, invoices/receipts, feedback and durable customer inbox.
- Production: route/component responsive and accessibility audit, permission matrix review, performance/retry tests, secure hosting, backup restore rehearsal, staff training and acceptance.

## Release gates

- Every DB change uses an additive Flyway migration; never rewrite a released migration or reset production data.
- Every query/write derives dealership scope from the authenticated principal, not client-supplied dealership IDs.
- Customer/vehicle/job relationships are enforced both in service logic and relational constraints.
- State transitions are validated, transactional and audited; high-risk writes are idempotent.
- Role-denial tests cover every mutation route. UI hiding supplements but never replaces API authorization.
- CI uses synthetic identities only and never sends external notifications.
- “Sent” external delivery means provider-confirmed delivery. Durable in-app records survive transport failure.
- Fresh migrations, supported schema upgrades, backup and restore must pass before production rollout.
- A module remains in progress until integration tests and real user acceptance cover the full business journey.

## Explicit external dependencies

Bajaj/OEM APIs, live payment gateway, GST/e-invoicing and WhatsApp/SMS/email providers require approved access, credentials, contractual scope, pricing and compliance checks. No internal record may be represented as an official OEM submission or provider-confirmed delivery.
