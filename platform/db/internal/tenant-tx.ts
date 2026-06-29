// INTERNAL — app/UI code must NOT import this. The only sanctioned app-facing door
// is identity/session-tx → withSessionTx, which resolves co_op_id from the live
// session row first (ADR-0004 §3). Exported only for the identity module and tests.
// The boundary check (tools/check-boundaries.mjs) fails any /apps import of this file.
import { Pool, type PoolClient } from "pg";

// The pool connects AS app_user (APP_DATABASE_URL): non-superuser, never BYPASSRLS.
export const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });

/**
 * Runs `fn` inside a transaction whose tenant context is set to `coOpId`.
 * `SET LOCAL` (via set_config(..., is_local=true)) is transaction-scoped, so the
 * context cannot leak across pooled-connection reuse. The value is parameterized,
 * so it is never string-interpolated into SQL.
 *
 * Callers must pass a SERVER-RESOLVED `coOpId` (from the trusted session) — never
 * client input. This helper is internal precisely so that rule is structural.
 */
export async function withTenantTx<T>(
  coOpId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('app.current_co_op', $1, true)", [coOpId]);
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (err) {
    await tx.query("ROLLBACK");
    throw err;
  } finally {
    tx.release();
  }
}
