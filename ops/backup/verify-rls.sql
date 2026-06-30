-- Post-restore RLS check (run as app_user on the scratch DB). Proves tenant isolation
-- survived the backup→restore round-trip. :A is co-op A's id (passed via -v A=...).
BEGIN;
SELECT set_config('app.current_co_op', :'A', true);
DO $$
DECLARE scoped int; explicit int;
BEGIN
  SELECT count(*) INTO scoped   FROM members;   -- RLS-scoped to the current tenant
  SELECT count(*) INTO explicit FROM members
    WHERE co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid;
  IF scoped < 1 THEN
    RAISE EXCEPTION 'verify-rls: tenant context sees zero rows (positive control failed)';
  END IF;
  IF scoped <> explicit THEN
    RAISE EXCEPTION 'verify-rls: RLS NOT isolating on restored DB (scoped=% explicit=%)', scoped, explicit;
  END IF;
END $$;
COMMIT;
SELECT 'verify-rls OK: tenant isolation intact after restore' AS result;
