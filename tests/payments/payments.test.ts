// Payments query helpers — getPaymentsForJob, getPaymentsForCustomer, recordRefund.
// recordRefund tests routed through platform/payments/refund.ts after v8 review Issue A:
// the prior inline UPDATE of the payments row was non-idempotent (silently allowed
// double-refund overwrites). recordRefund now INSERTs into refund_ledger (UNIQUE
// payment_id); retries become { recorded: false }. Tests use rollback-isolated
// transactions so no data persists. Includes cross-tenant isolation check (RLS
// tenant_isolation policy using nullif).
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { getPaymentsForJob, getPaymentsForCustomer } from "../../platform/payments/payments";
import { recordRefund } from "../../platform/payments/refund";
import { COOP_A, COOP_B } from "../../ops/fixtures";

afterAll(async () => {
  await pool.end();
});

async function withRollback(coOpId: string, fn: (tx: PoolClient) => Promise<void>): Promise<void> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('app.current_co_op', $1, true)", [coOpId]);
    await fn(tx);
  } finally {
    await tx.query("ROLLBACK");
    tx.release();
  }
}

async function seedPaidJobWithPayment(tx: PoolClient, suffix: string): Promise<{
  jobId: string;
  customerId: string;
  policyId: string;
}> {
  const cust = await tx.query(
    "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
    [COOP_A, `pay-${suffix}@pay`],
  );
  const customerId = cust.rows[0].id as string;
  const pol = await tx.query(
    `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')
     RETURNING id`,
    [COOP_A],
  );
  const policyId = pol.rows[0].id as string;
  const job = await tx.query(
    `INSERT INTO jobs (co_op_id, customer_id, sector, status, quoted_price_cents,
                       final_price_cents, policy_version_id, breakdown_json)
     VALUES ($1,$2,'cleaning','paid',200,200,$3,'{}') RETURNING id`,
    [COOP_A, customerId, policyId],
  );
  const jobId = job.rows[0].id as string;
  return { jobId, customerId, policyId };
}

describe("payments query helpers", () => {
  test("getPaymentsForJob returns inserted payment", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId } = await seedPaidJobWithPayment(tx, "got");
      await tx.query(
        `INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents, status, paid_at)
         VALUES ($1,$2,$3,200,'succeeded',now())`,
        [COOP_A, jobId, customerId],
      );
      const ps = await getPaymentsForJob(tx, COOP_A, jobId);
      expect(ps).toHaveLength(1);
      expect(ps[0]!.amountCents).toBe(200);
      expect(ps[0]!.status).toBe("succeeded");
    });
  });

  test("getPaymentsForCustomer returns all payments for a customer", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId, policyId } = await seedPaidJobWithPayment(tx, "cust1");
      const job2 = await tx.query(
        `INSERT INTO jobs (co_op_id, customer_id, sector, status, quoted_price_cents,
                           final_price_cents, policy_version_id, breakdown_json)
         VALUES ($1,$2,'cleaning','paid',300,300,$3,'{}') RETURNING id`,
        [COOP_A, customerId, policyId],
      );
      await tx.query(
        `INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents, status, paid_at)
         VALUES ($1,$2,$3,200,'succeeded',now()),
                ($1,$4,$3,300,'succeeded',now())`,
        [COOP_A, jobId, customerId, job2.rows[0].id],
      );
      const ps = await getPaymentsForCustomer(tx, COOP_A, customerId);
      expect(ps.length).toBe(2);
      const amounts = ps.map((p) => p.amountCents).sort();
      expect(amounts).toEqual([200, 300]);
    });
  });

  test("recordRefund inserts into refund_ledger and is idempotent on retry", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId } = await seedPaidJobWithPayment(tx, "ref");
      const pmt = await tx.query(
        `INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents, status, paid_at)
         VALUES ($1,$2,$3,200,'succeeded',now()) RETURNING id`,
        [COOP_A, jobId, customerId],
      );
      const paymentId = pmt.rows[0].id as string;

      // First call: replay creates the ledger row.
      const r1 = await recordRefund(tx, COOP_A, paymentId, 200, "customer request");
      expect(r1).toEqual({ recorded: true });

      const ledger = await tx.query(
        `SELECT amount_cents, reason FROM refund_ledger WHERE payment_id = $1`,
        [paymentId],
      );
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0].amount_cents).toBe(200);
      expect(ledger.rows[0].reason).toBe("customer request");

      // Second call: same paymentId hits UNIQUE(payment_id) and is a no-op.
      const r2 = await recordRefund(tx, COOP_A, paymentId, 200, "customer request");
      expect(r2).toEqual({ recorded: false });

      const ledger2 = await tx.query(
        `SELECT count(*)::int AS n FROM refund_ledger WHERE payment_id = $1`,
        [paymentId],
      );
      expect(ledger2.rows[0].n).toBe(1); // exactly one ledger row, no overwrite
    });
  });

  test("recordRefund rejects non-positive amount", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId } = await seedPaidJobWithPayment(tx, "refneg");
      const pmt = await tx.query(
        `INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents, status, paid_at)
         VALUES ($1,$2,$3,200,'succeeded',now()) RETURNING id`,
        [COOP_A, jobId, customerId],
      );
      await expect(
        recordRefund(tx, COOP_A, pmt.rows[0].id as string, 0, "test"),
      ).rejects.toThrow(/positive/);
    });
  });

  test("cross-tenant isolation: COOP_B sees zero COOP_A payments", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId } = await seedPaidJobWithPayment(tx, "iso");
      await tx.query(
        `INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents, status, paid_at)
         VALUES ($1,$2,$3,200,'succeeded',now())`,
        [COOP_A, jobId, customerId],
      );
      await tx.query("SELECT set_config('app.current_co_op', $1, true)", [COOP_B]);
      const ps = await getPaymentsForJob(tx, COOP_B, jobId);
      expect(ps).toHaveLength(0);
    });
  });
});

describe("payments backfill — v8 review Issue C", () => {
  // Backfill originally used ON CONFLICT DO NOTHING with no unique constraint against
  // which to conflict, so a re-run silently inserted duplicate rows. Migrated to a
  // WHERE NOT EXISTS guard. These tests run the same INSERT/SELECT pattern twice and
  // assert the count stays at 1.
  test("backfill is idempotent on re-run: WHERE NOT EXISTS prevents duplicates", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId } = await seedPaidJobWithPayment(tx, "bf");
      const insertSql = `
        INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents,
                              stripe_payment_intent_id, status, paid_at)
        SELECT co_op_id, id, customer_id, final_price_cents,
               'backfill-' || id, 'succeeded', COALESCE(updated_at, created_at)
        FROM jobs
        WHERE id = $1
          AND final_price_cents IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM payments
            WHERE payments.co_op_id = jobs.co_op_id
              AND payments.job_id = jobs.id
          )`;
      await tx.query(insertSql, [jobId]); // first run: insert
      await tx.query(insertSql, [jobId]); // re-run: should not insert anything (idempotent)
      const r = await tx.query(
        "SELECT count(*)::int AS n FROM payments WHERE job_id = $1",
        [jobId],
      );
      expect(r.rows[0].n).toBe(1);
      // sanity: customerId referenced from the seed-aligned payments row
      const row = await tx.query(
        "SELECT customer_id FROM payments WHERE job_id = $1",
        [jobId],
      );
      expect(row.rows[0].customer_id).toBe(customerId);
    });
  });
});
