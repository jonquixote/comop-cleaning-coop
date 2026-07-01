-- 0009_allocation.sql — applied as app_owner. Allocation workflow (build-order step 6):
-- surplus-allocation periods + the member capital-credit ledger. Tenant-scoped, RLS nullif.
-- Tax-conformant patronage treatment is validated by bylaws + CPA (§9) — the schema tracks
-- and allocates; it does NOT assert deductibility. Do not rely on these rows for filings
-- until confirmed.

CREATE TABLE allocation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- at most ONE open period per co-op (partial unique index)
CREATE UNIQUE INDEX one_open_period_per_coop ON allocation_periods (co_op_id) WHERE status = 'open';
CREATE INDEX ON allocation_periods (co_op_id);

CREATE TABLE member_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  period_id uuid NOT NULL REFERENCES allocation_periods(id),
  member_id uuid NOT NULL REFERENCES members(id),
  labor_basis numeric NOT NULL,                  -- hours basis for this member in the period
  amount_cents integer NOT NULL,                 -- capital credited this period
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, member_id)                  -- one row per member per period (idempotency)
);
CREATE INDEX ON member_allocations (co_op_id, member_id);

ALTER TABLE allocation_periods ENABLE ROW LEVEL SECURITY; ALTER TABLE allocation_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON allocation_periods
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE member_allocations ENABLE ROW LEVEL SECURITY; ALTER TABLE member_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_allocations
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

-- allocation_periods: app_user opens (INSERT), reads (SELECT), and closes (UPDATE status).
GRANT SELECT, INSERT, UPDATE ON allocation_periods TO app_user;
-- member_allocations: APPEND-ONLY capital ledger — SELECT + INSERT only (no UPDATE/DELETE).
GRANT SELECT, INSERT ON member_allocations TO app_user;
