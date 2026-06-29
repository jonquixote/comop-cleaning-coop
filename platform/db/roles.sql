-- platform/db/roles.sql — run as a SUPERUSER, connected to the target database.
-- Idempotent. Passwords are read from session GUCs the CALLER sets BEFORE this file
-- runs (via set_config('comop.owner_pw', …) / set_config('comop.app_pw', …)), so no
-- password is ever interpolated into this SQL text. ADR-0004 §4: two NON-superuser roles.
--   app_owner — owns schema/tables; runs migrations + seed
--   app_user  — the runtime app role; DML grants only (in 0002_rls.sql); never superuser/BYPASSRLS

CREATE EXTENSION IF NOT EXISTS citext;     -- users.email
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() on PG < 13 (harmless on 13+)

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_owner') THEN
    EXECUTE format('CREATE ROLE app_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
                   current_setting('comop.owner_pw'));
  ELSE
    EXECUTE format('ALTER ROLE app_owner WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
                   current_setting('comop.owner_pw'));
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format('CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
                   current_setting('comop.app_pw'));
  ELSE
    EXECUTE format('ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
                   current_setting('comop.app_pw'));
  END IF;
END $$;

-- app_owner owns the schema; migrations/seed create objects as app_owner.
ALTER SCHEMA public OWNER TO app_owner;
GRANT ALL ON SCHEMA public TO app_owner;

-- app_user (runtime) may connect + use the schema; per-table DML grants live in
-- 0002_rls.sql alongside the RLS policies they pair with (Task 4).
GRANT USAGE ON SCHEMA public TO app_user;
