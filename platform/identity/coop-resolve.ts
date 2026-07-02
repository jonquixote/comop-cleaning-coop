// Co-op resolution by slug — public, pre-auth. Used by register/login to find the
// tenant before a session exists. The slug → co_op_id lookup does not require tenant
// context (co_ops is not FORCE RLS per ADR-0004 §5). Returns the co_op_id or throws.
import { Pool } from "pg";
import { withTenantTx } from "../db/internal/tenant-tx";
import type { PoolClient } from "pg";

// Owner pool uses the same SSL logic as the app pool: localhost doesn't need it,
// remote managed DBs (UpCloud/Aiven) require it.
const ownerUrl = process.env.OWNER_DATABASE_URL ?? "";
const ssl = (() => {
  try {
    const u = new URL(ownerUrl);
    if (["localhost", "127.0.0.1", "::1"].includes(u.hostname)) return undefined;
  } catch { /* fall through */ }
  return { rejectUnauthorized: false };
})();
const ownerPool = new Pool({
  connectionString: ownerUrl,
  ...(ssl ? { ssl } : {}),
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
