// withSessionTx — THE sole app-facing DB door (ADR-0004 §3, ADR-0005). App/UI code
// passes only an opaque session token; the trusted co_op_id is resolved from the live
// session row server-side, then the internal withTenantTx sets SET LOCAL tenant context.
// An invalid/expired/revoked token throws BEFORE any query runs. App code must NEVER
// import the internal tenant-tx helper directly (enforced by tools/check-boundaries.mjs).
import type { PoolClient } from "pg";
import { withTenantTx } from "../db/internal/tenant-tx";
import { resolveSession, type SessionContext } from "./session";

/** Pre-auth tenant transaction: resolves the session, then runs fn in tenant context.
 *  Accepts an optional existing transaction (`existingTx`) for composability in tests
 *  that already hold a tenant-scoped connection. When omitted, opens its own transaction
 *  via withTenantTx (the production path). */
export async function withSessionTx<T>(
  token: string,
  fn: (tx: PoolClient, ctx: SessionContext) => Promise<T>,
  existingTx?: PoolClient,
): Promise<T> {
  const ctx = await resolveSession(token, existingTx);
  if (!ctx) throw new Error("no valid session");
  if (existingTx) return fn(existingTx, ctx);
  return withTenantTx(ctx.coOpId, (tx) => fn(tx, ctx));
}
