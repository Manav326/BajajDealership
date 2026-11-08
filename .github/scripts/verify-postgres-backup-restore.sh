#!/bin/sh
set -eu

: "${POSTGRES_USER:=bajaj_app}"
: "${POSTGRES_DB:=bajaj_dealership}"
restore_db="bajaj_restore_verify_$$"
backup_file="/tmp/bajaj-ci-backup-$$.dump"
marker="bajaj-ci-backup-restore-$$"

cleanup() {
  dropdb --if-exists -U "$POSTGRES_USER" "$restore_db" >/dev/null 2>&1 || true
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "DROP TABLE IF EXISTS public.ci_backup_restore_probe" >/dev/null 2>&1 || true
  rm -f "$backup_file"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE TABLE IF NOT EXISTS public.ci_backup_restore_probe (
  id integer PRIMARY KEY,
  marker text NOT NULL
);
DELETE FROM public.ci_backup_restore_probe;
INSERT INTO public.ci_backup_restore_probe (id, marker) VALUES (1, '$marker');
SQL

createdb -U "$POSTGRES_USER" "$restore_db"
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-acl --file "$backup_file"
test -s "$backup_file"
pg_restore -U "$POSTGRES_USER" -d "$restore_db" --no-owner --no-acl "$backup_file"

source_migrations="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
  "SELECT count(*) FROM flyway_schema_history WHERE success")"
restored_migrations="$(psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM flyway_schema_history WHERE success")"
if [ "$source_migrations" != "$restored_migrations" ] || [ "$restored_migrations" -lt 1 ]; then
  echo "Migration history changed during backup/restore: source=$source_migrations restored=$restored_migrations" >&2
  exit 1
fi

source_tables="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
restored_tables="$(psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
if [ "$source_tables" != "$restored_tables" ] || [ "$restored_tables" -lt 1 ]; then
  echo "Public table count changed during backup/restore: source=$source_tables restored=$restored_tables" >&2
  exit 1
fi

restored_marker="$(psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc \
  "SELECT marker FROM public.ci_backup_restore_probe WHERE id=1")"
if [ "$restored_marker" != "$marker" ]; then
  echo "Backup/restore data marker mismatch: expected=$marker restored=$restored_marker" >&2
  exit 1
fi

echo "PostgreSQL backup/restore verified: $source_migrations migrations, $source_tables public tables, and the CI data marker survived restoration."
