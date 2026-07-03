// Transparency router (app layer — allowed to import platform per ADR-0003).
// Surfaces the spec §6 transparency + period-health requirements to the worker
// app. All queries run inside withSessionTx so RLS scopes data to the logged-in
// member's tenant — no client-supplied co_op_id anywhere.
import { router, authedProcedure } from "@comop/platform/trpc/server";
import { withSessionTx } from "@comop/platform/identity/session-tx";
import {
  getCoOpTransparencyReport,
  getPeriodHealth,
} from "@comop/platform/transparency/transparency";

export const transparencyRouter = router({
  workerEarnings: authedProcedure.query(async ({ ctx }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      const userId = sessionCtx.userId;
      const coOpId = sessionCtx.coOpId;
      // Allocations per period
      const allocR = await tx.query(
        `SELECT ma.id              AS "allocationId",
                ma.period_id        AS "periodId",
                ap.starts_at        AS "periodStart",
                ap.ends_at          AS "periodEnd",
                ma.amount_cents     AS "amountCents",
                ma.labor_basis      AS "laborBasis"
           FROM member_allocations ma
           JOIN members m         ON m.id = ma.member_id
           JOIN allocation_periods ap ON ap.id = ma.period_id
          WHERE m.user_id = $1 AND ma.co_op_id = $2
          ORDER BY ap.ends_at DESC`,
        [userId, coOpId],
      );
      const allocations = allocR.rows.map((r) => ({
        allocationId: r.allocationId as string,
        periodId: r.periodId as string,
        periodStart: (r.periodStart as Date).toISOString(),
        periodEnd: (r.periodEnd as Date).toISOString(),
        amountCents: Number(r.amountCents),
        laborBasis: Number(r.laborBasis),
      }));

      // Capital account balance
      const capR = await tx.query(
        `SELECT pca.balance_cents AS "balanceCents"
           FROM patronage_capital_accounts pca
           JOIN members m ON m.id = pca.member_id
          WHERE m.user_id = $1 AND pca.co_op_id = $2`,
        [userId, coOpId],
      );
      const capitalBalanceCents = (capR.rowCount ?? 0) === 0
        ? 0
        : Number(capR.rows[0]!.balanceCents);

      // The current surplus_split lever
      const transparency = await getCoOpTransparencyReport(tx, coOpId);

      return {
        allocations,
        capitalBalanceCents,
        currentSurplusSplit: transparency.currentSurplusSplit,
        policyVersionId: transparency.policyVersionId,
      };
    }),
  ),

  periodTransparency: authedProcedure.query(async ({ ctx }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      return getCoOpTransparencyReport(tx, sessionCtx.coOpId);
    }),
  ),

  periodHealth: authedProcedure.query(async ({ ctx }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      return getPeriodHealth(tx, sessionCtx.coOpId);
    }),
  ),
});
