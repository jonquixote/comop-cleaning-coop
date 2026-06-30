-- 0006_dispatch.sql — applied as app_owner. Dispatch engine (build-order step 3):
-- worker availability + job assignments. The engine owns when/who/where-order; NO route
-- optimization at MVP. Tenant-scoped, default-deny RLS (nullif pattern). Times UTC.

CREATE TABLE worker_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  member_id uuid NOT NULL REFERENCES members(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON worker_availability (co_op_id, member_id);

CREATE TABLE job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  member_id uuid NOT NULL REFERENCES members(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  hours_logged numeric,                          -- null until execution (build-order step 4)
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- Cardinality rule (impl §4): one row per (member, job) for a single shift; multiple rows
-- only as explicit distinct shifts with their own time bounds — enforced operationally by
-- the dispatch conflict check, not a unique constraint (distinct shifts are allowed).
CREATE INDEX ON job_assignments (co_op_id, member_id, starts_at);

ALTER TABLE worker_availability ENABLE ROW LEVEL SECURITY; ALTER TABLE worker_availability FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON worker_availability
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE job_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE job_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_assignments
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON worker_availability, job_assignments TO app_user;
