# QuantaEdge Notification Studio — Dealership Adaptation

## Reference implementation

QuantaEdge files to use as the behavioural and security reference:
- Rich editor: apps/web/app/components/NotificationStudio.tsx
- Content validator: services/api/src/main/java/com/quantaedge/api/NotificationContentValidator.java
- Campaign service: services/api/src/main/java/com/quantaedge/api/RichNotificationService.java
- Android transport: services/api/src/main/java/com/quantaedge/api/AndroidPushService.java
- Product contract: docs/product/rich-notification-platform-contract.md

Use the design patterns and contracts; do not copy the education identity model. Dealership recipients are customers and staff. All data access is scoped to the authenticated dealership.

## Adapted design

- Versioned provider-neutral JSON with strict block allow-list; no executable HTML or JavaScript.
- Blocks for hero, rich text, image, vehicle card, service/job card, highlight, CTA and footer.
- Visual Design Studio and Logo & Graphics workspace; only validated raster media is uploaded.
- Versioned templates; historical versions and campaign content snapshots are immutable.
- Server-resolved audience preview; exclusions only remove from an eligible audience.
- Short-lived single-use preview proof binds sender, content, audience and exclusions.
- Idempotent campaign creation; durable inbox records; immutable audit events and delivery attempts.
- In-app notification is the source of truth; Android push is a separate transport attempt.
- Provider failure never removes the in-app record; delivery status is never overstated.
- Android device tokens are account-bound, revocable and protected at rest.
- Sensitive job/invoice content is not placed in lock-screen payloads.
- SMS, WhatsApp Business and email are added only after consent, credentials, template approvals, provider costs and compliance controls are confirmed.

## Initial event triggers

Appointment created/confirmed/rescheduled/cancelled; vehicle checked in; estimate awaiting approval; work status changed; bike ready for collection; invoice/receipt created; delivery feedback request; approved service-due reminder; complaint updated/resolved; staff-only assignments and restricted low-stock alerts.

Do not invent service schedules or OEM eligibility. Reminders use verified dates and approved dealership policy.

## Current implementation status

The initial schema and content validator are present. Campaign APIs, preview proof, editor UI, server-side audience resolver, dispatch/outbox worker, inbox APIs and Firebase Cloud Messaging adapter are not yet complete. Schema presence is not proof of functional notification delivery.
