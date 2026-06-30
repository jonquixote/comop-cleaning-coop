// Step 4 — completeJob write-back + guards (TDD, rollback-isolated). Logs hours onto the
// assignment (labor basis), marks it completed and the job done.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { completeJob, CompletionError } from "../../platform/execution/completion";
import { assignJob } from "../../platform/dispatch/dispatch";
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

async function setupAssignment(tx: PoolClient): Promise<{ jobId: string; assignmentId: string }> {
  const cust = await tx.query(
    "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
    [COOP_A, "exec@test"],
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
  const a = await assignJob(tx, COOP_A, {
    jobId: booked.jobId,
    memberId,
    startsAt: "2026-07-01T09:00:00Z",
    endsAt: "2026-07-01T11:00:00Z",
  });
  return { jobId: booked.jobId, assignmentId: a.assignmentId };
}

describe("completeJob — write-back + guards", () => {
  test("logs hours, marks the assignment completed and the job done (final = quoted)", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { jobId, assignmentId } = await setupAssignment(tx);
      const r = await completeJob(tx, COOP_A, { assignmentId, hoursLogged: 2 });
      expect(r.jobId).toBe(jobId);

      const a = await tx.query("SELECT hours_logged, status FROM job_assignments WHERE id = $1", [assignmentId]);
      expect(Number(a.rows[0].hours_logged)).toBe(2);
      expect(a.rows[0].status).toBe("completed");

      const j = await tx.query("SELECT status, final_price_cents, quoted_price_cents FROM jobs WHERE id = $1", [jobId]);
      expect(j.rows[0].status).toBe("done");
      expect(j.rows[0].final_price_cents).toBe(j.rows[0].quoted_price_cents);
    });
  });

  test("rejects completing an assignment twice", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { assignmentId } = await setupAssignment(tx);
      await completeJob(tx, COOP_A, { assignmentId, hoursLogged: 2 });
      await expect(completeJob(tx, COOP_A, { assignmentId, hoursLogged: 2 })).rejects.toThrow(CompletionError);
    });
  });

  test("rejects non-positive hours", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { assignmentId } = await setupAssignment(tx);
      await expect(completeJob(tx, COOP_A, { assignmentId, hoursLogged: 0 })).rejects.toThrow(CompletionError);
    });
  });
});
