// Step 3 dispatch (TDD). The engine owns when/who/where-order: availability + conflict
// detection + manual assignment. NO route optimization. Rollback-isolated.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { assignJob, DispatchError } from "../../platform/dispatch/dispatch";
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

// a job (via booking) + the seeded co-op A member + a wide availability window
async function setup(tx: PoolClient): Promise<{ jobId: string; memberId: string }> {
  const cust = await tx.query(
    "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
    [COOP_A, "dispatch@test"],
  );
  await tx.query(
    `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
    [COOP_A],
  );
  const booked = await createCleaningBooking(tx, COOP_A, {
    customerId: cust.rows[0].id as string,
    details: { sqft: 800, bedrooms: 1, bathrooms: 1, addons: [] },
  });
  const mem = await tx.query("SELECT id FROM members LIMIT 1");
  const memberId = mem.rows[0].id as string;
  await tx.query(
    "INSERT INTO worker_availability (co_op_id, member_id, starts_at, ends_at) VALUES ($1, $2, $3, $4)",
    [COOP_A, memberId, "2026-07-01T08:00:00Z", "2026-07-01T18:00:00Z"],
  );
  return { jobId: booked.jobId, memberId };
}

describe("dispatch — manual assignment + conflict detection", () => {
  test("assigns when the member is available and there is no conflict", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, memberId } = await setup(tx);
      const r = await assignJob(tx, COOP_A, { jobId, memberId, startsAt: "2026-07-01T09:00:00Z", endsAt: "2026-07-01T11:00:00Z" });
      expect(r.assignmentId).toBeTruthy();
    });
  });

  test("rejects an overlapping shift for the same member (conflict detection)", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, memberId } = await setup(tx);
      await assignJob(tx, COOP_A, { jobId, memberId, startsAt: "2026-07-01T09:00:00Z", endsAt: "2026-07-01T11:00:00Z" });
      await expect(
        assignJob(tx, COOP_A, { jobId, memberId, startsAt: "2026-07-01T10:00:00Z", endsAt: "2026-07-01T12:00:00Z" }),
      ).rejects.toThrow(DispatchError);
    });
  });

  test("rejects a shift outside the member's availability", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, memberId } = await setup(tx);
      await expect(
        assignJob(tx, COOP_A, { jobId, memberId, startsAt: "2026-07-01T19:00:00Z", endsAt: "2026-07-01T20:00:00Z" }),
      ).rejects.toThrow(DispatchError);
    });
  });

  test("allows a second NON-overlapping shift for the same member", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, memberId } = await setup(tx);
      await assignJob(tx, COOP_A, { jobId, memberId, startsAt: "2026-07-01T09:00:00Z", endsAt: "2026-07-01T11:00:00Z" });
      const r2 = await assignJob(tx, COOP_A, { jobId, memberId, startsAt: "2026-07-01T12:00:00Z", endsAt: "2026-07-01T14:00:00Z" });
      expect(r2.assignmentId).toBeTruthy();
    });
  });
});
