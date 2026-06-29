# Cleaning App — Build Spec with Pre-Scored Platform Seams

> **Platform test (apply to every shared module):** *Every platform module must be reusable by at least one plausible second sector without code changes, or it is not platform.* This turns the architecture from a philosophy into a testable rule — hold every PR against it.

## The one rule

Build **one excellent single-tenant cleaning app now**, as a modular monolith whose internal seams fall *exactly* on the future platform/local line from the federation design. Score the cuts now (cheap); defer the platform infrastructure until node #2 forces it (expensive). The app becomes a federation platform by **addition, not rewrite**.

**Dependency law (the thing that makes it work):** local/sector modules depend on platform modules through stable interfaces; **platform modules never import sector modules.** The platform is the lower layer that knows nothing about cleaning. Cleaning plugs into it.

Enforce it **mechanically**, because boundary erosion is a *deadline* failure, not a technical one — under pressure the cheapest move is always to leak a cleaning assumption into a shared module, and six of those turn the platform into a distributed monolith in a federation costume. Two enforcement layers, both required:
- **CI import-lint:** any platform module importing from a sector module is a **release-blocking** violation. This catches wrong-direction dependencies automatically.
- **The extraction test (above):** catches the subtler violation lint can't see — a module that technically sits in the platform package but is secretly cleaning-specific. Asked at code review: *could another sector use this unchanged?* If no, it's not platform, regardless of where the file lives.

**Seams vs infrastructure:** a *seam* is a boundary you can cut along later (an interface, a tenant key, a module split) — build these now, nearly free. *Infrastructure* is machinery that operates across the seam (multi-tenant routing, federation voting, cross-tenant billing) — defer these, they burn runway and you'll design them wrong from one instance anyway.

---

## The line: platform modules vs sector modules

**PLATFORM — sector-agnostic, lifted out to become the shared-services co-op's system at N≥2.** Each would serve a cleaning, landscaping, or junk-removal co-op identically.

| Module | Responsibility | Interface / seam |
|---|---|---|
| **Identity & Access** | Users, roles (customer / worker-owner / admin), auth | Generic; sectors read identity, never own it |
| **Membership & Ownership Ledger** | Who is a worker-*member* vs probationary; buy-in; internal capital accounts; one-worker-one-vote records | This is where the federation later reads each co-op's verified worker-count for √ apportionment — build it clean and the federation voting is fed automatically |
| **Member-Capital Ledger & Allocation Workflow** | Per-member labor basis (hours), internal capital accounts, surplus-allocation workflow. *Tax-conformant treatment is a configuration the bylaws + CPA validate — the engine tracks and allocates; it does not assert deductibility* | Sector-agnostic (patronage is by labor regardless of trade). **This is why you build instead of buy** — no SaaS scheduler models co-op member-capital allocations |
| **Payments & Payroll Orchestration** | Capture customer payment; payout to worker-members | Integrate (Stripe in, Gusto/Justworks for W-2 payroll) — orchestrate, don't build payroll |
| **Dispatch & Scheduling Engine** | **Owns: time windows, worker availability, route optimization, assignment constraints** (the *when / who / where-order* of work) | Engine is platform; **sectors own duration estimation, required-skill determination, and price formation** (the *what-this-job-is*). Boundary test: a rule true for landscaping crews too is engine; a rule true only because cleaning works a certain way is sector |
| **Compliance & Standards Tracking** | Track certs, training completion, IIPP/OSHA records, insurance/bond/registration status, expiries | Tracking engine is platform; the **specific ruleset** (cleaning = IIPP + janitorial registration; care = HCO license + aide registration) is sector config |
| **Notifications & Comms** | SMS / email / push rails to workers + customers | Generic transport; sectors supply content |
| **Data Export / Portability** | Clean export of a single co-op's complete dataset | **The exit right, in code.** Trivial given the tenant key (below). Build early — it's cheap and it's a constitutional guarantee |

**SECTOR / CLEANING — stays local; every future node ships its own.** This is what makes cleaning *cleaning* and what a cleaning customer sees.

| Module | Responsibility | Seam |
|---|---|---|
| **Booking Flow (Customer App)** | Choose service, see price, pick time, book | Cleaning books by bedrooms/bathrooms/sqft; landscaping by lot size — sector-specific surface |
| **Pricing Engine** | Per-room pricing, recurring discount, deep-clean surcharge, add-ons | Produces a **PricedJob** the platform payments module accepts |
| **Service Catalog & Checklists** | The cleaning tasks, per-room checklists, green-cleaning protocols | This is your **code of standards**, operationalized — the checklists *are* the standards |
| **Trust & Marketing Surface** | "Licensed, bonded, insured," reviews, public site | Sector-specific presentation |
| **Customer Service-Preferences** | "Unscented products," "focus on kitchen," access notes | Sector-shaped extension of the generic customer record |

---

## The seam mechanism (how the cut stays clean)

1. **Sector adapter interface.** Each sector implements a *small* set of functions the platform calls. That's the entire contract between platform and sector:
   - `estimateJobDuration(jobDetails) → minutes`
   - `getRequiredSkills(jobDetails) → skill[]`
   - `priceJob(jobDetails) → PricedJob`
   - `getComplianceRuleset() → requirement[]`
   - `getJobDetailSchema() → schema` (what extra fields this sector's jobs carry)
   Add a sector = implement this interface. The platform never changes.

2. **Generic job + sector extension table (data-level seam).** `jobs` is platform and generic (id, co_op_id, customer_id, scheduled_at, status, sector, priced_amount, assigned_members). `job_cleaning_details` is the sector extension (sqft, bedrooms, addons, product prefs), joined by job_id. New sector = new extension table; `jobs` is untouched.

3. **The tenant key — `co_op_id` on every platform table, at N=1.** Even with one co-op. This is the keystone (below).

4. **Dependencies point down only.** Enforced by package structure + CI rule.

---

## Keystone: tenant key + Postgres RLS = multi-tenancy and the exit right, pre-built

Put `co_op_id` on every platform table now, and write **row-level-security policies on it now**, with a single co-op. Consequences:

- **Multi-tenancy is pre-built.** When node #2 arrives, the database already isolates tenants. You add a row to `co_ops`, not a tenancy layer. No retrofit.
- **The exit right is trivial.** A co-op leaving with its members, customers, and history = export all rows where `co_op_id = X`. The constitutional guarantee and the `WHERE` clause are the same line.
- **It's nearly free now.** Supabase ships Postgres + Auth + RLS — the most future-proofing move is also the least effort on your existing stack.

This is the deepest point where the architecture *is* the values: guaranteed exit is enforced by the database, not promised by a policy.

**Default-deny tenancy rule.** The failure mode is asymmetric: a table that *should* be tenant-scoped accidentally being global is a cross-co-op data leak (one co-op seeing another's customers — the exact thing sovereignty and exit exist to prevent); the reverse error is merely over-scoping. So isolation is the default, sharing is the exception that must justify itself: **every table is tenant-scoped under RLS by default; a table becomes global only by explicit, reviewed exception.** The global set is tiny and obvious (sector registry, system config, shared service-category taxonomy). A careless `CREATE TABLE` is then safe-by-default, and only a deliberate, visible decision can open a cross-tenant hole — the schema-level expression of own-it-from-below.

---

## Dual audience: two surfaces, one backend

Not one app straining to serve both; not two backends. **Two front-end surfaces over one shared backend.**

- **Customer app:** browse service → see price → book → pay → track → rate. (Cleaning sector + platform payments.)
- **Worker-owner app:** my schedule → claim/accept jobs → execute checklists → log hours (→ feeds patronage) → see earnings + patronage balance → participate in single-co-op governance (proposals/votes *within* this co-op). (Platform + cleaning sector.)

The worker app's governance tab is single-co-op only for now. Federation-level √ voting is deferred (it doesn't exist until node #2).

---

## Data model spine (sketch)

**Platform (all carry `co_op_id`, all under RLS):**
- `co_ops` (id, name, …) — the tenant table; one row now
- `users` (id, co_op_id, role, …)
- `members` (id, user_id, co_op_id, status, buy_in_paid, capital_account_balance, joined_at) — ownership ledger
- `customers` (id, co_op_id, contact, address)
- `jobs` (id, co_op_id, customer_id, sector, scheduled_at, status, priced_amount) — generic
- `job_assignments` (job_id, member_id, hours_logged) — feeds patronage
- `patronage_periods`, `patronage_allocations` (member_id, period, labor_basis, amount) — member-capital ledger + allocation workflow; tax treatment validated by bylaws + CPA, not asserted by the schema
- `payments` (id, co_op_id, job_id, amount, status)
- `compliance_records` (id, co_op_id, member_id, requirement_key, status, valid_until)
- `training_records` (id, co_op_id, member_id, requirement_key, completed_at)

**Sector / cleaning:**
- `cleaning_service_types` (name, base_price_rule)
- `cleaning_checklists` (service_type, room, tasks[])
- `job_cleaning_details` (job_id, sqft, bedrooms, bathrooms, addons[]) — extends `jobs`
- `customer_cleaning_preferences` (customer_id, prefs)

Pattern to internalize: **generic platform row + sector extension table.** It's the data-level expression of the whole architecture.

---

## Recommended stack (matched to your tools)

- **Next.js (App Router)** — web apps; you've shipped it before.
- **Supabase (Postgres + Auth + RLS)** — connected; RLS is the keystone above.
- **Stripe** — customer payments.
- **Gusto / Justworks** — W-2 payroll integration. **Do not build payroll.**
- **Web-first**; PWA, then React Native if/when worker mobile demands it.
- **Monorepo, boundary-enforced:**
  ```
  /platform        identity · membership · patronage · payments · dispatch-engine ·
                   compliance-engine · notifications · export   (knows nothing about cleaning)
  /sectors/cleaning  booking · pricing · catalog+checklists · trust surface ·
                     adapter (implements platform interfaces)
  /apps/customer-web   customer surface
  /apps/worker         worker-owner surface
  ```
  At N=1 this deploys as one app. At N=2 you add `/sectors/landscaping`; the federation extraction separates `/platform` (→ shared-services co-op) from each `/sectors/*` (→ a node), **along seams already cut.**

---

## Build order: now vs deferred

**BUILD NOW (N=1):**
- `/platform` modules, **single-tenant** (tenant key + RLS present, default-deny; no tenant-management UI, no cross-tenant anything)
- `/sectors/cleaning`, fully
- Both apps (customer + worker)
- Data export (cheap given the tenant key; it's the exit right)

**DEFER until node #2 forces it:**
- Multi-tenant routing / per-tenant config management / platform-admin surface
- **Federation governance** (√ voting, apportionment snapshots, the double-lock) — note: *this co-op's own* member ledger is built now; the *federation's* voting system is deferred
- Cross-tenant patronage / shared-services billing

This deferral *is* "don't abstract until two instances force it," operationalized. You cannot correctly design the platform layer from one node — so build the seams, defer the infrastructure.

---

## The MVP cut — what to actually build first, in order

1. **Identity + `co_ops` + member ledger** (ownership substrate) with `co_op_id` + RLS from commit one.
2. **Customer booking → job creation** (cleaning sector) + **pricing engine**.
3. **Dispatch:** assign job to a worker-owner; worker app shows the schedule.
4. **Job execution:** checklist completion + **hours logging**.
5. **Payments in (Stripe);** record the patronage labor basis from logged hours.
6. **Allocation-period close** — member-capital allocation can be a manual/admin action at first; automate later. (Tax-conformant treatment confirmed with CPA before relying on it — the workflow runs regardless.)
7. **Data export.**

**Mandatory checkpoint — do not skip.** After the MVP, **prove the app runs a real cleaning business** (real customers, real worker-owners, real recurring revenue, cash-flow stability) **before adding any second-sector abstraction.** This checkpoint is the gate on the entire federation path: the architecture being ready is what lets you *wait*, and you earn the platform by running one excellent co-op first. Do not build one line of federation infrastructure until a real second node exists to force its shape.

---

## What this buys you (one sentence)

A cleaning app that becomes a platform by addition rather than rewrite — because the seams were scored exactly where the federation cut will fall, the database already enforces the tenancy the federation will need, and the right to walk away is a `WHERE` clause that was true from the first commit.
