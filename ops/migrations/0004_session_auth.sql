-- 0004_session_auth.sql — applied as app_owner. Session token storage + the pre-tenant
-- capability lookup policy (ADR-0005). sessions stays FORCE RLS; this adds a SELECT-only
-- permissive policy OR-ed with tenant_isolation, so a caller presenting a token's hash can
-- read exactly that one session row before any tenant context exists.

ALTER TABLE sessions ADD COLUMN token_hash text;          -- sha256(opaque token), set at create
ALTER TABLE sessions ALTER COLUMN token_hash SET NOT NULL; -- table is empty → safe
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);

CREATE POLICY session_by_token ON sessions
  FOR SELECT
  USING (token_hash = nullif(current_setting('app.session_token_hash', true), ''));
