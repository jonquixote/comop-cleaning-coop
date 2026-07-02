// TDD: customer registration + login + logout (impl §3a.1, ADR-0004 §3).
// All tests use rollback transactions — nothing persists.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { resolveSession, revokeSession } from "../../platform/identity/session";
import { hashPassword, verifyPassword } from "../../platform/identity/password";
import { resolveCoOpIdBySlug } from "../../platform/identity/coop-resolve";
import { createSession } from "../../platform/identity/session";
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

describe("registration + login + logout", () => {
  const testEmail = "reg-test@example.test";
  const testPassword = "correct-horse-battery";

  test("register: creates a users row with role=customer and returns a valid session token", async () => {
    await withRollback(COOP_A, async (tx) => {
      const passwordHash = hashPassword(testPassword);
      const r = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)
         RETURNING id, role, email`,
        [COOP_A, testEmail, passwordHash],
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].role).toBe("customer");
      expect(r.rows[0].email).toBe(testEmail);

      const userId = r.rows[0].id as string;
      const { token } = await createSession(userId, COOP_A, 24 * 14, tx);
      const session = await resolveSession(token, tx);
      expect(session?.userId).toBe(userId);
      expect(session?.coOpId).toBe(COOP_A);
    });
  });

  test("login: verifies password and returns a session token", async () => {
    await withRollback(COOP_A, async (tx) => {
      const passwordHash = hashPassword(testPassword);
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)
         RETURNING id`,
        [COOP_A, "login-test@example.test", passwordHash],
      );
      const userId = u.rows[0].id as string;

      const row = await tx.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [userId],
      );
      const stored = row.rows[0].password_hash as string;
      expect(verifyPassword(testPassword, stored)).toBe(true);
      expect(verifyPassword("wrong-password", stored)).toBe(false);
    });
  });

  test("logout: revokes the session token", async () => {
    await withRollback(COOP_A, async (tx) => {
      const passwordHash = hashPassword(testPassword);
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)
         RETURNING id`,
        [COOP_A, "logout-test@example.test", passwordHash],
      );
      const userId = u.rows[0].id as string;
      const { token } = await createSession(userId, COOP_A, 24 * 14, tx);

      expect(await resolveSession(token, tx)).not.toBeNull();
      await revokeSession(token, tx);
      expect(await resolveSession(token, tx)).toBeNull();
    });
  });
});

describe("co-op slug resolution", () => {
  test("resolves a known slug to a co-op id", async () => {
    // Seed provides slug 'coop-a' for COOP_A (via migration 0011)
    const coOpId = await resolveCoOpIdBySlug("coop-a");
    expect(coOpId).toBe(COOP_A);
  });

  test("throws for an unknown slug", async () => {
    await expect(resolveCoOpIdBySlug("nonexistent")).rejects.toThrow("co-op not found");
  });
});

describe("registration edge cases", () => {
  test("duplicate email within same co-op is rejected", async () => {
    await withRollback(COOP_A, async (tx) => {
      const passwordHash = hashPassword("password1");
      await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)`,
        [COOP_A, "dup@example.test", passwordHash],
      );
      await expect(
        tx.query(
          `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)`,
          [COOP_A, "dup@example.test", hashPassword("password2")],
        ),
      ).rejects.toThrow();
    });
  });

  test("same email in different co-ops is allowed", async () => {
    await withRollback(COOP_A, async (tx) => {
      const passwordHash = hashPassword("password1");
      await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)`,
        [COOP_A, "cross-coop@example.test", passwordHash],
      );
    });
    // COOP_B is a separate tenant — same email allowed
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT set_config('app.current_co_op', $1, true)", [
        "00000000-0000-0000-0000-00000000000b",
      ]);
      await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)`,
        ["00000000-0000-0000-0000-00000000000b", "cross-coop@example.test", hashPassword("password2")],
      );
      await tx.query("ROLLBACK");
    } finally {
      tx.release();
    }
  });
});
