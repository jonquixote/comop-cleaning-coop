// 5th MANDATORY invariant (std §1, §8a): sector-adapter contract. The cleaning adapter
// honors the SectorAdapter interface and the PriceBreakdown shape. Written first.
import { describe, test, expect } from "vitest";
import { cleaningAdapter } from "../../sectors/cleaning/adapter";
import type { SectorAdapter, PriceBreakdown } from "../../platform/sector-contract/types";
import type { CleaningJobDetails } from "../../sectors/cleaning/pricing";

const details: CleaningJobDetails = { sqft: 1200, bedrooms: 3, bathrooms: 2, addons: ["deep_clean"] };
const policy = { policyVersionId: "v1", surplusSplit: 0.2 };

describe("cleaning SectorAdapter contract", () => {
  test("conforms to SectorAdapter<CleaningJobDetails> (compile-time + shape)", () => {
    const a: SectorAdapter<CleaningJobDetails> = cleaningAdapter;
    for (const fn of ["estimateJobDuration", "getRequiredSkills", "priceJob", "getComplianceRuleset", "getJobDetailSchema"] as const) {
      expect(typeof a[fn]).toBe("function");
    }
  });

  test("estimateJobDuration returns positive integer minutes", () => {
    const m = cleaningAdapter.estimateJobDuration(details);
    expect(Number.isInteger(m)).toBe(true);
    expect(m).toBeGreaterThan(0);
  });

  test("getRequiredSkills returns a non-empty string[]", () => {
    const skills = cleaningAdapter.getRequiredSkills(details);
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every((s) => typeof s === "string")).toBe(true);
  });

  test("priceJob returns a PriceBreakdown whose components sum to final", () => {
    const b: PriceBreakdown = cleaningAdapter.priceJob(details, policy);
    expect(b.labor_cents + b.materials_cents + b.overhead_alloc_cents + b.surplus_cents).toBe(b.final_price_cents);
    expect(b.policy_version_id).toBe("v1");
  });

  test("getComplianceRuleset returns the cleaning ruleset (IIPP + janitorial registration)", () => {
    expect(cleaningAdapter.getComplianceRuleset()).toEqual(
      expect.arrayContaining(["IIPP", "janitorial_registration"]),
    );
  });

  test("getJobDetailSchema describes the cleaning job-detail fields", () => {
    expect(Object.keys(cleaningAdapter.getJobDetailSchema())).toEqual(
      expect.arrayContaining(["sqft", "bedrooms", "bathrooms", "addons"]),
    );
  });
});
