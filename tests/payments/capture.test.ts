// Step 5 — Stripe capture + webhook idempotency (TDD, rollback-isolated). Threat-model
// mode 2: a duplicate webhook delivery must never double-charge.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { capturePayment, PaymentError } from "../../platform/payments/stripe";
import { createCleaningBooking } from "../../sectors/cleaning/booking";
import { COOP_A } from "../../ops/fixtures";

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

async function setupDoneJob(tx: PoolClient): Promise<{ jobId: string; finalCents: number }> {
  const cust = await tx.query(
    "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
    [COOP_A, "pay@test"],
  );
  await tx.query(
    `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
    [COOP_A],
  );
  const booked = await createCleaningBooking(tx, COOP_A, {
    customerId: cust.rows[0].id as string,
    details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] },
  });
  await tx.query("UPDATE jobs SET status='done', final_price_cents=quoted_price_cents WHERE id=$1", [booked.jobId]);
  const j = await tx.query("SELECT final_price_cents FROM jobs WHERE id=$1", [booked.jobId]);
  return { jobId: booked.jobId, finalCents: j.rows[0].final_price_cents as number };
}

describe("capturePayment — capture + idempotency + guards", () => {
  test("captures: marks the job paid, records the event once, amount == final_price_cents", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, finalCents } = await setupDoneJob(tx);
      const r = await capturePayment(tx, COOP_A, jobId, "pi_test_123");
      expect(r.captured).toBe(true);
      expect(r.amountCents).toBe(finalCents); // read from the job, never recomputed

      const j = await tx.query("SELECT status FROM jobs WHERE id=$1", [jobId]);
      expect(j.rows[0].status).toBe("paid");
      const w = await tx.query("SELECT count(*)::int AS n FROM webhook_events WHERE stripe_event_id=$1", ["pi_test_123"]);
      expect(w.rows[0].n).toBe(1);
      const p = await tx.query(
        "SELECT count(*)::int AS n FROM payments WHERE job_id = $1",
        [jobId],
      );
      expect(p.rows[0].n).toBe(1);
    });
  });

  test("captures: persists stripeChargeId on jobs and payments when provided (Issue B)", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId } = await setupDoneJob(tx);
      const r = await capturePayment(tx, COOP_A, jobId, "pi_charge_test", "ch_abc123");
      expect(r.captured).toBe(true);

      const j = await tx.query("SELECT status, stripe_charge_id FROM jobs WHERE id=$1", [jobId]);
      expect(j.rows[0].status).toBe("paid");
      expect(j.rows[0].stripe_charge_id).toBe("ch_abc123");

      const p = await tx.query(
        "SELECT stripe_charge_id FROM payments WHERE job_id = $1",
        [jobId],
      );
      expect(p.rows).toHaveLength(1);
      expect(p.rows[0].stripe_charge_id).toBe("ch_abc123");
    });
  });

  test("captures: stripeChargeId is nullable when omitted", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId } = await setupDoneJob(tx);
      const r = await capturePayment(tx, COOP_A, jobId, "pi_charge_null");
      expect(r.captured).toBe(true);

      const j = await tx.query("SELECT stripe_charge_id FROM jobs WHERE id=$1", [jobId]);
      expect(j.rows[0].stripe_charge_id).toBeNull();
    });
  });

  test("duplicate delivery is idempotent — no double-charge", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, finalCents } = await setupDoneJob(tx);
      const r1 = await capturePayment(tx, COOP_A, jobId, "pi_dup_1");
      const r2 = await capturePayment(tx, COOP_A, jobId, "pi_dup_1");
      expect(r1.captured).toBe(true);
      expect(r2.captured).toBe(false); // second delivery is a no-op
      expect(r2.amountCents).toBe(finalCents);

      const w = await tx.query("SELECT count(*)::int AS n FROM webhook_events WHERE stripe_event_id=$1", ["pi_dup_1"]);
      expect(w.rows[0].n).toBe(1); // recorded exactly once
      const j = await tx.query("SELECT status FROM jobs WHERE id=$1", [jobId]);
      expect(j.rows[0].status).toBe("paid");
    });
  });

  test("rejects capture when the job is not 'done'", async () => {
    await withRollback(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
        [COOP_A, "notdone@pay"],
      );
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );
      const booked = await createCleaningBooking(tx, COOP_A, {
        customerId: cust.rows[0].id as string,
        details: { sqft: 800, bedrooms: 1, bathrooms: 1, addons: [] },
      });
      await expect(capturePayment(tx, COOP_A, booked.jobId, "pi_x")).rejects.toThrow(PaymentError); // status 'quoted'
    });
  });

  test("append-only: app_user has SELECT + INSERT but NOT UPDATE/DELETE on webhook_events", async () => {
    await withRollback(COOP_A, async (tx) => {
      const g = await tx.query(
        "SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='app_user' AND table_name='webhook_events'",
      );
      const privs = g.rows.map((r) => r.privilege_type as string);
      expect(privs).toContain("SELECT");
      expect(privs).toContain("INSERT");
      expect(privs).not.toContain("UPDATE");
      expect(privs).not.toContain("DELETE");
    });
  });

  test("append-only: a runtime UPDATE is denied", async () => {
    await withRollback(COOP_A, async (tx) => {
      await expect(tx.query("UPDATE webhook_events SET status='ignored'")).rejects.toThrow(/permission denied/i);
    });
  });
});
