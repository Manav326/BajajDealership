-- Campaign dispatch retry visibility, backoff and bounded automatic retry support.
alter table notification_campaign
  add column dispatch_attempt_count integer not null default 0 check (dispatch_attempt_count >= 0),
  add column last_dispatch_attempt_at timestamptz,
  add column next_dispatch_attempt_at timestamptz,
  add column last_dispatch_error varchar(300);
create index ix_notification_campaign_due_retry
  on notification_campaign(status, scheduled_at, next_dispatch_attempt_at, id)
  where status = 'SCHEDULED';
