// ops/seed.ts — seeds co-op A (active) + dormant co-op B (isolation fixture).
// Idempotent. Provisions co_ops as app_owner (no context — co_ops not forced), then
// seeds each co-op's users+members UNDER ITS OWN tenant context via withTenantTx (the
// app_user runtime path) — so the generic WITH CHECK passes under FORCE and the fixture
// itself is evidence the policy works. Run: `set -a; source .env; set +a; tsx ops/seed.ts`.
import { Client } from "pg";
import { withTenantTx, pool } from "../platform/db/internal/tenant-tx";
import { COOP_A, COOP_B, COOP_A_NAME, COOP_B_NAME } from "./fixtures";

const ownerUrl = process.env.OWNER_DATABASE_URL;
if (!ownerUrl) throw new Error("OWNER_DATABASE_URL is not set (see .env.example)");

// 1. provision both co-ops as app_owner (no tenant context). Idempotent.
const owner = new Client({ connectionString: ownerUrl });
await owner.connect();
await owner.query(
  "INSERT INTO co_ops (id, name) VALUES ($1,$2),($3,$4) ON CONFLICT (id) DO NOTHING",
  [COOP_A, COOP_A_NAME, COOP_B, COOP_B_NAME],
);
await owner.end();

// 2. seed each co-op's rows UNDER ITS OWN context (exercises the real policy path).
async function seedCoOp(coOpId: string, email: string, role: string): Promise<void> {
  await withTenantTx(coOpId, async (tx) => {
    const u = await tx.query(
      `INSERT INTO users (co_op_id, role, email) VALUES ($1,$2,$3)
       ON CONFLICT (co_op_id, email) DO UPDATE SET role = EXCLUDED.role
       RETURNING id`,
      [coOpId, role, email],
    );
    const userId = u.rows[0].id as string;
    await tx.query(
      `INSERT INTO members (co_op_id, user_id, status)
       SELECT $1, $2, 'member'
       WHERE NOT EXISTS (SELECT 1 FROM members WHERE co_op_id = $1 AND user_id = $2)`,
      [coOpId, userId],
    );
  });
}

await seedCoOp(COOP_A, "a-admin@example.test", "admin");
await seedCoOp(COOP_B, "b-worker@example.test", "worker");
await pool.end();
console.log("seed ok: co-op A (active) + co-op B (dormant isolation fixture)");
