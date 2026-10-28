-- Make campaign approval a persisted, auditable state before send/schedule.
alter table notification_campaign
  drop constraint notification_campaign_status_check;

alter table notification_campaign
  add constraint notification_campaign_status_check
  check (status in ('DRAFT', 'PREVIEWED', 'APPROVED', 'SCHEDULED', 'QUEUED', 'PROCESSING',
    'SENT', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED', 'EXPIRED'));

alter table notification_campaign
  add column approved_by_staff_user_id bigint,
  add column approved_at timestamptz,
  add constraint fk_notification_campaign_approver_same_dealership
    foreign key (dealership_id, approved_by_staff_user_id)
    references staff_user (dealership_id, id),
  add constraint ck_notification_campaign_approval_actor
    check (approved_at is null or approved_by_staff_user_id is not null);

create index ix_notification_campaign_approved
  on notification_campaign (dealership_id, approved_at desc)
  where approved_at is not null;
