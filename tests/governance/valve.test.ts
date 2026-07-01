// Step 7 — the valve: surplus_split changes ONLY via a passed surplus_split proposal, once,
// with a valid fraction (TDD + Step-7 authz hardening). New policy row carries set_by_proposal_id.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { createProposal, openProposal, castVote, closeProposal } from "../../platform/governance/proposals";
import { setSurplusSplitByProposal } from "../../platform/governance/valve";
import { GovernanceError } from "../../platform/governance/errors";
import { resolveCurrentPolicySnapshot } from "../../platform/policy/policy";
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

let memberSeq = 0;
async function passedProposal(tx: PoolClient, type = "surplus_split"): Promise<string> {
  const email = `vv-${memberSeq++}@valve`;
  const u = await tx.query("INSERT INTO users (co_op_id, role, email) VALUES ($1,'worker',$2) RETURNING id", [COOP_A, email]);
  const m = await tx.query("INSERT INTO members (co_op_id, user_id, status) VALUES ($1,$2,'member') RETURNING id", [COOP_A, u.rows[0].id]);
  const { proposalId } = await createProposal(tx, COOP_A, { title: "Set split", type });
  await openProposal(tx, COOP_A, proposalId);
  await castVote(tx, COOP_A, proposalId, m.rows[0].id as string, "yes");
  await closeProposal(tx, COOP_A, proposalId); // yes=1,no=0 → passed
  return proposalId;
}

describe("valve — surplus_split set only by a passed proposal", () => {
  test("rejects setting the split on a non-passed proposal", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { proposalId } = await createProposal(tx, COOP_A, { title: "x", type: "surplus_split" }); // draft
      await expect(setSurplusSplitByProposal(tx, COOP_A, proposalId, 0.3)).rejects.toThrow(GovernanceError);
    });
  });

  test("rejects a proposal whose type is not surplus_split", async () => {
    await withRollback(COOP_A, async (tx) => {
      const proposalId = await passedProposal(tx, "expenditure"); // passed, WRONG type
      await expect(setSurplusSplitByProposal(tx, COOP_A, proposalId, 0.3)).rejects.toThrow(GovernanceError);
    });
  });

  test("rejects a fraction outside [0,1]", async () => {
    await withRollback(COOP_A, async (tx) => {
      const proposalId = await passedProposal(tx);
      await expect(setSurplusSplitByProposal(tx, COOP_A, proposalId, 1.5)).rejects.toThrow(GovernanceError);
      await expect(setSurplusSplitByProposal(tx, COOP_A, proposalId, -0.1)).rejects.toThrow(GovernanceError);
    });
  });

  test("rejects reuse — a passed proposal sets the split only once", async () => {
    await withRollback(COOP_A, async (tx) => {
      const proposalId = await passedProposal(tx);
      await setSurplusSplitByProposal(tx, COOP_A, proposalId, 0.3);
      await expect(setSurplusSplitByProposal(tx, COOP_A, proposalId, 0.4)).rejects.toThrow(GovernanceError);
    });
  });

  test("a passed proposal writes a new policy_settings row with set_by_proposal_id; snapshot reflects it", async () => {
    await withRollback(COOP_A, async (tx) => {
      const proposalId = await passedProposal(tx);
      const { policyVersionId } = await setSurplusSplitByProposal(tx, COOP_A, proposalId, 0.35);

      const row = (await tx.query("SELECT key, value_json, set_by_proposal_id FROM policy_settings WHERE id=$1", [policyVersionId])).rows[0];
      expect(row.key).toBe("surplus_split");
      expect(Number(row.value_json.fraction)).toBe(0.35);
      expect(row.set_by_proposal_id).toBe(proposalId);

      const snap = await resolveCurrentPolicySnapshot(tx);
      expect(snap.surplusSplit).toBe(0.35);
      expect(snap.policyVersionId).toBe(policyVersionId);
    });
  });
});
