// Shared app-layer helper: resolves the authenticated user's member row
// within their co-op. Throws FORBIDDEN (with a configurable message) if
// the caller has no membership record for the current tenant.
//
// Co-op membership is a per-tenant fact: SELECT membership is keyed on
// the (userId, coOpId) pair coming from the session chain — never from
// any client-supplied input. The session token resolves via withSessionTx
// to a SessionContext that already enforces tenant isolation per
// ADR-0004 / ADR-0010.
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";

export async function resolveMemberId(
  tx: PoolClient,
  sessionCtx: { userId: string; coOpId: string },
  errorMessage?: string,
): Promise<string> {
  const m = await tx.query<{ id: string }>(
    "SELECT id FROM members WHERE user_id = $1 AND co_op_id = $2",
    [sessionCtx.userId, sessionCtx.coOpId],
  );
  if ((m.rowCount ?? 0) === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: errorMessage ?? "you are not a member of this co-op",
    });
  }
  return m.rows[0]!.id as string;
}
