-- 0005_booking.sql — applied as app_owner. Booking→job + versioned policy (build-order
-- step 2). customers + policy_settings (versioned, never overwritten) + generic jobs +
-- job_cleaning_details (sector extension). All tenant-scoped, default-deny RLS (nullif
-- pattern, ADR-0002/0004 §5). Money is integer cents; timestamps UTC.

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  contact text NOT NULL,
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Versioned, vote-set levers (incl. surplus_split). History preserved; NEVER overwritten.
CREATE TABLE policy_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  key text NOT NULL,
  value_json jsonb NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  set_by_proposal_id uuid,                       -- governance link (proposals land later); nullable at genesis
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON policy_settings (co_op_id, key, effective_from DESC);

-- Generic platform row. quoted vs final are two facts — never collapse them.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  sector text NOT NULL,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','scheduled','in_progress','done','cancelled')),
  quoted_price_cents integer NOT NULL,           -- frozen at quote time
  final_price_cents integer,                     -- null until any post-job settlement
  policy_version_id uuid NOT NULL REFERENCES policy_settings(id),  -- the snapshot the quote froze
  breakdown_json jsonb NOT NULL,                 -- the frozen PriceBreakdown
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON jobs (co_op_id);

-- Sector extension (jobs never changes when a sector is added). Carries co_op_id for RLS.
CREATE TABLE job_cleaning_details (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  sqft integer NOT NULL,
  bedrooms integer NOT NULL,
  bathrooms integer NOT NULL,
  addons text[] NOT NULL DEFAULT '{}'
);

-- ---- default-deny RLS (generic nullif pattern) on all four ----
ALTER TABLE customers ENABLE ROW LEVEL SECURITY; ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE policy_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE policy_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON policy_settings
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY; ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE job_cleaning_details ENABLE ROW LEVEL SECURITY; ALTER TABLE job_cleaning_details FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_cleaning_details
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON customers, policy_settings, jobs, job_cleaning_details TO app_user;
