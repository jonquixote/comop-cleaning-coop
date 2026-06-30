// Cleaning price formation (sector-owned — impl §5). Pure, deterministic, integer cents.
// The breakdown components sum to final BY CONSTRUCTION; the surplus_split lever moves only
// surplus (and thus final), never the cost components.
import type { PriceBreakdown, PolicySnapshot } from "../../platform/sector-contract/types";

export interface CleaningJobDetails {
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  addons: string[];
}

// Deterministic pricing constants (cents / minutes). Real values are a sector/config
// concern; these defaults are pinned by the breakdown test.
const LABOR_RATE_CENTS_PER_MIN = 50; // $0.50/min
const MIN_PER_BEDROOM = 20;
const MIN_PER_BATHROOM = 30;
const MIN_PER_100_SQFT = 4;
const MATERIALS_BASE_CENTS = 800;
const MATERIALS_PER_BATHROOM_CENTS = 150;
const OVERHEAD_PCT = 0.15; // overhead allocated as a fraction of (labor + materials)
const ADDON_LABOR_MIN: Record<string, number> = {
  deep_clean: 45,
  inside_fridge: 15,
  inside_oven: 20,
  windows: 25,
};

// Sector-owned duration estimate (minutes). Shared by priceJob and the adapter.
export function estimateMinutes(details: CleaningJobDetails): number {
  const addonMinutes = details.addons.reduce((m, a) => m + (ADDON_LABOR_MIN[a] ?? 0), 0);
  return (
    details.bedrooms * MIN_PER_BEDROOM +
    details.bathrooms * MIN_PER_BATHROOM +
    Math.ceil(details.sqft / 100) * MIN_PER_100_SQFT +
    addonMinutes
  );
}

export function priceJob(details: CleaningJobDetails, policy: PolicySnapshot): PriceBreakdown {
  const labor_cents = estimateMinutes(details) * LABOR_RATE_CENTS_PER_MIN;
  const materials_cents = MATERIALS_BASE_CENTS + details.bathrooms * MATERIALS_PER_BATHROOM_CENTS;
  const overhead_alloc_cents = Math.round((labor_cents + materials_cents) * OVERHEAD_PCT);

  // surplus is derived from the split, applied to the cost subtotal; final is the sum, so the
  // breakdown invariant (Σ components == final) holds exactly with no rounding drift.
  const cost_subtotal = labor_cents + materials_cents + overhead_alloc_cents;
  const surplus_cents = Math.round(cost_subtotal * policy.surplusSplit);
  const final_price_cents = cost_subtotal + surplus_cents;

  return {
    labor_cents,
    materials_cents,
    overhead_alloc_cents,
    surplus_cents,
    final_price_cents,
    policy_version_id: policy.policyVersionId,
  };
}
