// Server-side session lifecycle (impl §3a.1, ADR-0005). Sessions are Postgres rows,
// revocable; resolution reads the live row so revocation takes effect immediately.
// The raw token is a bearer secret; only its sha256 is stored.
import { createHash, randomBytes } from "node:crypto";
import { pool, withTenantTx } from "../db/internal/tenant-tx";

export interface SessionContext {
  sessionId: string;
  userId: string;
  coOpId: string;
}

const sha256 = (t: string): string => createHash("sha256").update(t).digest("hex");

/** Create a session for a user in a KNOWN tenant. Returns the opaque bearer token. */
export async function createSession(
  userId: string,
  coOpId: string,
  ttlHours = 24 * 14,
): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url");
  await withTenantTx(coOpId, async (tx) => {
    await tx.query(
      `INSERT INTO sessions (co_op_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
      [coOpId, userId, sha256(token), ttlHours],
    );
  });
  return { token };
}

/** Pre-tenant capability lookup (ADR-0005): presenting the token authorizes reading
 *  exactly its own session row. Returns null for absent/expired/revoked tokens. */
export async function resolveSession(token: string): Promise<SessionContext | null> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('app.session_token_hash', $1, true)", [sha256(token)]);
    const r = await tx.query(
      `SELECT id, user_id, co_op_id FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [sha256(token)],
    );
    await tx.query("COMMIT");
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return { sessionId: row.id as string, userId: row.user_id as string, coOpId: row.co_op_id as string };
  } catch (err) {
    await tx.query("ROLLBACK");
    throw err;
  } finally {
    tx.release();
  }
}

/** Revoke immediately. The next resolve fails because the live row carries revoked_at. */
export async function revokeSession(token: string): Promise<void> {
  const s = await resolveSession(token);
  if (!s) return;
  await withTenantTx(s.coOpId, async (tx) => {
    await tx.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [s.sessionId]);
  });
}
