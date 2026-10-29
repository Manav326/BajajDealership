-- Keep publishing images in the existing PostgreSQL service; no external storage account is required.
-- Campaign art is bounded to 4.5 MB per image by the upload API and this schema.
create table social_media_object_storage (
  storage_key varchar(340) primary key,
  content_type varchar(100) not null check (content_type = 'image/jpeg'),
  content bytea not null,
  byte_length bigint not null check (byte_length between 1 and 4500000),
  created_at timestamptz not null default now(),
  constraint ck_social_media_object_storage_length
    check (octet_length(content) = byte_length),
  constraint ck_social_media_object_storage_key
    check (storage_key like 'db/%')
);
create index ix_social_media_object_storage_created
  on social_media_object_storage (created_at desc);
