#!/usr/bin/env bash
# ops/bootstrap.sh — one-time (idempotent) DB + role bootstrap. Run as a Postgres
# SUPERUSER. Creates the database, the citext/pgcrypto extensions, and the two
# NON-superuser roles (ADR-0004 §4). Reads .env. Migrations run separately (run.ts).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

SUPER="${SUPERUSER_DATABASE_URL:?set SUPERUSER_DATABASE_URL in .env}"
DB="${DB_NAME:-comop}"

# 1. database (CREATE DATABASE cannot run in a transaction / be guarded inline)
if ! psql "$SUPER" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1; then
  psql "$SUPER" -c "CREATE DATABASE \"${DB}\""
  echo "created database ${DB}"
fi

# 2. extensions + roles (superuser, connected to the target DB). Passwords are passed
#    as session GUCs so they are never interpolated into roles.sql.
SUPER_DB="${SUPER%/*}/${DB}"
psql "$SUPER_DB" \
  -c "SELECT set_config('comop.owner_pw', '${OWNER_PASSWORD}', false)" \
  -c "SELECT set_config('comop.app_pw',   '${APP_PASSWORD}',   false)" \
  -f platform/db/roles.sql

echo "bootstrap ok: db=${DB} roles=app_owner,app_user"
