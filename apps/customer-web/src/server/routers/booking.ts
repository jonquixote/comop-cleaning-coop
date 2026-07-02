// Booking router (app layer — allowed to import platform + sectors per ADR-0003).
// createBooking: looks up or creates the customers row for the authenticated user, then
// delegates to the sector-owned createCleaningBooking. list: finds the user's customer
// row via customers.user_id, then queries jobs WHERE customer_id = that id.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "@comop/platform/trpc/server";
import { withSessionTx } from "@comop/platform/identity/session-tx";
import { createCleaningBooking, type BookingInput } from "@comop/cleaning/booking";
import type { CleaningJobDetails } from "@comop/cleaning/pricing";

interface JobRow {
  id: string;
  sector: string;
  scheduled_at: string | null;
  status: string;
  quoted_price_cents: number;
  policy_version_id: string;
  created_at: string;
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  addons: string[];
}

const ADDON_VALUES = ["deep_clean", "inside_fridge", "inside_oven", "windows"] as const;

const createBookingSchema = z.object({
  sqft: z.number().int().positive(),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  addons: z.array(z.enum(ADDON_VALUES)).default([]),
  scheduledAt: z.string().datetime().optional(),
});

export const bookingRouter = router({
  create: authedProcedure.input(createBookingSchema).mutation(async ({ ctx, input }) => {
    return withSessionTx(ctx.token, async (tx, sessionCtx) => {
      let customerId: string;
      const cust = await tx.query(
        "SELECT id FROM customers WHERE user_id = $1 AND co_op_id = $2",
        [sessionCtx.userId, sessionCtx.coOpId],
      );
      if (cust.rowCount === 0) {
        const userRow = await tx.query(
          "SELECT email FROM users WHERE id = $1",
          [sessionCtx.userId],
        );
        if (userRow.rowCount === 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
        const email = userRow.rows[0].email as string;
        const ins = await tx.query(
          "INSERT INTO customers (co_op_id, user_id, contact) VALUES ($1, $2, $3) RETURNING id",
          [sessionCtx.coOpId, sessionCtx.userId, email],
        );
        customerId = ins.rows[0].id as string;
      } else {
        customerId = cust.rows[0].id as string;
      }

      const details: CleaningJobDetails = {
        sqft: input.sqft,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        addons: [...input.addons],
      };
      const bookingInput: BookingInput = { customerId, details, scheduledAt: input.scheduledAt };
      const result = await createCleaningBooking(tx, sessionCtx.coOpId, bookingInput);
      return {
        jobId: result.jobId,
        quotedPriceCents: result.quotedPriceCents,
        policyVersionId: result.policyVersionId,
      };
    });
  }),

  list: authedProcedure.query(async ({ ctx }) => {
    return withSessionTx(ctx.token, async (tx, sessionCtx) => {
      const cust = await tx.query(
        "SELECT id FROM customers WHERE user_id = $1 AND co_op_id = $2",
        [sessionCtx.userId, sessionCtx.coOpId],
      );
      if (cust.rowCount === 0) return [];
      const customerId = cust.rows[0].id as string;
      const r = await tx.query(
        `SELECT j.id, j.sector, j.scheduled_at, j.status, j.quoted_price_cents, j.policy_version_id, j.created_at,
                jcd.sqft, jcd.bedrooms, jcd.bathrooms, jcd.addons
         FROM jobs j
         JOIN job_cleaning_details jcd ON jcd.job_id = j.id
         WHERE j.customer_id = $1 AND j.co_op_id = $2
         ORDER BY j.created_at DESC`,
        [customerId, sessionCtx.coOpId],
      );
      return r.rows.map((row: JobRow) => ({
        jobId: row.id,
        sector: row.sector,
        scheduledAt: row.scheduled_at,
        status: row.status,
        quotedPriceCents: row.quoted_price_cents,
        policyVersionId: row.policy_version_id,
        createdAt: row.created_at,
        sqft: row.sqft,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        addons: row.addons,
      }));
    });
  }),
});
