// Step 6 — closeAllocationPeriod: labor-basis surplus distribution (TDD, rollback-isolated).
// Patronage by labor (spec §4). Conservation: allocations sum to the total surplus exactly.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { closeAllocationPeriod, AllocationError } from "../../platform/allocation/allocation";
import { recordPayout } from "../../platform/payout/payout";
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

async function newMember(tx: PoolClient, email: string): Promise<string> {
  const u = await tx.query("INSERT INTO users (co_op_id, role, email) VALUES ($1, 'worker', $2) RETURNING id", [COOP_A, email]);
  const m = await tx.query("INSERT INTO members (co_op_id, user_id, status) VALUES ($1, $2, 'member') RETURNING id", [COOP_A, u.rows[0].id]);
  return m.rows[0].id as string;
}

async function setup(tx: PoolClient): Promise<{ periodId: string; m1: string; m2: string; totalSurplus: number }> {
  const cust = await tx.query("INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id", [COOP_A, "alloc@test"]);
  await tx.query(`INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`, [COOP_A]);
  const booked = await createCleaningBooking(tx, COOP_A, {
    customerId: cust.rows[0].id as string,
    details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] },
  });
  await tx.query("UPDATE jobs SET status='done', final_price_cents=quoted_price_cents WHERE id=$1", [booked.jobId]);
  const m1 = await newMember(tx, "w1@alloc");
  const m2 = await newMember(tx, "w2@alloc");
  // labor: m1 = 3h, m2 = 1h (both completed) on the job
  await tx.query(
    "INSERT INTO job_assignments (co_op_id, job_id, member_id, starts_at, ends_at, hours_logged, status) VALUES ($1,$2,$3,'2026-07-01T09:00:00Z','2026-07-01T12:00:00Z',3,'completed')",
    [COOP_A, booked.jobId, m1],
  );
  await tx.query(
    "INSERT INTO job_assignments (co_op_id, job_id, member_id, starts_at, ends_at, hours_logged, status) VALUES ($1,$2,$3,'2026-07-01T12:00:00Z','2026-07-01T13:00:00Z',1,'completed')",
    [COOP_A, booked.jobId, m2],
  );
  const pay = await recordPayout(tx, COOP_A, booked.jobId); // surplus into payout_ledger (recorded_at now)
  const period = await tx.query(
    "INSERT INTO allocation_periods (co_op_id, starts_at, ends_at) VALUES ($1, now() - interval '1 hour', now() + interval '1 hour') RETURNING id",
    [COOP_A],
  );
  return { periodId: period.rows[0].id as string, m1, m2, totalSurplus: pay.surplusCents };
}

describe("closeAllocationPeriod — labor-basis distribution", () => {
  test("distributes surplus by labor, conserving cents exactly; closes the period", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { periodId, m1, m2, totalSurplus } = await setup(tx);
      const r = await closeAllocationPeriod(tx, COOP_A, periodId);
      expect(r.totalSurplusCents).toBe(totalSurplus);

      const rows = (await tx.query("SELECT member_id, amount_cents, labor_basis FROM member_allocations WHERE period_id=$1", [periodId])).rows;
      const sum = rows.reduce((a: number, x) => a + x.amount_cents, 0);
      expect(sum).toBe(totalSurplus); // CONSERVATION — no cents created or lost

      const a1 = rows.find((x) => x.member_id === m1)!;
      const a2 = rows.find((x) => x.member_id === m2)!;
      expect(a1.amount_cents).toBeGreaterThan(a2.amount_cents); // 3h > 1h
      expect(Number(a1.labor_basis)).toBe(3);
      expect(Number(a2.labor_basis)).toBe(1);

      const p = await tx.query("SELECT status FROM allocation_periods WHERE id=$1", [periodId]);
      expect(p.rows[0].status).toBe("closed");
    });
  });

  test("rejects double-close", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { periodId } = await setup(tx);
      await closeAllocationPeriod(tx, COOP_A, periodId);
      await expect(closeAllocationPeriod(tx, COOP_A, periodId)).rejects.toThrow(AllocationError);
    });
  });

  test("one allocation row per member per period; ledger is append-only", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { periodId, m1 } = await setup(tx);
      await closeAllocationPeriod(tx, COOP_A, periodId);
      const c = await tx.query("SELECT count(*)::int AS n FROM member_allocations WHERE period_id=$1 AND member_id=$2", [periodId, m1]);
      expect(c.rows[0].n).toBe(1);

      const g = await tx.query(
        "SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='app_user' AND table_name='member_allocations'",
      );
      const privs = g.rows.map((r) => r.privilege_type as string);
      expect(privs).toContain("SELECT");
      expect(privs).toContain("INSERT");
      expect(privs).not.toContain("UPDATE");
      expect(privs).not.toContain("DELETE");
    });
  });
});
