# Implementation Plan — Lucky Bajaj Agency

Provider: QuantaEdge  
Scope: one outlet for bike sales and service; staff web portal, customer website and Android app.  
Status: active implementation; root README is the authoritative roadmap.

## Current implementation slice

- React web shell with responsive owner dashboard and API health indicator.
- Spring Boot REST API with a health endpoint and secure-by-default authorization rules.
- PostgreSQL/Flyway foundation for dealership, staff/roles, customers, vehicle models/units, ownership history and audit events.
- Notification core schema for templates, campaigns, durable recipients, delivery attempts, private media metadata, device registrations, audit and transactional outbox.
- Rich notification JSON validator adapted from the QuantaEdge Notification Studio contract, with unit tests.
- CI for backend unit tests and React web production build.

## Next vertical slice

Implement staff/customer authentication and server-enforced permissions. Then add customer CRUD and vehicle registry endpoints with service-layer validation, pagination, dealership scoping, audit records and integration tests. Business endpoints remain denied until their access policy is implemented.

## Release gates

- Migrations apply on a clean PostgreSQL database and supported upgrades without destructive resets.
- Security tests cover unauthenticated access, role denial and customer/dealership isolation.
- Sales, inventory and financial writes are transactional and idempotent where retries are possible.
- Notification audience/preview is resolved server-side; provider failures never remove the durable inbox.
- Tests use synthetic identities and do not send real outbound notifications.
- Reports reconcile with persisted business records.
- A backup is restored in a rehearsal; exact-head CI and end-to-end acceptance evidence is required.
