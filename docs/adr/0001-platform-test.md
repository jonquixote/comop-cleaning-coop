# ADR-0001: The Platform Test — what may live in `/platform`

- **Status:** Accepted
- **Date:** genesis (N=1)
- **Context:** The app is a single-tenant cleaning product built as a modular monolith whose internal seams are pre-scored where the future platform/local (federation) cut will fall. The platform layer is only valuable if it remains *liftable* — reusable, unchanged, by a future second sector (landscaping, junk removal, etc.). The dominant long-run risk is boundary erosion: under deadline pressure, cleaning-specific assumptions leak into shared modules and the platform silently becomes a distributed monolith.

## Decision
**Every module, type, table, or function placed in `/platform` must be reusable by at least one plausible second sector without code changes, or it is not platform.**

Operationally:
- At code review, every change touching `/platform` is held against one question: *could another sector use this unchanged?* If no, it does not belong in `/platform`, regardless of where the file currently sits.
- The platform layer **knows nothing about cleaning.** Sectors plug into it through the sector-adapter interface (`estimateJobDuration`, `getRequiredSkills`, `priceJob`, `getComplianceRuleset`, `getJobDetailSchema`).
- Dispatch boundary (the most erosion-prone seam): the **engine owns time windows, worker availability, route optimization, and assignment constraints** (when / who / where-order). **Sectors own duration estimation, required-skill determination, and price formation** (what-the-job-is). Test: a rule true for landscaping crews too is engine; a rule true only because cleaning works a certain way is sector.

## Consequences
- A proposal to add cleaning-only fields or logic to platform scheduling is a **stop-the-line review event**, not a routine PR.
- Some duplication across sectors is accepted as the cost of keeping the platform liftable. Do not "DRY up" sector-specific logic into the platform to avoid repetition — that is the erosion this ADR exists to prevent.
- This ADR is enforced mechanically by the CI import rule (ADR-0003) and socially by the review question above. Lint catches wrong-direction dependencies; the review question catches the subtler "technically in /platform but secretly cleaning-specific" case lint cannot see.
