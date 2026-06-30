// Platform↔sector contract (ADR-0001). Sector-agnostic — knows nothing about any sector.
// Adding a sector = implementing SectorAdapter; the platform never changes.
//
// priceJob returns a COMPUTABLE BREAKDOWN (components sum to final), never a scalar — so
// transparency and vote-time tradeoff modeling read real economics instead of
// reverse-engineering them (impl §5).

export interface PriceBreakdown {
  labor_cents: number;
  materials_cents: number;
  overhead_alloc_cents: number;
  surplus_cents: number; // worker-benefit margin, derived from the split
  final_price_cents: number; // == labor + materials + overhead + surplus (asserted by test, §8a)
  policy_version_id: string; // the policy_settings version this price was computed under
}

// The snapshot a quote freezes onto itself at creation time T (impl §5). Re-pricing a job
// from its stored details + this snapshot reproduces the identical breakdown (determinism).
export interface PolicySnapshot {
  policyVersionId: string;
  surplusSplit: number; // the pay↔price lever (fraction) — a versioned, vote-set policy value
}

// Each sector implements this small set; the platform calls it and never changes.
export interface SectorAdapter<Details> {
  estimateJobDuration(details: Details): number; // minutes — sector owns
  getRequiredSkills(details: Details): string[]; // sector owns
  priceJob(details: Details, policy: PolicySnapshot): PriceBreakdown; // sector owns
  getComplianceRuleset(): string[]; // sector owns
  getJobDetailSchema(): Record<string, string>; // sector owns
}
