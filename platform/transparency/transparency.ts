// Financial transparency (platform, sector-agnostic — impl §6, the anti-waste surface).
// The live economics every worker-owner can see: revenue, cost components, the surplus pool,
// and the current pay↔price lever. Reads only existing tables (jobs, payout_ledger,
// policy_settings, expenses) — honest numbers, all sides; inform, don't steer. Runs in
// the caller's tx.
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

// ---- Period-health / break-even (the forward-looking half of transparency) ----
// Spec §6 "Period-health / break-even (worker app)":
//   - revenue vs. fixed + variable costs FOR THE CURRENT OPEN PERIOD
//   - break-even line (minimum revenue to cover costs)
//   - surplus or deficit for the period so far
//   - a clear health indicator ("on_track" / "below_break_even" / "deficit")
//
// NOTE ON THE BREAK-EVEN FORMULA:
//   surplusSplit is the FRACTION OF SURPLUS that goes to workers (spec §6 — the
//   pay↔price lever). It is NOT a share of revenue absorbed by overhead. The
//   break-even point is simply the revenue at which surplus = 0, i.e. revenue
//   == totalCosts. Lowering surplusSplit moves WORKER TAKE-HOME per unit of
//   surplus (it does NOT change when the co-op can cover its costs).

export type PeriodHealthStatus = "on_track" | "below_break_even" | "deficit";

export interface PeriodHealth {
  periodId: string | null;          // null if no open period exists for this co-op
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  totalRevenueCents: number;        // SUM(payout_ledger.amount_cents) within the open period window
  totalExpensesCents: number;       // SUM(expenses.amount_cents) within the window
  fixedCostsCents: number;          // = totalExpenses within the window (no separate fixed/variable split yet)
  laborCents: number;               // SUM(payout_ledger.labor_basis_cents) within the window (worker pay booked)
  surplusCents: number;             // revenue - expenses
  currentSurplusSplit: number;      // from policy (informs worker share, NOT break-even)
  breakEvenRevenueCents: number;    // == totalExpensesCents (surplus=0 when revenue exactly covers costs)
  status: PeriodHealthStatus;
  statusReason: string;             // human-readable explanation for UI
}

export async function getPeriodHealth(tx: PoolClient, coOpId: string): Promise<PeriodHealth> {
  // The current OPEN allocation_period for this co-op. If none, return zeros.
  const period = await tx.query(
    `SELECT id, starts_at, ends_at
       FROM allocation_periods
      WHERE co_op_id = $1 AND status = 'open'
      ORDER BY starts_at DESC
      LIMIT 1`,
    [coOpId],
  );
  if ((period.rowCount ?? 0) === 0) {
    const policy = await resolveCurrentPolicySnapshot(tx);
    return {
      periodId: null,
      periodStartsAt: null,
      periodEndsAt: null,
      totalRevenueCents: 0,
      totalExpensesCents: 0,
      fixedCostsCents: 0,
      laborCents: 0,
      surplusCents: 0,
      currentSurplusSplit: policy.surplusSplit,
      breakEvenRevenueCents: 0,
      status: "deficit",
      statusReason: "no open allocation period — cannot compute period health",
    };
  }
  const pId = period.rows[0].id as string;
  const pStart = period.rows[0].starts_at as Date;
  const pEnd = period.rows[0].ends_at as Date;

  // Read surfaces:
  //   - revenue from SUM(final_price_cents) of jobs that were recorded in this window
  //     (we use jobs.updated_at as the closest proxy — `recorded_at` doesn't exist on jobs;
  //      this is intentionally a coarse approximation; the canonical period truth is the
  //      explicit ledger written by closeAllocationPeriod, computed afterwards, not live).
  //   - expenses from expenses.amount_cents within the window
  //   - labor from SUM(jobs.breakdown_json->>'labor_cents'::int) of done/paid jobs in window
  const rev = await tx.query(
    `SELECT COALESCE(SUM(final_price_cents), 0)::bigint AS r
       FROM jobs
      WHERE co_op_id = $1 AND updated_at >= $2 AND updated_at <= $3
        AND status IN ('done','paid')`,
    [coOpId, pStart, pEnd],
  );
  const exp = await tx.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS e
       FROM expenses
      WHERE co_op_id = $1 AND incurred_at >= $2 AND incurred_at <= $3`,
    [coOpId, pStart, pEnd],
  );
  const lab = await tx.query(
    `SELECT COALESCE(SUM((breakdown_json->>'labor_cents')::int), 0)::bigint AS l
       FROM jobs
      WHERE co_op_id = $1 AND updated_at >= $2 AND updated_at <= $3
        AND status IN ('done','paid')`,
    [coOpId, pStart, pEnd],
  );
  const policy = await resolveCurrentPolicySnapshot(tx);

  const totalRevenueCents = Number(rev.rows[0].r);
  const totalExpensesCents = Number(exp.rows[0].e);
  const laborCents = Number(lab.rows[0].l);
  const surplusCents = totalRevenueCents - totalExpensesCents;
  const breakEvenRevenueCents = totalExpensesCents; // surplus = 0 ⟺ revenue == costs

  // Status rule: surplus > 0 → on_track; surplus == 0 → below_break_even; surplus < 0 → deficit.
  // No revenue at all (also a viable case for a brand-new period) is a deficit until costs kick in.
  const status: PeriodHealthStatus =
    surplusCents > 0 ? "on_track" : surplusCents === 0 ? "below_break_even" : "deficit";
  const statusReason =
    status === "on_track"
      ? `surplus ${surplusCents} cents above break-even`
      : status === "below_break_even"
        ? `exactly at break-even (revenue = costs)`
        : `deficit of ${Math.abs(surplusCents)} cents below break-even`;

  return {
    periodId: pId,
    periodStartsAt: pStart.toISOString(),
    periodEndsAt: pEnd.toISOString(),
    totalRevenueCents,
    totalExpensesCents,
    fixedCostsCents: totalExpensesCents,
    laborCents,
    surplusCents,
    currentSurplusSplit: policy.surplusSplit,
    breakEvenRevenueCents,
    status,
    statusReason,
  };
}
