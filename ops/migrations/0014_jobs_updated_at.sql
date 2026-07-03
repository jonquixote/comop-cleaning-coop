-- 0014_jobs_updated_at.sql — applied as app_owner.
-- Adds updated_at to the jobs table so the period-health / break-even
-- query (transparency.ts getPeriodHealth) can filter on when jobs were
-- last modified. Existing rows are backfilled with their created_at
-- value; a BEFORE UPDATE trigger keeps updated_at current on every
-- row change. DEFAULT now() means INSERTs never need to mention it.
--
-- No new grants needed: the trigger runs under table-owner authority,
-- same pattern as 0010_governance.sql (enforce_decision_comm_economics).

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE jobs SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE jobs ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE jobs ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION set_jobs_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_jobs_updated_at();
