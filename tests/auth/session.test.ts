// Task 6 — password hashing + the session-resolved door (impl §3a.1, ADR-0004 §3, ADR-0005).
import { describe, test, expect, afterAll } from "vitest";
import { pool, withTenantTx } from "../../platform/db/internal/tenant-tx";
import { createSession, resolveSession, revokeSession } from "../../platform/identity/session";
import { withSessionTx } from "../../platform/identity/session-tx";
import { hashPassword, verifyPassword } from "../../platform/identity/password";
import { COOP_A } from "../../ops/fixtures";

afterAll(async () => {
  await pool.end();
});

describe("password hashing (scrypt)", () => {
  test("accepts the correct password and rejects a wrong one", () => {
    const h = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
});

describe("session lifecycle + withSessionTx door", () => {
  test("create → resolve → door runs in tenant context → revoke → null", async () => {
    const userId = await withTenantTx(COOP_A, async (tx) => {
      const r = await tx.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      return r.rows[0].id as string;
    });

    const { token } = await createSession(userId, COOP_A);

    const s = await resolveSession(token);
    expect(s?.coOpId).toBe(COOP_A);
    expect(s?.userId).toBe(userId);

    // The door resolves co_op_id from the session and sets the tenant context itself:
    const seenContext = await withSessionTx(token, async (tx, ctx) => {
      expect(ctx.coOpId).toBe(COOP_A);
      const r = await tx.query("SELECT current_setting('app.current_co_op', true) AS coop");
      return r.rows[0].coop as string;
    });
    expect(seenContext).toBe(COOP_A);

    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
    await expect(withSessionTx(token, async () => "unreached")).rejects.toThrow("no valid session");
  });

  test("a forged/absent token never resolves", async () => {
    expect(await resolveSession("not-a-real-token")).toBeNull();
  });
});
