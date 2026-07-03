-- 0013_invites.sql — applied as app_owner. Single-issued, expiring invite tokens for
-- worker-owner onboarding (spec §3a.1: "worker-owners are invited, not self-registered").
-- The token itself is opaque; we store SHA-256(token) in token_hash and hand the
-- plaintext token back to the issuer exactly ONCE — the caller is responsible for
-- delivering it to the invitee out-of-band. Marking redeemed_at stops double-use.
--
-- The redemption flow resolves the co_op_id from the invite row itself
-- (no client-supplied tenant input — spec §3a requires the trusted-tenant chain),
-- then creates a user (role='worker') + member (status='probationary') under that
-- co-op. Promotion to status='member' is a separate admin action, not part of this
-- migration's surface.

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id    uuid NOT NULL REFERENCES co_ops(id),
  issued_by   uuid NOT NULL REFERENCES members(id),
  token_hash  text NOT NULL UNIQUE,
  email       citext,
  expires_at  timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON invites (co_op_id);
CREATE INDEX ON invites (co_op_id, redeemed_at);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY; ALTER TABLE invites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invites
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON invites TO app_user;
