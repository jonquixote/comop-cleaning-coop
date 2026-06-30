// Payout ledger (platform, sector-agnostic). recordPayout reads the job's FROZEN breakdown
// surplus (never recomputed) and appends exactly one ledger row per job (idempotent via the
// UNIQUE job_id). The ledger is append-only (no UPDATE/DELETE grant). getCoOpSurplusBalance
// sums the tenant's accrued worker-benefit surplus. Runs in the caller's tenant tx.
import type { PoolClient } from "pg";

export class PayoutError extends Error {}

export async function recordPayout(
  tx: PoolClient,
  coOpId: string,
  jobId: string,
): Promise<{ recorded: boolean; surplusCents: number }> {
  const j = await tx.query(
    "SELECT status, breakdown_json FROM jobs WHERE id = $1 AND co_op_id = $2",
    [jobId, coOpId],
  );
  if (j.rowCount === 0) throw new PayoutError("job not found");
  if (j.rows[0].status !== "done") throw new PayoutError("job is not completed");

  const surplusCents = Number(j.rows[0].breakdown_json.surplus_cents); // FROZEN breakdown, not recomputed
  const r = await tx.query(
    `INSERT INTO payout_ledger (co_op_id, job_id, surplus_cents)
     VALUES ($1, $2, $3)
     ON CONFLICT (job_id) DO NOTHING
     RETURNING id`,
    [coOpId, jobId, surplusCents],
  );
  return { recorded: (r.rowCount ?? 0) > 0, surplusCents };
}

export async function getCoOpSurplusBalance(tx: PoolClient): Promise<number> {
  const r = await tx.query("SELECT COALESCE(SUM(surplus_cents), 0)::bigint AS total FROM payout_ledger");
  return Number(r.rows[0].total);
}
