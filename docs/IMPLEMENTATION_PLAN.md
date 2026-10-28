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
- Workshop intake and quality: create/list/confirm/cancel appointment; verify current dealership-scoped customer/vehicle ownership; check-in exactly once into a job card; create seven inspection items; require completed checklist before estimate; immutable estimate revisions with line totals/discount; record customer decision evidence; technician assignment before work; only assigned quality inspector can pass quality check.
- Workshop web workspace for appointment search/create/check-in, job-card queue, inspection checklist, estimate revision/decision capture, technician assignment, start-work, quality-check, invoice issue, partial-payment receipts, reversals and receiver-acknowledged paid handover. Billing uses the existing BillingOperationsService and a single controller route set; receipts are manual operational records, not evidence of payment-provider settlement.
- Integration tests for migrations, authentication, customer consent/isolation, inventory receiving, notification contracts/inbox, workshop check-in idempotency, inspection completion, estimate calculations/revisions, approval evidence, technician assignment, quality-check gates, invoice issue, partial payment/idempotency, reversal history, balance enforcement and acknowledgement-backed handover.
- CI runs backend tests/migrations with PostgreSQL and TypeScript/React production build. Verify the latest run result before calling a newer commit green.

## Immediate validation work

1. Keep CI green on the exact latest main commit, including the persisted notification approval gate and its permission/audience-drift tests.
2. Review estimate/quality SQL and APIs for concurrent operations, overflow boundaries, role denial, customer-evidence wording and immutable history.
3. Add controller-level authorization tests for every workshop mutation (appointment cancel/check-in, estimate, assignment, start work and quality check).
4. Add robust concurrency tests for duplicate appointment check-in, concurrent estimate submissions, duplicate decisions and quality-check retries.
5. Harden Notification Studio concurrent approval/send/cancel semantics, permission split, scheduled cancel races, media access and preview freshness. Keep external providers disabled until configured and tested.

## Next business vertical slice: workshop spare-parts ledger

1. Inspect and reuse the current bike-unit inventory/stock movement pattern where it fits; do not merge motorcycle-unit stock with consumable spare-part SKUs.
2. Add part SKU/catalogue, supplier references, purchase receipt and a stock movement ledger with quantities, cost basis, actor, timestamp, source reference and idempotency protection.
3. Add job-card part reservation, issue, return and wastage flows. A job cannot consume parts from another dealership, oversell available stock, or issue more than its reservation.
4. Serialize stock-changing transactions per dealership/SKU and add tests for duplicate receipt/issue retries, concurrent issue, return limits and full audit history.
5. Include issued/returned part lines in estimate revisions only through an explicit revision and customer approval; never silently alter an already-approved estimate or issued invoice.
6. Defer valuation methods, accounting journal, supplier payables and formal tax treatment until rules are agreed. No automated OEM or payment-provider submission is implied.

## Follow-on finance controls

- Credit notes/refunds/adjustments with separate authority and append-only reversal history.
- Daily cash/UPI/bank reconciliation against external statements. Manual receipt records do not indicate a gateway transaction was verified.
- GST/e-invoicing only after the correct legal entity, registration data, tax rules and approved provider integration are defined and tested.

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
