-- 0016_job_cleaning_checklists.sql — applied as app_owner.
-- Per-job checklist instances created at booking time, derived from CleaningJobDetails
-- metrics (bedrooms, bathrooms, addons). Standards are code (sectors/cleaning/checklists.ts),
-- not DB data — so no templates table for MVP. The spec's `cleaning_checklists` template
-- table is deferred to a future phase (admin customization of room/task definitions).

CREATE TABLE job_cleaning_checklists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id     uuid NOT NULL REFERENCES co_ops(id),
  job_id       uuid NOT NULL REFERENCES jobs(id),
  room         text NOT NULL,
  tasks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ON job_cleaning_checklists (co_op_id, job_id);

ALTER TABLE job_cleaning_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_cleaning_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_cleaning_checklists
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

-- Mutable-no-delete: workers check/uncheck tasks, update completion status. No DELETE.
GRANT SELECT, INSERT, UPDATE ON job_cleaning_checklists TO app_user;
