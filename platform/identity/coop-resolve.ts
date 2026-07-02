// Co-op resolution by slug — public, pre-auth. Used by register/login to find the
// tenant before a session exists. The slug → co_op_id lookup does not require tenant
// context (co_ops is not FORCE RLS per ADR-0004 §5). Returns the co_op_id or throws.
import { Pool } from "pg";
import { withTenantTx } from "../db/internal/tenant-tx";
import type { PoolClient } from "pg";

const ownerPool = new Pool({
  connectionString: process.env.OWNER_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function resolveCoOpIdBySlug(slug: string): Promise<string> {
  const r = await ownerPool.query("SELECT id FROM co_ops WHERE slug = $1", [slug]);
  if (r.rowCount === 0) throw new Error("co-op not found");
  return r.rows[0].id as string;
}

/** Pre-auth tenant transaction: resolves co_op_id by slug, then runs fn in tenant context.
 *  This is the app-facing door for unauthenticated operations (register, login credential
 *  check). Authenticated operations use withSessionTx instead. */
export async function withCoOpTx<T>(
  slug: string,
  fn: (tx: PoolClient, coOpId: string) => Promise<T>,
): Promise<T> {
  const coOpId = await resolveCoOpIdBySlug(slug);
  return withTenantTx(coOpId, (tx) => fn(tx, coOpId));
}
