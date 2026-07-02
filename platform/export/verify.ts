// Round-trip verification — the exit-right invariant's proof (platform; ADR-0009). Operates on
// the export DOCUMENTS (not raw ids, which legitimately change on re-map). Never throws — always
// reports { valid, errors }.
//
// V3 change (fix #4, ADR-0011 § date-safety): `ms()` is replaced with `safeMs()` which returns
// `number | null` for malformed/missing timestamps. Null timestamps trigger an attributable
// error per affected period so users see the corruption rather than getting silently-wrong
// sums or NaN propagation.
import type { ExportDocument } from "./export";

export interface VerifyResult {
  valid: boolean;
  errors: string[];
}

const rowsOf = (d: ExportDocument, t: string): Record<string, unknown>[] => d.tables[t]?.rows ?? [];
const sumField = (rs: Record<string, unknown>[], f: string): number =>
  rs.reduce((s, r) => s + Number(r[f] ?? 0), 0);

/** Defensive timestamp parser. Accepts Date, ISO-8601 string, or epoch-millis number;
 *  returns `null` for everything else (nullish, non-ISO strings, NaN). */
function safeMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    if (v.length === 0) return null;
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function verifyRoundTrip(original: ExportDocument, reimported: ExportDocument): VerifyResult {
  const errors: string[] = [];

  // (1) row counts match per table
  const tables = new Set([...Object.keys(original.tables), ...Object.keys(reimported.tables)]);
  for (const t of tables) {
    const a = original.tables[t]?.rowCount ?? 0;
    const b = reimported.tables[t]?.rowCount ?? 0;
    if (a !== b) errors.push(`row count mismatch for ${t}: original ${a}, reimported ${b}`);
  }

  // (2) payout ledger surplus sum is identical (original is authoritative).
  const aSurplus = sumField(rowsOf(original, "payout_ledger"), "surplus_cents");
  const bSurplus = sumField(rowsOf(reimported, "payout_ledger"), "surplus_cents");
  if (aSurplus !== bSurplus) {
    errors.push(`payout surplus sum mismatch: original ${aSurplus}, reimported ${bSurplus}`);
  }

  // (3) allocation conservation: per period, Σ member_allocations == surplus in the period window.
  // If any ledger row in the window has an unparseable recorded_at, the comparison cannot run
  // safely — mark the period with an attributable error rather than silently dropping the row
  // (which would corrupt the conservation total).
  for (const period of rowsOf(reimported, "allocation_periods")) {
    const periodStart = safeMs(period.starts_at);
    const periodEnd = safeMs(period.ends_at);
    if (periodStart == null || periodEnd == null) {
      errors.push(
        `period ${String(period.id)} has invalid period boundaries (starts_at=${String(
          period.starts_at,
        )}, ends_at=${String(period.ends_at)})`,
      );
      continue;
    }

    const ledgerInWindow: Record<string, unknown>[] = [];
    const dropped: number[] = [];
    rowsOf(reimported, "payout_ledger").forEach((p, i) => {
      const t = safeMs(p.recorded_at);
      if (t == null) {
        dropped.push(i);
        return;
      }
      if (t >= periodStart && t < periodEnd) ledgerInWindow.push(p);
    });
    if (dropped.length > 0) {
      errors.push(
        `period ${String(period.id)}: ${dropped.length} payout_ledger row(s) have invalid recorded_at — conservation unverifiable`,
      );
    }

    const allocated = sumField(
      rowsOf(reimported, "member_allocations").filter((a) => a.period_id === period.id),
      "amount_cents",
    );
    const windowSurplus = sumField(ledgerInWindow, "surplus_cents");
    if (allocated !== windowSurplus) {
      errors.push(
        `allocation conservation violated for period ${String(period.id)}: allocated ${allocated} != window surplus ${windowSurplus}`,
      );
    }
  }

  // (4) policy version chain: every non-null set_by_proposal_id resolves to a present proposal.
  const proposalIds = new Set(rowsOf(reimported, "proposals").map((r) => r.id));
  for (const ps of rowsOf(reimported, "policy_settings")) {
    if (ps.set_by_proposal_id != null && !proposalIds.has(ps.set_by_proposal_id)) {
      errors.push(`policy_settings ${String(ps.id)} references missing proposal ${String(ps.set_by_proposal_id)}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
