// Refund ledger (platform, sector-agnostic). recordRefund INSERTs exactly one row per
// payments payment (idempotent via the UNIQUE(payment_id) on refund_ledger). Honest
// ledger (std §3): no in-place overwrite — a re-issue attempt hits the UNIQUE
// constraint and is dropped (ON CONFLICT DO NOTHING), mirroring platform/payout/payout.ts
// (recordPayout). The ledger is append-only (no UPDATE/DELETE grant). On the FIRST
// (idempotent) recording, the underlying payments row is transitioned to 'refunded'
// (status + refunded_at + refund_amount_cents) so the payment's own state matches the
// ledger — a duplicate re-issue leaves it untouched. Runs in the caller's tenant tx.
import type { PoolClient } from "pg";

export class RefundError extends Error {}

export async function recordRefund(
  tx: PoolClient,
  coOpId: string,
  paymentId: string,
  amountCents: number,
  reason: string,
): Promise<{ recorded: boolean }> {
  if (amountCents <= 0) {
    throw new RefundError("refund amount must be positive");
  }
  // A refund can never exceed what was captured. Read the payment under the caller's
  // tenant context (RLS already scopes to co_op_id; the explicit predicate is defence
  // in depth). A missing row means wrong tenant or bad id — fail closed, don't refund.
  const p = await tx.query<{ amount_cents: number }>(
    "SELECT amount_cents FROM payments WHERE id = $1 AND co_op_id = $2",
    [paymentId, coOpId],
  );
  if (p.rowCount === 0) {
    throw new RefundError("payment not found");
  }
  if (amountCents > Number(p.rows[0]!.amount_cents)) {
    throw new RefundError("refund amount exceeds original payment");
  }
  const r = await tx.query(
    `INSERT INTO refund_ledger (co_op_id, payment_id, amount_cents, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING id`,
    [coOpId, paymentId, amountCents, reason],
  );
  const recorded = (r.rowCount ?? 0) > 0;
  if (recorded) {
    await tx.query(
      `UPDATE payments
          SET status = 'refunded', refunded_at = now(), refund_amount_cents = $3
        WHERE id = $1 AND co_op_id = $2`,
      [paymentId, coOpId, amountCents],
    );
  }
  return { recorded };
}
