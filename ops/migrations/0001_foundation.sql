-- 0001_foundation.sql — applied as app_owner (ADR-0004 §4).
-- Foundation tables. ADR-0002 tenancy; ADR-0004 §5 co_ops anchor.
-- citext + pgcrypto are created in platform/db/roles.sql (superuser) before this runs.
-- RLS policies + app_user DML grants land in 0002_rls.sql (Task 4) — kept a SEPARATE
-- migration so neither file is ever edited after it has been applied.

CREATE TABLE co_ops (                       -- TENANT ANCHOR: keyed by its own id; NO co_op_id column (ADR-0004 §5)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  role text NOT NULL CHECK (role IN ('customer','worker','admin')),   -- server-set only
  email citext NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (co_op_id, email)                  -- per-tenant account identity (not global)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('probationary','member')),
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON users(co_op_id);            -- §5 co_op_id index coverage
CREATE INDEX ON sessions(co_op_id);
CREATE INDEX ON members(co_op_id);
