// Payments query helpers — getPaymentsForJob, getPaymentsForCustomer, recordRefund.
// Tests use rollback-isolated transactions so no data persists. Includes cross-tenant
// isolation check (RLS tenant_isolation policy using nullif).
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import {
  getPaymentsForJob,
  getPaymentsForCustomer,
  recordRefund,
} from "../../platform/payments/payments";
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

  test("recordRefund updates status + timestamps", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, customerId } = await seedPaidJobWithPayment(tx, "ref");
      const pmt = await tx.query(
        `INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents, status, paid_at)
         VALUES ($1,$2,$3,200,'succeeded',now()) RETURNING id`,
        [COOP_A, jobId, customerId],
      );
      const paymentId = pmt.rows[0].id as string;
      await recordRefund(tx, COOP_A, paymentId, 200, "customer request");
      const r = await tx.query(
        "SELECT status, refunded_at, refund_amount_cents, failure_reason FROM payments WHERE id = $1",
        [paymentId],
      );
      expect(r.rows[0].status).toBe("refunded");
      expect(r.rows[0].refund_amount_cents).toBe(200);
      expect(r.rows[0].refunded_at).not.toBeNull();
      expect(r.rows[0].failure_reason).toBe("customer request");
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
