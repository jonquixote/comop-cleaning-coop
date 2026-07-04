// Refund ledger (platform, sector-agnostic). recordRefund INSERTs exactly one row per
// payments payment (idempotent via the UNIQUE(payment_id) on refund_ledger). Honest
// ledger (std §3): no in-place overwrite — a re-issue attempt hits the UNIQUE
// constraint and is dropped (ON CONFLICT DO NOTHING), mirroring platform/payout/payout.ts
// (recordPayout). The ledger is append-only (no UPDATE/DELETE grant). Caller is expected
// to transition the underlying payments row to 'refunded' out-of-band if it needs to
// (the ledger is the source of truth for refund accounting). Runs in the caller's
// tenant tx.
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
  const r = await tx.query(
    `INSERT INTO refund_ledger (co_op_id, payment_id, amount_cents, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING id`,
    [coOpId, paymentId, amountCents, reason],
  );
  return { recorded: (r.rowCount ?? 0) > 0 };
}
