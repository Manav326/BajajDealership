# Implementation Plan — Lucky Bajaj Agency

**Provider:** QuantaEdge  
**Scope:** one outlet for bike sales and service; owner/staff web portal, customer website and Android app.  
**Status:** active implementation. The root README is the roadmap and status source.

## Delivered foundation and tested slices

- Spring Boot API, PostgreSQL, additive Flyway migrations and GitHub Actions CI against a real PostgreSQL service.
- Staff login with dealership code + email/mobile + password; hashed bearer sessions, server-side revocation, password hashing, login-attempt throttling, one-time owner bootstrap and role/permission checks.
- Dealership-scoped customer list/search/create/update, validation, marketing-consent source handling, audit records and tests for cross-dealership isolation.
- Vehicle model and individual-unit inventory; unique chassis/engine references; explicit expected-stock receiving; append-only stock-movement history. Consumable spare parts use separate SKU/balance/receipt/movement tables and never share motorcycle-unit stock rows.
- Rich-notification validator; private PNG/JPEG upload and integrity checks; immutable templates; server-resolved customer/staff audience; consent-filtered marketing audience; selected-only recipients/exclusions; expiring one-time preview proof; idempotent send request; scheduling/cancellation; durable in-app records/inbox; read/unread/dismiss endpoints; audit.
- React web sign-in, owner shell, customer workspace, vehicle inventory workspace, Notification Studio editor/template/version/preview/scheduling UI, Logo & Graphics raster export/upload, and a topbar in-app inbox with unread badge.
- Workshop intake and quality: create/list/confirm/cancel appointment; verify current dealership-scoped customer/vehicle ownership; check-in exactly once into a job card; create seven inspection items; require completed checklist before estimate; immutable estimate revisions with line totals/discount; record customer decision evidence; technician assignment before work; only assigned quality inspector can pass quality check.
- Workshop web workspace for appointment search/create/check-in, job-card queue, inspection checklist, estimate revision/decision capture, technician assignment, start-work, quality-check, invoice issue, partial-payment receipts, reversals and receiver-acknowledged paid handover. Billing uses the existing BillingOperationsService and a single controller route set; receipts are manual operational records, not evidence of payment-provider settlement.
- Integration tests for migrations, authentication, customer consent/isolation, vehicle inventory receiving, notification contracts/inbox, workshop check-in idempotency, inspection completion, estimate calculations/revisions, approval evidence, technician assignment, quality-check gates, operational invoice issue, partial payment/idempotency, reversal history, balance enforcement and acknowledgement-backed handover, plus spare-part receipt retries/weighted-average cost, reservation/issue/return/release quantities, partial-release accounting and cross-dealership isolation.
- CI runs backend tests/migrations with PostgreSQL and TypeScript/React production build. Verify the latest run result before calling a newer commit green.

## Immediate validation work

1. Keep CI green on the latest commit after spare-part selector, permission-denial tests and responsive workspace are all included.
2. Add concurrent spare-stock tests for same-SKU receipt/reservation/issue races, duplicate idempotency keys and transaction rollback on rejected quantities.
3. Add controller-level authorization tests for every workshop mutation and for parts read/manage/receive/reserve/issue/return boundaries.
4. Integrate issued/returned part-cost snapshots into a *new* estimate revision. No issued part may silently rewrite an approved estimate or issued invoice; customer decision evidence remains mandatory.
5. Complete concurrent workshop tests for duplicate check-in, estimate submissions, decisions, quality checks and invoice/payment/handover races.
6. Harden Notification Studio concurrent approval/send/cancel semantics, scheduled cancel races, media access and preview freshness. Keep external providers disabled until configured and tested.

## Implemented slice: spare-parts stock and job-card operations

- Delivered: separate SKU catalogue and supplier records; purchase receipts with line-level unit cost; weighted-average cost; on-hand/reserved/available balances; dealership-scoped stock movements with before/after quantities and actor; receipt idempotency/fingerprint; job-card reservation, issue, return and release endpoints; one idempotency namespace for reservation operations; explicit quantity released; responsive web screens for catalogue, supplier receipt, movement history, and job-card parts; route permission-denial tests.
- Safety semantics: reserve only for approved/in-progress jobs, issue/return only while in progress, reject over-reservation/over-issue/over-return, make retry with the same key/payload replay the original result, reject changed payloads, and separate consumables from individual bike-unit inventory.

## Delivered slice: costed part reservation snapshots on estimate revisions

- An estimate PART line may reference a reservation on that same job card and dealership. The service locks the reservation, verifies the expected quantity and SKU description are still current, then snapshots reserved/issued/returned/released quantities, reservation cost basis and snapshot time.
- The customer-facing selling price is entered independently; the internal stock-cost snapshot does not set the selling price. Issuing a reservation requires a matching current approved estimate line; returns/releases that change the quantity snapshot prevent further issue until a new estimate revision is approved.
- Invoice creation rechecks all nonzero planned reservations against the active approved estimate revision and rejects unpriced/new reservations or changed returned/released quantities before an invoice snapshot is created.
- A new revision can be submitted while work is approved/in progress; the job pauses in AWAITING_APPROVAL, and the decision resumes the previous active status. Prior revisions and their decisions remain auditable; when a new revision is approved, an older approved revision is marked SUPERSEDED. Issued invoices remain snapshots and are not silently changed.
- Integration coverage verifies the reservation snapshot, different internal cost vs customer price, approval behavior and resumption of IN_PROGRESS.

## Delivered slice: spare-parts reorder policy

- Each SKU has a low-stock threshold and reorder-to target, both stored with the dealership-scoped balance. A zero threshold disables alerting.
- The low-stock list compares available quantity (on-hand minus reserved) to the threshold and computes suggested order quantity as max(target minus available, 0).
- The workspace exposes policy editing and low-stock alerts only to users who already have parts read/manage permissions; backend authorization remains authoritative.

## Next business vertical slice: stock-operation concurrency and reconciliation

1. Extend concurrency coverage from reservations to same-SKU receipts, issue, return and release, including idempotency keys reused by different staff sessions and transaction rollback after an unavailable-stock race.
2. Complete reconciliation of reserved/issued/returned/released part quantities against approved estimate lines when stock changes after a decision. Require a new estimate revision rather than mutate an approved estimate or issued invoice.
3. Add scheduled reorder notifications only after confirming delivery channel, recipient scope, permissions and operational budgets. Keep CI notifications internal and synthetic.
4. Defer supplier payables, inventory accounting journals, refunds/credit notes and statutory tax treatment until rules and authorization are agreed.

## Follow-on finance controls

- Credit notes/refunds/adjustments with separate authority and append-only reversal history.
- Daily cash/UPI/bank reconciliation against external statements. Manual receipt records do not indicate a gateway transaction was verified.
- GST/e-invoicing only after the correct legal entity, registration data, tax rules and approved provider integration are defined and tested.

## Follow-on vertical slices

- Finance: refunds/credit notes, payment-provider verification, reconciliation and tax/e-invoicing after legal and provider requirements are confirmed.
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
