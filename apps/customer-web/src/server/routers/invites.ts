// Invites router (app layer — allowed to import platform per ADR-0003).
// issueInvite: ADMIN-only. Resolves a co-op-internal admin check before issuing
// the single-use, expiring token. The caller must have role='admin' (loaded out
// of the sessions chain — never client-supplied).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "@comop/platform/trpc/server";
import { withSessionTx } from "@comop/platform/identity/session-tx";
import { issueInvite } from "@comop/platform/identity/invite";

export const invitesRouter = router({
  issueInvite: authedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) =>
      withSessionTx(ctx.token, async (tx, sessionCtx) => {
        // Role-check: only admins may issue invites (spec §3a.1).
        const u = await tx.query<{ role: string }>(
          "SELECT role FROM users WHERE id = $1",
          [sessionCtx.userId],
        );
        if ((u.rowCount ?? 0) === 0 || u.rows[0]!.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "only admins may issue invites" });
        }
        // Member id (the issuer) — the invite row needs a FK to a member.
        const m = await tx.query<{ id: string }>(
          "SELECT id FROM members WHERE user_id = $1 AND co_op_id = $2",
          [sessionCtx.userId, sessionCtx.coOpId],
        );
        if ((m.rowCount ?? 0) === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "admin must also be a member to issue invites" });
        }
        const issuedByMemberId = m.rows[0]!.id as string;
        const { token, expiresAt } = await issueInvite(tx, sessionCtx.coOpId, issuedByMemberId, {
          email: input.email,
        });
        return { token, expiresAt };
      }),
    ),
});
