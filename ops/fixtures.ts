// Shared seed/test fixtures. Fixed UUIDs so the isolation test can reference the
// seeded co-ops deterministically. Co-op B is the DORMANT isolation fixture —
// never delete it from the seed (onboarding §1).
export const COOP_A = "00000000-0000-0000-0000-00000000000a";
export const COOP_B = "00000000-0000-0000-0000-00000000000b";
export const COOP_A_NAME = "Co-op A (active)";
export const COOP_B_NAME = "Co-op B (dormant isolation fixture)";
