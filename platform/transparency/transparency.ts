// Financial transparency (platform, sector-agnostic — impl §6, the anti-waste surface).
// The live economics every worker-owner can see: revenue, cost components, the surplus pool,
// and the current pay↔price lever. Reads only existing tables (jobs, payout_ledger,
// policy_settings) — honest numbers, all sides; inform, don't steer. Runs in the caller's tx.
import type { PoolClient } from "pg";
import { resolveCurrentPolicySnapshot } from "../policy/policy";

export interface TransparencyReport {
  totalRevenueCents: number; // SUM(final_price_cents) of paid jobs
  laborCents: number;
  materialsCents: number;
  overheadCents: number;
  surplusPoolCents: number; // SUM(payout_ledger.surplus_cents)
  currentSurplusSplit: number; // the versioned pay↔price lever (fraction)
  policyVersionId: string;
}

export async function getCoOpTransparencyReport(tx: PoolClient, coOpId: string): Promise<TransparencyReport> {
  const econ = await tx.query(
    `SELECT
       COALESCE(SUM(final_price_cents), 0)::bigint                             AS revenue,
       COALESCE(SUM((breakdown_json->>'labor_cents')::int), 0)::bigint         AS labor,
       COALESCE(SUM((breakdown_json->>'materials_cents')::int), 0)::bigint     AS materials,
       COALESCE(SUM((breakdown_json->>'overhead_alloc_cents')::int), 0)::bigint AS overhead
     FROM jobs WHERE status = 'paid' AND co_op_id = $1`,
    [coOpId],
  );
  const surplus = await tx.query(
    "SELECT COALESCE(SUM(surplus_cents), 0)::bigint AS s FROM payout_ledger WHERE co_op_id = $1",
    [coOpId],
  );
  const policy = await resolveCurrentPolicySnapshot(tx);

  return {
    totalRevenueCents: Number(econ.rows[0].revenue),
    laborCents: Number(econ.rows[0].labor),
    materialsCents: Number(econ.rows[0].materials),
    overheadCents: Number(econ.rows[0].overhead),
    surplusPoolCents: Number(surplus.rows[0].s),
    currentSurplusSplit: policy.surplusSplit,
    policyVersionId: policy.policyVersionId,
  };
}
