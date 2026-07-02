// Data export — the exit right, in code (platform, sector-agnostic; ADR-0009). Discovers
// every tenant-scoped table (co_op_id column) + the co_ops anchor from the catalog, excludes
// the ADR-0002 globals + views + sequences, topo-sorts FK-safe, and dumps each WHERE
// co_op_id = X. Names NO sector table — a new sector's extension table exports automatically.
//
// V3 change (#2): per-table columnTypes so the importer can scope UUID remap to uuid-typed
// columns only (text natural keys like stripe_event_id pass through unchanged).
// V3 change (#3): tenant-table discovery uses pg_class.relkind to exclude views,
// materialized views, sequences, and foreign tables — only ordinary tables ('r') and
// partitioned tables ('p') qualify.
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

// pg_class.relkind values we accept (ordinary + partitioned). Materialized views and
// regular views are excluded by construction; foreign tables and sequences cannot be
// tenant-scoped by co_op_id anyway. See ADR-0011 (§ view exclusion, fix #3).
const TENANT_REL_KINDS = new Set(["r", "p"]);

export interface ExportTable {
  rows: Record<string, unknown>[];
  rowCount: number;
  /** Per-column data_type keyed by column name (lower-cased). Optional for backwards-compatible import of documents produced before V3 (#2). */
  columnTypes?: Record<string, string>;
}

export interface ExportDocument {
  version: number;
  exportedAt: string;
  coOpId: string;
  tables: Record<string, ExportTable>;
}

/**
 * Tenant-table discovery — returns the names of every ordinary (or partitioned) public
 * table that has a `co_op_id` column, plus the `co_ops` anchor. Excludes views (relkind
 * 'v' / 'm'), foreign tables ('f'), and sequences ('S'). Topologically sorted so every
 * FK parent appears before its children.
 */
export async function tenantTablesInFkOrder(client: ClientBase): Promise<string[]> {
  const cols = await client.query<{ table_name: string }>(
    `SELECT DISTINCT c.table_name
       FROM information_schema.columns c
       JOIN pg_class  cls ON cls.relname = c.table_name
       JOIN pg_namespace ns  ON ns.oid = cls.relnamespace AND ns.nspname = c.table_schema
      WHERE c.table_schema = 'public'
        AND c.column_name   = 'co_op_id'
        AND cls.relkind     = ANY($1::char[])`,
    [Array.from(TENANT_REL_KINDS)],
  );
  const nodes = new Set<string>(cols.rows.map((r) => r.table_name));
  nodes.add("co_ops"); // anchor: keyed by its own id (no co_op_id column)
  for (const g of EXCLUDED_TABLES) nodes.delete(g);

  const fks = await client.query<{ child: string; parent: string }>(
    `SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent
       FROM pg_constraint con
       JOIN pg_class  cc ON cc.oid = con.conrelid
       JOIN pg_namespace cn ON cn.oid = cc.relnamespace
      WHERE con.contype = 'f'
        AND cn.nspname  = 'public'
        AND cc.relkind  = ANY($1::char[])`,
    [Array.from(TENANT_REL_KINDS)],
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

/** Per-table column-type lookup (#2). Returns `Record<colName, data_type>` (lower-cased keys). */
async function columnTypesFor(client: ClientBase, table: string): Promise<Record<string, string>> {
  const r = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const out: Record<string, string> = {};
  for (const row of r.rows) out[row.column_name.toLowerCase()] = row.data_type;
  return out;
}

export async function exportCoOpData(client: ClientBase, coOpId: string): Promise<ExportDocument> {
  const order = await tenantTablesInFkOrder(client);
  const tables: Record<string, ExportTable> = {};
  for (const t of order) {
    const col = t === "co_ops" ? "id" : "co_op_id";
    // Belt + suspenders: RLS (the caller's tenant tx) AND an explicit co_op_id filter.
    const r = await client.query(`SELECT * FROM "${t}" WHERE "${col}" = $1`, [coOpId]);
    const columnTypes = await columnTypesFor(client, t);
    tables[t] = {
      rows: r.rows as Record<string, unknown>[],
      rowCount: r.rowCount ?? 0,
      columnTypes,
    };
  }
  return { version: 3, exportedAt: new Date().toISOString(), coOpId, tables };
}
