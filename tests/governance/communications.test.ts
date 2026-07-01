// Step 7 — the 4th MANDATORY invariant (std §1, §8a): a decision-mode communication without
// a linked proposal + attached computable economics is rejected AT WRITE TIME. Enforced in
// createCommunication AND by a DB trigger (a direct INSERT cannot bypass it). ADR-0008.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { createCommunication } from "../../platform/governance/communications";
import { createProposal } from "../../platform/governance/proposals";
import { GovernanceError } from "../../platform/governance/errors";
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

describe("valve write-constraint — decision-mode economics", () => {
  test("routine comm is allowed without a proposal", async () => {
    await withRollback(COOP_A, async (tx) => {
      const r = await createCommunication(tx, COOP_A, { mode: "routine", body: "weekly schedule notice" });
      expect(r.communicationId).toBeTruthy();
    });
  });

  test("decision comm rejected without a linked proposal", async () => {
    await withRollback(COOP_A, async (tx) => {
      await expect(createCommunication(tx, COOP_A, { mode: "decision", body: "vote now!" })).rejects.toThrow(GovernanceError);
    });
  });

  test("decision comm rejected when the proposal carries no computable economics", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { proposalId } = await createProposal(tx, COOP_A, { title: "no econ" }); // transparency_snapshot_json null
      await expect(createCommunication(tx, COOP_A, { mode: "decision", proposalId, body: "vote!" })).rejects.toThrow(GovernanceError);
    });
  });

  test("decision comm allowed when the proposal carries economics", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { proposalId } = await createProposal(tx, COOP_A, {
        title: "with econ",
        transparencySnapshot: { deltaSurplusCents: 500, deltaCustomerPriceCents: 300 },
      });
      const r = await createCommunication(tx, COOP_A, { mode: "decision", proposalId, body: "here is the math + vote" });
      expect(r.communicationId).toBeTruthy();
    });
  });

  test("write-time DB trigger: a direct INSERT of a decision comm without economics is rejected", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { proposalId } = await createProposal(tx, COOP_A, { title: "no econ" });
      await expect(
        tx.query("INSERT INTO communications (co_op_id, mode, proposal_id, body) VALUES ($1,'decision',$2,'sneaky direct insert')", [COOP_A, proposalId]),
      ).rejects.toThrow(/computable economics|transparency_snapshot/i);
    });
  });
});
