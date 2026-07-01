// Round-trip verification — the exit-right invariant's proof (platform; ADR-0009). Operates on
// the export DOCUMENTS (not raw ids, which legitimately change on re-map). Never throws — always
// reports { valid, errors }.
import type { ExportDocument } from "./export";

export interface VerifyResult {
  valid: boolean;
  errors: string[];
}

const rowsOf = (d: ExportDocument, t: string): Record<string, unknown>[] => d.tables[t]?.rows ?? [];
const sumField = (rs: Record<string, unknown>[], f: string): number => rs.reduce((s, r) => s + Number(r[f] ?? 0), 0);
const ms = (v: unknown): number => new Date(v as string).getTime();

export function verifyRoundTrip(original: ExportDocument, reimported: ExportDocument): VerifyResult {
  const errors: string[] = [];

  // (1) row counts match per table
  const tables = new Set([...Object.keys(original.tables), ...Object.keys(reimported.tables)]);
  for (const t of tables) {
    const a = original.tables[t]?.rowCount ?? 0;
    const b = reimported.tables[t]?.rowCount ?? 0;
    if (a !== b) errors.push(`row count mismatch for ${t}: original ${a}, reimported ${b}`);
  }

  // (2) payout ledger surplus sum is identical
  const aSurplus = sumField(rowsOf(original, "payout_ledger"), "surplus_cents");
  const bSurplus = sumField(rowsOf(reimported, "payout_ledger"), "surplus_cents");
  if (aSurplus !== bSurplus) {
    errors.push(`payout surplus sum mismatch: original ${aSurplus}, reimported ${bSurplus}`);
  }

  // (3) allocation conservation: per period, Σ member_allocations == surplus in the period window
  for (const period of rowsOf(reimported, "allocation_periods")) {
    const allocated = sumField(
      rowsOf(reimported, "member_allocations").filter((a) => a.period_id === period.id),
      "amount_cents",
    );
    const windowSurplus = sumField(
      rowsOf(reimported, "payout_ledger").filter(
        (p) => ms(p.recorded_at) >= ms(period.starts_at) && ms(p.recorded_at) < ms(period.ends_at),
      ),
      "surplus_cents",
    );
    if (allocated !== windowSurplus) {
      errors.push(
        `allocation conservation violated for period ${String(period.id)}: allocated ${allocated} != window surplus ${windowSurplus}`,
      );
    }
  }

  // (4) policy version chain: every non-null set_by_proposal_id resolves to a present proposal
  const proposalIds = new Set(rowsOf(reimported, "proposals").map((r) => r.id));
  for (const ps of rowsOf(reimported, "policy_settings")) {
    if (ps.set_by_proposal_id != null && !proposalIds.has(ps.set_by_proposal_id)) {
      errors.push(`policy_settings ${String(ps.id)} references missing proposal ${String(ps.set_by_proposal_id)}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
