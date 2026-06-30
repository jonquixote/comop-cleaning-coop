// MANDATORY TDD (std §1, §8a) — the freeze: re-pricing a job from its stored details +
// snapshotted policy_version_id reproduces the identical breakdown. A later surplus_split
// vote changes future quotes only; prices never change underneath people (threat-model mode 4).
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { getPolicySnapshotById } from "../../platform/policy/policy";
import { priceJob, type CleaningJobDetails } from "../../sectors/cleaning/pricing";
import { createCleaningBooking } from "../../sectors/cleaning/booking";
import { COOP_A } from "../../ops/fixtures";

afterAll(async () => {
  await pool.end();
});

// Tenant transaction that ALWAYS rolls back — isolated + re-runnable, nothing persists.
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

describe("policy snapshot freeze (threat-model mode 4)", () => {
  test("re-pricing by the snapshotted version reproduces the quote; a later vote changes future quotes only", async () => {
    await withRollback(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
        [COOP_A, "freeze@test"],
      );
      const customerId = cust.rows[0].id as string;

      // ensure at least one surplus_split version exists for the tenant
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );

      const details: CleaningJobDetails = { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] };
      const booked = await createCleaningBooking(tx, COOP_A, { customerId, details });

      const row = await tx.query(
        "SELECT quoted_price_cents, policy_version_id, breakdown_json FROM jobs WHERE id = $1",
        [booked.jobId],
      );
      const stored = row.rows[0];

      // the freeze: re-price from stored details + the snapshotted version → identical
      const snap = await getPolicySnapshotById(tx, stored.policy_version_id);
      const repriced = priceJob(details, snap);
      expect(repriced.final_price_cents).toBe(stored.quoted_price_cents);
      expect(repriced).toEqual(stored.breakdown_json);

      // a later vote with a different split prices differently — but only for FUTURE quotes
      const atDifferentSplit = priceJob(details, { policyVersionId: "ignored", surplusSplit: snap.surplusSplit + 0.5 });
      expect(atDifferentSplit.final_price_cents).not.toBe(stored.quoted_price_cents);
    });
  });
});
