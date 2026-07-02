// Server-side session lifecycle (impl §3a.1, ADR-0005). Sessions are Postgres rows,
// revocable; resolution reads the live row so revocation takes effect immediately.
// The raw token is a bearer secret; only its sha256 is stored.
import { createHash, randomBytes } from "node:crypto";
import { pool, withTenantTx } from "../db/internal/tenant-tx";
import type { PoolClient } from "pg";

export interface SessionContext {
  sessionId: string;
  userId: string;
  coOpId: string;
}

const sha256 = (t: string): string => createHash("sha256").update(t).digest("hex");

/** Create a session for a user in a KNOWN tenant. Returns the opaque bearer token.
 *  Accepts an optional existing transaction (`tx`) for composability in tests and
 *  callers that already hold a tenant-scoped connection. When omitted, opens its own
 *  transaction via withTenantTx. */
export async function createSession(
  userId: string,
  coOpId: string,
  ttlHours = 24 * 14,
  tx?: PoolClient,
): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url");
  const insert = async (c: PoolClient) => {
    await c.query(
      `INSERT INTO sessions (co_op_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
      [coOpId, userId, sha256(token), ttlHours],
    );
  };
  if (tx) {
    await insert(tx);
  } else {
    await withTenantTx(coOpId, insert);
  }
  return { token };
}

/** Pre-tenant capability lookup (ADR-0005): presenting the token authorizes reading
 *  exactly its own session row. Returns null for absent/expired/revoked tokens.
 *  Accepts an optional existing transaction (`tx`) for composability in tests and
 *  callers that already hold a tenant-scoped connection. When omitted, opens its own
 *  transaction via pool.connect + BEGIN/COMMIT. */
export async function resolveSession(
  token: string,
  tx?: PoolClient,
): Promise<SessionContext | null> {
  const query = async (c: PoolClient) => {
    await c.query("SELECT set_config('app.session_token_hash', $1, true)", [sha256(token)]);
    const r = await c.query(
      `SELECT id, user_id, co_op_id FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [sha256(token)],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return { sessionId: row.id as string, userId: row.user_id as string, coOpId: row.co_op_id as string };
  };
  if (tx) return query(tx);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await query(c);
    await c.query("COMMIT");
    return result;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

/** Revoke immediately. The next resolve fails because the live row carries revoked_at.
 *  Accepts an optional existing transaction (`tx`) for composability. */
export async function revokeSession(token: string, tx?: PoolClient): Promise<void> {
  const s = await resolveSession(token, tx);
  if (!s) return;
  const doUpdate = async (c: PoolClient) => {
    await c.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [s.sessionId]);
  };
  if (tx) {
    await doUpdate(tx);
  } else {
    await withTenantTx(s.coOpId, doUpdate);
  }
}
