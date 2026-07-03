// Step 3a invite flow (spec §3a.1): worker-owners are INVITED, never self-registered.
// Token is hashed before storage; plaintext may only leave via the issueInvite
// return value. Rollback-isolated.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { issueInvite, redeemInvite, InviteError } from "../../platform/identity/invite";
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

// Each test needs an admin (or member) to be `issued_by`. The seed provisions an
// admin 'a-admin@example.test' for COOP_A; on local DBs without seed we provision
// one in-place so the test is hermetic.
async function getOrCreateAdminMemberId(tx: PoolClient): Promise<string> {
  const existing = await tx.query(
    "SELECT id FROM members WHERE co_op_id = $1 ORDER BY joined_at ASC LIMIT 1",
    [COOP_A],
  );
  if ((existing.rowCount ?? 0) > 0) return existing.rows[0].id as string;
  const u = await tx.query(
    `INSERT INTO users (co_op_id, role, email)
     VALUES ($1, 'admin', 'test-admin@example.test')
     ON CONFLICT (co_op_id, email) DO NOTHING
     RETURNING id`,
    [COOP_A],
  );
  // Race-safe: fetch by email if INSERT was a no-op.
  const userId =
    (u.rows[0]?.id as string | undefined) ??
    (await tx.query(
      "SELECT id FROM users WHERE co_op_id = $1 AND email = 'test-admin@example.test'",
      [COOP_A],
    )).rows[0]!.id as string;
  const m = await tx.query(
    `INSERT INTO members (co_op_id, user_id, status)
     VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [COOP_A, userId],
  );
  if (m.rowCount && m.rowCount > 0) return m.rows[0].id as string;
  const back = await tx.query(
    "SELECT id FROM members WHERE co_op_id = $1 AND user_id = $2",
    [COOP_A, userId],
  );
  return back.rows[0]!.id as string;
}

describe("invite flow — issue + redeem (spec §3a.1)", () => {
  test("happy path: issue → redeem → worker user + probationary member created", async () => {
    await withRollback(COOP_A, async (tx) => {
      const adminId = await getOrCreateAdminMemberId(tx);
      const { token } = await issueInvite(tx, COOP_A, adminId, { email: "new-worker@example.test" });
      expect(token).toBeTruthy();

      // redeem runs without a tenant context yet — but inside the outer tx
      // that already has COOP_A context set, which is fine.
      const { userId, memberId, coOpId } = await redeemInvite(tx, token);
      expect(coOpId).toBe(COOP_A);

      const user = await tx.query(
        "SELECT role, email FROM users WHERE id = $1",
        [userId],
      );
      expect(user.rows[0].role).toBe("worker");
      expect(user.rows[0].email).toBe("new-worker@example.test");

      const member = await tx.query(
        "SELECT status FROM members WHERE id = $1",
        [memberId],
      );
      expect(member.rows[0].status).toBe("probationary");
    });
  });

  test("expires_in_hours honored: with an expiry in the past, redeem is rejected", async () => {
    await withRollback(COOP_A, async (tx) => {
      const adminId = await getOrCreateAdminMemberId(tx);
      // Negative hours puts expires_at in the past without depending on SQL sha256().
      const { token } = await issueInvite(tx, COOP_A, adminId, { expiresInHours: -1 });

      await expect(redeemInvite(tx, token)).rejects.toBeInstanceOf(InviteError);
      await expect(redeemInvite(tx, token)).rejects.toThrow(/expired/);
    });
  });

  test("already redeemed: a second attempt on the same token is rejected", async () => {
    await withRollback(COOP_A, async (tx) => {
      const adminId = await getOrCreateAdminMemberId(tx);
      const { token } = await issueInvite(tx, COOP_A, adminId, { email: "dup-test@example.test" });
      const first = await redeemInvite(tx, token);
      expect(first.userId).toBeTruthy();

      await expect(redeemInvite(tx, token)).rejects.toBeInstanceOf(InviteError);
      await expect(redeemInvite(tx, token)).rejects.toThrow(/already redeemed/);
    });
  });

  test("wrong token: a forgery is rejected with InviteError", async () => {
    await withRollback(COOP_A, async (tx) => {
      await expect(redeemInvite(tx, "this-is-not-a-real-token-zzz")).rejects.toBeInstanceOf(InviteError);
      await expect(redeemInvite(tx, "this-is-not-a-real-token-zzz")).rejects.toThrow(/not found/);
    });
  });

  test("two distinct issues produce two distinct tokens and two distinct redemptions", async () => {
    await withRollback(COOP_A, async (tx) => {
      const adminId = await getOrCreateAdminMemberId(tx);
      const a = await issueInvite(tx, COOP_A, adminId, { email: "alpha@example.test" });
      const b = await issueInvite(tx, COOP_A, adminId, { email: "beta@example.test" });
      expect(a.token).not.toBe(b.token);

      const ra = await redeemInvite(tx, a.token);
      const rb = await redeemInvite(tx, b.token);
      expect(ra.userId).not.toBe(rb.userId);
      expect(ra.memberId).not.toBe(rb.memberId);
    });
  });
});
