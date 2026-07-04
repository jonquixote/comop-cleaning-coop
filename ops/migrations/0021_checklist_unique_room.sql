-- 0021_checklist_unique_room.sql — applied as app_owner.
-- createJobChecklists inserts one row per derived room per job. Nothing at the DB level
-- stopped a double-run (a retried booking, a future re-generation path) from inserting a
-- second "Kitchen" for the same job — silent duplicate checklist sections. Add a UNIQUE
-- (job_id, room) so duplication fails loudly. job_id is globally unique (jobs PK), so the
-- pair already implies the tenant; no co_op_id needed in the key.

ALTER TABLE job_cleaning_checklists
  ADD CONSTRAINT job_cleaning_checklists_job_id_room_key UNIQUE (job_id, room);
