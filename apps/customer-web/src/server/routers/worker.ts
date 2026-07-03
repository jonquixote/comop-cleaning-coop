// Worker router (app layer — allowed to import platform + sectors per ADR-0003).
// workerJobs: jobs assigned to the logged-in worker (joined from job_assignments
// through jobs). The memberId is resolved from sessionCtx.userId — workers without
// a member row (e.g., never-redeemed invitees) get an UNAUTHORIZED-equivalent FORBIDDEN.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "@comop/platform/trpc/server";
import { withSessionTx } from "@comop/platform/identity/session-tx";
import { resolveMemberId } from "../member";

export interface WorkerJobRow {
  assignmentId: string;
  jobId: string;
  scheduledAt: string | null;
  status: string;
  quotedPriceCents: number;
  finalPriceCents: number | null;
  customerContact: string;
  startsAt: string;
  endsAt: string;
  hoursLogged: number | null;
}

export interface GetJobRow {
  assignmentId: string;
  memberId: string;
  startsAt: string;
  endsAt: string;
  hoursLogged: number | null;
  assignmentStatus: string;
  jobId: string;
  jobStatus: string;
  quotedPriceCents: number;
  finalPriceCents: number | null;
  breakdown: unknown;
  scheduledAt: string | null;
  customerContact: string;
  customerAddress: string | null;
}

export const workerRouter = router({
  workerJobs: authedProcedure.query(async ({ ctx }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      const memberId = await resolveMemberId(tx, sessionCtx);
      const r = await tx.query<WorkerJobRow>(
        `SELECT ja.id                  AS "assignmentId",
                j.id                   AS "jobId",
                j.scheduled_at         AS "scheduledAt",
                j.status               AS status,
                j.quoted_price_cents   AS "quotedPriceCents",
                j.final_price_cents    AS "finalPriceCents",
                c.contact              AS "customerContact",
                ja.starts_at           AS "startsAt",
                ja.ends_at             AS "endsAt",
                ja.hours_logged        AS "hoursLogged"
           FROM job_assignments ja
           JOIN jobs     j ON j.id = ja.job_id AND j.co_op_id = ja.co_op_id
           JOIN customers c ON c.id = j.customer_id
          WHERE ja.member_id = $1 AND ja.co_op_id = $2
            AND ja.status <> 'cancelled'
          ORDER BY ja.starts_at ASC`,
        [memberId, sessionCtx.coOpId],
      );
      return r.rows.map((row) => ({
        ...row,
        quotedPriceCents: Number(row.quotedPriceCents),
        hoursLogged: row.hoursLogged === null ? null : Number(row.hoursLogged),
      }));
    }),
  ),
  getJob: authedProcedure.input(z.object({ jobId: z.string().uuid() })).query(async ({ ctx, input }) =>
    withSessionTx(ctx.token, async (tx, sessionCtx) => {
      const memberId = await resolveMemberId(tx, sessionCtx);
      const r = await tx.query<GetJobRow>(
        `SELECT ja.id AS "assignmentId",
                ja.member_id AS "memberId",
                ja.starts_at AS "startsAt",
                ja.ends_at AS "endsAt",
                ja.hours_logged AS "hoursLogged",
                ja.status AS "assignmentStatus",
                j.id AS "jobId",
                j.status AS "jobStatus",
                j.quoted_price_cents AS "quotedPriceCents",
                j.final_price_cents AS "finalPriceCents",
                j.breakdown_json AS "breakdown",
                j.scheduled_at AS "scheduledAt",
                c.contact AS "customerContact",
                c.address AS "customerAddress"
           FROM job_assignments ja
           JOIN jobs j ON j.id = ja.job_id
           JOIN customers c ON c.id = j.customer_id
          WHERE ja.job_id = $1 AND ja.co_op_id = $2 AND ja.member_id = $3`,
        [input.jobId, sessionCtx.coOpId, memberId],
      );
      if ((r.rowCount ?? 0) === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "job not found or not assigned to you" });
      }
      const row = r.rows[0]!;
      return {
        ...row,
        quotedPriceCents: Number(row.quotedPriceCents),
        finalPriceCents: row.finalPriceCents === null ? null : Number(row.finalPriceCents),
        hoursLogged: row.hoursLogged === null ? null : Number(row.hoursLogged),
      };
    }),
  ),
});
