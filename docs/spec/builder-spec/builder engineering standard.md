# Builder Engineering Standard — Cleaning Co-op Platform

> Companion to `cleaning_app_implementation_spec.md`. That document says **what to build**; this one says **how to build it to the standard, and how to prove it.** Two altitudes, both binding. The point of everything below is to force *executable proof where the cost of being wrong is highest*, and to make shortcuts expensive and thoughtfulness cheap.

---

## 0. Before any code — the comprehension gate

The builder must deliver a **one-page threat model** *before* implementation begins, covering at minimum:
- **RLS failure** — how a tenant could see another tenant's rows, and what prevents it (the auth→RLS chain, fail-closed default).
- **Webhook duplication** — what happens when Stripe retries, and why credit applies exactly once.
- **Broken restore** — how you'd know a backup is bad *before* you need it, and the drill that proves it.
- **Bad policy/version semantics** — how a quote could change underneath a customer or worker, and what freezes it.

This is the cheapest, highest-signal test available: it reveals in an afternoon whether the builder *understands the system* or is *nodding along*.

**Rejection criterion (so the gate stays real, not ceremonial):**
- A **wrong** answer is a **stop** — the builder does not understand the system; do not proceed.
- An **incomplete** answer is a **short pause with a deadline** to close the specific gap, then re-review.
- A page that merely restates the spec back without demonstrating understanding of *how* each failure occurs and *what* prevents it counts as incomplete.

Do not hand over the keys until this page exists and clears the criterion.

---

## 1. Selective TDD (proof where wrong is catastrophic; lighter elsewhere)

Following Fowler's shape — many small tests, few broad ones. **TDD is mandatory** (test written first, defining the invariant) for:
- **Pricing math & policy-version determinism** — breakdown components sum to the quoted price; re-pricing from stored details + snapshotted `policy_version_id` reproduces the identical breakdown.
- **Auth → RLS isolation, especially the fail-closed case** — seeded second co-op sees zero rows; no-tenant-context returns zero rows.
- **Export / re-import round-trip** — co-op data round-trips into a fresh system with integrity verified.
- **Decision-mode write constraints** — a decision-mode communication without a linked proposal + attached computable economics is rejected at write time.
- **Sector-adapter contract tests** — the adapter honors the `SectorAdapter` interface and `PriceBreakdown` shape.

For **CRUD screens, booking flows, and UI rendering**, TDD is optional — but **tests ship with the feature and pass in CI**. The rule is not religion; it is executable proof on the load-bearing invariants.

**The one-line litmus (use this at 2am):** *do not TDD CSS layout, copy tweaks, or log-message wording; do TDD anything that computes money, filters by tenant, or writes to a versioned or financial table.*

---

## 2. The CI pipeline (named, automated, visible — not implied)

Two cadences, so the sacred discipline (restore) doesn't punish the people it depends on (Fowler's shape: many fast low-level checks, few slow broad ones).

**Fast gate — every PR, all must pass to merge:**
1. **Strict type-check** (no `any` escape hatches on platform/security/pricing/governance paths).
2. **Lint + import-ban** (ADR-0003: `/platform → /sectors/*` fails the build).
3. **Unit + integration tests** (incl. the §1 mandatory-TDD suites).
4. **Fast verification queries** (RLS isolation against a seeded second co-op; pricing breakdown sums).

**Heavy gate — nightly and pre-release:**
5. **Full restore-drill verification** — backup restored to a scratch instance, full verification suite run, **a failed or skipped drill pages a human (per §7 posture).**
6. Full export/re-import round-trip; any slow broad-stack tests.

Restore stays sacred; running it nightly + pre-release (not on every push) keeps the cadence realistic so developers don't learn to resent or bypass it. A mediocre builder still must not satisfy "CI" with a thin lint pass — the fast gate already includes the load-bearing tests.

---

## 3. Definition of Done (engineering quality, distinct from acceptance criteria)

Acceptance criteria say the *product slice exists*; DoD says the *engineering quality is acceptable*. For any feature touching **platform logic, security, pricing, or governance**, "done" means **all** of:
- Tests exist (TDD where §1 mandates it) and **CI is green**.
- Invariants hold (breakdown sums; RLS isolates; policy version frozen; webhook idempotent).
- Any new schema writes **history correctly** (versioned/append where the spec requires it; no in-place overwrite of policy or financial records).
- Any **ops-impacting change updates the runbook** (deployment, backup, recovery, auth, or payments).
- The **PR checklist** (§5) is completed.

---

## 4. Development workflow

- **Short-lived branches / trunk-based development.** Frequent integration + fast CI feedback is what keeps a codebase like this honest. No long-lived divergent branches.
- **Every PR touching `/platform`** includes three things together: the **code change**, the **test** that defines or protects the invariant, and a **runbook update** if the change affects deployment, backup, recovery, auth, or payments.
- **ADR tax:** any meaningful deviation from the spec — auth choice, schema change, altering the trust chain, relaxing a boundary, changing pricing/policy semantics — requires a **short ADR *before* implementation**. Shortcuts become expensive; thoughtfulness becomes cheap. (Append to `docs/adr/`.)
- **ADR ↔ trunk-based reconciliation (so the two rules don't fight):** the ADR lands **first** as a tiny docs/draft PR; the implementation follows in a **separate PR referencing that ADR**. Design artifact precedes code artifact, branches stay short — fully compatible with trunk-based development's small, frequent integration.

---

## 5. PR checklist (the spec as a repeatable review instrument)

Paste into every PR; reviewer confirms each:
- [ ] **RLS:** new tables tenant-scoped under `co_op_id` (default-deny), or an explicit ADR-0002 global exception.
- [ ] **Money:** all amounts stored as **integer minor units (cents)** — no floats.
- [ ] **Time:** all timestamps **UTC**.
- [ ] **Pricing:** breakdown components sum to quoted price; the **breakdown test still passes**.
- [ ] **Policy:** any price/quote snapshots its `policy_version_id`; no silent change underneath people.
- [ ] **Idempotency:** webhook/payroll paths are retry-safe (no double-credit, no double-pay).
- [ ] **History:** policy/financial writes are append/versioned, not in-place overwrites.
- [ ] **Boundary:** no `/platform → /sectors/*` import; nothing cleaning-specific hiding in `/platform`.
- [ ] **Migration review:** schema changes on tenant-scoped tables checked for **`co_op_id` index coverage** and **RLS policy correctness**.
- [ ] **Query-plan sanity:** new queries on tenant-scoped data have an **`EXPLAIN` review** — RLS filters must not silently become sequential scans at volume.
- [ ] **Tests:** mandatory-TDD invariants covered (§1); feature tests ship and pass.
- [ ] **Runbook:** updated if deployment/backup/recovery/auth/payments affected.
- [ ] **ADR:** filed if this PR deviates from the spec (§4).

---

## 7. Operational baseline (so the system can be *run*, not just *built*)

- **Staging environment — named, not implied.** A second Docker Compose stack or cheap secondary VPS that mirrors production. It is where **Stripe test-mode webhooks**, **restore rehearsal**, and **realistic RLS/data testing** live between local dev and production. No change reaches production without passing here.
- **Alerting / response posture — a name and a timeline, not "a human."**
  - **Page now (respond immediately):** payment path failing, tenant-context/RLS error, production down, **restore drill failed**.
  - **Next business day:** non-critical sync retries, dependency advisories, capacity-threshold warnings.
  - Define **who** is paged and **how** (the on-call person + channel) before launch. "Pages a human" without a name is a page into the void.
- **Dependency discipline (a monument on drifting deps is still drift).** Weekly automated vulnerability scan; monthly patch/minor updates; quarterly major-version review; **production image digests pinned** (not floating tags).
- **Capacity planning (minimal but real).** Define expected MVP load (concurrent bookings, payment throughput); define thresholds that trigger review; **run one simple load test against booking + payment before launch.** "For people, not profit" dies the first time the booking flow falls over under load it was never tested against.

---

## 6. One line

The implementation spec makes the cooperative values true in the data; this standard makes them **stay** true under a year of commits — by forcing proof on the invariants that cost money, leak tenants, or corrupt the democratic record, and by turning the spec into a gate, a checklist, and a comprehension test rather than a document someone read once.
