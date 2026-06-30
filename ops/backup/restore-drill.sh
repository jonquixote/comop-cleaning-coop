#!/usr/bin/env bash
# Restore the LATEST off-site backup into a SCRATCH database and verify it. The single
# most important line in the spec (impl §3). A failed OR SKIPPED drill exits non-zero and
# pages on-call (std §7). Never touches the working DB.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then set -a; source .env; set +a; fi   # CI sets env directly; local sources .env

: "${SUPERUSER_DATABASE_URL:?}"; : "${APP_DATABASE_URL:?}"; : "${APP_PASSWORD:?}"
: "${BACKUP_PASS:?}"; : "${OFFSITE_REPO:?}"
SCRATCH_DB="${SCRATCH_DB_NAME:-comop_scratch}"
PAGE_CHANNEL="${PAGE_CHANNEL:-stderr}"
COOP_A="00000000-0000-0000-0000-00000000000a"   # seed fixture (ops/fixtures.ts)
SUPER_BASE="${SUPERUSER_DATABASE_URL%/*}"
APP_SCRATCH="${APP_DATABASE_URL%/*}/${SCRATCH_DB}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

page() { echo "PAGE on-call ($PAGE_CHANNEL): restore drill FAILED — $1" >&2; exit 1; }

# 1. latest off-site backup name (skipped/none == failed)
case "$OFFSITE_REPO" in
  rclone:*)  NAME="$(rclone lsf "${OFFSITE_REPO#rclone:}" 2>/dev/null | grep '\.dump\.enc$' | sort | tail -1 || true)" ;;
  s3://*)    NAME="$(aws s3 ls "${OFFSITE_REPO%/}/" 2>/dev/null | awk '{print $4}' | grep '\.dump\.enc$' | sort | tail -1 || true)" ;;
  *)         NAME="$(ls -1 "$OFFSITE_REPO" 2>/dev/null | grep '\.dump\.enc$' | sort | tail -1 || true)" ;;
esac
[ -n "${NAME:-}" ] || page "no off-site backup found (SKIPPED == FAILED)"
echo "latest off-site backup: $NAME"

# 2. pull + decrypt
case "$OFFSITE_REPO" in
  rclone:*)  rclone copy "${OFFSITE_REPO#rclone:}/$NAME" "$TMP" ;;
  s3://*)    aws s3 cp "${OFFSITE_REPO%/}/$NAME" "$TMP/$NAME" ;;
  *)         cp "$OFFSITE_REPO/$NAME" "$TMP/$NAME" ;;
esac
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASS -in "$TMP/$NAME" -out "$TMP/restore.dump" \
  || page "decrypt failed (bad backup or wrong key)"

# 3. restore into a FRESH scratch DB (NEVER the working DB)
psql "$SUPER_BASE/postgres" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\""
psql "$SUPER_BASE/postgres" -q -c "CREATE DATABASE \"$SCRATCH_DB\""
pg_restore --no-owner -d "$SUPER_BASE/$SCRATCH_DB" "$TMP/restore.dump" \
  || page "pg_restore failed"

# 4a. verify row counts (as superuser — sees all rows)
psql -v ON_ERROR_STOP=1 "$SUPER_BASE/$SCRATCH_DB" -f ops/backup/verify-suite.sql \
  || page "row-count verification failed on restored DB"

# 4b. verify RLS STILL ISOLATES on the restored DB (as app_user, tenant context = co-op A)
PGPASSWORD="$APP_PASSWORD" psql -v ON_ERROR_STOP=1 -v A="$COOP_A" "$APP_SCRATCH" -f ops/backup/verify-rls.sql \
  || page "RLS isolation verification failed on restored DB"

# 5. clean up scratch
psql "$SUPER_BASE/postgres" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\""
echo "restore drill PASSED: $NAME restored to scratch, row counts + RLS isolation verified"
