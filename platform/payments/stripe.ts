// Stripe payment capture (platform, sector-agnostic). Idempotent against duplicate webhook
// delivery via webhook_events UNIQUE(stripe_event_id): a re-delivered event inserts nothing
// and does NOT re-mark the job — threat-model mode 2 (never double-charge). Reads the settled
// final_price_cents from the job (never recomputed). Runs in the caller's tenant transaction.
import type { PoolClient } from "pg";

export class PaymentError extends Error {}

export async function capturePayment(
  tx: PoolClient,
  coOpId: string,
  jobId: string,
  stripePaymentIntentId: string,
): Promise<{ captured: boolean; amountCents: number }> {
  const j = await tx.query(
    "SELECT status, final_price_cents FROM jobs WHERE id = $1 AND co_op_id = $2",
    [jobId, coOpId],
  );
  if (j.rowCount === 0) throw new PaymentError("job not found");

  const status = j.rows[0].status as string;
  if (status !== "done" && status !== "paid") {
    throw new PaymentError(`job must be 'done' before capture, is '${status}'`);
  }
  const amountCents = j.rows[0].final_price_cents as number | null;
  if (amountCents == null) throw new PaymentError("job has no settled final_price_cents");

  // Idempotency ledger: one row per Stripe identifier. A duplicate delivery hits the
  // UNIQUE(stripe_event_id) constraint and is dropped (ON CONFLICT DO NOTHING).
  const ins = await tx.query(
    `INSERT INTO webhook_events (co_op_id, provider, stripe_event_id, job_id, processed_at)
     VALUES ($1, 'stripe', $2, $3, now())
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING id`,
    [coOpId, stripePaymentIntentId, jobId],
  );
  const firstDelivery = (ins.rowCount ?? 0) > 0;

  // Only the FIRST delivery transitions the job to paid — duplicates are a no-op.
  if (firstDelivery) {
    await tx.query("UPDATE jobs SET status = 'paid' WHERE id = $1 AND co_op_id = $2", [jobId, coOpId]);
  }
  return { captured: firstDelivery, amountCents };
}
