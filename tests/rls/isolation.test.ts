// MANDATORY fail-closed isolation invariant (Engineering Standard §1, §8a).
// Breaking this breaks a load-bearing wall (onboarding §2). Positive control FIRST,
// so the fail-closed assertion cannot false-green on an empty table. Queries `members`.
import { describe, test, expect, afterAll } from "vitest";
import { pool, withTenantTx } from "../../platform/db/internal/tenant-tx";
import { COOP_A, COOP_B } from "../../ops/fixtures";

afterAll(async () => {
  await pool.end();
});

describe("RLS fail-closed isolation (seeded co-op A + dormant co-op B)", () => {
  test("positive control: co-op A context SEES co-op A's own members", async () => {
    const r = await withTenantTx(COOP_A, (tx) => tx.query("SELECT id FROM members"));
    expect(r.rowCount ?? 0).toBeGreaterThan(0); // rows DO exist for A
  });

  test("isolation: co-op A context sees NONE of co-op B's members", async () => {
    const r = await withTenantTx(COOP_A, (tx) =>
      tx.query("SELECT id FROM members WHERE co_op_id = $1", [COOP_B]),
    );
    expect(r.rowCount ?? 0).toBe(0);
  });

  test("fail-closed: no tenant context returns zero rows (though rows exist)", async () => {
    const tx = await pool.connect(); // NO set_config — context unset
    try {
      const r = await tx.query("SELECT id FROM members");
      expect(r.rowCount ?? 0).toBe(0); // HIDDEN, not absent — proven by the positive control
    } finally {
      tx.release();
    }
  });
});
