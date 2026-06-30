// The cleaning sector adapter — the entire platform↔cleaning contract (impl §5, ADR-0001).
// Adding a sector = implementing SectorAdapter; the platform never changes. The platform
// receives this via composition (apps wire it in); platform code never imports it.
import type { PriceBreakdown, PolicySnapshot, SectorAdapter } from "../../platform/sector-contract/types";
import { priceJob, estimateMinutes, type CleaningJobDetails } from "./pricing";

const SKILL_BY_ADDON: Record<string, string> = {
  deep_clean: "deep_clean",
  inside_fridge: "appliance_cleaning",
  inside_oven: "appliance_cleaning",
  windows: "window_cleaning",
};

export const cleaningAdapter: SectorAdapter<CleaningJobDetails> = {
  estimateJobDuration: (details) => estimateMinutes(details),

  getRequiredSkills: (details) => {
    const skills = new Set<string>(["general_cleaning"]);
    for (const a of details.addons) {
      const s = SKILL_BY_ADDON[a];
      if (s) skills.add(s);
    }
    return [...skills];
  },

  priceJob: (details, policy: PolicySnapshot): PriceBreakdown => priceJob(details, policy),

  getComplianceRuleset: () => ["IIPP", "janitorial_registration"],

  getJobDetailSchema: () => ({
    sqft: "number",
    bedrooms: "number",
    bathrooms: "number",
    addons: "string[]",
  }),
};
