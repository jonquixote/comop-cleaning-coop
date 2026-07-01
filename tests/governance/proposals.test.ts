// Step 7 — proposal lifecycle + voting (TDD, rollback-isolated).
import { describe, test, expect, afterAll } from "vitest";
import { Client, type PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { createProposal, openProposal, castVote, closeProposal } from "../../platform/governance/proposals";
import { GovernanceError } from "../../platform/governance/errors";
import { COOP_A, COOP_B } from "../../ops/fixtures";

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
  const u = await tx.query("INSERT INTO users (co_op_id, role, email) VALUES ($1,'worker',$2) RETURNING id", [COOP_A, email]);
  const m = await tx.query("INSERT INTO members (co_op_id, user_id, status) VALUES ($1,$2,'member') RETURNING id", [COOP_A, u.rows[0].id]);
  return m.rows[0].id as string;
}

describe("proposal lifecycle + voting", () => {
  test("create → open → votes → close = passed", async () => {
    await withRollback(COOP_A, async (tx) => {
      const m1 = await newMember(tx, "v1@gov");
      const m2 = await newMember(tx, "v2@gov");
      const { proposalId } = await createProposal(tx, COOP_A, { title: "Raise the split", type: "surplus_split" });

      await expect(castVote(tx, COOP_A, proposalId, m1, "yes")).rejects.toThrow(GovernanceError); // draft: no voting
      await openProposal(tx, COOP_A, proposalId);
      await castVote(tx, COOP_A, proposalId, m1, "yes");
      await castVote(tx, COOP_A, proposalId, m2, "yes");

      const r = await closeProposal(tx, COOP_A, proposalId);
      expect(r.status).toBe("passed");
      expect(r.yes).toBe(2);
      expect(r.no).toBe(0);
      const p = await tx.query("SELECT status FROM proposals WHERE id=$1", [proposalId]);
      expect(p.rows[0].status).toBe("passed");
    });
  });

  test("close = failed when no > yes", async () => {
    await withRollback(COOP_A, async (tx) => {
      const m1 = await newMember(tx, "v3@gov");
      const { proposalId } = await createProposal(tx, COOP_A, { title: "x" });
      await openProposal(tx, COOP_A, proposalId);
      await castVote(tx, COOP_A, proposalId, m1, "no");
      const r = await closeProposal(tx, COOP_A, proposalId);
      expect(r.status).toBe("failed");
    });
  });

  test("double-vote rejected (one vote per member)", async () => {
    await withRollback(COOP_A, async (tx) => {
      const m1 = await newMember(tx, "v4@gov");
      const { proposalId } = await createProposal(tx, COOP_A, { title: "x" });
      await openProposal(tx, COOP_A, proposalId);
      await castVote(tx, COOP_A, proposalId, m1, "yes");
      await expect(castVote(tx, COOP_A, proposalId, m1, "no")).rejects.toThrow(GovernanceError);
    });
  });

  test("close guard: only an open proposal can be closed", async () => {
    await withRollback(COOP_A, async (tx) => {
      const { proposalId } = await createProposal(tx, COOP_A, { title: "x" }); // draft
      await expect(closeProposal(tx, COOP_A, proposalId)).rejects.toThrow(GovernanceError);
    });
  });

  test("castVote rejects a probationary (non-member) worker", async () => {
    await withRollback(COOP_A, async (tx) => {
      const u = await tx.query("INSERT INTO users (co_op_id, role, email) VALUES ($1,'worker','prob@gov') RETURNING id", [COOP_A]);
      const prob = await tx.query("INSERT INTO members (co_op_id, user_id, status) VALUES ($1,$2,'probationary') RETURNING id", [COOP_A, u.rows[0].id]);
      const { proposalId } = await createProposal(tx, COOP_A, { title: "x" });
      await openProposal(tx, COOP_A, proposalId);
      await expect(castVote(tx, COOP_A, proposalId, prob.rows[0].id as string, "yes")).rejects.toThrow(GovernanceError);
    });
  });

  test("castVote rejects a cross-tenant member (co-op B's member)", async () => {
    const suUrl = (process.env.SUPERUSER_DATABASE_URL ?? "").replace(/\/[^/]*$/, `/${process.env.DB_NAME ?? "comop"}`);
    const su = new Client({ connectionString: suUrl }); // superuser on the app DB (bypasses RLS) to read co-op B
    await su.connect();
    const b = await su.query("SELECT id FROM members WHERE co_op_id=$1 LIMIT 1", [COOP_B]);
    const bMemberId = b.rows[0].id as string;
    await su.end();
    await withRollback(COOP_A, async (tx) => {
      const { proposalId } = await createProposal(tx, COOP_A, { title: "x" });
      await openProposal(tx, COOP_A, proposalId);
      await expect(castVote(tx, COOP_A, proposalId, bMemberId, "yes")).rejects.toThrow(GovernanceError);
    });
  });
});
