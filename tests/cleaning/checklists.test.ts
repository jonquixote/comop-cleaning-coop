// Cleaning checklists (sector code, ADR-0003) — getTemplatesForJob derivation + createJobChecklists
// insertion. Tests use rollback-isolated transactions, derive-only means no template-table seeding.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { getTemplatesForJob } from "../../sectors/cleaning/checklists";
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

describe("getTemplatesForJob", () => {
  test("2 bed, 1 bath → 5 rooms", () => {
    const r = getTemplatesForJob({ sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] });
    expect(r.map((x) => x.room)).toEqual([
      "Kitchen",
      "Bathroom",
      "Bedroom 1",
      "Bedroom 2",
      "Living Room",
    ]);
  });

  test("0 bed, 0 bath → 2 rooms (kitchen + living room)", () => {
    const r = getTemplatesForJob({ sqft: 500, bedrooms: 0, bathrooms: 0, addons: [] });
    expect(r.map((x) => x.room)).toEqual(["Kitchen", "Living Room"]);
  });

  test("3 bed, 2 bath → 7 rooms with numbered labels for multiples", () => {
    const r = getTemplatesForJob({ sqft: 1500, bedrooms: 3, bathrooms: 2, addons: [] });
    expect(r.map((x) => x.room)).toEqual([
      "Kitchen",
      "Bathroom 1",
      "Bathroom 2",
      "Bedroom 1",
      "Bedroom 2",
      "Bedroom 3",
      "Living Room",
    ]);
  });

  test("add-ons generate checklist work (kitchen extras + windows + deep-clean sections)", () => {
    const r = getTemplatesForJob({
      sqft: 1200,
      bedrooms: 1,
      bathrooms: 1,
      addons: ["inside_fridge", "inside_oven", "windows", "deep_clean"],
    });
    const rooms = r.map((x) => x.room);
    expect(rooms).toContain("Windows");
    expect(rooms).toContain("Deep Clean");
    const kitchen = r.find((x) => x.room === "Kitchen")!;
    const kitchenTasks = kitchen.tasks.map((t) => t.description);
    expect(kitchenTasks).toContain("Clean inside refrigerator");
    expect(kitchenTasks).toContain("Clean inside oven");
  });

  test("no add-ons → no add-on rooms (kitchen has only base tasks)", () => {
    const r = getTemplatesForJob({ sqft: 800, bedrooms: 1, bathrooms: 1, addons: [] });
    expect(r.map((x) => x.room)).not.toContain("Windows");
    expect(r.map((x) => x.room)).not.toContain("Deep Clean");
    const kitchen = r.find((x) => x.room === "Kitchen")!;
    expect(kitchen.tasks.map((t) => t.description)).not.toContain("Clean inside oven");
  });

  test("optional tasks marked correctly (baseboards optional, others required)", () => {
    const r = getTemplatesForJob({ sqft: 800, bedrooms: 1, bathrooms: 1, addons: [] });
    for (const room of r) {
      for (const task of room.tasks) {
        if (task.description.includes("baseboards")) expect(task.optional).toBe(true);
        else expect(task.optional).toBe(false);
      }
    }
  });
});

describe("createJobChecklists (via createCleaningBooking)", () => {
  test("2 bed, 1 bath → creates 5 job_cleaning_checklists rows", async () => {
    await withRollback(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
        [COOP_A, "checklist-test"],
      );
      const customerId = cust.rows[0].id as string;
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );
      const booked = await createCleaningBooking(tx, COOP_A, {
        customerId,
        details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] },
      });
      const r = await tx.query(
        "SELECT count(*)::int AS n FROM job_cleaning_checklists WHERE job_id = $1",
        [booked.jobId],
      );
      expect(r.rows[0].n).toBe(5);
    });
  });

  test("0 bed, 0 bath → creates 2 job_cleaning_checklists rows", async () => {
    await withRollback(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
        [COOP_A, "checklist-zero"],
      );
      const customerId = cust.rows[0].id as string;
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );
      const booked = await createCleaningBooking(tx, COOP_A, {
        customerId,
        details: { sqft: 500, bedrooms: 0, bathrooms: 0, addons: [] },
      });
      const r = await tx.query(
        "SELECT count(*)::int AS n FROM job_cleaning_checklists WHERE job_id = $1",
        [booked.jobId],
      );
      expect(r.rows[0].n).toBe(2);
    });
  });

  test("tasks JSON array is well-formed and contains descriptions", async () => {
    await withRollback(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1, $2) RETURNING id",
        [COOP_A, "checklist-tasks"],
      );
      const customerId = cust.rows[0].id as string;
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );
      const booked = await createCleaningBooking(tx, COOP_A, {
        customerId,
        details: { sqft: 1000, bedrooms: 1, bathrooms: 1, addons: [] },
      });
      const r = await tx.query(
        "SELECT room, tasks FROM job_cleaning_checklists WHERE job_id = $1",
        [booked.jobId],
      );
      expect(r.rows.length).toBe(4); // kitchen + bathroom + bedroom + living room
      for (const row of r.rows) {
        expect(row.tasks).toBeTruthy();
        const tasks = row.tasks as { description: string; optional: boolean }[];
        expect(Array.isArray(tasks)).toBe(true);
        expect(tasks.length).toBeGreaterThan(0);
        for (const t of tasks) {
          expect(typeof t.description).toBe("string");
          expect(typeof t.optional).toBe("boolean");
        }
      }
    });
  });
});
