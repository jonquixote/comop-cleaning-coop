#!/usr/bin/env bash
# Encrypted logical backup pushed OFF-BOX (impl §3 floor: off-site + encrypted at rest).
#
# Production PRIMARY is pgBackRest PHYSICAL backups (PITR/WAL, RLS-agnostic) — deferred
# under the spec's staging allowance. This logical backup proves the off-site+restore
# FLOOR now. pg_dump runs as SUPERUSER on purpose: app_owner is subject to FORCE RLS and
# would dump ZERO rows from users/sessions/members.
# On production, pgBackRest runs against the native Postgres data directory directly — not a Docker volume.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then set -a; source .env; set +a; fi   # CI sets env directly; local sources .env

: "${SUPERUSER_DATABASE_URL:?}"; : "${DB_NAME:=comop}"
: "${BACKUP_PASS:?set BACKUP_PASS in .env}"; : "${OFFSITE_REPO:?set OFFSITE_REPO in .env}"

SUPER_DB="${SUPERUSER_DATABASE_URL%/*}/${DB_NAME}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="comop_${STAMP}.dump.enc"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# dump (custom format, compressed) → encrypt (aes-256-cbc, pbkdf2)
pg_dump -Fc "$SUPER_DB" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASS -out "$TMP/$NAME"
echo "encrypted backup: $NAME ($(wc -c < "$TMP/$NAME" | tr -d ' ') bytes)"

# push OFF the DB box. rclone:/s3: → real remote (B2 / Storage Box); else a filesystem repo.
case "$OFFSITE_REPO" in
  rclone:*)    rclone copy "$TMP/$NAME" "${OFFSITE_REPO#rclone:}" ;;   # e.g. rclone:b2:comop-backups
  s3://*)      aws s3 cp "$TMP/$NAME" "${OFFSITE_REPO%/}/" ;;          # e.g. s3://comop-backups
  *)           mkdir -p "$OFFSITE_REPO"; cp "$TMP/$NAME" "$OFFSITE_REPO/" ;;  # off-box filesystem repo
esac
echo "pushed off-site: $OFFSITE_REPO/$NAME"

# retention: keep the most recent 30 on a filesystem repo (remotes use lifecycle rules)
case "$OFFSITE_REPO" in
  rclone:*|s3://*) : ;;
  *) ls -1t "$OFFSITE_REPO"/comop_*.dump.enc 2>/dev/null | tail -n +31 | xargs -r rm -- ;;
esac
