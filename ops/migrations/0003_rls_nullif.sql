-- 0003_rls_nullif.sql — applied as app_owner. Hardening fix surfaced by the fail-closed
-- test: a pooled connection REUSED after a tenant transaction reverts app.current_co_op
-- to '' (empty string), and ''::uuid ERRORS instead of yielding zero rows. Wrapping the
-- read in nullif(...,'') makes an empty OR unset context NULL → predicate NULL → ZERO
-- rows (graceful fail-closed, no error). Recreates the 0002 policies; never edits an
-- applied migration in place.

DROP POLICY tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

DROP POLICY tenant_isolation ON sessions;
CREATE POLICY tenant_isolation ON sessions
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

DROP POLICY tenant_isolation ON members;
CREATE POLICY tenant_isolation ON members
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

DROP POLICY tenant_self_read ON co_ops;
CREATE POLICY tenant_self_read ON co_ops
  FOR SELECT
  USING (id = nullif(current_setting('app.current_co_op', true), '')::uuid);
