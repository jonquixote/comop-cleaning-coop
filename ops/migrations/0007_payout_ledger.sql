-- 0007_payout_ledger.sql — applied as app_owner. APPEND-ONLY payout ledger (build-order
-- step 4): the worker-benefit surplus owed per completed job, taken from the job's FROZEN
-- breakdown. Honest ledger (std §3): no in-place overwrite — app_user gets SELECT + INSERT
-- ONLY, never UPDATE/DELETE. Corrections are new append rows, not edits. Tenant-scoped RLS.

CREATE TABLE payout_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  surplus_cents integer NOT NULL,                -- == job's frozen breakdown_json.surplus_cents
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id)                                -- exactly one payout per job (economics integrity / idempotency)
);
CREATE INDEX ON payout_ledger (co_op_id);

ALTER TABLE payout_ledger ENABLE ROW LEVEL SECURITY; ALTER TABLE payout_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payout_ledger
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

-- APPEND-ONLY: deliberately SELECT + INSERT only. NO UPDATE, NO DELETE for app_user.
GRANT SELECT, INSERT ON payout_ledger TO app_user;
