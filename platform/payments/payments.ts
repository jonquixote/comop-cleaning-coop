// Payments query helpers (platform, sector-agnostic). Read-only accessors for the
// payments table written by platform/payments/stripe (capturePayment). All queries are
// multi-tenant: co_op_id + withSessionTx boundaries. Runs in the caller's tx.
import type { PoolClient } from "pg";

export interface Payment {
  id: string;
  jobId: string;
  customerId: string;
  amountCents: number;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  status: string;
  paidAt: string | null;
  failureReason: string | null;
  refundedAt: string | null;
  refundAmountCents: number | null;
}

export async function getPaymentsForJob(
  tx: PoolClient,
  coOpId: string,
  jobId: string,
): Promise<Payment[]> {
  const r = await tx.query(
    `SELECT id, job_id, customer_id, amount_cents,
            stripe_payment_intent_id, stripe_charge_id,
            status, paid_at, failure_reason, refunded_at, refund_amount_cents
       FROM payments
      WHERE co_op_id = $1 AND job_id = $2
      ORDER BY created_at DESC`,
    [coOpId, jobId],
  );
  return r.rows.map(mapPayment);
}

export async function getPaymentsForCustomer(
  tx: PoolClient,
  coOpId: string,
  customerId: string,
): Promise<Payment[]> {
  const r = await tx.query(
    `SELECT id, job_id, customer_id, amount_cents,
            stripe_payment_intent_id, stripe_charge_id,
            status, paid_at, failure_reason, refunded_at, refund_amount_cents
       FROM payments
      WHERE co_op_id = $1 AND customer_id = $2
      ORDER BY created_at DESC`,
    [coOpId, customerId],
  );
  return r.rows.map(mapPayment);
}

export async function recordRefund(
  tx: PoolClient,
  coOpId: string,
  paymentId: string,
  amountCents: number,
  reason: string,
): Promise<void> {
  await tx.query(
    `UPDATE payments
        SET status = 'refunded', refund_amount_cents = $3,
            refunded_at = now(), failure_reason = $4
      WHERE id = $1 AND co_op_id = $2`,
    [paymentId, coOpId, amountCents, reason],
  );
}

interface PaymentRow {
  id: string;
  job_id: string;
  customer_id: string;
  amount_cents: number | string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  status: string;
  paid_at: Date | null;
  failure_reason: string | null;
  refunded_at: Date | null;
  refund_amount_cents: number | string | null;
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    jobId: row.job_id,
    customerId: row.customer_id,
    amountCents: Number(row.amount_cents),
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeChargeId: row.stripe_charge_id,
    status: row.status,
    paidAt: row.paid_at ? row.paid_at.toISOString() : null,
    failureReason: row.failure_reason,
    refundedAt: row.refunded_at ? row.refunded_at.toISOString() : null,
    refundAmountCents:
      row.refund_amount_cents == null ? null : Number(row.refund_amount_cents),
  };
}
