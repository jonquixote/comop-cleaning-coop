// Data import — re-import a co-op export into a FRESH co-op (platform, sector-agnostic; ADR-0009).
// Every top-level uuid is remapped old→new consistently (so FK chains reconstruct); co_op_id and
// the co_ops anchor id map to newCoOpId. The remap is DETERMINISTIC per (newCoOpId, oldUuid), so
// re-importing the same document yields identical ids → PK conflict → ON CONFLICT DO NOTHING →
// idempotent ("the system accepts its own output"). Runs as a role that can insert co_ops.
import { createHash } from "node:crypto";
import type { ClientBase } from "pg";
import type { ExportDocument } from "./export";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deterministic, uuidv5-shaped: sha1(newCoOpId ":" oldUuid) → a stable new uuid.
function deterministicUuid(namespace: string, name: string): string {
  const h = createHash("sha1").update(`${namespace}:${name}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function importCoOpData(
  client: ClientBase,
  newCoOpId: string,
  doc: ExportDocument,
): Promise<{ rowsImported: number; rowsSkipped: number }> {
  const map = new Map<string, string>();
  map.set(doc.coOpId, newCoOpId); // the co-op id + every co_op_id reference → newCoOpId

  const remap = (v: unknown): unknown => {
    if (typeof v === "string" && UUID_RE.test(v)) {
      let nv = map.get(v);
      if (nv === undefined) {
        nv = deterministicUuid(newCoOpId, v);
        map.set(v, nv);
      }
      return nv;
    }
    return v; // non-uuid scalars, jsonb objects, arrays, timestamps pass through unchanged
  };

  const insertRow = async (table: string, row: Record<string, unknown>): Promise<number> => {
    const cols = Object.keys(row);
    const values = cols.map((c) => remap(row[c]));
    const r = await client.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT DO NOTHING`,
      values,
    );
    return r.rowCount ?? 0;
  };

  const tableNames = Object.keys(doc.tables); // preserves the export's FK-safe order
  let imported = 0;
  let total = 0;

  // co_ops first (anchor; inserted without a tenant context — co_ops is not FORCE-RLS).
  for (const t of tableNames) {
    if (t !== "co_ops") continue;
    for (const row of doc.tables[t]!.rows) {
      total++;
      imported += await insertRow(t, row);
    }
  }
  // set tenant context to the NEW co-op, then import the remaining (RLS-forced) tables.
  await client.query("SELECT set_config('app.current_co_op', $1, true)", [newCoOpId]);
  for (const t of tableNames) {
    if (t === "co_ops") continue;
    for (const row of doc.tables[t]!.rows) {
      total++;
      imported += await insertRow(t, row);
    }
  }

  return { rowsImported: imported, rowsSkipped: total - imported };
}
