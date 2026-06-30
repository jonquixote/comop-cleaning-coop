// Step 4 — payout ledger: economics integrity + append-only (TDD, rollback-isolated).
// recordPayout reads the FROZEN breakdown_json surplus (never recomputed); the ledger is
// append-only (app_user has no UPDATE/DELETE); the balance is a sum read.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { recordPayout, getCoOpSurplusBalance, PayoutError } from "../../platform/payout/payout";
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

async function setupDoneJob(tx: PoolClient, fraction: number): Promise<{ jobId: string; surplusCents: number }> {
  const cust = await tx.query(
    "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
    [COOP_A, "payout@test"],
  );
  await tx.query("INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', $2)", [
    COOP_A,
    JSON.stringify({ fraction }),
  ]);
  const booked = await createCleaningBooking(tx, COOP_A, {
    customerId: cust.rows[0].id as string,
    details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] },
  });
  await tx.query("UPDATE jobs SET status='done', final_price_cents=quoted_price_cents WHERE id=$1", [booked.jobId]);
  const j = await tx.query("SELECT breakdown_json FROM jobs WHERE id=$1", [booked.jobId]);
  return { jobId: booked.jobId, surplusCents: Number(j.rows[0].breakdown_json.surplus_cents) };
}

describe("payout ledger — economics integrity + append-only", () => {
  test("records the frozen breakdown surplus; idempotent; balance sums", async () => {
    await withRollback(COOP_A, async (tx) => {
      const a = await setupDoneJob(tx, 0.2);
      const r1 = await recordPayout(tx, COOP_A, a.jobId);
      expect(r1.recorded).toBe(true);
      expect(r1.surplusCents).toBe(a.surplusCents); // read from the frozen breakdown, not recomputed

      const row = await tx.query("SELECT surplus_cents FROM payout_ledger WHERE job_id=$1", [a.jobId]);
      expect(row.rows[0].surplus_cents).toBe(a.surplusCents);

      // idempotent: recording again does not double-credit
      const r2 = await recordPayout(tx, COOP_A, a.jobId);
      expect(r2.recorded).toBe(false);
      expect(await getCoOpSurplusBalance(tx)).toBe(a.surplusCents);

      // a second completed job adds to the balance
      const b = await setupDoneJob(tx, 0.3);
      await recordPayout(tx, COOP_A, b.jobId);
      expect(await getCoOpSurplusBalance(tx)).toBe(a.surplusCents + b.surplusCents);
    });
  });

  test("recordPayout requires a completed (done) job", async () => {
    await withRollback(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
        [COOP_A, "notdone@test"],
      );
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );
      const booked = await createCleaningBooking(tx, COOP_A, {
        customerId: cust.rows[0].id as string,
        details: { sqft: 800, bedrooms: 1, bathrooms: 1, addons: [] },
      });
      await expect(recordPayout(tx, COOP_A, booked.jobId)).rejects.toThrow(PayoutError); // status 'quoted'
    });
  });

  test("append-only: app_user has SELECT + INSERT but NOT UPDATE/DELETE on payout_ledger", async () => {
    await withRollback(COOP_A, async (tx) => {
      const g = await tx.query(
        "SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='app_user' AND table_name='payout_ledger'",
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
      await expect(tx.query("UPDATE payout_ledger SET surplus_cents = 0")).rejects.toThrow(/permission denied/i);
    });
  });
});
