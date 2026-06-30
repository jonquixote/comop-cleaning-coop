# Cleaning Co-op Platform — Implementation Spec (for the builder)

> **Scope discipline (read first).** This is a spec to build **one cleaning co-op's MVP on durable, cheap-to-run foundations** — not a federation platform. The "monument" is in the *rigor of the foundation* (tested backups, clean seams, honest ledgers, no vendor lock-in) and the *discipline of the scope* (one co-op, prove it runs, then stop). It is **not** in the size of the build. Build small, unbreakable, and visible. Do not build federation infrastructure until a real second node exists. Governing rules live in `docs/adr/0001–0003`.

---

## 0. Mission tenets the code must serve

These are not flavor; they generate requirements.

1. **For people, not profit.** The co-op delivers comparable-or-lower price to customers *and* a better standard of living to worker-owners, funded by removing the owner's profit margin. The balance point between *worker pay* and *customer price* is a **tightrope set regularly by member vote**, not a fixed constant. → *Requirement: surplus-allocation is a versioned, vote-set policy value (§5, §6), not a config literal.*
2. **Informed democracy or none.** The collective decides well only when informed. Worker-owners must see real unit economics — revenue, costs, margin, where each dollar goes. → *Requirement: a financial-transparency surface (§6) that is also the anti-waste mechanism (sunlight replaces the boss).*
3. **Decision-mode communication ("the valve").** Routine weeks get routine comms; high-stakes votes get ramped information and turnout effort. Its fuel is **transparency, not persuasion** — inform and mobilize, never steer. → *Requirement: communications carry a routine|decision mode; decision-mode ties to a proposal and surfaces the real tradeoff (§6).*
4. **No wastefulness.** Cheap to run without being cheap. Durable foundations, minimal recurring cost, no managed lock-in (§2, §3).

---

## 1. Architecture (carried from the design spec — unchanged)

- **Modular monolith, one deployable system.** Internal seams pre-scored on the future platform/local (federation) line. Becomes a platform by *addition, not rewrite*.
- **Dependency law (ADR-0003, CI-enforced):** `/sectors/* → /platform` allowed; `/platform → /sectors/*` is a release-blocking violation. Platform knows nothing about cleaning.
- **Platform test (ADR-0001):** a module belongs in `/platform` only if a plausible second sector could reuse it unchanged. Dispatch boundary: **engine owns** time windows, availability, route optimization, assignment constraints; **sectors own** duration estimation, required skills, price formation.
- **Default-deny tenancy (ADR-0002):** every table tenant-scoped under RLS by `co_op_id` by default; global tables are an explicit, reviewed exception list.
- **Repo layout:**
  ```
  /platform   identity · membership-ledger · allocation-workflow · payments-orchestration ·
              dispatch-engine · compliance-engine · governance · transparency ·
              notifications · export        (sector-agnostic)
  /sectors/cleaning   booking · pricing · catalog+checklists · trust-surface · adapter
  /apps/customer-web   customer surface
  /apps/worker         worker-owner surface (incl. governance + transparency tabs)
  /ops                 docker-compose, backup/restore scripts, runbook, migrations
  /docs/adr            0001 platform-test · 0002 rls-default-deny · 0003 ci-sector-import-ban
  ```

---

## 2. Stack — self-hosted, cost-disciplined, no managed lock-in

Chosen for low recurring cost, longevity, reproducibility, and operability by non-specialists.

| Layer | Choice | Why |
|---|---|---|
| **Database** | **PostgreSQL, self-hosted** (the architectural keystone — RLS is a *Postgres* feature, not a vendor's) | No lock-in; RLS gives tenancy + exit-as-export; the one component that must be rock-solid |
| **Compute** | A single well-specced VPS to start (e.g., **Hetzner** dedicated/cloud or equivalent) — *not* hyperscaler markup | "Cheap without being cheap": serious price/performance, scale up before scaling out |
| **Containerization** | Docker / docker-compose — local dev and restore-drill scratch only. Production Postgres runs native (apt + systemd). See ADR-0006. | Reproducible, documented, portable — a monument must be rebuildable from source on a fresh box |
| **App framework** | **Next.js (App Router)**, TypeScript | Builder knows it; one framework for both surfaces; SSR + API in one |
| **Auth** | **A currently-maintained self-hosted session-auth approach** (magic-link + password; sessions stored in *your* Postgres). *Specified by property, not brand — do not hard-anchor a monument on one library* | No auth SaaS dependency or per-MAU billing; the tenant identity it yields drives RLS (§3a) |
| **Migrations** | Version-controlled schema migrations (e.g., **Drizzle** or raw-SQL migration runner) committed to `/ops` | Schema is code; reproducible; reviewable. Never edit prod schema by hand |
| **App-boundary contract** | **Typed contracts at the client↔server seam** (tRPC schemas for the TS-internal stack; **OpenAPI** if any external/3rd-party consumer exists) | The internal adapter seam is typed; the external app seam must be too — don't make the builder invent the HTTP contract |
| **Observability** | **Structured logs with trace IDs** on the load-bearing paths: payment, payroll sync, allocation, and tenant-context-setting each emit events carrying `co_op_id`, severity, and trace ID. Plus health checks + uptime | "Health checks only" can't debug production; the money and tenant-identity paths must be traceable |
| **Payments** | **Stripe** (integration, money rails) | Don't build card processing; PCI burden stays with Stripe |
| **Payroll** | Integrate a payroll provider for W-2 filing; **do not build payroll** | Tax filing is a regulated specialty; orchestrate, don't reinvent |
| **Object storage** (backups, attachments) | S3-compatible, cheap (**Backblaze B2 / Hetzner Storage Box**) | Off-box, off-site, cheap durability |

> The architecture has **zero dependency on Supabase or any managed platform.** Everything above is open-source or a thin, replaceable integration (Stripe/payroll).

---

## 3. Durability discipline — the actual foundation (non-negotiable)

For a thing meant to last, run by worker-owners who are not DBAs, the backup/restore machinery must be **automated, off-site, encrypted, and — above all — tested.** An untested backup is a hope, not a backup.

**Required:**
1. **Point-in-time recovery (PITR).** Continuous WAL archiving + scheduled base backups via **pgBackRest** (or barman). Target RPO ≤ 5 min, RTO ≤ 1 hour.
2. **Off-site, encrypted backup storage.** Push to B2/Storage Box; encrypt at rest; retain on a defined schedule (e.g., daily 30d, weekly 12w, monthly 12m).
3. **Automated restore drills.** A scheduled job restores the latest backup to a scratch instance and runs a verification query suite; **a failed or skipped drill pages a human.** This is the single most important line in this spec.
4. **A written runbook** (`/ops/runbook.md`): how to restore, how to fail over, how to rotate the cert, who to call. Operable by a non-specialist following steps.
5. **Replication (when it earns its keep).** A streaming replica for failover once downtime cost justifies it — not required at MVP, but the schema/ops should not preclude it.
6. **Reproducible rebuild.** `docker-compose up` + latest migration + latest restore = a working system on a bare box. Test this end-to-end at least once before launch.

> **Staging caveat (do not over-read):** the **non-negotiable floor is off-site backups + verified restore drills.** If *full PITR machinery* (continuous WAL/PITR) becomes the thing delaying launch, stage it carefully — ship with solid scheduled off-site base backups + a passing restore drill, and add PITR shortly after. Never compromise the off-site-plus-verified-restore floor; that is the line.
>
> Cost note (honest): at N=1 the dollar savings vs managed are ~zero and the ops burden is real overhead — the savings are a *scale* property. The reason to self-host from day one is **no future migration and foundational discipline from the start**, which fits "monument" better than starting managed and ripping it out. The price of self-hosting is paid in this section's rigor; pay it fully or the savings are borrowed against catastrophic loss.

---

## 3a. The auth → RLS trusted-tenant chain (the security model's load-bearing link)

RLS only protects you if the database evaluates the **correct** tenant identity. The tenant context must come from the trusted server session, **never from client input** — a client-supplied `co_op_id` is the entire vulnerability. The chain, made explicit:

1. **Resolve tenant server-side.** On each authenticated request, the server reads the user's `co_op_id` from the **trusted session record** (in Postgres), not from any header, body, or query param the client controls.
2. **Set trusted context inside the transaction.** All DB work for the request runs inside a transaction that first executes `SET LOCAL app.current_co_op = <resolved id>` (transaction-scoped, so it cannot leak across requests or connection-pool reuse).
3. **Policies read the server-set value.** Every RLS policy filters on `co_op_id = current_setting('app.current_co_op')::uuid` (or equivalent). The application's normal DB role is **non-superuser** and **cannot bypass RLS** (`BYPASSRLS` is never granted to the app role).
4. **Default-deny on missing context.** If `app.current_co_op` is unset, policies evaluate to **zero rows** — a query with no tenant context returns nothing, never everything. (A careless code path fails closed.)
5. **Admin cross-tenant reads** (if ever needed) go through a separate, audited role/path — never the app role, never by relaxing a policy.

> This is the difference between "we use RLS" and a tenancy model that actually holds. The isolation guarantee — and the exit right that depends on it — is only as good as this chain.

### 3a.1 Auth lifecycle (specify it, or the builder invents ad-hoc membership logic)

Define these explicitly; do not leave them implicit:
- **Account creation & invitation:** customers self-register; worker-owners are **invited** (membership is governance, not signup) — an invite token issued by an existing admin/member, redeemable once, expiring.
- **Member activation:** invited worker → `probationary` on first login → `member` only by the co-op's defined admission step (and, where applicable, a passed proposal). Status transitions are recorded.
- **Role assignment:** roles (`customer|worker|admin`) assigned server-side; never client-settable; changes are audited.
- **Session revocation:** sessions are server-side records in Postgres and **revocable** (logout, admin revoke, role change) — revocation takes effect immediately because RLS reads the live session's tenant/role, not a stale token.

---

## 4. Data model — spine

**Conventions:** every table carries `co_op_id` and an RLS policy by default (ADR-0002). Global exceptions: `sector_registry`, `system_config`, `service_category_taxonomy`. All money in integer minor units (cents). All timestamps UTC.

**Platform (tenant-scoped, RLS):**
- `co_ops` (id, name, …) — tenant table; one row now
- `users` (id, co_op_id, role[customer|worker|admin], …); `sessions` (auth)
- `members` (id, user_id, co_op_id, status[probationary|member], joined_at) — **membership roster**; the verified worker-member count read here is what a future federation uses for √ apportionment
- `membership_fees` (id, co_op_id, member_id, amount_cents, paid_at) — the fee paid to **join** (a fee, not equity)
- `patronage_capital_accounts` (id, co_op_id, member_id, balance_cents) — **equity** accrued from labor, payable out per bylaws
  - ⚠️ **Legal-distinction note (confirm with CPA/counsel):** membership fee ≠ patronage capital. A fee is what you pay to join; patronage capital is member *equity*. These are split here deliberately so the schema does not silently encode the wrong legal interpretation. Confirm treatment before relying on either for filings or member statements.
- `customers` (id, co_op_id, contact, address)
- `jobs` (id, co_op_id, customer_id, sector, scheduled_at, status, **quoted_price_cents** [frozen at quote time], **final_price_cents** [null until any post-job settlement], policy_version_id) — **generic**. *Two names because they are two facts: what was promised at quote, and what settled after. Never collapse them.*
- `job_assignments` (id, job_id, member_id, hours_logged) — labor basis feed. **Cardinality rule (pick and enforce): one row per (worker, job) for a single-shift job; multiple rows allowed only as explicit distinct shifts with their own time bounds.** Ambiguity here is where double-counted hours and double-paid wages hide.
- `payments` (id, co_op_id, job_id, amount_cents, status, stripe_ref)
- `expenses` (id, co_op_id, category, amount_cents, incurred_at, note) — **where the money goes; powers transparency + anti-waste**
- `allocation_periods` (id, co_op_id, period, status); `allocations` (id, co_op_id, period_id, member_id, labor_basis, amount_cents) — **member-capital ledger + allocation workflow.** *Tax-conformant patronage treatment is validated by bylaws + CPA, not asserted by the schema* (per associate review)
- `policy_settings` (id, co_op_id, key, value_json, effective_from, set_by_proposal_id) — **versioned, vote-set levers**, incl. `surplus_split` (the pay↔price tightrope position). History preserved; never overwritten in place
- `payroll_sync_records` (id, co_op_id, member_id, period_id, amount_sent_cents, sent_at, provider, external_ref, status[pending|sent|confirmed|failed], idempotency_key) — **audit seam for the "don't build payroll" boundary** + **retry-safe status machine:** records what was sent, when, the reference that came back, and a key so a retried sync never double-pays
- `webhook_events` (id, provider, external_event_id UNIQUE, received_at, processed_at, status) — **idempotency ledger:** Stripe *will* retry; a webhook whose `external_event_id` is already present is acknowledged and **not reprocessed**. Payment credit is applied exactly once.
- `compliance_records` (id, co_op_id, member_id, requirement_key, status, valid_until); `training_records` (id, co_op_id, member_id, requirement_key, completed_at)
- `proposals` (id, co_op_id, title, body, type, status, opens_at, closes_at, stakes_level[routine|high]); `votes` (id, co_op_id, proposal_id, member_id, choice, cast_at) — **governance**
- `communications` (id, co_op_id, mode[routine|decision], proposal_id?, body, audience, sent_at) — **the valve**

**Sector / cleaning:**
- `cleaning_service_types` (name, base_price_rule); `cleaning_checklists` (service_type, room, tasks[]) — *the code of standards, operationalized*
- `job_cleaning_details` (job_id, sqft, bedrooms, bathrooms, addons[]) — extends `jobs`
- `customer_cleaning_preferences` (customer_id, prefs)

**Seam pattern to internalize:** generic platform row (`jobs`) + sector extension table (`job_cleaning_details`). Adding a sector adds an extension table; `jobs` never changes.

---

## 5. Sector adapter interface (the whole platform↔cleaning contract)

Cleaning implements; platform calls. Adding a sector = implementing this. Platform never changes.
```ts
interface SectorAdapter {
  estimateJobDuration(details): Minutes;             // sector owns
  getRequiredSkills(details): Skill[];               // sector owns
  priceJob(details, policySnapshot): PriceBreakdown; // sector owns; returns components, not a number
  getComplianceRuleset(): Requirement[];             // sector owns (cleaning: IIPP + janitorial reg.)
  getJobDetailSchema(): Schema;                      // sector owns (what job_cleaning_details holds)
}

// priceJob returns a COMPUTABLE BREAKDOWN, never just a final number — so transparency
// and vote-time tradeoff modeling fall out of the data instead of being reverse-engineered:
interface PriceBreakdown {
  labor_cents: number;
  materials_cents: number;
  overhead_alloc_cents: number;
  surplus_cents: number;        // the worker-benefit margin, derived from the split
  final_price_cents: number;    // == sum of the above (asserted by test, §8a)
  policy_version_id: string;    // the policy_settings row this price was computed under
}
```

**Pricing & policy-version semantics (bright-line, so prices never change underneath people):**
- `priceJob` returns a **breakdown** (labor / materials / overhead / surplus / final), not a scalar. The components **must sum** to the final price (enforced by test, §8a). This is what lets the transparency and break-even surfaces (§6) read real economics instead of reconstructing them.
- A quote **snapshots the applicable `policy_settings` version onto itself** at creation time T. The job carries that `policy_version_id` for its entire life.
- **The rule:** the price a customer was quoted and the split a worker was promised are **frozen on the record**. A later policy vote changes **future** quotes only — never one already given. Determinism: re-pricing a job from its stored details + its snapshotted `policy_version_id` reproduces the identical breakdown.

---

## 6. The two surfaces mission tenets require

**Governance & voting (worker app):**
- List/See proposals; cast votes within the single co-op (one-worker-one-vote at this level).
- The **pay↔price lever** (`surplus_split`) is changed *only* by a passed proposal; passing a proposal writes a new `policy_settings` row with `set_by_proposal_id`. The lever's full history is auditable.
- `stakes_level=high` proposals trigger decision-mode communications (the valve).

**Financial transparency (worker app) — the anti-waste mechanism:**
- Every worker-owner can see: period revenue (`payments`), costs (`expenses`), surplus, the current pay↔price position, and their own allocation/capital account.
- Render the tradeoff plainly at vote time: "moving the split X→Y changes worker take-home by ⟨…⟩ and customer price by ⟨…⟩." Honest numbers, all sides — **inform, don't steer.**
- This surface is *why* a boss isn't needed to police waste: the members can see it.

**Period-health / break-even (worker app) — the forward-looking half of transparency:**
- "Where the money went" is backward-looking; the co-op must also see whether it is **structurally healthy**: revenue vs. fixed + variable costs, the break-even line, and surplus/deficit for the period.
- This is what keeps the pay↔price vote **responsible** — you cannot honestly set the split without seeing whether the co-op can afford it. "For people, not profit" still has to survive contact with rent and insurance; a co-op that can't see it's underwater will vote itself generous and die.

**The valve (communications) — "inform, don't steer" made structural:**
- Routine mode: standard schedule/job notices.
- Decision mode is **unsendable unless** it (a) links a `proposals` row **and** (b) carries that proposal's underlying economics in **computable form** (the affected `PriceBreakdown` deltas / period-health impact attached to the record, not prose). Enforced as a write-time constraint, not a guideline.
- Consequence: **you cannot open the valve on a vote without attaching the math.** Mobilization without the numbers is structurally impossible, which is the enforceable version of "inform, don't steer."

---

## 7. Build order — MVP, in sequence

1. **Foundation:** Postgres + Docker + migrations + auth; `co_ops` + `users` + `members` with `co_op_id` + RLS (default-deny) from commit one. **Stand up backups + a passing restore drill before feature work** (§3).
2. **Booking → job:** cleaning booking flow + `priceJob` (reads `surplus_split`) → creates `jobs` + `job_cleaning_details`.
3. **Dispatch (scheduling, not optimization at MVP):** availability, conflict detection, manual assignment, simple suggestions; worker app shows schedule. The engine *owns* when/who/where-order and the seam stays ready for richer dispatch later — but **no route-optimization project before there is volume.**
4. **Execution:** checklist completion + hours logging → `job_assignments`. **Compliance, minimal but real:** expired training or a missing required credential can **block assignment** — operational teeth without building a subsystem.
5. **Money in:** Stripe payment capture; record `expenses`; record labor basis.
6. **Allocation + transparency:** `allocation_period` close (manual/admin first) writing `allocations`; the transparency surface goes live (revenue/costs/surplus/split visible to members).
7. **Governance + valve:** proposals + votes; the `surplus_split` lever set by vote; decision-mode comms.
8. **Export:** clean per-tenant export (`WHERE co_op_id = X`) — the exit right, in code.

**Mandatory checkpoint (do not skip):** after the MVP, **prove a real cleaning business runs on it** — real customers, real worker-owners, recurring revenue, cash-flow stability — **before any second-sector abstraction or federation infrastructure.** The architecture being ready is what lets you wait.

---

## 8. Acceptance criteria (MVP "done")

- A customer can book, get a policy-derived price, be scheduled, and pay.
- A worker-owner can see their schedule, complete a checklist, log hours, and view earnings + capital account.
- Members can see period revenue, costs, surplus, and the current pay↔price position.
- A proposal can pass and move the `surplus_split` lever, with history preserved and the change reflected in new quotes.
- `co_op_id` + RLS verified: a query as co-op A cannot read co-op B's rows (test with a seeded second co-op, then leave it dormant).
- **Export round-trip proven:** a full per-tenant export **re-imports into a fresh system with integrity verified** — the exit right is round-tripped, not symbolic. (A one-way dump does not satisfy this.)
- **A restore drill has passed** from off-site backup onto a bare box via `docker-compose` + migrations + restore.
- CI fails on any `/platform → /sectors/*` import.

---

## 8a. Required tests (the document's claim is rigor — honor it)

Automated tests are required for the things that actually break:
- **Pricing math:** breakdown components sum to `final_price_cents`; re-pricing from stored details + snapshotted `policy_version_id` is deterministic.
- **RLS isolation:** with a **seeded second co-op**, a query in co-op A's context returns **zero** of co-op B's rows; a query with **no** tenant context returns zero rows (fail-closed).
- **Export round-trip:** export co-op A, re-import into a **fresh instance**, verify integrity (§ below).
- **Platform/sector boundary:** the import-ban lint runs in CI **and** an architectural test asserts no `/platform` module references a sector — covering the "in /platform but secretly cleaning-specific" case the lint can't see.
- **Decision-mode constraint:** a decision-mode communication without a linked proposal + attached computable economics is rejected at write time.

---

## 9. Deferred / needs external authority

- **Federation infrastructure** (√-weighted voting, apportionment snapshots, double-lock, cross-tenant patronage, shared-services billing, multi-tenant admin) — deferred until node #2 exists.
- **Counsel (SELC):** entity = CA cooperative corporation (AB 816); the load-bearing question of whether a *secondary* co-op may weight member votes; securities exemption analogs. (See federation design doc.)
- **CPA:** patronage/Subchapter T conformance, allocation timing (8½-month rule), payroll/tax — **do not rely on `allocations` outputs for filings or member tax statements until confirmed.**
- **Genesis numbers** (set at drafting): founder-handover trigger (N co-ops / M workers / date D), apportionment interval, vote-unit scaling, cap variant.

---

## One line

A cheap-to-run, vendor-independent, self-healing cleaning-co-op MVP whose pay↔price balance is set by an informed member vote, whose books are open to the people who own them, and whose foundations — tested backups, clean seams, honest ledgers — are built to outlast the conversation that designed them.
