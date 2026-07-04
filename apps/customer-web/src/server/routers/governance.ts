// Governance router (app layer — allowed to import platform per ADR-0003).
// Lists proposals (open + recent closed), returns one proposal + vote tallies, and
// casts a vote (yes/no/abstain). Members eligible to vote are members with
// status='member' (probationary cannot vote — same rule as platform.castVote).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "@comop/platform/trpc/server";
import { withSessionTx } from "@comop/platform/identity/session-tx";
import { castVote as platformCastVote } from "@comop/platform/governance/proposals";
import { GovernanceError } from "@comop/platform/governance/errors";
import { resolveMemberId } from "../member";

interface ProposalListRow {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  status: string;
  opensAt: Date | null;
  closesAt: Date | null;
  stakesLevel: string | null;
  createdAt: Date;
}

interface ProposalDetailRow {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  status: string;
  opensAt: Date | null;
  closesAt: Date | null;
  stakesLevel: string | null;
  transparencySnapshot: unknown;
  createdAt: Date;
}

interface TallyRow {
  choice: string;
  c: number;
}

export const governanceRouter = router({
  listProposals: authedProcedure.query(async ({ ctx }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      const r = await tx.query<ProposalListRow>(
        `SELECT id, title, body, type, status,
                opens_at AS "opensAt",
                closes_at AS "closesAt",
                stakes_level AS "stakesLevel",
                created_at AS "createdAt"
           FROM proposals
          WHERE co_op_id = $1
          ORDER BY created_at DESC
          LIMIT 100`,
        [sessionCtx.coOpId],
      );
      return r.rows.map((row) => ({
        ...row,
        opensAt: row.opensAt === null ? null : row.opensAt.toISOString(),
        closesAt: row.closesAt === null ? null : row.closesAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }));
    }),
  ),

  getProposal: authedProcedure.input(z.object({ proposalId: z.string().uuid() })).query(async ({ ctx, input }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      const r = await tx.query<ProposalDetailRow>(
        `SELECT id, title, body, type, status,
                opens_at AS "opensAt",
                closes_at AS "closesAt",
                stakes_level AS "stakesLevel",
                transparency_snapshot_json AS "transparencySnapshot",
                created_at AS "createdAt"
           FROM proposals
          WHERE id = $1 AND co_op_id = $2`,
        [input.proposalId, sessionCtx.coOpId],
      );
      if ((r.rowCount ?? 0) === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      }
      const tallies = await tx.query<TallyRow>(
        `SELECT choice, COUNT(*)::int AS c
           FROM votes WHERE proposal_id = $1 AND co_op_id = $2
          GROUP BY choice`,
        [input.proposalId, sessionCtx.coOpId],
      );
      const tally: Record<"yes" | "no" | "abstain", number> = { yes: 0, no: 0, abstain: 0 };
      for (const t of tallies.rows) tally[t.choice as "yes" | "no" | "abstain"] = t.c;
      const row = r.rows[0]!;
      return {
        ...row,
        opensAt: row.opensAt === null ? null : row.opensAt.toISOString(),
        closesAt: row.closesAt === null ? null : row.closesAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        tallies: tally,
      };
    }),
  ),

  castVote: authedProcedure
    .input(z.object({ proposalId: z.string().uuid(), choice: z.enum(["yes", "no", "abstain"]) }))
    .mutation(async ({ ctx, input }) =>
      withSessionTx(ctx.token, async (tx, sessionCtx) => {
        const memberId = await resolveMemberId(tx, sessionCtx);
        try {
          await platformCastVote(
            tx,
            sessionCtx.coOpId,
            input.proposalId,
            memberId,
            input.choice,
          );
        } catch (err) {
          // Only surface messages from our own domain errors (known-safe, user-facing).
          // Anything else (a raw pg/driver error) could leak schema/internals — map it to
          // a generic message and keep the detail server-side.
          if (err instanceof GovernanceError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "could not cast vote" });
        }
        return { ok: true };
      }),
    ),
});
