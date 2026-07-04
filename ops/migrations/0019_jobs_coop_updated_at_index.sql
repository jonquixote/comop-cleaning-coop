-- 0019_jobs_coop_updated_at_index.sql — applied as app_owner.
-- The period-health / break-even query (transparency.ts getPeriodHealth) filters jobs by
-- co_op_id and a window on updated_at. Phase 1 shipped only a bare (co_op_id) index (0005),
-- so that filter degrades to a heap scan under RLS as job volume grows — exactly the
-- "RLS filters must not silently become sequential scans at volume" concern in the PR
-- checklist. Add the composite (co_op_id, updated_at) index so the tenant-scoped time
-- window is index-served.

CREATE INDEX IF NOT EXISTS jobs_co_op_id_updated_at_idx ON jobs (co_op_id, updated_at);
