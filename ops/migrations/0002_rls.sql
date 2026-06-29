-- 0002_rls.sql — applied as app_owner. Default-deny tenant isolation (ADR-0002).
-- Generic policy on the three non-anchor tables; bespoke carve-out on co_ops
-- (ADR-0004 §5, LOCKED). app_user DML grants are paired with the policies they ride on.

-- ---- generic: users, sessions, members (ENABLE + FORCE + default-deny) ----
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users    FORCE  ROW LEVEL SECURITY;        -- subject even for app_owner → seed sets context
CREATE POLICY tenant_isolation ON users
  USING      (co_op_id = current_setting('app.current_co_op', true)::uuid)
  WITH CHECK (co_op_id = current_setting('app.current_co_op', true)::uuid);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING      (co_op_id = current_setting('app.current_co_op', true)::uuid)
  WITH CHECK (co_op_id = current_setting('app.current_co_op', true)::uuid);

ALTER TABLE members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE members  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON members
  USING      (co_op_id = current_setting('app.current_co_op', true)::uuid)
  WITH CHECK (co_op_id = current_setting('app.current_co_op', true)::uuid);

-- current_setting(..., true) → NULL when unset → predicate NULL → ZERO rows (fail-closed).
-- NO null-permissive branch. app_user is non-superuser, never BYPASSRLS (ADR-0004 §4).
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, members TO app_user;

-- ---- bespoke: co_ops anchor (ENABLE, NOT forced; SELECT-only) — ADR-0004 §5 LOCKED ----
ALTER TABLE co_ops ENABLE ROW LEVEL SECURITY;          -- NOT forced: app_owner provisions/seeds co-ops w/o context
CREATE POLICY tenant_self_read ON co_ops
  FOR SELECT
  USING (id = current_setting('app.current_co_op', true)::uuid);   -- a co-op reads only its OWN row
GRANT SELECT ON co_ops TO app_user;                    -- SELECT only; co-op creation is a provisioner action at N=1
