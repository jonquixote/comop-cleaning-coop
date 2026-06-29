# Threat Model — Cleaning Co-op Platform

> **Comprehension gate (Builder Engineering Standard §0).** One page, four load-bearing
> failure modes. For each: *how it actually happens*, *what structurally prevents it*, and
> *how we prove the prevention holds*. Prevention is named at the layer that enforces it —
> three of four are a database constraint, not application vigilance.
>
> **Stack note (binding-doc reconciliation):** the service-spec names Supabase; the builder
> implementation spec overrides it — *"zero dependency on Supabase or any managed platform"* —
> and the ADRs are stack-agnostic (Postgres RLS, not Supabase RLS). This model assumes
> **self-hosted PostgreSQL**. Recorded as ADR-0004.

---

## 1. RLS failure — one tenant reads another tenant's rows

**How it happens.** RLS isolates only if the database evaluates the *correct* tenant id. Three concrete paths to a leak:
- **(a) Client-supplied tenant.** Code reads `co_op_id` from a header / body / query param and trusts it. An attacker sets co-op B's id; the policy faithfully filters *to B*. This single mistake is the entire vulnerability.
- **(b) Missing context that defaults to "all".** A path opens a connection without setting tenant context. If a policy is written permissively (`... OR current_setting() IS NULL`) or the app role holds `BYPASSRLS`, a context-less query returns **everything** instead of nothing.
- **(c) Connection-pool leakage.** Context set with `SET` (session-scoped) instead of `SET LOCAL` (transaction-scoped) survives on a pooled connection and bleeds into the next request — a different tenant.

**What prevents it — the auth→RLS chain (impl §3a), fail-closed.**
1. `co_op_id` is resolved **server-side from the trusted Postgres session record** — never from client input.
2. Every request runs in a transaction whose first statement is `SET LOCAL app.current_co_op = <resolved id>` — transaction-scoped, so it cannot outlive the txn or leak across pool reuse.
3. Every policy filters `co_op_id = current_setting('app.current_co_op')::uuid` with **no null-permissive branch**; the app DB role is **non-superuser and never granted `BYPASSRLS`**.
4. Unset context → `current_setting` is NULL → predicate is NULL → **zero rows**. Default-deny (ADR-0002) means a careless `CREATE TABLE` is tenant-scoped automatically; only a reviewed exception opens a hole.

**Proof.** Mandatory TDD invariant (§1, §8a): a seeded **dormant second co-op**; a query in A's context returns **zero** of B's rows, **and** a query with no `SET LOCAL` returns **zero** rows (fail-closed). Runs in the fast CI gate on every PR. *(Phase 1.)*

---

## 2. Webhook duplication — a Stripe retry credits a payment twice

**How it happens.** Stripe delivers **at-least-once** and retries on any non-2xx or timeout. A naive `charge.succeeded → insert payment / bump balance` handler runs the credit path again on every retry (and on two near-simultaneous deliveries) → double-counted revenue, and a corrupted labor/allocation basis downstream.

**What prevents it — the `webhook_events` idempotency ledger (impl §4).** `external_event_id` carries a **UNIQUE** constraint. In one transaction the handler: `INSERT ... ON CONFLICT DO NOTHING` on the event id → if nothing was inserted (already seen), **ack 200 and stop, do not reprocess** → else apply the credit and mark processed. The **UNIQUE index, not the application code, is the guarantee**: two concurrent retries race on the index and exactly one wins. The same shape protects payroll — `payroll_sync_records.idempotency_key` makes a retried sync never double-pay.

**Proof.** Idempotency is a PR-checklist gate (§5) plus an integration test: deliver the same `external_event_id` twice, assert exactly one credit. *(Phase-gated: ledger table + UNIQUE land in the Phase 1 schema; the handler + test land with "Money in", build-order step 5.)*

---

## 3. Broken restore — the backup exists but cannot bring the system back

**How it happens.** Backups rot silently: a misconfigured pgBackRest stanza writes empty/partial archives; the encryption key drifts; the WAL chain breaks; or the dump captures a schema the current migrations can no longer load. Every one of these is discovered **at the disaster** — the single moment recovery is impossible. "We have backups" is a hope, not a backup.

**What prevents it — tested restore, not stored backup (impl §3).**
1. **pgBackRest:** continuous WAL archiving + scheduled base backups, **encrypted at rest**, pushed **off-box** to B2 / Hetzner Storage Box. Targets RPO ≤ 5 min, RTO ≤ 1 hour.
2. **Automated restore drill:** restores the *latest* backup to a *scratch* instance and runs a verification query suite (row counts, RLS still isolates, pricing sums) — proving the backup is **loadable and correct before it is needed**.
3. **A failed _or skipped_ drill pages a named human (§7).** Skipped counts as failed, so the discipline cannot quietly lapse into decoration.
4. **Reproducible rebuild:** `docker-compose up` + latest migration + latest restore = a working system on a bare box; tested end-to-end at least once before launch.

**Proof.** Heavy CI gate, nightly + pre-release: full restore drill to scratch + verification suite; failure pages on-call. The mandatory export/re-import round-trip proves data is **portable**, not merely present. *(Phase 1 establishes the floor: off-site encrypted base backups + a passing restore drill before feature work.)*

---

## 4. Bad policy/version semantics — a quote changes underneath a customer or worker

**How it happens.** `surplus_split` (the pay↔price lever) is read **live** by the pricing engine. A member vote changes it. Every already-quoted, not-yet-settled job now re-derives a *different* price and worker-share than was promised — the customer is effectively re-billed, the worker's basis shifts. Worse, if `policy_settings` is overwritten **in place**, the prior version is gone and the original quote cannot even be reconstructed.

**What prevents it — snapshot-on-quote + append-only history (impl §5).**
1. `policy_settings` is **versioned** (`effective_from`, `set_by_proposal_id`) and **never overwritten** — a passing vote `INSERT`s a new row.
2. At quote time T the job **snapshots the applicable `policy_version_id` onto itself** and carries it for its entire life.
3. `priceJob(details, policySnapshot)` is a **pure function** of stored details + the snapshotted version → re-pricing reproduces an **identical breakdown** (determinism).
4. A later vote changes **future quotes only**; in-flight jobs are frozen on their record. `quoted_price_cents` (promised) and `final_price_cents` (settled) are kept **distinct and never collapsed**.

**Proof.** Mandatory TDD invariants (§1, §8a): breakdown components **sum** to `final_price_cents`; re-pricing from stored details + snapshotted `policy_version_id` is byte-identical. PR-checklist policy/history gates. *(Phase-gated: `policy_settings` versioning + the snapshot column land with "Booking→job", step 2; their tests are TDD-first there.)*

---

**One line.** Three of these four are stopped by a constraint the *database* enforces — the RLS predicate, the UNIQUE index, append-only history — rather than by code remembering to be careful; the fourth (restore) is stopped by *exercising* recovery on a schedule, so its failure surfaces in a drill instead of a disaster.

---

### Phasing summary (what this gate commits Phase 1 to vs. defers)
| Failure mode | Prevention lands | Proof lands |
|---|---|---|
| 1 · RLS leak | **Phase 1** (auth→RLS chain, default-deny policies) | **Phase 1** (fail-closed isolation test) |
| 2 · Webhook dup | Phase 1 schema (table + UNIQUE) | Step 5 "Money in" (handler + test) |
| 3 · Broken restore | **Phase 1** (off-site encrypted backups + restore drill floor) | **Phase 1** drill; full drill nightly thereafter |
| 4 · Policy semantics | Step 2 "Booking→job" (versioning + snapshot) | Step 2 (determinism + sum tests, TDD-first) |

### Deferred — named so they are not lost, out of Phase 1 scope
- **`webhook_events` tenancy:** the spec's sketch carries no `co_op_id` and it is **not** on the ADR-0002 approved-global list. Resolve at step 5 — either add `co_op_id` (resolved from the payment) or file an ADR-0002 amendment making it a deliberate global exception. **Do not let it land un-scoped.**
- **CPA / counsel (§9):** patronage/Subchapter T treatment, AB 816 weighted-vote latitude, securities. `allocations` outputs are **not** to be relied on for filings until confirmed.
- **Federation infrastructure (§9):** √-voting, apportionment, double-lock, cross-tenant anything — deferred until a real node #2 exists. Not built.
