-- Add optional password-login usernames and a verified Google identity to each dealership-scoped customer account.
-- Existing accounts and sessions remain valid; null usernames/Google identities preserve legacy login paths.

alter table customer_portal_account
  add column username varchar(40),
  add column google_subject varchar(255),
  add column google_email varchar(320),
  add column google_linked_at timestamptz;

alter table customer_portal_account
  add constraint ck_customer_portal_username_format
    check (username is null or username ~ '^[A-Za-z0-9._-]{3,40}$'),
  add constraint ck_customer_portal_google_identity_complete
    check (
      (google_subject is null and google_email is null and google_linked_at is null)
      or
      (google_subject is not null and google_email is not null and google_linked_at is not null)
    );

-- Usernames are case-insensitive within a dealership. Existing accounts have null usernames.
create unique index uq_customer_portal_username
  on customer_portal_account (dealership_id, lower(username))
  where username is not null;

-- One Google identity/email may belong to only one customer portal account in a dealership.
create unique index uq_customer_portal_google_subject
  on customer_portal_account (dealership_id, google_subject)
  where google_subject is not null;

create unique index uq_customer_portal_google_email
  on customer_portal_account (dealership_id, lower(google_email))
  where google_email is not null;

comment on column customer_portal_account.username is
  'Optional case-insensitive customer-selected username; null preserves legacy customer-code login.';
comment on column customer_portal_account.google_subject is
  'Google OIDC subject from a server-verified ID token; unique per dealership.';
comment on column customer_portal_account.google_email is
  'Verified Google email from the ID token, stored separately from editable CRM contact email.';
