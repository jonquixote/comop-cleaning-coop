# Phase 2 — Household Sectors Expansion Plan
**STATUS: DRAFTED AND DORMANT. Do not execute. This file sits in the repo, correct and waiting.**
**Drafted:** 2026-07-02 · **Supersedes:** nothing · **Companions:** `phase-2-household-implementation-spec.md`, ADR-0005, ADR-0006 (drafted inside the spec, to land as docs PRs at gate-clearance)

---

## 0. The gate (hard, twofold, artifact-verified)

Stage 2 work begins only when **both** exist as committed artifacts:

- **G1 — Phase 1 checkpoint cleared:** a real cleaning business is running on the platform, defined as: **10 consecutive real paid jobs** booked → dispatched → completed → invoiced → paid → reconciled **with zero manual database edits**, plus one post-launch restore drill passed. Evidence: a signed checkpoint note at `docs/checkpoints/phase-1-checkpoint.md` naming the 10 job IDs and the drill date.
- **G2 — Market test GO verdict:** the pre-registered protocol's joint verdict cell reads **GO**. Evidence: the signed protocol + a dated export of the GATES sheet committed at `docs/checkpoints/market-test-verdict/`.

**Nobody starts Stage 2 early because the code felt ready before the market did.** A branch named `phase-2/*` created before both artifacts exist is itself a stop-the-line event under the engineering standard.

**Build gates vs. launch gates (distinct, both binding):** G1+G2 unlock *building*. **Going live with childcare bookings** additionally requires: (L1) counsel's written answers to attorney-packet Q1–Q3 committed at `docs/counsel/`, (L2) insurance bound — A&M coverage in force and the WCIRB classification determination (or carrier's written interim treatment) on file, (L3) the TrustLine pipeline live (first workers at applicant status or beyond). The compliance engine enforces L1 mechanically: childcare service activation reads a `counsel_reference` config value pointing at the committed letter, and refuses to enable without it.

## 1. The architecture decision (not punted)

**Decision: separate sector adapters per service type — `childcare` as a full adapter, `meal_prep` as a thin one — plus a new *platform* primitive, the `engagement`, which owns bundling.** The "one combined household adapter that always prices as a bundle" alternative is **rejected**, for three reasons that hold under every market-test outcome that reaches this gate:

1. **Compliance granularity is non-negotiable.** WCIRB payroll splitting demands contemporaneous task-coded records per service type — no percentages, no estimates, or the whole day defaults to the highest-rated class. The wage-order defense and the 80/20 personal-attendant audit need the same per-service typing. A monolithic "household job" would have to decompose into typed segments internally anyway; the segment is the true atom, so the schema should say so.
2. **Product ambiguity under a Form-A-flagship outcome.** G2 guarantees *some* retainer evidence (GO requires it), but the flagship may still be Form A. A bundle-only household adapter would then compete with the cleaning adapter to price a plain clean — two owners for one product is how pricing bugs are born. Per-service adapters serve spot cleans, spot childcare, and bundles from one set of parts.
3. **The extraction test (ADR-0001, applied literally).** A plausible second co-op that does *only* childcare (the Beyond Care model) must be able to reuse the childcare adapter without code changes. A fused household adapter fails that test on its face.

**How the market signal steers the build (pre-committed conditional, using data we'll have):**
- If the test's flagship = **Form B**: the engagement primitive ships *before* childcare go-live (Tasks 5 before 4-launch in the spec) — the retainer is the product, spot childcare is incidental.
- If flagship = **Form A**: childcare goes live first as spot bookings layered on cleaning clients; the engagement primitive follows within the stage — the retainer is the upsell.
Either way every component gets built; only the order and the go-live sequencing move. That is why this decision can be made now without waiting on the verdict.

## 2. New data, sorted by the platform test (ADR-0001 applied item by item)

*The test, verbatim: every platform module must be reusable by a plausible second sector without code changes, or it is not platform.*

| Item | Verdict | Reasoning |
|---|---|---|
| **Credential registry** (`worker_credentials`: type, status pending/valid/expired/revoked, issued, **expires**, evidence ref, verifier) | **/platform** | Janitorial needs OSHA certs; care needs HCA registration + TB tests. Universal machinery; *which* credentials a service requires is declared by the sector adapter's `getComplianceRuleset`. |
| TrustLine status + expiry · Pediatric CPR/first-aid + expiry · annual MVR | **rows in the platform registry**, required-by: childcare adapter declaration | Sector declares, platform enforces. TrustLine gate = status ∈ {pending, valid} (applicant status suffices per compliance pass); CPR gate = valid **on the service date**, not merely today. |
| **Compliance instruments** (`compliance_instruments`: type, worker/client/job scope, signed_at, doc ref) — CANRA §11166.5 acknowledgment (worker-scoped), per-shift on-duty meal agreement (job-scoped, written/paid/revocable), per-family transport authorization (client×worker-scoped) | **/platform** | The care phase will add the WIC §15630 elder-abuse acknowledgment to the same table; janitorial could add site-safety acknowledgments. Instrument machinery is universal; instrument *types* are sector-declared. |
| **Parent-presence relief logging** | **sector-owned field** (`job_childcare_details.parent_present`) **normalized through the adapter** into a platform input `relief_available: boolean` | The platform meal-period rule is generic — "relief available → schedule off-duty meal; else per-shift on-duty agreement required, fail-closed." Only childcare knows that a parent constitutes relief. The domain semantics stay in the sector; the law machinery stays in the platform. This is the seam working as designed. |
| **Per-service hour codes** | **falls out of the schema** — every `jobs` row (segment) carries a non-null `service_type`; timekeeping actuals attach to segments | The WCIRB highest-rated-class default becomes *impossible by construction*: payroll export refuses any worker-day containing untyped time and emits a block event instead. |
| **Day-level compliance evaluation** (gap/split-shift detection, daily OT/DT, meal-period placement, 48-hr sick accrual) + `compliance_events` (append-only) + versioned `jurisdictions`/`minimum_wages` tables | **/platform** | Pure law, zero sector semantics. Minimum-wage tables are global-read reference data (same exception class as `sector_registry`, ADR-0002 note). |
| **Engagements** (recurring client commitment: primary worker, weekly segment template, tier price, continuity promise, generation of segment jobs) | **/platform** | A janitorial co-op bundles floor-care + windows on a contract; a care co-op bundles personal care + homemaking on a care plan. Recurring multi-segment commitments pass the extraction test cleanly. |
| `job_childcare_details` (children count/age band, school/site, transport flag, parent_present) · `job_mealprep_details` (minimal) | **/sectors** | Classic extension-table pattern from Phase 1. |
| 80/20 personal-attendant dashboard | **/platform reporting** over sector-declared task-category mapping | Dormant until counsel; see §4. |

## 3. What changes in dispatch, pricing, and compliance — honestly

**The honest headline: "just add a sector" undersells this stage by about half.** Phase 1's silent assumption was *one job = one worker = one day*. The hybrid day breaks it: N typed segments per day, governed by day-level law no single sector adapter can own. That forces two genuinely new platform layers — the engagement primitive and the worker-day compliance evaluator — and those two are roughly **50% of Stage 2's effort**. The sector adapters themselves are the easy part. Budget accordingly and don't let anyone sell this stage as "a schema migration and two adapters."

- **Dispatch** gains four constraint types: (1) *credential gating at assignment* — fail-closed against the registry per adapter-declared requirements, validity checked on the service date; (2) *contiguity preference* — any employer-set unpaid gap >1 hr auto-attaches the split-shift premium **as a visible cost in the plan**, so the optimizer economically prefers the continuous day: the statute's incentive becomes the scheduler's objective function; (3) *continuity* — engagements carry a primary worker and an ordered bench; substitution triggers client notification (the backup-bench promise as code); (4) *meal-period placement* — any day >5 hrs gets a 30-minute meal scheduled to start before the end of the 5th hour: off-duty when `relief_available`, otherwise the shift blocks until its per-shift on-duty agreement instrument exists.
- **Pricing** stays per-segment through the existing adapter interface — `PriceBreakdown` must-sum and `policy_version_id` snapshots unchanged. Childcare and meal-prep hourly rates become member-voted, versioned sector policy levers on the same machinery. The engagement adds one invariant up a level: **Σ segment final prices + any explicit `plan_adjustment` line = invoiced total** (tier prices are marketing round numbers; the adjustment line reconciles them — never silently).
- **Compliance engine** runs twice per worker-day: at **plan time** (dispatch validation, premium forecasting, agreement gating) and at **payroll close** (recomputation from clock actuals; divergences emit `compliance_events` — premium due, OT/DT computed, violations flagged — which feed `payroll_sync_records` as typed earning codes). Actuals win; plans never silently overwrite them.
- **Payroll export** grows real complexity: earning codes (regular, daily OT, DT, split-shift premium, sick), task-coded hour summaries per worker per class. **Stage 2 Task 0 is a provider-capability check** — if the payroll provider can't carry these codes, we learn it before writing a line of engine code.

## 4. Counsel-gated design points (built dormant, switched by paper)

- **Wage order (attorney Q1):** everything is designed to the stricter reading — full non-exemption, 8/40/DT-12, split premiums, standard meal/rest. Counsel's answer changes documents, not schema.
- **Personal-attendant mode (Q1/§80-20):** the dashboard ships; the *exemption treatment* is a config flag that the compliance engine refuses to enable unless `counsel_reference` points at a committed opinion letter. Paper is the switch.
- **Parent-present presumption (Q4):** the `relief_available` mapping defaults to *parent present ⇒ relief available ⇒ off-duty meal scheduled*. If counsel answers otherwise, the mapping changes in the childcare adapter — one function, platform untouched.

## 5. Out of scope for Stage 2 — even then

Federation infrastructure of any kind · provisioning flows for a second co-op tenant (multi-tenant RLS exists; activation does not) · Regime 2 (commercial janitorial adapter) · Regime 3 (HCO care adapter, EVV, HCA registry integration) — with the standing rule that no Stage 2 schema decision may foreclose it (the credential registry and instruments table are already generic for exactly this reason) · card-on-file autopay and any subscription-billing engine (engagements generate weekly **draft** invoices on the existing payment rails; autopay is Stage 3) · route optimization beyond the contiguity/continuity constraints · native apps · transport *scheduling* optimization (transport ships only as: credential rows + authorization instruments + a boolean on childcare jobs).

## 6. Definition of done for the stage

All Phase 1 invariants still green · the spec's new TDD-mandatory suites green · one real household engagement running end-to-end for two consecutive weeks (segments generated → dispatched under all four constraint types → worked → clocked → payroll-closed with correct earning codes → invoiced with the sum invariant holding) · zero untyped worker-time in payroll history · launch gates L1–L3 evidenced in `docs/` before the first childcare booking.
