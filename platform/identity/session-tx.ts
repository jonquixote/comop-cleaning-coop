// withSessionTx — THE sole app-facing DB door (ADR-0004 §3, ADR-0005). App/UI code
// passes only an opaque session token; the trusted co_op_id is resolved from the live
// session row server-side, then the internal withTenantTx sets SET LOCAL tenant context.
// An invalid/expired/revoked token throws BEFORE any query runs. App code must NEVER
// import the internal tenant-tx helper directly (enforced by tools/check-boundaries.mjs).
import type { PoolClient } from "pg";
import { withTenantTx } from "../db/internal/tenant-tx";
import { resolveSession, type SessionContext } from "./session";

export async function withSessionTx<T>(
  token: string,
  fn: (tx: PoolClient, ctx: SessionContext) => Promise<T>,
): Promise<T> {
  const ctx = await resolveSession(token);
  if (!ctx) throw new Error("no valid session");
  return withTenantTx(ctx.coOpId, (tx) => fn(tx, ctx));
}
