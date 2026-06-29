# Onboarding Runbook — New Engineer

> Third companion. The **implementation spec** says *what to build*; the **engineering standard** says *how to build it to the standard*; this says *how a second engineer joins and becomes productive without tribal knowledge.* This document is the standard's true job made concrete: **it is what lets the project survive the original builder leaving.** If a new engineer can't get from this page to a reviewed, merged change in a day, this document has failed — fix it, don't work around it.

---

## 0. Read first (30 minutes, in order)
1. `cleaning_app_implementation_spec.md` — what the system is. Pay attention to §0 mission tenets, §3a auth→RLS chain, §5 pricing breakdown + policy snapshot.
2. `builder_engineering_standard.md` — how we work and what "done" means.
3. `docs/adr/0001–0003` — the three rules that keep the codebase honest (platform test, default-deny RLS, sector-import ban).
4. Skim existing ADRs beyond 0003 — they are the project's memory of *why* things are the way they are.

**The mental model in one paragraph:** one cleaning co-op, built as a modular monolith with seams pre-cut where a future federation will split it. The platform layer knows nothing about cleaning; cleaning plugs into it. Tenancy is enforced by Postgres RLS on `co_op_id`, set from the trusted server session — never client input. Money is integer cents, times are UTC, prices are frozen on a policy-version snapshot, and the books are open to the worker-owners who own the co-op. The cooperative values live in the data, not the UI.

---

## 1. Boot the stack locally
```
git clone <repo> && cd <repo>
cp .env.example .env        # fill secrets per the comments; never commit .env
docker compose up           # brings up Postgres + app + workers
# in a second shell:
<migrate-cmd>               # apply all migrations (e.g. drizzle migrate / migration runner)
<seed-cmd>                  # seed one co-op + a dormant SECOND co-op (for RLS tests)
```
You should now reach the customer surface and the worker surface locally. If any step fails, the gap is a runbook bug — report it.

> The **dormant second co-op** is not optional decoration: it is the fixture that proves tenant isolation. Never delete it from the seed.

---

## 2. Run the tests
```
<typecheck-cmd>            # strict; no `any` on platform/security/pricing/governance
<lint-cmd>                 # includes the /platform -> /sectors import-ban (ADR-0003)
<unit-cmd>                 # incl. mandatory-TDD invariants
<integration-cmd>         # incl. RLS isolation vs the seeded second co-op
```
The five invariants that must always be green (engineering standard §1): pricing/policy determinism, auth→RLS fail-closed, export round-trip, decision-mode write constraint, sector-adapter contract. **If you break one of these, you have broken a load-bearing wall — stop and fix it before anything else.**

---

## 3. Run a restore drill locally (do this in your first week)
The discipline that makes this a monument. Once locally, by hand, so you trust it:
```
<backup-cmd>              # produce a backup (pgBackRest/barman per /ops)
<restore-cmd>            # restore into a SCRATCH instance (never your working DB)
<verify-cmd>             # run the verification query suite; confirm it passes
```
Read `/ops/runbook.md` for the production version (failover, cert rotation, who to page). **An untested backup is a hope, not a backup** — do the drill until you'd trust it at 2am.

---

## 4. Make a change — the workflow
1. **Short-lived branch or trunk** (engineering standard §4). No long divergent branches.
2. **Deviating from the spec?** Land a tiny **ADR PR first** (`docs/adr/NNNN-…`), then the implementation PR referencing it. Design artifact before code artifact.
3. **Write the test where it's mandatory** (the §1 litmus: *TDD anything that computes money, filters by tenant, or writes to a versioned or financial table; don't TDD CSS, copy, or log wording*).
4. **Touching `/platform`?** Your PR includes the code change, the invariant test, **and** a runbook update if it affects deployment/backup/recovery/auth/payments.
5. **Open the PR with the checklist** (engineering standard §5) filled — RLS, cents, UTC, breakdown test, policy snapshot, idempotency, history, boundary, migration review, query-plan, tests, runbook, ADR.

---

## 5. Get it reviewed & merged
- **Fast CI gate** must be green (type-check, lint/import-ban, unit+integration, fast verification queries).
- A reviewer confirms the **PR checklist** and **Definition of Done** (engineering standard §3): tests exist, CI green, invariants hold, schema writes history correctly, runbook updated.
- Merge → it deploys to **staging** first (engineering standard §7); nothing reaches production without passing staging.
- The **heavy gate** (full restore drill, export round-trip) runs nightly/pre-release — if it fails on your change, you'll be paged.

---

## 6. Where things live
- `/platform` — sector-agnostic core (identity, ledger, allocation, payments, dispatch, governance, transparency, export). **Never imports `/sectors`.**
- `/sectors/cleaning` — booking, pricing, checklists, trust surface, the sector adapter.
- `/apps/*` — customer + worker surfaces.
- `/ops` — docker-compose, migrations, backup/restore scripts, `runbook.md`.
- `/docs/adr` — the project's memory of decisions. **When in doubt about *why*, read here before changing anything.**

---

## 7. The five things that will get you in trouble (memorize)
1. **Trusting client input for tenant identity.** `co_op_id` comes from the server session, set as `app.current_co_op` in-transaction. Never from a header/body/param.
2. **Floats for money.** Integer cents, always.
3. **Overwriting policy or financial history.** Append/version; never in-place.
4. **Letting cleaning logic leak into `/platform`.** If a second sector couldn't reuse it unchanged, it doesn't belong there.
5. **A price that changes underneath someone.** Quotes snapshot their `policy_version_id`; a later vote changes future quotes only.

---

## One line
If you've read the two specs, booted the stack, run the tests, done one restore drill, and shipped one reviewed change — you are productive, and the project no longer lives in one person's head. That last clause is the entire point.
