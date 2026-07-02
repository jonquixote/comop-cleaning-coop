// TDD: createBooking + list (impl §5, ADR-0004 §3). All tests use rollback transactions
// — nothing persists. Tests must exercise the customers.user_id → jobs.customer_id join.
import { describe, test, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { createSession } from "../../platform/identity/session";
import { withSessionTx } from "../../platform/identity/session-tx";
import { createCleaningBooking } from "../../sectors/cleaning/booking";
import { priceJob, type CleaningJobDetails } from "../../sectors/cleaning/pricing";
import { getPolicySnapshotById } from "../../platform/policy/policy";
import { hashPassword } from "../../platform/identity/password";
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

describe("booking.create", () => {
  test("creates a job with integer-cents price and frozen policy version", async () => {
    await withRollback(COOP_A, async (tx) => {
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3) RETURNING id`,
        [COOP_A, "booking-test@example.test", hashPassword("password123")],
      );
      const userId = u.rows[0].id as string;

      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, user_id, contact) VALUES ($1, $2, $3) RETURNING id",
        [COOP_A, userId, "booking-test@example.test"],
      );
      const customerId = cust.rows[0].id as string;

      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );

      const details: CleaningJobDetails = { sqft: 1200, bedrooms: 3, bathrooms: 2, addons: ["deep_clean"] };
      const result = await createCleaningBooking(tx, COOP_A, { customerId, details });

      expect(result.jobId).toBeTruthy();
      expect(Number.isInteger(result.quotedPriceCents)).toBe(true);
      expect(result.quotedPriceCents).toBeGreaterThan(0);
      expect(result.policyVersionId).toBeTruthy();

      const jobRow = await tx.query(
        "SELECT quoted_price_cents, policy_version_id, status FROM jobs WHERE id = $1",
        [result.jobId],
      );
      expect(jobRow.rows[0].quoted_price_cents).toBe(result.quotedPriceCents);
      expect(jobRow.rows[0].status).toBe("quoted");
    });
  });

  test("re-price by stored policy_version_id reproduces the identical breakdown", async () => {
    await withRollback(COOP_A, async (tx) => {
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3) RETURNING id`,
        [COOP_A, "repricing-test@example.test", hashPassword("password123")],
      );
      const userId = u.rows[0].id as string;

      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, user_id, contact) VALUES ($1, $2, $3) RETURNING id",
        [COOP_A, userId, "repricing-test@example.test"],
      );
      const customerId = cust.rows[0].id as string;

      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );

      const details: CleaningJobDetails = { sqft: 800, bedrooms: 1, bathrooms: 1, addons: [] };
      const result = await createCleaningBooking(tx, COOP_A, { customerId, details });

      const snap = await getPolicySnapshotById(tx, result.policyVersionId);
      const repriced = priceJob(details, snap);
      expect(repriced.final_price_cents).toBe(result.quotedPriceCents);
    });
  });
});

describe("booking.list via customers.user_id → jobs.customer_id join", () => {
  test("returns only the user's own bookings, joining through customers.user_id", async () => {
    await withRollback(COOP_A, async (tx) => {
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3) RETURNING id`,
        [COOP_A, "list-test@example.test", hashPassword("password123")],
      );
      const userId = u.rows[0].id as string;

      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, user_id, contact) VALUES ($1, $2, $3) RETURNING id",
        [COOP_A, userId, "list-test@example.test"],
      );
      const customerId = cust.rows[0].id as string;

      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );

      const details: CleaningJobDetails = { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] };
      await createCleaningBooking(tx, COOP_A, { customerId, details });

      const jobs = await tx.query(
        `SELECT j.id, j.quoted_price_cents
         FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         WHERE c.user_id = $1 AND j.co_op_id = $2`,
        [userId, COOP_A],
      );
      expect(jobs.rowCount).toBe(1);
      expect(Number.isInteger(jobs.rows[0].quoted_price_cents)).toBe(true);
    });
  });

  test("returns empty when the user has no customers row yet", async () => {
    await withRollback(COOP_A, async (tx) => {
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3) RETURNING id`,
        [COOP_A, "no-customer@example.test", hashPassword("password123")],
      );
      const userId = u.rows[0].id as string;

      const jobs = await tx.query(
        `SELECT j.id FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         WHERE c.user_id = $1 AND j.co_op_id = $2`,
        [userId, COOP_A],
      );
      expect(jobs.rowCount).toBe(0);
    });
  });
});

describe("booking.create with session (withSessionTx door)", () => {
  test("withSessionTx resolves tenant and the booking is created in the correct co-op", async () => {
    await withRollback(COOP_A, async (tx) => {
      const u = await tx.query(
        `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3) RETURNING id`,
        [COOP_A, "door-test@example.test", hashPassword("password123")],
      );
      const userId = u.rows[0].id as string;

      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, user_id, contact) VALUES ($1, $2, $3) RETURNING id",
        [COOP_A, userId, "door-test@example.test"],
      );
      const customerId = cust.rows[0].id as string;

      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1, 'surplus_split', '{"fraction":0.2}')`,
        [COOP_A],
      );

      const { token } = await createSession(userId, COOP_A);

      const bookedJobId = await withSessionTx(token, async (tx2, ctx) => {
        expect(ctx.coOpId).toBe(COOP_A);
        const details: CleaningJobDetails = { sqft: 900, bedrooms: 1, bathrooms: 1, addons: [] };
        const result = await createCleaningBooking(tx2, ctx.coOpId, { customerId, details });
        return result.jobId;
      });

      const job = await tx.query("SELECT id, co_op_id FROM jobs WHERE id = $1", [bookedJobId]);
      expect(job.rows[0].co_op_id).toBe(COOP_A);
    });
  });
});
