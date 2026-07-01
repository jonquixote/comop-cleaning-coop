// Data export — the exit right, in code (platform, sector-agnostic; ADR-0009). Discovers
// every tenant-scoped table (co_op_id column) + the co_ops anchor from the catalog, excludes
// the ADR-0002 globals, topo-sorts FK-safe, and dumps each WHERE co_op_id = X. Names NO sector
// table — a new sector's extension table exports automatically.
import type { ClientBase } from "pg";

// Excluded from a co-op's export: the ADR-0002 globals (platform-owned, not the co-op's),
// schema_migrations (schema, not data), and sessions (transient auth credentials — the charter
// exports customers/schedules/history, not login tokens; ADR-0009 §6).
const EXCLUDED_TABLES = new Set([
  "sector_registry",
  "system_config",
  "service_category_taxonomy",
  "schema_migrations",
  "sessions",
]);

export interface ExportTable {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ExportDocument {
  version: number;
  exportedAt: string;
  coOpId: string;
  tables: Record<string, ExportTable>;
}

/** Tenant tables + the co_ops anchor, topo-sorted so parents come before children (FK-safe). */
export async function tenantTablesInFkOrder(client: ClientBase): Promise<string[]> {
  const cols = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'co_op_id'`,
  );
  const nodes = new Set<string>(cols.rows.map((r) => r.table_name));
  nodes.add("co_ops"); // anchor: keyed by its own id (no co_op_id column)
  for (const g of EXCLUDED_TABLES) nodes.delete(g);

  const fks = await client.query<{ child: string; parent: string }>(
    `SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent
     FROM pg_constraint con
     WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace`,
  );
  const strip = (s: string): string => s.replace(/^public\./, "").replace(/"/g, "");
  const deps = new Map<string, Set<string>>();
  for (const t of nodes) deps.set(t, new Set());
  for (const r of fks.rows) {
    const child = strip(r.child);
    const parent = strip(r.parent);
    if (nodes.has(child) && nodes.has(parent) && child !== parent) deps.get(child)!.add(parent);
  }

  const order: string[] = [];
  const remaining = new Set(nodes);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((t) => [...deps.get(t)!].every((p) => !remaining.has(p)));
    if (ready.length === 0) throw new Error("FK cycle among tenant tables — cannot order export");
    ready.sort();
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return order;
}

export async function exportCoOpData(client: ClientBase, coOpId: string): Promise<ExportDocument> {
  const order = await tenantTablesInFkOrder(client);
  const tables: Record<string, ExportTable> = {};
  for (const t of order) {
    const col = t === "co_ops" ? "id" : "co_op_id";
    // Belt + suspenders: RLS (the caller's tenant tx) AND an explicit co_op_id filter.
    const r = await client.query(`SELECT * FROM "${t}" WHERE "${col}" = $1`, [coOpId]);
    tables[t] = { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 };
  }
  return { version: 1, exportedAt: new Date().toISOString(), coOpId, tables };
}
