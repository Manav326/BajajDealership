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

## Next business vertical slice: costed parts on estimate revisions

1. Add reservation/issue/return line snapshots to the estimate-building view, including quantity actually used, returned quantity, and the agreed stock cost basis. A reservation is not the same as consumption.
2. Allow staff to explicitly include consumable parts as priced estimate lines. Create a new revision when the proposed parts/labour mix changes; preserve every previous revision and decision.
3. Require customer approval of the revised total before continuing work where the change exceeds the previously approved estimate; never silently mutate an approved estimate or issued invoice.
4. Test race conditions for simultaneous receipts/reservations/issues on one SKU, duplicate operation keys across staff sessions, stock constraints, idempotent retries and rollback on rejected operations.
5. Add low-stock thresholds and reorder reporting only after the base ledger and estimate linkage are verified. Supplier payables, inventory accounting and tax treatment remain separate follow-on work.

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
