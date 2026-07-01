// Surplus allocation (platform, sector-agnostic). Closing a period distributes the surplus
// recorded in payout_ledger over the window to member capital accounts BY LABOR (patronage
// by hours — spec §4), conserving cents exactly (largest-remainder). Append to
// member_allocations; mark the period closed. Guard: period must be open.
//
// NOTE (§9): tax-conformant patronage treatment is validated by bylaws + CPA — this engine
// tracks and allocates; it does not assert deductibility. Do not rely on these outputs for
// filings or member tax statements until confirmed.
import type { PoolClient } from "pg";

export class AllocationError extends Error {}

interface MemberLabor {
  memberId: string;
  hours: number;
}
interface MemberAllocation extends MemberLabor {
  amountCents: number;
}

// Distribute `total` cents across members proportional to hours, conserving cents exactly:
// floor each share, then hand the leftover cents to the largest fractional remainders.
function distributeByLargestRemainder(total: number, members: MemberLabor[], totalHours: number): MemberAllocation[] {
  if (totalHours <= 0 || members.length === 0) {
    return members.map((m) => ({ ...m, amountCents: 0 }));
  }
  const scored = members.map((m) => {
    const raw = (total * m.hours) / totalHours;
    const floor = Math.floor(raw);
    return { member: m, floor, frac: raw - floor };
  });
  const floorSum = scored.reduce((a, s) => a + s.floor, 0);
  let leftover = total - floorSum; // cents still to distribute
  scored.sort((a, b) => b.frac - a.frac);
  return scored.map((s) => {
    const bonus = leftover > 0 ? 1 : 0;
    if (leftover > 0) leftover -= 1;
    return { memberId: s.member.memberId, hours: s.member.hours, amountCents: s.floor + bonus };
  });
}

export async function closeAllocationPeriod(
  tx: PoolClient,
  coOpId: string,
  periodId: string,
): Promise<{ totalSurplusCents: number; memberCount: number }> {
  const p = await tx.query(
    "SELECT starts_at, ends_at, status FROM allocation_periods WHERE id = $1 AND co_op_id = $2",
    [periodId, coOpId],
  );
  if (p.rowCount === 0) throw new AllocationError("allocation period not found");
  if (p.rows[0].status !== "open") throw new AllocationError("allocation period is not open");
  const { starts_at, ends_at } = p.rows[0];

  const s = await tx.query(
    "SELECT COALESCE(SUM(surplus_cents), 0)::bigint AS total FROM payout_ledger WHERE recorded_at >= $1 AND recorded_at < $2",
    [starts_at, ends_at],
  );
  const totalSurplus = Number(s.rows[0].total);

  const labor = await tx.query(
    `SELECT ja.member_id, SUM(ja.hours_logged) AS hours
     FROM job_assignments ja
     JOIN payout_ledger pl ON pl.job_id = ja.job_id
     WHERE pl.recorded_at >= $1 AND pl.recorded_at < $2
       AND ja.status = 'completed' AND ja.hours_logged IS NOT NULL
     GROUP BY ja.member_id`,
    [starts_at, ends_at],
  );
  const members: MemberLabor[] = labor.rows.map((r) => ({ memberId: r.member_id as string, hours: Number(r.hours) }));
  const totalHours = members.reduce((a, m) => a + m.hours, 0);

  const allocations = distributeByLargestRemainder(totalSurplus, members, totalHours);
  for (const a of allocations) {
    await tx.query(
      `INSERT INTO member_allocations (co_op_id, period_id, member_id, labor_basis, amount_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (period_id, member_id) DO NOTHING`,
      [coOpId, periodId, a.memberId, a.hours, a.amountCents],
    );
  }

  await tx.query(
    "UPDATE allocation_periods SET status = 'closed', closed_at = now() WHERE id = $1 AND co_op_id = $2",
    [periodId, coOpId],
  );
  return { totalSurplusCents: totalSurplus, memberCount: allocations.length };
}
