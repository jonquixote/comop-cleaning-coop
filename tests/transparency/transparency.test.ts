// Step 6 — getCoOpTransparencyReport: the live economics a member can see (TDD). Numbers
// must match the payout ledger + job data exactly (inform, don't steer — impl §6).
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { getCoOpTransparencyReport } from "../../platform/transparency/transparency";
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

interface PaidJob {
  final: number;
  surplus: number;
  labor: number;
  materials: number;
  overhead: number;
}

async function paidJob(tx: PoolClient, fraction: number): Promise<PaidJob> {
  const cust = await tx.query("INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id", [COOP_A, "t@test"]);
  await tx.query("INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', $2)", [
    COOP_A,
    JSON.stringify({ fraction }),
  ]);
  const booked = await createCleaningBooking(tx, COOP_A, {
    customerId: cust.rows[0].id as string,
    details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] },
  });
  // done → record payout (guard needs 'done') → paid (so it counts as revenue)
  await tx.query("UPDATE jobs SET status='done', final_price_cents=quoted_price_cents WHERE id=$1", [booked.jobId]);
  await recordPayout(tx, COOP_A, booked.jobId);
  await tx.query("UPDATE jobs SET status='paid' WHERE id=$1", [booked.jobId]);

  const b = (await tx.query("SELECT final_price_cents, breakdown_json FROM jobs WHERE id=$1", [booked.jobId])).rows[0];
  const bd = b.breakdown_json;
  return {
    final: b.final_price_cents,
    surplus: bd.surplus_cents,
    labor: bd.labor_cents,
    materials: bd.materials_cents,
    overhead: bd.overhead_alloc_cents,
  };
}

describe("getCoOpTransparencyReport", () => {
  test("numbers match the payout ledger + job data", async () => {
    await withRollback(COOP_A, async (tx) => {
      const j = await paidJob(tx, 0.2);
      const rep = await getCoOpTransparencyReport(tx, COOP_A);

      expect(rep.totalRevenueCents).toBe(j.final); // SUM(final_price_cents) of paid jobs
      expect(rep.surplusPoolCents).toBe(j.surplus); // SUM(payout_ledger.surplus_cents)
      expect(rep.laborCents).toBe(j.labor);
      expect(rep.materialsCents).toBe(j.materials);
      expect(rep.overheadCents).toBe(j.overhead);
      expect(rep.currentSurplusSplit).toBe(0.2); // current versioned policy
      expect(rep.policyVersionId).toBeTruthy();
    });
  });
});
