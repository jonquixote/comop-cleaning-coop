// Step 8 — the exit right: export a co-op, re-import into a FRESH co-op, verify integrity.
// The 3rd (final) mandatory invariant (§8a): a round-trip, not a one-way dump. Rollback-isolated.
import { describe, test, expect, afterAll } from "vitest";
import { Client, type PoolClient, type ClientBase } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import { exportCoOpData, type ExportDocument } from "../../platform/export/export";
import { importCoOpData } from "../../platform/export/import";
import { verifyRoundTrip } from "../../platform/export/verify";
import { createCleaningBooking } from "../../sectors/cleaning/booking";
import { recordPayout } from "../../platform/payout/payout";
import { capturePayment } from "../../platform/payments/stripe";
import { closeAllocationPeriod } from "../../platform/allocation/allocation";
import { createProposal, openProposal, castVote, closeProposal } from "../../platform/governance/proposals";
import { setSurplusSplitByProposal } from "../../platform/governance/valve";
import { createCommunication } from "../../platform/governance/communications";
import { COOP_A, COOP_B } from "../../ops/fixtures";

const OWNER = process.env.OWNER_DATABASE_URL ?? "";
const COOP_C = "00000000-0000-0000-0000-00000000000c";
const COOP_EMPTY = "00000000-0000-0000-0000-00000000000e";

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

// app_owner connection helper; transaction policy depends on the operation:
//   - importCoOpData is self-transactional (uses SAVEPOINT internally) — connect
//     without an outer BEGIN so the SAVEPOINT path is exercised end-to-end.
//   - exports are read-only and don't need an enclosing tx.
// Both forms roll back any persistent state because the NEW co-op ids used here
// (COOP_C, COOP_EMPTY) are unique to the test run.
async function withOwnerClient(fn: (c: Client) => Promise<void>): Promise<void> {
  const c = new Client({ connectionString: OWNER });
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
  }
}

// Build a representative co-op A dataset (most tables) and export it, all in a rollback tx.
async function buildAndExportA(): Promise<ExportDocument> {
  let doc: ExportDocument | undefined;
  await withRollback(COOP_A, async (tx) => {
    const cust = await tx.query("INSERT INTO customers (co_op_id, contact) VALUES ($1,$2) RETURNING id", [COOP_A, "exit@test"]);
    await tx.query(`INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1,'surplus_split','{"fraction":0.2}')`, [COOP_A]);
    const booked = await createCleaningBooking(tx, COOP_A, {
      customerId: cust.rows[0].id as string,
      details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: ["deep_clean"] },
    });
    await tx.query("UPDATE jobs SET status='done', final_price_cents=quoted_price_cents WHERE id=$1", [booked.jobId]);

    const u = await tx.query("INSERT INTO users (co_op_id, role, email) VALUES ($1,'worker','ex@w') RETURNING id", [COOP_A]);
    const m = await tx.query("INSERT INTO members (co_op_id, user_id, status) VALUES ($1,$2,'member') RETURNING id", [COOP_A, u.rows[0].id]);
    const memberId = m.rows[0].id as string;
    await tx.query(
      "INSERT INTO job_assignments (co_op_id, job_id, member_id, starts_at, ends_at, hours_logged, status) VALUES ($1,$2,$3,'2026-07-01T09:00:00Z','2026-07-01T11:00:00Z',2,'completed')",
      [COOP_A, booked.jobId, memberId],
    );
    await recordPayout(tx, COOP_A, booked.jobId);
    await capturePayment(tx, COOP_A, booked.jobId, "pi_exit_123"); // webhook_events + job -> paid

    const period = await tx.query(
      "INSERT INTO allocation_periods (co_op_id, starts_at, ends_at) VALUES ($1, now()-interval '1 hour', now()+interval '1 hour') RETURNING id",
      [COOP_A],
    );
    await closeAllocationPeriod(tx, COOP_A, period.rows[0].id as string); // member_allocations (conservation)

    // governance + valve (exercises the policy_settings.set_by_proposal_id chain)
    const { proposalId } = await createProposal(tx, COOP_A, { title: "raise split", type: "surplus_split", transparencySnapshot: { d: 1 } });
    await openProposal(tx, COOP_A, proposalId);
    await castVote(tx, COOP_A, proposalId, memberId, "yes");
    await closeProposal(tx, COOP_A, proposalId);
    await setSurplusSplitByProposal(tx, COOP_A, proposalId, 0.25); // policy_settings linked to the proposal
    await createCommunication(tx, COOP_A, { mode: "routine", body: "notice" });

    doc = await exportCoOpData(tx, COOP_A);
  });
  return doc!;
}

describe("export round-trip — the exit right", () => {
  test("export COOP_A → import as COOP_C → verifyRoundTrip passes", async () => {
    const doc = await buildAndExportA();
    expect(doc.tables.jobs!.rowCount).toBeGreaterThan(0);
    expect(doc.tables.payout_ledger!.rowCount).toBeGreaterThan(0);
    expect(doc.tables.member_allocations!.rowCount).toBeGreaterThan(0);

    let reDoc: ExportDocument | undefined;
    await withOwnerClient(async (c: ClientBase) => {
      await importCoOpData(c, COOP_C, doc);
      reDoc = await exportCoOpData(c, COOP_C);
    });

    const result = verifyRoundTrip(doc, reDoc!);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("cross-tenant isolation: COOP_B rows never appear in COOP_A's export", async () => {
    const doc = await buildAndExportA();
    for (const [t, { rows }] of Object.entries(doc.tables)) {
      for (const row of rows) {
        if (t === "co_ops") expect(row.id).toBe(COOP_A);
        else expect(row.co_op_id).toBe(COOP_A);
        expect(row.co_op_id === COOP_B).toBe(false);
      }
    }
  });

  test("re-import idempotency: importing twice doesn't double rows", async () => {
    const doc = await buildAndExportA();
    await withOwnerClient(async (c: ClientBase) => {
      const first = await importCoOpData(c, COOP_C, doc);
      const second = await importCoOpData(c, COOP_C, doc);
      expect(first.rowsImported).toBeGreaterThan(0);
      expect(second.rowsImported).toBe(0); // deterministic ids + ON CONFLICT DO NOTHING
      const reDoc = await exportCoOpData(c, COOP_C);
      for (const t of Object.keys(doc.tables)) {
        expect(reDoc.tables[t]?.rowCount ?? 0).toBe(doc.tables[t]!.rowCount);
      }
    });
  });

  test("verifyRoundTrip catches corruption: tampered surplus_cents → valid:false", async () => {
    const doc = await buildAndExportA();
    let reDoc: ExportDocument | undefined;
    await withOwnerClient(async (c: ClientBase) => {
      await importCoOpData(c, COOP_C, doc);
      reDoc = await exportCoOpData(c, COOP_C);
    });
    const first = reDoc!.tables.payout_ledger!.rows[0]!;
    first.surplus_cents = Number(first.surplus_cents) + 999; // tamper
    const result = verifyRoundTrip(doc, reDoc!);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("empty co-op exports cleanly (no rows, no error)", async () => {
    await withOwnerClient(async (c: ClientBase) => {
      await c.query("INSERT INTO co_ops (id, name) VALUES ($1, 'Empty Co-op')", [COOP_EMPTY]);
      await c.query("SELECT set_config('app.current_co_op', $1, true)", [COOP_EMPTY]);
      const doc = await exportCoOpData(c, COOP_EMPTY);
      expect(doc.coOpId).toBe(COOP_EMPTY);
      expect(doc.tables.co_ops!.rowCount).toBe(1);
      expect(doc.tables.jobs!.rowCount).toBe(0);
      expect(doc.tables.members!.rowCount).toBe(0);
    });
  });
});
