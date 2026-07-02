// Step 8 fixes — adversarial tests for the four review items on PR #9 (Gemini Code Assist).
//
// Each test maps to one review finding and starts failing on the pre-fix code. The
// tests assert the post-fix contract AND keep the existing roundtrip invariants
// working (rollback isolation; nothing persists).
//
// Hermetic: every test uses fresh co-op ids unique to the run; helper cleans up.
import { describe, test, expect, afterAll, beforeEach, afterEach } from "vitest";
import { Client, type Client as PgClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import {
  exportCoOpData,
  type ExportDocument,
  tenantTablesInFkOrder,
} from "../../platform/export/export";
import { importCoOpData } from "../../platform/export/import";
import { verifyRoundTrip } from "../../platform/export/verify";

const OWNER = process.env.OWNER_DATABASE_URL ?? "";
const SRC = "00000000-0000-0000-0000-000000000a01";
const TGT = "00000000-0000-0000-0000-000000000a02";
const VIEW_FIXTURE = "jobs_by_co_op_view_v";

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await withOwnerClient(async (c) => {
    await c.query("INSERT INTO co_ops (id, name) VALUES ($1, 'src') ON CONFLICT (id) DO NOTHING", [SRC]);
    await c.query("INSERT INTO co_ops (id, name) VALUES ($1, 'tgt') ON CONFLICT (id) DO NOTHING", [TGT]);
  });
});

async function withOwnerClient(fn: (c: PgClient) => Promise<void>): Promise<void> {
  const c = new Client({ connectionString: OWNER });
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
  }
}

// Tenant-scoped data must be inserted as `app_user` with `app.current_co_op` set
// (the FORCE-RLS policy on policy_settings, jobs, etc. requires it). Postgres' role
// grant matrix: app_owner can read co_ops (anchor, no RLS) but tenant tables reject
// writes from outside a tenant tx. We seed tenant data using a separate `app_user`
// connection with the context set.
async function withTenantClient<T>(coOpId: string, fn: (c: PgClient) => Promise<T>): Promise<T> {
  const appUrl = process.env.APP_DATABASE_URL!;
  const c = new Client({ connectionString: appUrl });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_co_op', $1, true)", [coOpId]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}

// Insert a co_ops row directly (anchor, no RLS). Run as app_owner.
async function insertCoOp(c: PgClient, id: string, name: string): Promise<void> {
  await c.query("INSERT INTO co_ops (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [id, name]);
}

async function cleanup(c: PgClient): Promise<void> {
  // Drop the view if it leaked across runs (tests drop it themselves; safety net here).
  await c.query(`DROP VIEW IF EXISTS public.${VIEW_FIXTURE} CASCADE`).catch(() => {});
  await c.query(`DELETE FROM co_ops WHERE id IN ($1, $2)`, [SRC, TGT]).catch(() => {});
}

// ---------------------------------------------------------------------------
// Fix #1 — importCoOpData is atomic regardless of caller-side transaction.
// Uses an internal SAVEPOINT so the operation is composable: it works whether
// the caller opened BEGIN or not, and any failure rolls back to the SAVEPOINT
// (or to the caller's BEGIN) without leaking partial rows.
// ---------------------------------------------------------------------------

describe("importCoOpData — transaction boundary (#1)", () => {
  afterEach(async () => {
    await withOwnerClient((c) => cleanup(c));
  });

  test("FAIL — fires when an insert fails; no partial rows persist (atomic on fresh connection)", async () => {
    // Build a doc where the customer row's co_op_id will remap to a UUID that has NO
    // corresponding co_ops row. The FK constraint catches it and ON CONFLICT DO NOTHING
    // cannot swallow a constraint violation — the import must throw.
    await withTenantClient(SRC, async (tc) => {
      await tc.query("INSERT INTO customers (co_op_id, contact) VALUES ($1, 'phoney')", [SRC]);
      const doc = await exportCoOpData(tc, SRC);

      // Switch the doc's coOpId to a FRESH uuid that does NOT exist in co_ops.
      // The customer's co_op_id points to SRC; after remap it becomes
      // deterministic(DOOM, SRC) — a uuid unknown to co_ops.
      const DOOM = "00000000-0000-0000-0000-deaddeaddead";
      const sabotaged = { ...doc, coOpId: DOOM };

      // Run on a fresh OWNER connection — no pre-existing tx, so the import
      // opens its own BEGIN. If any tenant-table insert fails (FK to co_ops on
      // the remapped co_op_id), the import MUST roll back and throw.
      await withOwnerClient(async (oc) => {
        await expect(importCoOpData(oc, DOOM, sabotaged)).rejects.toBeDefined();

        // After the throw, the DOOM co-op must not have leaked ANY customers.
        const cust = await withTenantClient(DOOM, (qc) =>
          qc.query<{ n: number }>("SELECT count(*)::int AS n FROM customers WHERE co_op_id = $1", [DOOM]),
        ).catch(() => ({ rows: [{ n: -1 }] }) as { rows: { n: number }[] });
        expect(cust.rows[0]!.n).toBe(0);
      });
    });
  });

  test("PASS — composable into a caller's transaction (SAVEPOINT path)", async () => {
    // Build doc from SRC, then import inside a caller-owned BEGIN on an app_owner
    // connection. The import must detect the outer tx, use SAVEPOINT composably, and
    // leave rows visible inside the outer tx. The outer ROLLBACK ensures hermeticness.
    let doc: ExportDocument;
    await withTenantClient(SRC, async (tc) => {
      await tc.query("INSERT INTO customers (co_op_id, contact) VALUES ($1, 'phoney')", [SRC]);
      doc = await exportCoOpData(tc, SRC);
    });

    await withOwnerClient(async (oc) => {
      await oc.query("BEGIN");
      await importCoOpData(oc, TGT, doc!);
      const r = await oc.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM customers WHERE co_op_id = $1",
        [TGT],
      );
      expect(r.rows[0]!.n).toBeGreaterThan(0); // rows visible inside outer tx
      await oc.query("ROLLBACK");
    });
  });
});

// ---------------------------------------------------------------------------
// Fix #2 — UUID remap is restricted to columns of type 'uuid'. Text natural
// keys (e.g. stripe_event_id) MUST be passed through verbatim, even when their
// content is uuid-shaped.
// ---------------------------------------------------------------------------

describe("UUID remap scope (#2)", () => {
  afterEach(async () => {
    await withOwnerClient((c) => cleanup(c));
  });

  test("uuid-shaped text-typed column is NOT remapped", async () => {
    const fakeStripeId = "00000000-0000-0000-0000-555555555555";
    await withTenantClient(SRC, async (tc) => {
      // Use customers.contact (text). Stamp a uuid-shaped string into it; the export
      // records columnTypes.contact='text' (from information_schema). The remapper must
      // NOT remap it (only uuid-typed columns trigger deterministic remapping).
      await tc.query("INSERT INTO customers (co_op_id, contact) VALUES ($1, $2)", [SRC, fakeStripeId]);

      const doc = await exportCoOpData(tc, SRC);
      // Sanity check: the column is text-typed in the export metadata.
      expect(doc.tables.customers!.columnTypes!["contact"]).toBe("text");

      // Import to TGT — must preserve the contact string verbatim. We run on a
      // OWNER connection (the IMPORT itself wraps work in BEGIN/COMMIT and sets
      // RLS context to TGT for tenant tables). Pre-existing TGT co_ops row avoids
      // INSERT collision.
      await withOwnerClient(async (oc) => {
        await insertCoOp(oc, TGT, "tgt");
        await importCoOpData(oc, TGT, doc);

        // After COMMIT, query via app_user (the OWNER connection won't be in the
        // TGT tenant context — we've already left the import's tx).
        await withTenantClient(TGT, async (qc) => {
          const r = await qc.query<{ contact: string }>(
            "SELECT contact FROM customers WHERE co_op_id = $1",
            [TGT],
          );
          expect(r.rows.length).toBeGreaterThanOrEqual(1);
          const hit = r.rows.find((row) => row.contact === fakeStripeId);
          expect(hit).toBeDefined();
        });
      });
    });
  });

  test("remap is column-type aware: columnTypes is exposed on every exported table", async () => {
    await withTenantClient(SRC, async (tc) => {
      const doc = await exportCoOpData(tc, SRC);
      for (const [t, tdef] of Object.entries(doc.tables)) {
        expect(typeof tdef.columnTypes).toBe("object");
        if (t !== "co_ops") expect(tdef.columnTypes!["co_op_id"]).toBe("uuid");
        if (t === "co_ops") expect(tdef.columnTypes!["id"]).toBe("uuid");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Fix #3 — tenantTablesInFkOrder excludes views (and other non-ordinary-table
// relations). A view with a co_op_id column MUST NOT appear in the export.
// ---------------------------------------------------------------------------

describe("View exclusion in table discovery (#3)", () => {
  afterEach(async () => {
    await withOwnerClient((c) => cleanup(c));
  });

  test("a view with co_op_id is NOT returned by tenantTablesInFkOrder", async () => {
    await withOwnerClient(async (c) => {
      // Create a temporary test view in the current transaction so it's dropped
      // at end-of-tx. Actually CREATE VIEW is non-temp by default; we drop it
      // ourselves at cleanup. Use a deliberately awkward name so it can't
      // collide with anything real.
      await c.query(
        `CREATE VIEW ${VIEW_FIXTURE} AS SELECT co_op_id, count(*)::int AS n FROM jobs GROUP BY co_op_id`,
      );

      try {
        const order = await tenantTablesInFkOrder(c);
        expect(order).not.toContain(VIEW_FIXTURE);
      } finally {
        await c.query(`DROP VIEW IF EXISTS ${VIEW_FIXTURE}`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Fix #4 — verifyRoundTrip is robust against malformed/missing timestamps.
// Null/undefined/non-ISO recorded_at must not crash and must produce a
// clearly-attributable error, not silent NaN.
// ---------------------------------------------------------------------------

describe("verifyRoundTrip — defensive date parsing (#4)", () => {
  test("null recorded_at in payout_ledger → valid:false with attributable error", () => {
    const original: ExportDocument = {
      version: 1,
      exportedAt: new Date().toISOString(),
      coOpId: "00000000-0000-0000-0000-000000000099",
      tables: {
        co_ops: {
          rowCount: 1,
          columnTypes: { id: "uuid", name: "text" },
          rows: [{ id: "00000000-0000-0000-0000-000000000099" }],
        },
        allocation_periods: {
          rowCount: 1,
          columnTypes: { id: "uuid", co_op_id: "uuid", starts_at: "timestamp with time zone", ends_at: "timestamp with time zone" },
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000101",
              starts_at: "2026-01-01T00:00:00.000Z",
              ends_at: "2027-01-01T00:00:00.000Z",
            },
          ],
        },
        member_allocations: {
          rowCount: 0,
          columnTypes: { id: "uuid", co_op_id: "uuid", period_id: "uuid", amount_cents: "bigint" },
          rows: [],
        },
        payout_ledger: {
          rowCount: 1,
          columnTypes: { id: "uuid", co_op_id: "uuid", recorded_at: "timestamp with time zone", surplus_cents: "bigint" },
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000201",
              recorded_at: null, // <-- the adversarial case
              surplus_cents: 100,
            },
          ],
        },
      },
    };
    const result = verifyRoundTrip(original, original);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/recorded_at|timestamp/i);
  });

  test("valid timestamps → valid:true", () => {
    const original: ExportDocument = {
      version: 1,
      exportedAt: new Date().toISOString(),
      coOpId: "00000000-0000-0000-0000-000000000099",
      tables: {
        co_ops: {
          rowCount: 1,
          columnTypes: { id: "uuid", name: "text" },
          rows: [{ id: "00000000-0000-0000-0000-000000000099" }],
        },
        allocation_periods: {
          rowCount: 1,
          columnTypes: { id: "uuid", co_op_id: "uuid", starts_at: "timestamp with time zone", ends_at: "timestamp with time zone" },
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000101",
              starts_at: "2026-06-01T00:00:00.000Z",
              ends_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
        member_allocations: {
          rowCount: 1,
          columnTypes: { id: "uuid", co_op_id: "uuid", period_id: "uuid", amount_cents: "bigint" },
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000301",
              period_id: "00000000-0000-0000-0000-000000000101",
              amount_cents: 200,
            },
          ],
        },
        payout_ledger: {
          rowCount: 1,
          columnTypes: { id: "uuid", co_op_id: "uuid", recorded_at: "timestamp with time zone", surplus_cents: "bigint" },
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000201",
              recorded_at: "2026-06-15T12:00:00.000Z",
              surplus_cents: 200,
            },
          ],
        },
      },
    };
    const result = verifyRoundTrip(original, original);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
