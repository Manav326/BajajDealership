# QuantaEdge — Bajaj Dealership Management System

**Customer:** Lucky Bajaj Agency  
**Software provider:** QuantaEdge  
**Initial scope:** One outlet handling both new-bike sales and servicing  
**Delivery target:** 12–16 weeks, subject to team capacity and external dependencies

A connected dealership management system with an owner/staff web portal, a customer website, and an Android customer app. All clients share one secure Spring Boot API and PostgreSQL database.

## Product roadmap

### Phase 1 — Requirements, UX and architecture (Weeks 1–2)
- Freeze workflows, screen map, role/permission matrix, data model, API contracts and acceptance tests.
- Define customer vs staff identity and vehicle ownership.
- Audit QuantaEdge Notification Studio and adapt its provider-neutral rich-content contract to dealership workflows.
- Confirm Bajaj/OEM access, payment/tax scope and outbound messaging providers.
- Exit gate: every quoted feature has a specification and observable acceptance criteria.

### Phase 2 — Secure foundation (Weeks 3–4)
- Bootstrap ReactJS web app, Spring Boot REST API, PostgreSQL and Flyway.
- Implement authentication, server-enforced RBAC, audit events, validation/error conventions, secure media storage and health endpoints.
- Add CI/build/test checks, environment configuration and secret handling.
- Rehearse database backup and restore.
- Exit gate: clean database migration and secure test deployment pass.

### Phase 3 — CRM, sales and vehicle inventory (Weeks 5–7)
- Customer profiles/preferences, enquiries, test rides, bookings and follow-ups.
- Vehicle models/units, stock receipt, chassis/engine identity where applicable, reservation, allocation, finance/document tracking and delivery.
- Owner dashboard and initial reconciliation reports.
- Exit gate: enquiry-to-delivery journey passes without duplicate or contradictory records.

### Phase 4 — Workshop and spare parts (Weeks 8–10)
- Appointment/walk-in, check-in, inspection, estimates and customer approval.
- Job cards, technician assignment, status transitions, parts issue/return, quality check, billing and handover.
- Suppliers, purchase/receipt, stock ledger, reorder rules and parts valuation.
- Exit gate: end-to-end service journey passes with accurate stock movements and traceable approvals.

### Phase 5 — Billing, staff and Notification Studio (Weeks 11–12)
- Operational invoices/receipts, payment allocations, partial payments, refunds/adjustments, expenses, dues and daily closing.
- Attendance, work allocation, permission-aware staff views and audit trails.
- Notification Studio: rich block editor, Logo & Graphics workspace, Hindi/English copy, templates/versioning, audience review, exclusions, preview, approval, scheduling, delivery history, retries and cancellation.
- Durable in-app inbox and Android push interface.
- Exit gate: financial reconciliation and notification campaign lifecycle pass acceptance tests.

### Phase 6 — Customer website and Android app (Weeks 13–14)
- Customer account, linked bikes, appointments, permitted service progress/history, available invoices/receipts, feedback and notification inbox.
- React Native Android client using the same API; device registration, permission handling and secure deep links.
- Exit gate: customer workflows match between web and Android; account switching does not leak another customer's records.

### Phase 7 — Acceptance, hardening and launch (Weeks 15–16)
- Security, role isolation, responsive UI, performance, migrations and backup recovery tests.
- Failure/retry tests for payments, stock movements and notifications.
- End-to-end tests with synthetic data; no real customer notifications during QA.
- Staff training, deployment checklist and go-live approval.
- Exit gate: no release-blocking defects, critical workflows pass, reports reconcile, backups restore, acceptance is recorded.

## Quoted product features

| Module | Purpose |
|---|---|
| Owner dashboard | Sales, service workload, collections, dues, expenses, stock alerts and staff activity |
| Customer CRM | Contact preferences, linked vehicles, enquiries, visits, service history and complaints |
| Bike sales | Enquiries, test rides, bookings, allocation, finance/document tracking, invoices and delivery |
| Vehicle inventory | Models, individual vehicle identifiers, stock lifecycle and reservation controls |
| Workshop | Appointments, inspection, estimates, approval, job cards, assigned work, quality checks and handover |
| Spare parts | Suppliers, purchasing, stock ledger, issue/return, damage, reorder levels and valuation |
| Billing/operational accounts | Invoices/receipts, partial payments, cash/UPI/bank records, refunds, expenses and daily closing |
| Staff and permissions | Individual logins, roles, attendance/leave, task allocation, approved incentives and audit |
| Customer website and Android app | Appointments, vehicle/service records, authorised job status, notifications and feedback |
| Notification Studio | Visual rich-content editor, graphics/design tools, bilingual templates, audience builder, preview, approval, scheduling, campaign delivery and reports |
| Reports and exports | Sales/service summaries, collections/dues, expenses, stock and staff activity |
| Administration | Settings, access controls, audit, backups, monitoring and recovery |

## Technology baseline

- Web: ReactJS
- Android: React Native, subject to validation of native requirements and build tooling
- Backend: Java / Spring Boot REST API
- Database: PostgreSQL
- Schema: additive Flyway migrations; never rewrite a released migration
- API: REST + JSON, documented contracts and consistent error responses
- Hosting: conventional HTTPS website/API hosting, protected media storage, monitoring and tested backups

Start as a modular monolith. All clients share one API and one source of truth. Do not introduce microservices until measured usage justifies them.

## Notification Studio: adapt QuantaEdge, do not duplicate it blindly

Adapt QuantaEdge's provider-neutral rich-content approach:
- Versioned JSON blocks, a strict validator and safe renderer; no executable HTML or JavaScript.
- Hero, rich text, images, vehicle/service cards, CTA, badges and footer.
- Logo & Graphics design workspace with validated raster export.
- Versioned templates and immutable campaign snapshots.
- Server-resolved audience review and a short-lived, single-use send-preview proof.
- Idempotent campaign creation, durable inbox, audit events and delivery attempts.
- In-app delivery first; Android push via server-side Firebase configuration.
- Scheduling, bounded retry, token revocation and honest delivery/failure status.
- SMS, WhatsApp Business and email only after provider, consent, approval and price are confirmed.

Do not copy QuantaEdge's student, parent, institution, course or HRMS identity rules. Create dealership-specific customer/staff roles and vehicle/job access. Provider failure must not erase an in-app notification or be reported as successful delivery.

## Core business journeys

**Sales:** enquiry → optional test ride → booking → vehicle allocation → documents/finance status → invoice/payment record → delivery → customer/vehicle link.

**Workshop:** appointment or walk-in → check-in → inspection/estimate → customer approval → assigned job → parts movement → repair → quality inspection → invoice/payment → delivery → feedback/reminder.

**Parts:** purchase/order → received/checked → available → reserved/issued → consumed/returned/damaged/adjusted with actor, reference and reason.

Validate transitions on the server and audit them. Cancellations and refunds adjust records; they do not silently delete completed transactions.

## Non-negotiable quality gates

- Server-enforced roles and customer-record isolation.
- No duplicate payments, sales, stock movements or notification recipients after retries.
- Database transactions and constraints for critical business state.
- Traceable stock ledger and financial history.
- Rich-content/media validation and internal-route or approved HTTPS-only links.
- Audience resolved on the server; browser-provided counts and IDs are never authority.
- Template versioning and cancellation before scheduled dispatch.
- Honest, recoverable provider failures.
- Web/Android workflow parity and responsive layout tests.
- Fresh/upgraded DB migration tests, API integration tests, web build, Android build and end-to-end tests.
- Restore a backup in a rehearsal; do not merely verify that a backup file exists.
- Use synthetic QA users; never send outbound messages to real customers in tests.

## External dependencies and exclusions

- Bajaj warranty, service coupon, claims, inventory and dealer APIs are not assumed to exist. Report official submission only after an authorised integration confirms it.
- The quoted accounts scope covers operational billing, collections, expenses and reconciliation. Full double-entry accounting, live gateway processing, GST/e-invoicing integrations and tax advice need explicit scope if required.
- In-app notifications are core. Android push requires Firebase configuration. SMS, WhatsApp Business and email require provider credentials, consent/template controls and usage budgets.
- Third-party fees, legacy-data migration, additional outlets/users and bespoke integrations are separate unless the signed agreement includes them.

## Repository and delivery rules

1. Keep implementation aligned with the accepted Lucky Bajaj / QuantaEdge quotation.
2. Make small, reviewable commits. Do not call a feature complete until acceptance evidence exists.
3. Never hard-code credentials or commit service-account files.
4. Maintain docs/IMPLEMENTATION_PLAN.md and docs/NOTIFICATION_STUDIO_REUSE.md as detailed companion documents.
5. Record migrations, test commands/results, known gaps and next steps in the implementation journal.
6. This roadmap describes planned work; it is not evidence that features are implemented.
