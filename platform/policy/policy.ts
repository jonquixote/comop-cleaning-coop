// Versioned policy resolution (platform, sector-agnostic). policy_settings is append-only;
// a quote snapshots the applicable version id, and re-pricing loads that exact version so
// the breakdown is reproduced identically (impl §5; threat-model mode 4). Runs inside the
// caller's tenant transaction (the passed tx already has tenant context set).
import type { PoolClient } from "pg";
import type { PolicySnapshot } from "../sector-contract/types";

const SURPLUS_SPLIT = "surplus_split";

function toSnapshot(row: { id: string; value_json: { fraction: number } }): PolicySnapshot {
  return { policyVersionId: row.id, surplusSplit: Number(row.value_json.fraction) };
}

/** The currently-effective surplus_split version for the tenant (latest effective_from <= now). */
export async function resolveCurrentPolicySnapshot(tx: PoolClient): Promise<PolicySnapshot> {
  const r = await tx.query(
    `SELECT id, value_json FROM policy_settings
     WHERE key = $1 AND effective_from <= now()
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [SURPLUS_SPLIT],
  );
  if (r.rowCount === 0) throw new Error("no surplus_split policy set for tenant");
  return toSnapshot(r.rows[0]);
}

/** Load a SPECIFIC frozen version by id — used to re-price a job from its snapshot. */
export async function getPolicySnapshotById(tx: PoolClient, policyVersionId: string): Promise<PolicySnapshot> {
  const r = await tx.query("SELECT id, value_json FROM policy_settings WHERE id = $1", [policyVersionId]);
  if (r.rowCount === 0) throw new Error("policy version not found");
  return toSnapshot(r.rows[0]);
}
