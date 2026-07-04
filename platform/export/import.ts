// Data import — re-import a co-op export into a FRESH co-op (platform, sector-agnostic; ADR-0009).
// Every top-level uuid-typed column is remapped old→new consistently (so FK chains
// reconstruct); columns of other types (text natural keys, jsonb, timestamps) pass through
// unchanged. The remap is DETERMINISTIC per (newCoOpId, oldUuid), so re-importing the same
// document yields identical ids → PK conflict → ON CONFLICT DO NOTHING → idempotent
// ("the system accepts its own output").
//
// Transaction contract (fix #1, ADR-0011 § tx-boundary):
//   * If the caller's connection is NOT already inside a tx, importCoOpData opens
//     BEGIN/COMMIT itself — atomic on a fresh connection.
//   * If it IS inside a tx, the function wraps work in a SAVEPOINT and releases it on
//     success / rolls back on failure — composable inside a caller-owned transaction.
//
// Runs as a role that can insert co_ops (e.g. app_owner) because the very first insert
// (co_ops anchor row) is not subject to FORCE-RLS.
import { createHash } from "node:crypto";
import type { ClientBase } from "pg";
import type { ExportDocument, ExportTable } from "./export";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVEPOINT_NAME = "comop_import";

// Deterministic, uuidv5-shaped: sha1(newCoOpId ":" oldUuid) → a stable new uuid.
function deterministicUuid(namespace: string, name: string): string {
  const h = createHash("sha1").update(`${namespace}:${name}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// A `ClientBase` does not expose the active state — detect via a SAVEPOINT probe. We
// pick the cheapest possible probe: issuing a SAVEPOINT inside an existing tx is fine;
// issuing it outside an active tx errors with SQLSTATE 25P01 (nosqlstate 0A000
// is not guaranteed stable, so we also match the standard message).
async function hasOpenTx(client: ClientBase): Promise<boolean> {
  try {
    await client.query(`SAVEPOINT __probe__`);
    await client.query(`RELEASE SAVEPOINT __probe__`);
    return true;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "25P01") return false;
    const msg = (e as Error).message ?? "";
    if (/SAVEPOINT can only be used in transaction blocks/i.test(msg)) return false;
    throw e; // unexpected error — propagate
  }
}

export async function importCoOpData(
  client: ClientBase,
  newCoOpId: string,
  doc: ExportDocument,
): Promise<{ rowsImported: number; rowsSkipped: number; warnings: string[] }> {
  const hadOuterTx = await hasOpenTx(client);
  if (!hadOuterTx) await client.query("BEGIN");
  await client.query(`SAVEPOINT ${SAVEPOINT_NAME}`);
  try {
    const out = await runImport(client, newCoOpId, doc);
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT_NAME}`);
    if (!hadOuterTx) await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`).catch(() => {});
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT_NAME}`).catch(() => {});
    if (!hadOuterTx) await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function runImport(
  client: ClientBase,
  newCoOpId: string,
  doc: ExportDocument,
): Promise<{ rowsImported: number; rowsSkipped: number; warnings: string[] }> {
  const map = new Map<string, string>();
  map.set(doc.coOpId, newCoOpId); // the co-op id + every co_op_id reference → newCoOpId

  const warnings: string[] = [];

  /** Apply remap to value `v` only when its column is uuid-typed per the table's
   *  columnTypes metadata. If columnTypes is absent (legacy V1/V2 export document),
   *  fall back to blanket uuid-pattern detection and emit a warning so the caller
   *  can see they should re-export with a newer format. Jsonb content is opaque
   *  per ADR-0009 §5 — we never recurse into it. */
  const remapForColumn = (v: unknown, table: string, col: string): unknown => {
    const ct = doc.tables[table]?.columnTypes;
    const colLower = col.toLowerCase();
    if (!ct) {
      // Legacy document: warn once and continue with old behavior.
      if (!warnings.includes("legacy-export-document:uuid-remap-scope-undetermined")) {
        warnings.push("legacy-export-document:uuid-remap-scope-undetermined");
      }
      if (typeof v === "string" && UUID_RE.test(v)) {
        let nv = map.get(v);
        if (nv === undefined) {
          nv = deterministicUuid(newCoOpId, v);
          map.set(v, nv);
        }
        return nv;
      }
      return v;
    }
    if (ct[colLower] !== "uuid") return v;
    if (typeof v !== "string" || !UUID_RE.test(v)) return v;
    let nv = map.get(v);
    if (nv === undefined) {
      nv = deterministicUuid(newCoOpId, v);
      map.set(v, nv);
    }
    return nv;
  };

  const insertRow = async (table: string, tdef: ExportTable, row: Record<string, unknown>): Promise<number> => {
    const cols = Object.keys(row);
    // pg's parameter encoder serializes JS arrays as Postgres array literals
    // ({...}) — which is wrong for jsonb columns. JSON-stringify any non-null
    // object/array value before handing it to pg; pg will then parse the
    // resulting string as JSON when it hits a jsonb column. Without this,
    // checklist / breakdown / value_json columns get wire-encoded as
    // pg-array literals and Postgres errors "invalid input syntax for type
    // json" (issue surfaced by v8+refund review; reproducible with one row).
    const ct = tdef.columnTypes ?? {};
    if (!tdef.columnTypes) {
      if (!warnings.includes("legacy-export-document:jsonb-type-undetermined")) {
        warnings.push("legacy-export-document:jsonb-type-undetermined");
      }
    }
    const values = cols.map((c) => {
      const v = remapForColumn(row[c], table, c);
      const colType = ct[c.toLowerCase()];
      if ((colType === "jsonb" || colType === "json") && v !== null && typeof v === "object") {
        return JSON.stringify(v);
      }
      return v;
    });
    const r = await client.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
        ON CONFLICT DO NOTHING`,
      values,
    );
    return r.rowCount ?? 0;
  };

  // tableNames preserves the export's FK-safe order
  const tableNames = Object.keys(doc.tables);
  let imported = 0;
  let total = 0;

  // co_ops first (anchor; inserted without a tenant context — co_ops is not FORCE-RLS).
  // Null out slug — it is a UNIQUE user-facing label that would conflict if the source
  // co-op already owns it (e.g. every export of "Co-op A" carries slug="coop-a"). The
  // imported co-op can set its own slug later.
  for (const t of tableNames) {
    if (t !== "co_ops") continue;
    for (const row of doc.tables[t]!.rows) {
      row.slug = null;
      total++;
      imported += await insertRow(t, doc.tables[t]!, row);
    }
  }
  // set_config with is_local=true is transaction-scoped — it reverts on ROLLBACK
  // (and on ROLLBACK TO SAVEPOINT). This makes our SAVEPOINT rollback cleanly undo
  // the tenant-context switch, which is the desired composability property.
  await client.query("SELECT set_config('app.current_co_op', $1, true)", [newCoOpId]);
  for (const t of tableNames) {
    if (t === "co_ops") continue;
    for (const row of doc.tables[t]!.rows) {
      total++;
      imported += await insertRow(t, doc.tables[t]!, row);
    }
  }

  return { rowsImported: imported, rowsSkipped: total - imported, warnings };
}
