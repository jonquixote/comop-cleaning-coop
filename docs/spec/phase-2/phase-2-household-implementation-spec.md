# Phase 2 Implementation Spec — Household Sectors
**STATUS: DRAFTED AND DORMANT. Execution gated on G1 + G2 per `phase-2-household-sectors.md` §0. Reading this early is encouraged; branching early is a stop-the-line event.**
**Extends (does not replace):** `cleaning_app_implementation_spec.md`, `builder_engineering_standard.md` (see Addendum A), `onboarding_runbook.md` (see Addendum B), ADRs 0001–0004.
**Revised 2026-07-03 (v2):** adversarial review + reconciliation against the actual Phase 1 codebase. Material changes: real Phase-1 seam states (credential gate, no invoice rails, no payroll code, `jobs.sector` incumbent), weekly/7th-day OT, sick accrual, travel/non-service time, meal-aware split-shift math, safeguarding features owed to the insurer, plan/close event separation, pay periods, go-live minimum set, launch gate L4. See Addendum C for the commitments-traceability table.

---

## §0 Comprehension gate (addendum to the standard's threat-model gate)

Before Task 1, the builder answers in writing, in the PR that lands the ADRs:

1. Under USRP Part 3 §V Rule 3, when task-coded records fail, the auditor defaults **the employee's entire payroll** — not one day's — to the highest-rated applicable classification. Name the two mechanisms in this spec that make *mistyped recorded time* impossible by construction, state precisely the class of exposure those two mechanisms **cannot see**, and name the third mechanism that exists because of it.
2. Why can the childcare adapter *not* own split-shift computation, and what exactly does it own instead in the meal-period flow?
3. A worker's pediatric-CPR cert expires the day *before* a scheduled childcare segment. Name every moment the system can block (generation, re-check deadline, clock-in), the table consulted, and why "valid today" is the wrong check at each of them.
4. Why must payroll-close recomputation come from clock actuals rather than the dispatch plan, and what happens when they diverge?
5. A worker drives 25 minutes between a Santa Monica cleaning segment and a Mar Vista childcare segment. Where does that time live in the schema, what earning code and comp-class treatment does it get, why would omitting it entirely *not* trip the untyped-time export refusal, and which check catches it?

Wrong answer = stop. Incomplete = timed pause. Same as Phase 1.

**Threat-model delta (same PR, per the standard §0):** one page covering the new sensitive classes this stage introduces — children's details (`job_childcare_details`, activity logs), credential evidence references (Live Scan, MVR, TrustLine), and incident records adjacent to CANRA reporting. For each: who can read it under RLS, where evidence documents physically live, and retention posture. No Task 1 until this page clears the same rejection criterion.

## §1 ADRs to land first (docs PRs, per the ADR-tax)

*Numbering note: the repo is already at ADR-0010 — twice (`0010-managed-pg-for-mvp.md` and `0010-worker-app-colocation.md`). The dedupe rename (worker-app-colocation → 0011) is a separate one-line PR that precedes these; this spec's ADRs take 0012/0013.*

**ADR-0012 — The engagement primitive is platform.** Recurring multi-segment client commitments (primary worker, ordered bench, weekly segment template, tier pricing with explicit frozen reconciliation) pass the extraction test: janitorial contracts and care plans need the identical machinery. Consequence: `/platform/engagements` may not import `/sectors/*`; sector adapters contribute only segment pricing, detail schemas, and compliance declarations.

**ADR-0013 — Per-service sector adapters; bundling never lives in a sector.** `childcare` (full) and `meal_prep` (thin) join `cleaning` as peers. The rejected alternative (fused "household" adapter) and its three failure modes are recorded in the plan §1. Consequences: every `jobs` row carries a non-null service type; CI extends the import ban unchanged; **this ADR also carries the `SectorAdapter` contract widening** (a deliberate reviewed act per ADR-0003): `getComplianceRuleset(): string[]` (today a nullary static list in `platform/sector-contract/types.ts`) becomes a typed ruleset —

```ts
interface ComplianceRuleset {
  requiredCredentials(details): CredentialTypeCode[];     // may depend on details (e.g. transport_included)
  requiredInstruments(details): InstrumentRequirement[];  // scope: worker | client_worker | job
  reliefAvailable(details): boolean | null;               // childcare maps parent_present; null = not applicable
}
```

— plus a **runtime adapter registry** (`service_type → SectorAdapter`), which does not exist today: Phase 1 booking imports cleaning modules directly and the adapter object is referenced only by its contract test. Dispatch, day-compliance, and segment generation must resolve adapters dynamically; the cleaning path is refactored onto the registry in Task 2. The cleaning adapter and contract tests update in the same PR as the interface change.

**ADR-0002 appendix amendment (separate tiny PR, required by ADR-0002 itself):** add to the approved global tables — `service_types`, `credential_types`, `instrument_types`, `jurisdictions`, `minimum_wages`. All are GLOBAL-READ reference data; everything else in this spec is tenant-scoped, no exceptions.

## §2 Schema (DDL sketch — names binding, exact types to migration review)

All tables `co_op_id`-scoped, RLS default-deny per ADR-0002 (Phase 1 pattern: `ENABLE` + `FORCE` + `tenant_isolation` with the `nullif` guard), unless marked GLOBAL-READ above. Every migration reviewed for co_op_id index coverage per the PR checklist. **Identity:** all `member_id` columns reference `members(id)`; pre-membership W-2 employees are representable as `members.status='probationary'` — credential and payroll rows exist before (and regardless of) full membership. **Time:** storage stays UTC; *worker-date* and all day/week law evaluate on the co-op's local calendar day (config, default `America/Los_Angeles`); DST days evaluate on actual elapsed hours; the workweek anchor is a `workweek_start` config value.

```sql
-- platform: service typing (GLOBAL-READ)
service_types(id, code UNIQUE, name,             -- seed: cleaning, childcare, meal_prep
  wc_class_code text NULL)                       -- WCIRB class is DATA, not code; NULL until the
                                                 -- determination lands; export blocks on NULL class
-- jobs.sector (Phase 1, text NOT NULL) is MIGRATED, not duplicated: backfill
-- service_type_id from sector, CHECK-equal during transition, then drop sector.

-- platform: sites & jurisdictions
client_sites(id, co_op_id, customer_id, address, zip,
  jurisdiction_id NOT NULL, jurisdiction_confirmed bool)
  -- NEW TABLE (Phase 1 has only customers.address free text). Backfill: one site per
  -- Phase 1 customer. ZIP-mapped default from a named, versioned ZIP→jurisdiction seed
  -- (reviewed each 7/1 wage cycle); manual confirmation REQUIRED where a ZIP spans
  -- jurisdictions (WeHo/LA City share ZIPs) — the override workflow is load-bearing.
jurisdictions(id, code, name)                    -- GLOBAL-READ; la_city, la_county, santa_monica, weho
minimum_wages(id, jurisdiction_id, hourly_cents, effective_from)   -- GLOBAL-READ, append-only

-- platform: credentials
credential_types(id, code UNIQUE, name, requires_expiry bool)      -- GLOBAL-READ; seed: trustline,
                                                                   -- cpr_pediatric, mvr_annual, live_scan
worker_credentials(id, co_op_id, member_id, credential_type_id,
  status ENUM(pending, valid, renewal_pending, expired, revoked, superseded),
  issued_at, expires_at, evidence_ref, verified_by,
  recheck_deadline NULL,                         -- renewal_pending only: hard fail-closed date
  superseded_by NULL)                            -- renewals APPEND a new row; never update in place
  -- CHECK: requires_expiry ⇒ expires_at NOT NULL for status IN (valid, renewal_pending)
  -- partial UNIQUE (member_id, credential_type_id) WHERE status NOT IN (expired, revoked, superseded)
  -- SUPERSEDES Phase 1 compliance_records for credential gating (migration in Task 1);
  -- training_records remains, training-only.

-- platform: instruments
instrument_types(id, code UNIQUE)                -- GLOBAL-READ; seed: canra_ack,
                                                 -- on_duty_meal_agreement, transport_authorization
compliance_instruments(id, co_op_id, instrument_type_id, member_id,
  client_id NULL, job_id NULL, signed_at, doc_ref, revoked_at NULL)
  -- on_duty_meal_agreement REQUIRES job_id (per-shift, never blanket): trigger-enforced
  -- (a CHECK cannot consult instrument_types)

-- platform: engagements
engagements(id, co_op_id, client_id, primary_member_id, status,
  tier_code, weekly_price_cents, starts_on, ends_on NULL)
engagement_bench(co_op_id, engagement_id, member_id, rank)
  -- ordered backup; bench-add VALIDATES the member against the engagement's segment
  -- service types' required credentials — a hollow bench is discovered at add time,
  -- not at 7am substitution time
engagement_segment_templates(id, co_op_id, engagement_id, weekday, start_time,
  duration_min, service_type_id, site_id, effective_from, superseded_at NULL)
  -- template edits are VERSIONED rows; regeneration applies from a cutover date;
  -- already-dispatched segments never mutate

-- jobs become segments
jobs: service_type_id FK NOT NULL (migrated from sector),
      engagement_id NULL, day_sequence int NULL
job_childcare_details(job_id PK, co_op_id, children_count, age_band,
  school_or_site, transport_included bool, parent_present bool)
job_mealprep_details(job_id PK, co_op_id, dietary_notes)

-- sector/childcare: safeguarding (the broker-packet §D underwriting controls are APP FEATURES)
childcare_activity_logs(id, co_op_id, job_id, member_id, entries jsonb, submitted_at)
  -- required per childcare segment (cleaning-checklist completion pattern)
childcare_incidents(id, co_op_id, job_id, member_id, occurred_at, description,
  escalated_at, resolved_at)                     -- same-day escalation SLA + notification hook

-- platform: timekeeping
time_entries(id, co_op_id, member_id,
  job_id NULL, nonservice_type ENUM(travel, training, meeting) NULL,
  clock_in, clock_out NULL,
  source ENUM(worker, correction), corrected_entry_id NULL,
  corrected_by NULL, correction_reason NULL)
  -- CHECK: exactly one of (job_id, nonservice_type) is set — travel between segments,
  -- training, and co-op meetings are compensable and TYPED, never invisible
  -- EXCLUDE USING gist (member_id WITH =, tstzrange(clock_in, clock_out) WITH &&)
  --   — overlapping entries are impossible (Phase 1's "where double-counted hours hide")
  -- corrections are APPEND rows referencing the corrected entry; never in-place edits
  -- an open interval (clock_out NULL) past day close ⇒ untyped_time_block for that day
mileage_logs(id, co_op_id, member_id, work_date, from_site_id, to_site_id,
  miles, rate_cents_per_mile)                    -- Lab. Code §2802; pays as `reimbursement`

-- platform: pay periods + day compliance
pay_periods(id, co_op_id, starts_on, ends_on, status)
  -- semi-monthly minimum (CA payday law); DISTINCT from allocation_periods —
  -- pay cadence is law, patronage cadence is governance; never conflate the keys
compliance_events(id, co_op_id, member_id, work_date,
  phase ENUM(plan, close), evaluation_run_id,
  type ENUM(split_shift_premium, daily_ot, weekly_ot, seventh_day_ot, double_time,
    meal_violation_flag, rest_violation_flag, credential_block,
    untyped_time_block, incomplete_day_block, plan_gap_detected),
  amount_cents NULL, details jsonb, created_at)
  -- APPEND-ONLY: no UPDATE/DELETE grants to app_user + a belt-and-suspenders trigger.
  -- "current" = latest evaluation_run_id per (member, work_date, phase).
  -- ONLY phase='close' rows may feed payroll; plan rows forecast, never settle (A2).
sick_leave_ledger(id, co_op_id, member_id,
  entry_type ENUM(accrual, usage, cap_adjustment), hours, work_date, created_at)
  -- append-only; 48 hr/yr LA standard co-op-wide (attorney packet A.4);
  -- accrual computed at pay-period close from time_entries

-- platform: payroll export (GREENFIELD — Phase 1 has the payroll_sync_records table
-- and its idempotency_key column but ZERO payroll code; this stage builds the export)
payroll_export_lines(id, co_op_id, member_id, pay_period_id,
  earning_code ENUM(regular, ot_daily, ot_weekly, ot_7th_day, dt,
    split_premium, meal_premium, rest_premium, sick, reimbursement),
  wc_class_code, hours, amount_cents,
  idempotency_key UNIQUE)                        -- key shape: (member, pay_period, code, class)
  -- payroll_sync_records stays as the provider-sync status machine; its period_id
  -- moves to pay_periods; lines are WHAT it sends
```

**Multi-key policy snapshots (the Phase 1 single-lever assumption breaks here):** Phase 1 has one policy lever (`surplus_split`), so `jobs.policy_version_id` — a single FK to one `policy_settings` row — sufficed. Childcare and meal-prep hourly rates add levers; a price now depends on N policy rows. Rule: a quote freezes the **full set** of `(key, policy_settings.id)` pairs it read into `breakdown_json.policy_versions`; `policy_version_id` remains the primary-lever FK for integrity. Re-price determinism quantifies over the frozen set, not one row.

## §3 Build order (each task = invariants green + its TDD suite green before the next)

**Task 0 — Provider capability check + WCIRB posture + ADRs (no code).** Confirm in writing that the payroll provider (a) ingests all **ten** earning codes above, including non-taxable `reimbursement`, (b) carries per-class hour summaries, and (c) renders a **§226-compliant sample wage statement** showing rate and hours per premium/OT line — obtain the sample stub itself, not an assurance (attorney Q2 exists because ingestion ≠ compliant rendering). If the provider fails any leg, stop: provider selection reopens before engine work. **WCIRB contingency, stated now:** class codes live in `service_types.wc_class_code` as data; if the determination (broker packet §C) forecloses splitting or assigns an unexpected code, the export collapses to a single class by config — the typing machinery stays, because the wage-order defense and the 80/20 audit need it regardless. Land ADR-0012/0013, the ADR-0002 appendix amendment, this spec's comprehension answers, and the threat-model delta.

**Task 1 — Credential registry + fail-closed gating (supersedes, does not fork).** Phase 1 already gates assignment in-transaction — `platform/dispatch/dispatch.ts:45–58` consults `compliance_records`, and that gate is **fail-open** (no row = OK). This task migrates `compliance_records` rows into `worker_credentials` (requirement_key → credential_types), **replaces** that gate fail-closed inside the same transaction (the TOCTOU-free pattern already exists; extend it, don't rebuild it), and leaves `training_records` as training-only. Validity predicate, binding:
`(status='valid' OR (status='pending' AND type='trustline') OR (status='renewal_pending' AND now() < recheck_deadline)) AND ((NOT requires_expiry AND expires_at IS NULL) OR expires_at >= service_date)` — note `requires_expiry` is consulted, so a required-expiry row with NULL `expires_at` **blocks** (the data-entry omission most likely to occur must fail closed).
The world changes after assignment; three mechanisms notice: (a) **clock-in re-check** (A1's second path, built here, not just promised); (b) a **daily revocation/denial sweep** re-validating future assignments — status flips (revoked, TrustLine denied after pending-pass, recheck_deadline passed) emit `credential_block` and trigger bench substitution + notification; (c) **renewal without churn** — a cert expiring inside the generation horizon goes `renewal_pending` with a `recheck_deadline` before the service date instead of blocking weeks early; fail-closed fires at the deadline, not at generation. **The 7am unblock path, named:** audited re-verification (new evidence_ref + verified_by) or bench substitution — never a silent override; a manual DB edit remains a defined failure.
*TDD-mandatory:* fail-closed with positive control (succeeds with credentials, fails when one row flips); service-date-vs-today expiry; TrustLine-pending passes childcare gate; revoked always blocks; **NULL-expiry-on-required-expiry blocks**; renewal_pending passes before deadline and blocks after; revocation-after-assignment sweep emits and substitutes; bench-add validation rejects an uncredentialed backup.

**Task 2 — Sites, segment typing, timekeeping, earning-coded export.** `client_sites` + Phase 1 address backfill + jurisdiction confirmation workflow. `jobs.sector → service_type_id` migration (backfill, CHECK-equal, drop). Adapter registry + widened `ComplianceRuleset` (per ADR-0013); cleaning path refactored onto the registry. `time_entries` with the exactly-one-of CHECK, the overlap-exclusion constraint, append-style corrections, and the open-interval rule. Payroll export (**greenfield**): produces `payroll_export_lines`, refuses any worker-day containing time not attributable to a typed segment or non-service category — refusal emits `untyped_time_block`, **never estimates**. Second, independent check: **worker-day completeness** — clocked span reconciled against assignment span; unexplained deltas emit `incomplete_day_block`. This is the mechanism for the exposure typing cannot see: compensable time nobody recorded (gate Q1/Q5). **Refusal has a repair path or it becomes a wage-timing violation:** every block raises an alert with a resolution SLA tied to the pay-period close date (payday obligations don't pause for our hygiene); an unresolved block at close pages a human per the standard §7.
*TDD-mandatory:* export refusal on untyped time (positive control first); completeness-check on a day with a missing travel entry; hour-summary correctness across a 3-segment day incl. travel; overlap exclusion; correction-is-append; idempotent export on the `(member, pay_period, code, class)` key.

**Task 3 — Day-compliance engine, plan-time.** Inputs: a worker-date's planned segments + jurisdiction floors (worker-date = local calendar day; `workweek_start` anchors the week). Outputs:
- **Gap detection:** an employer-set unpaid gap counts only **beyond one bona fide scheduled meal period per work period** (attorney packet §C — a 75-min break containing the mandated 30-min meal is a 45-min gap, no premium). Countable gap >60 min ⇒ forecast `split_shift_premium` at the day's **highest applicable** floor with the DLSE over-minimum offset, generalized for mixed-rate/mixed-jurisdiction days: `premium = max(0, MW_high × (H + 1) − W)` where `MW_high` = the day's highest applicable floor, `H` = paid hours across all segments, `W` = total wages payable for the day. Single-rate, single-jurisdiction days reduce to the worked example.
- **Meal placement:** >5 cumulative hours worked ⇒ 30-min meal **starting before the end of the 5th cumulative hour worked** (not wall clock — split days are this business's default shape); >10 cumulative hours ⇒ second meal before the end of the 10th. Off-duty iff the adapter reports `relief_available`; else require the job-scoped `on_duty_meal_agreement` instrument — missing or revoked ⇒ block. (≤6-hr waiver machinery: deliberately deferred; short days schedule the meal anyway.)
- **Rest breaks:** 10-min paid per 4 hours or major fraction — placement nudges at plan time; a missed rest at close is `rest_violation_flag` + one hour `rest_premium` (§226.7), same for meal violations (`meal_premium`).
- **OT forecasts:** daily >8 / DT >12, **weekly >40, and 7th-consecutive-workday rates** — with the no-pyramiding rule (hours already premium-paid daily don't double-count toward weekly).
*Worked example, binding for the property test (fast-check enters the dev-deps here; the examples stay binding as example tests regardless):* 8.0 paid hrs at $30.00 across LA City ($18.42 floor), one 120-min unpaid break containing the mandated 30-min meal ⇒ countable gap 90 min ⇒ premium = max(0, 18.42×9 − 240.00) = **$0** (offset consumes it); the same day at $18.42 flat ⇒ max(0, 165.78 − 147.36) = **$18.42**. Both asserted.
*TDD-mandatory:* both offset branches (meal shown); countable-gap boundary at exactly 60 (no premium) and 61 (premium); the 75-min-break-with-meal case (no premium); meal placement at cumulative 5:00 vs 5:01; second meal at 10:00 vs 10:01; jurisdiction-mix day takes the max floor; weekly-OT no-pyramiding; 7th-day rates; blocked-without-agreement fail-closed with positive control; instrument revoked after plan re-blocks; a DST-transition day.

**Task 4 — Childcare + meal-prep adapters, safeguarding, surfaces.** `job_childcare_details` / `job_mealprep_details`; `priceJob` with member-voted rate levers (versioned; **multi-key snapshot semantics per §2**, frozen-quote rule identical to cleaning); `getComplianceRuleset` declares {trustline, cpr_pediatric, canra_ack} (+ {mvr_annual, transport_authorization} when `transport_included`); adapter maps `parent_present → relief_available`. **Safeguarding — the underwriting controls the broker packet §D warrants are app features and land here:** per-segment `childcare_activity_logs` required for completion (cleaning-checklist pattern), parent check-ins, `childcare_incidents` with same-day escalation SLA + notification hook. **Surfaces:** spot-childcare booking + quote on the existing booking rails; worker multi-segment day view (segments, meal placement, forecast premiums visible) in the `(worker)` route group per ADR-0010(→0011). Attendant-mode config exists but **refuses to enable** without `counsel_reference` (Q4/Q1 letters at `docs/counsel/`).
*TDD-mandatory:* breakdown-must-sum for both adapters; frozen-quote across a multi-key policy set (one lever votes mid-quote, price unchanged); ruleset declarations drive Task-1 gates end-to-end; attendant flag hard-refusal; segment cannot complete without a submitted activity log.

**Task 5 — Engagements + invoice rails.** Phase 1 has **no invoicing** (per-job `payments` only) — this task builds it: `invoices(id, co_op_id, engagement_id, period, status[draft|issued|paid], total_cents)` + `invoice_lines(invoice_id, kind[segment|plan_adjustment], job_id NULL, amount_cents)`. Template → weekly segment generation, idempotent by `UNIQUE(engagement_id, service_date, start_time)`; template edits versioned with cutover-date regeneration (dispatched segments never mutate). Primary-worker preference with credential-validated bench fallback + client notification. **The reconciliation invariant, made falsifiable:** `plan_adjustment` is **frozen at generation time** as `weekly_price_cents − Σ(template segment prices under that week's snapshot)` and stored as its own line — never derived as a residual (a residual makes the invariant an identity that can't fail). Invariant: Σ segment lines + the frozen adjustment line = `weekly_price_cents`, and Σ all lines = invoice total. Draft invoices generate **in arrears** after the week's settlement (they sum `final_price_cents`; a week with unsettled segments can draft but not issue). **Engagement policy semantics:** each generated week freezes its own snapshot; a policy vote applies from the next generation cycle — Phase 1's "future quotes only," per week (no indefinite freeze on `ends_on NULL`, no drift against the tier price).
*TDD-mandatory:* generation idempotency incl. regeneration-after-template-edit; sum invariant **fails** when a segment price is mutated (falsifiability is the test); frozen adjustment survives a mid-week policy vote; tier rounding; bench substitution ordering incl. the blocked-substitute cascade; RLS isolation on all new tables (positive-control pattern from Phase 1).

**Task 6 — Payroll close from actuals.** Recompute Task-3 outputs from `time_entries` as `phase='close'` events under a fresh `evaluation_run_id`; divergence from plan ⇒ events, never silent edits; **only close-phase events price payroll**. `job_assignments.hours_logged` becomes **derived from actuals at close** — one hour ledger; pay and patronage can no longer disagree about the same labor on the transparency surface. Sick accrual posts to the ledger at pay-period close (1:30 or front-load per policy; cap + carryover per the 48-hr standard); meal/rest/split premiums pay as their earning codes; mileage pays as `reimbursement`. Export lines key to `pay_periods` (not `allocation_periods`). **The 80/20 personal-attendant dashboard lands here** (promised in the plan §2/§4 and to counsel): per-worker per-service hour shares from actuals over the sector-declared task-category mapping — the dashboard ships; the exemption treatment stays paper-switched (A4). Period-close report joins the transparency surface (premiums and OT visible to members — inform, don't steer).
*TDD-mandatory:* plan-vs-actual divergence emits and reconciles; only close-phase events feed export; append-only enforcement on `compliance_events` (grants + trigger); `hours_logged == Σ time_entries` at close; sick accrual math + carryover cap; export round-trip re-verified.

**Task 7 — Launch-gate checklist (childcare go-live).** **Go-live minimum build set: Tasks 1, 2, 3, 4, 6, 7 — Task 5 is the only deferrable unit.** (Without Task 6 there is no lawful way to settle the premiums Task 3 forecasts; A2 forbids plans from settling; hand-computed payroll is the manual intervention this project defines as failure.) Mechanical checks: **L1** counsel files present + config references resolve; **L2** insurance binder ref recorded + the WCIRB determination (or carrier's written interim treatment) on file + the §D safeguarding features demonstrably live (they are warranted underwriting controls — coverage was priced on them); **L3** ≥1 worker fully gated-in end-to-end on staging with a real credential set; **L4 (Form-A path only)** a spot-childcare demand artifact: ≥N childcare COMMITs at floor pricing from existing clients, N pre-registered by member vote before outreach begins — Form A commits are *cleaning* commits and G2's retainer evidence can be satisfied with zero paid childcare signal; cleaning demand is not childcare demand. Go-live is a checklist PR, not a feeling.

**Conditional ordering (pre-committed, keyed to the market test's flagship output — build-order only, never a go-live inference):** Form B flagship ⇒ Task 5 completes before childcare go-live (the retainer is the product). Form A flagship ⇒ Task 5 may finish after go-live; go-live still requires the minimum set plus L1–L4. Build content identical either way.

## Addendum A — Engineering-standard extensions (new load-bearing rules; the standard itself is unchanged)

- **A1 Compliance-block-on-assignment:** any assignment or clock-in path that cannot prove its gates inside the transaction fails closed. TDD-mandatory category, permanently. (Both paths are built in Task 1, not merely named.)
- **A2 Actuals win:** payroll derives from `time_entries`; plans forecast, never settle. Divergence is an event, not an update. Mechanically: only `phase='close'` compliance events may price payroll.
- **A3 No untyped time:** typing is NOT NULL at the schema level (segment or non-service category) and payroll refuses at the export level. Two independent mechanisms, deliberately redundant — against *mistyped recorded* time.
- **A4 Paper-switched features:** any legally contingent behavior (attendant mode, relief-presumption inversion) toggles only via config that references a committed counsel document. No letter, no flag.
- **A5 Litmus extension:** "TDD anything that computes money, filters by tenant, writes to versioned/financial tables, **or gates a human's assignment to a job**."
- **A6 No unrecorded compensable time:** the schema cannot see an hour nobody recorded. Every worker-day reconciles clocked span against assignment span; unexplained deltas block export with a deadline-bearing alert. This completeness check — not the typing — is what stands between the co-op and invisible-hours exposure.

## Addendum B — Onboarding runbook extension (one new section)

*"The household sectors in one hour":* read ADR-0012/0013 and plan §§1–3 · run the day-compliance suite and read the split-shift worked example until the offset math *and the meal-exclusion rule* are obvious · trace one engagement end-to-end on staging (template → segments → gated dispatch → clock incl. a travel entry → payroll close → invoice with the frozen adjustment line) · find the three places `parent_present` is touched and say aloud which side of the platform seam each sits on · say aloud why `hours_logged` is derived, not entered. The five-things-that-get-you-in-trouble list gains a sixth and seventh: **estimating hours by percentage anywhere in payroll code**, and **writing an hour of labor into any ledger other than `time_entries`.**

## Addendum C — Commitments traceability (every promise on paper → the task that builds it)

| Commitment | Source | Owner |
|---|---|---|
| Daily OT >8 / DT >12 | attorney A.4 | Task 3/6 |
| Weekly OT >40, 7th-day rates | attorney A.4, WO 15 | Task 3/6 |
| Split-shift premium, meal-aware gap | attorney A.4, §C | Task 3 |
| Meal/rest periods + §226.7 premiums | attorney A.4, Q4 | Task 3/6 |
| 48-hr sick leave (LAMC §187.04 standard) | attorney A.4, broker §D | Task 6 |
| Per-service contemporaneous hour codes | attorney A.4, broker §C | Task 2 |
| §2802 mileage reimbursement | attorney A.4, broker §A | Task 2/6 |
| §226-compliant premium wage statements | attorney Q2 | Task 0 (provider check) |
| TrustLine / CPR / MVR / Live Scan gating | attorney A.5, broker §D | Task 1 |
| CANRA acknowledgment before first shift | attorney Q3, broker §D | Task 1 (instrument) |
| Daily in-app activity logs, parent check-ins, incident escalation | broker §D | Task 4 |
| Transport authorization + MVR when transporting | broker §D | Task 1/4 |
| 80/20 per-worker attendant audit surface | attorney §C, plan §4 | Task 6 |
| Attendant exemption paper-switched | plan §4 | Task 4 (A4) |
| WCIRB no-split contingency | broker §C | Task 0/2 |

## Deltas from the parent plan (`phase-2-household-sectors.md` stays authoritative for G1/G2)

1. The Form-A conditional is narrowed to **build order only**; go-live always requires the Task 7 minimum set (incl. Task 6) and gains **L4**, a childcare-specific demand artifact.
2. The 80/20 dashboard the plan promises ("the dashboard ships") is assigned a task (Task 6).
3. The plan's "existing payment rails" for weekly draft invoices are, in the code, per-job payments only; invoice rails are built in Task 5.
