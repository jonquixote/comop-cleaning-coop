// MANDATORY TDD (std §1, §8a): pricing math + policy-version determinism. Written first.
// Pure functions — no DB. priceJob returns a COMPUTABLE BREAKDOWN, never a scalar.
import { describe, test, expect } from "vitest";
import { priceJob, type CleaningJobDetails } from "../../sectors/cleaning/pricing";
import type { PolicySnapshot } from "../../platform/sector-contract/types";

const policyV1: PolicySnapshot = { policyVersionId: "v1", surplusSplit: 0.2 };
const sample: CleaningJobDetails = { sqft: 1200, bedrooms: 3, bathrooms: 2, addons: ["deep_clean"] };

describe("cleaning priceJob — breakdown invariants", () => {
  test("components sum EXACTLY to final_price_cents", () => {
    const b = priceJob(sample, policyV1);
    expect(b.labor_cents + b.materials_cents + b.overhead_alloc_cents + b.surplus_cents).toBe(b.final_price_cents);
  });

  test("all amounts are integer cents (no floats)", () => {
    const b = priceJob(sample, policyV1);
    for (const v of [b.labor_cents, b.materials_cents, b.overhead_alloc_cents, b.surplus_cents, b.final_price_cents]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test("deterministic: same details + same policy version → identical breakdown", () => {
    expect(priceJob(sample, policyV1)).toEqual(priceJob(sample, policyV1));
  });

  test("stamps the snapshot's policy_version_id onto the breakdown", () => {
    expect(priceJob(sample, policyV1).policy_version_id).toBe("v1");
  });

  test("the surplus_split lever moves price: higher split → more surplus + higher final", () => {
    const low = priceJob(sample, { policyVersionId: "v1", surplusSplit: 0.2 });
    const high = priceJob(sample, { policyVersionId: "v2", surplusSplit: 0.3 });
    expect(high.surplus_cents).toBeGreaterThan(low.surplus_cents);
    expect(high.final_price_cents).toBeGreaterThan(low.final_price_cents);
    // cost components unchanged by the split — only surplus (and thus final) move:
    expect(high.labor_cents).toBe(low.labor_cents);
    expect(high.materials_cents).toBe(low.materials_cents);
    expect(high.overhead_alloc_cents).toBe(low.overhead_alloc_cents);
  });
});
