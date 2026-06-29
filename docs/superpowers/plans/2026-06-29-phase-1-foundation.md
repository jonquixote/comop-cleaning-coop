# Phase 1 — Load-Bearing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GATE:** Threat model (`docs/threat-model.md`) is **approved** (Engineering Standard §0). **Task 0 (ADRs, docs-only) lands first** per the §4 ADR tax; **Task 1 does not begin until this revised (v2) plan is re-confirmed.**
>
> **Plan version:** **v2** — revised per review. See **Revision log (v2)** at the end for the eight fixes.

**Goal:** Stand up the unbreakable foundation — auth→RLS trusted-tenant chain, schema/migrations, off-site backups with a passing restore drill, and the mandatory fail-closed isolation test — so all feature work (steps 2–8) is built on proven tenancy and proven recovery.

**Architecture:** Modular monolith, boundary-enforced monorepo (`/platform` knows nothing about cleaning). Self-hosted PostgreSQL with default-deny Row-Level Security keyed on `co_op_id`. Tenant identity is resolved from the **live server-side session row** at the sole app-facing DB entry point, then pushed into `SET LOCAL app.current_co_op` inside the request transaction; RLS policies read only that server-set value and return zero rows when it is unset.

**Tech Stack:** Next.js (App Router) + TypeScript · self-hosted PostgreSQL · Docker + docker-compose · committed SQL/Drizzle migrations in `/ops` · self-hosted session auth (magic-link + password, sessions in Postgres) specified *by property* · pgBackRest → Backblaze B2 / Hetzner Storage Box · tRPC at the client↔server seam.

## Global Constraints

*Every task's requirements implicitly include this section. Values copied verbatim from the specs/ADRs.*

- **Money:** integer minor units (cents); **no floats**. (std §5, impl §4)
- **Time:** all timestamps **UTC**. (std §5)
- **Tenancy:** every table carries `co_op_id` + an RLS policy, **default-deny**, from the first commit. (ADR-0002) **Anchor exception:** `co_ops` is tenant-scoped by its own `id` via a bespoke policy and has **no `co_op_id` column** — the one structural exception to the column rule, recorded in **ADR-0004**.
- **Global-table exceptions — the *only* ones:** `sector_registry`, `system_config`, `service_category_taxonomy`. Anything else global = an ADR-0002 amendment. (`co_ops` is **not** global — it stays tenant-isolated, just keyed on `id`.)
- **Tenant context:** `co_op_id` comes from the **trusted live session row**, set as `SET LOCAL app.current_co_op` **in-transaction**; **never** from header/body/param. (impl §3a)
- **App DB role:** the app connects as **`app_user`** — `LOGIN, NOSUPERUSER, NOBYPASSRLS`, DML grants only. Migrations/seed run as **`app_owner`**. (impl §3a, ADR-0004)
- **Boundary:** `/sectors/* → /platform` allowed; **`/platform → /sectors/*` is release-blocking**; `/platform` must not reference any sector by name. (ADR-0001, ADR-0003)
- **Type-check:** strict; **no `any`** on platform/security/pricing/governance paths. (std §2)
- **History:** policy/financial writes are **append/versioned**, never in-place overwrite. (std §5)
- **Restore floor (non-negotiable):** off-site **encrypted** backups + a **verified restore drill**; a **failed _or skipped_** drill **pages a named human**. RPO ≤ 5 min, RTO ≤ 1 hour. (impl §3, std §7)
- **ADR tax:** any spec deviation = a tiny ADR PR **first**, implementation PR references it. (std §4)

---

## Full MVP build order (forward map — only Phase 1 is detailed here)

Per impl §7 / service-spec "MVP cut". **Do not broaden Phase 1 into these.**

1. **Foundation** ← *this plan* — Postgres + Docker + migrations + auth; `co_ops`+`users`+`members` with `co_op_id`+RLS default-deny from commit one; **backups + passing restore drill before feature work.**
2. Booking → job (`priceJob` reads `surplus_split`; `policy_version_id` snapshot; TDD pricing determinism + sum).
3. Dispatch (availability, conflict detection, manual assignment — *no route optimization*).
4. Execution (checklist completion + hours → `job_assignments`; compliance can block assignment).
5. Money in (Stripe capture; `webhook_events` idempotency handler; `expenses`; labor basis).
6. Allocation + transparency (period close → `allocations`; transparency surface live).
7. Governance + valve (proposals/votes; `surplus_split` set by vote; decision-mode comms write-constraint).
8. Export (per-tenant export; **re-import round-trip** proven).

**Mandatory checkpoint after step 8:** prove a real cleaning business runs on it before *any* second-sector abstraction or federation infrastructure.

---

## File Structure (Phase 1)

```
/docs/adr/0001-platform-test.md            (relocated from docs/spec/service-spec)
/docs/adr/0002-rls-default-deny.md         (relocated)
/docs/adr/0003-ci-sector-import-ban.md     (relocated)
/docs/adr/0004-stack-and-auth-choice.md    (NEW — Supabase→self-hosted; auth by property; co_ops carve-out; role + entry-point rules)
/platform/db/internal/tenant-tx.ts         INTERNAL: pool + SET LOCAL txn helper (NOT app-importable)
/platform/db/roles.sql                     app_user (LOGIN, non-superuser, no BYPASSRLS) + app_owner (owns tables, runs migrations/seed)
/platform/identity/session-tx.ts           withSessionTx — SOLE app-facing DB entry; resolves co_op_id from the live session row
/platform/identity/session.ts              create / resolve / revoke server-side sessions
/platform/identity/password.ts             argon2 hash/verify
/platform/identity/magic-link.ts           single-use, expiring login tokens
/platform/identity/invite.ts               worker invite tokens (single-use, expiring)
/ops/docker-compose.yml                    postgres + app (+ scratch profile for drills)
/ops/migrations/0001_foundation.sql        citext ext; co_ops (anchor), users, sessions, members + RLS policies
/ops/migrations/run.ts                     migration runner (committed; never edit prod by hand)
/ops/seed.ts                               one co-op + DORMANT second co-op (RLS fixture; runs as app_owner)
/ops/backup/pgbackrest.conf                stanza, encryption, B2/Storage Box repo
/ops/backup/restore-drill.sh               restore latest → scratch → verify → page on fail/skip
/ops/backup/verify-suite.sql               post-restore verification queries
/ops/runbook.md                            restore / failover / cert rotation / who to page
/tools/check-boundaries.ts                 architectural test: no /platform ref to a sector; no app import of internal tenant-tx
/tests/rls/isolation.test.ts               MANDATORY fail-closed isolation invariant + positive control
/.github/workflows/fast-gate.yml           typecheck · lint+import-ban · unit+integration · fast verify
/.github/workflows/heavy-gate.yml          nightly/pre-release restore drill + export round-trip
/eslint.config.js                          import/no-restricted-paths (ADR-0003)
/.env.example                              documented secrets; never commit .env
```

> **Plan density (deliberate, per std §1 — "proof where wrong is catastrophic; lighter elsewhere").** Load-bearing tasks (the auth→RLS chain, the fail-closed test, the import-ban, the restore drill) carry **full concrete code/SQL**. Pure scaffolding (Next.js init, compose boilerplate) carries exact file lists + commands, not every line. This mirrors the Standard's own posture; it is not a placeholder shortcut.

---

## Task 0: ADRs land first (docs-only — satisfies the §4 ADR tax)  ✅ *executed this revision*

**Files:**
- Create: `docs/adr/0004-stack-and-auth-choice.md`
- Move: `docs/spec/service-spec/000{1,2,3}-*.md` → `docs/adr/000{1,2,3}-*.md`

**ADR-0004 records (deviations/clarifications = stack + auth + trust-chain + schema, std §4):**
- **Self-hosted PostgreSQL; no Supabase / no managed platform.** impl §2 mandates "zero dependency on Supabase"; service-spec's Supabase mention is superseded; ADRs are stack-agnostic.
- **Auth by property** — session auth (magic-link + password), sessions are server-side Postgres rows, revocable. *Default:* a thin hand-rolled session layer (sessions table + signed httpOnly cookie + argon2) rather than anchoring the monument to one library. Concrete dependency chosen at implementation after a maintenance check.
- **Migrations** = committed SQL runner (or Drizzle) in `/ops`; never edit prod schema by hand. **Backups** = pgBackRest → B2/Storage Box.
- **Session-resolved entry point** — the string-taking `withTenantTx` is internal; the only app-facing DB door is `withSessionTx`, which resolves `co_op_id` from the live session row (provenance is structural, not conventional).
- **Role pattern** — app connects directly as `app_user` (`LOGIN, NOSUPERUSER, NOBYPASSRLS`); `app_owner` owns tables and runs migrations/seed. Invariant: runtime app role never superuser, never `BYPASSRLS`.
- **`co_ops` carve-out** — the anchor table is keyed by its own `id` (no `co_op_id` column) and gets a bespoke `ENABLE`-but-not-`FORCE`, SELECT-only policy; the generic verbatim policy is **not** applied to it.

- [x] **Step 1:** Write `docs/adr/0004-stack-and-auth-choice.md` (Status: Accepted; Context/Decision/Consequences) capturing the decisions above (incl. the `co_ops` policy carve-out, the `app_user`/`app_owner` connection pattern, and the session-resolved entry-point rule).
- [x] **Step 2:** Move ADR-0001/2/3 into `docs/adr/` (plain `mv` — relocation predates repo history). References in the specs/runbook already point to `docs/adr/` → the move makes them correct.
- [x] **Step 3:** Commit (genesis). *(Done this revision — see session summary.)*

---

## Task 1: Boundary-enforced monorepo skeleton + import-ban (ADR-0003)  ⛔ *blocked on v2 re-confirmation*

The dependency law must fail builds **from commit one**, before any module can leak.

**Files:**
- Create: monorepo workspaces `/platform`, `/sectors/cleaning`, `/apps/customer-web`, `/apps/worker`, `/ops`, `/tools`, `/tests`
- Create: `eslint.config.js`, `tools/check-boundaries.ts`, root `tsconfig.json` (strict), `.gitignore`

**Interfaces:**
- Produces: workspace layout + a green `lint` and `typecheck` that **fail** on a `/platform → /sectors` import and on any app import of the internal tenant helper.

- [ ] **Step 1: Write the failing boundary test.** Add a temporary file `platform/_probe.ts` with `import '../sectors/cleaning/index'`.
- [ ] **Step 2: Run the lint, verify it fails.**
  Run: `npx eslint platform/` → Expected: FAIL with the ADR-0003 message.
  `eslint.config.js` zone:
  ```js
  // import/no-restricted-paths
  { target: "./platform", from: "./sectors",
    message: "ADR-0003: platform must not import from sectors. Widen the sector-adapter interface, don't import." }
  ```
- [ ] **Step 3: Add the architectural test** (`tools/check-boundaries.ts`) — (a) greps `/platform/**` for any literal sector name (`cleaning`, `sectors/`) and exits non-zero on a hit (catches the "in /platform but secretly cleaning-specific" case lint can't, per ADR-0001/§8a); (b) flags any `/apps/**` import of `platform/db/internal/tenant-tx` (the internal helper must not be an app door — ADR-0004 §3).
- [ ] **Step 4: Delete the probe; run `npx eslint platform/ && npx tsx tools/check-boundaries.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "chore: boundary-enforced monorepo skeleton + ADR-0003 import-ban"`

---

## Task 2: Reproducible stack — docker-compose + env

**Files:**
- Create: `ops/docker-compose.yml` (services: `postgres`, `app`; profile `scratch` for drill target), `.env.example`

- [ ] **Step 1:** Write `ops/docker-compose.yml` — pinned Postgres **image digest** (not a floating tag, std §7), named volume, healthcheck; `app` service for Next.js.
- [ ] **Step 2:** Write `.env.example` with documented keys (`APP_DATABASE_URL` [as `app_user`], `OWNER_DATABASE_URL` [as `app_owner`], `SESSION_SECRET`, `PGBACKREST_REPO`, `B2_*`) and a "never commit `.env`" comment.
- [ ] **Step 3: Verify boot.** Run: `docker compose -f ops/docker-compose.yml up -d postgres` → `pg_isready` PASS.
- [ ] **Step 4: Commit.** `git commit -m "ops: docker-compose postgres+app, reproducible boot"`

---

## Task 3: First migration — foundation tables + the two roles

**Files:**
- Create: `ops/migrations/0001_foundation.sql`, `ops/migrations/run.ts`, `platform/db/roles.sql`

**Interfaces:**
- Produces tables: `co_ops` (tenant anchor, keyed by `id`, **no `co_op_id` column**), `users(co_op_id, role)`, `sessions`, `members(status)` — the three non-anchor tables `co_op_id`-scoped, UTC `timestamptz`, ids `uuid`.
- Produces roles: `app_user` (LOGIN, `NOSUPERUSER`, **no `BYPASSRLS`**, DML grants only — the runtime app role) and `app_owner` (owns tables; runs migrations + seed).

- [ ] **Step 1:** Write `platform/db/roles.sql` — one pattern; role, connection string, and code comments all match it:
  ```sql
  -- ADR-0004 §4: the app connects DIRECTLY as app_user. Migrations/seed run as app_owner (table owner).
  CREATE ROLE app_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOBYPASSRLS;  -- owns schema/tables; runs migrations + seed
  CREATE ROLE app_user  LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOBYPASSRLS;  -- runtime app role; DML grants only (Task 4)
  -- INVARIANT: the runtime app role (app_user) is NEVER superuser and NEVER has BYPASSRLS.
  -- APP_DATABASE_URL connects as app_user; OWNER_DATABASE_URL (migrations/seed) connects as app_owner.
  ```
- [ ] **Step 2:** Write `ops/migrations/0001_foundation.sql` (run as `app_owner`):
  ```sql
  CREATE EXTENSION IF NOT EXISTS citext;            -- required by users.email (citext) below
  -- gen_random_uuid() is core in PostgreSQL 13+ (pinned image is newer) — no pgcrypto extension needed.

  CREATE TABLE co_ops (                              -- TENANT ANCHOR: keyed by its own id; NO co_op_id column (ADR-0004 §5)
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    co_op_id uuid NOT NULL REFERENCES co_ops(id),
    role text NOT NULL CHECK (role IN ('customer','worker','admin')),  -- server-set only
    email citext NOT NULL,
    password_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (co_op_id, email)                         -- per-tenant account identity (not global)
  );
  CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    co_op_id uuid NOT NULL REFERENCES co_ops(id),
    user_id uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    co_op_id uuid NOT NULL REFERENCES co_ops(id),
    user_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL CHECK (status IN ('probationary','member')),
    joined_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX ON users(co_op_id);                   -- §5 co_op_id index coverage
  CREATE INDEX ON sessions(co_op_id);
  CREATE INDEX ON members(co_op_id);
  ```
- [ ] **Step 3:** Write `ops/migrations/run.ts` (applies ordered files as `app_owner`, records applied set).
- [ ] **Step 4: Apply.** Run: `OWNER_DATABASE_URL=... npx tsx ops/migrations/run.ts` → Expected: `0001_foundation applied`.
- [ ] **Step 5: Commit.** `git commit -m "feat(db): foundation tables (co_ops anchor) + app_user/app_owner roles"`

---

## Task 4: The auth→RLS trusted-tenant chain (load-bearing — full code)

**Files:**
- Create: `platform/db/internal/tenant-tx.ts`
- Modify: `ops/migrations/0001_foundation.sql` (append RLS policies)

**Interfaces:**
- Produces: `withTenantTx(coOpId: string, fn: (tx) => Promise<T>): Promise<T>` — **INTERNAL, not re-exported from the `/platform` package index.** A bare-string helper carries no provenance, so it is kept module-private; only `platform/identity/session-tx.ts` and tests import it. The **app-facing** entry point (`withSessionTx`, Task 6) is the only door app/UI code may use, and it resolves `co_op_id` from the live session before calling this. *(Fix: structurally prevents client-supplied tenant input reaching the trusted path — threat-model mode 1.)*

- [ ] **Step 1a: Generic default-deny RLS — the THREE non-anchor tables only** (`users`, `sessions`, `members`):
  ```sql
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users FORCE  ROW LEVEL SECURITY;       -- subject even for app_owner → seed must set context
  CREATE POLICY tenant_isolation ON users
    USING      (co_op_id = current_setting('app.current_co_op', true)::uuid)
    WITH CHECK (co_op_id = current_setting('app.current_co_op', true)::uuid);
  -- current_setting(..., true) → NULL when unset → predicate NULL → ZERO rows (fail-closed).
  -- NO "OR ... IS NULL" branch. Repeat verbatim for sessions and members. NOT for co_ops.
  GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, members TO app_user;
  ```
- [ ] **Step 1b: Bespoke policy for the anchor table `co_ops`** (ADR-0004 §5 carve-out — **not** the generic shape; avoids the chicken-and-egg on the first co-op insert and on seeding co-op B):
  ```sql
  ALTER TABLE co_ops ENABLE ROW LEVEL SECURITY;      -- ENABLE but do NOT FORCE:
  --   app_owner (table owner, not forced) provisions/seeds co-ops with NO tenant context;
  --   app_user stays subject to the SELECT policy below.
  CREATE POLICY tenant_self_read ON co_ops
    FOR SELECT
    USING (id = current_setting('app.current_co_op', true)::uuid);   -- a co-op reads only its OWN row
  GRANT SELECT ON co_ops TO app_user;                 -- app_user: SELECT only; co-op creation is a provisioner action at N=1
  ```
- [ ] **Step 2: Write `platform/db/internal/tenant-tx.ts`** — the chain, transaction-scoped. **Module-internal: not re-exported from the `/platform` package index** (only `platform/identity/session-tx.ts` and tests import it):
  ```ts
  // INTERNAL. App/UI code must NOT import this — use withSessionTx (Task 6).
  // Exported only for (a) the identity module and (b) tests.
  export async function withTenantTx<T>(
    coOpId: string, fn: (tx: PoolClient) => Promise<T>,
  ): Promise<T> {
    const tx = await pool.connect();          // pool connects AS app_user (LOGIN, non-superuser, no BYPASSRLS)
    try {
      await tx.query("BEGIN");
      // SET LOCAL = transaction-scoped; cannot leak across pool reuse. Parameterized: no SQLi.
      await tx.query("SELECT set_config('app.current_co_op', $1, true)", [coOpId]);
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (e) { await tx.query("ROLLBACK"); throw e; }
    finally { tx.release(); }
  }
  ```
- [ ] **Step 3: Re-apply migration to a fresh DB; smoke check.** As `app_owner`, insert co-ops A and B into `co_ops` (no context — not forced). Then `withTenantTx(A, ...)` insert one `members` row for A; confirm an A-context `SELECT * FROM members` returns it and a B-context select does not.
- [ ] **Step 4: Commit.** `git commit -m "feat(security): internal auth->RLS chain (SET LOCAL); generic policies + co_ops carve-out"`

---

## Task 5: MANDATORY fail-closed isolation invariant (TDD — §1, §8a)

This is a load-bearing wall (onboarding §2). Test is written **first**, with a **positive control** so it cannot false-green on an empty table.

**Files:**
- Create: `tests/rls/isolation.test.ts` (imports the INTERNAL `withTenantTx` + `pool` — tests are trusted callers)
- Depends on the Task 7 seed (co-op A + dormant co-op B, **each with ≥1 `members` row**). *(Author the test now against fixture ids; wire seed in Task 7.)*
- Queries `members` — a real Phase 1 table; **not** `customers` (which does not exist until a later phase).

- [ ] **Step 1: Write the failing tests — positive control FIRST.**
  ```ts
  test("positive control: co-op A context SEES co-op A's own members", async () => {
    const rows = await withTenantTx(COOP_A, (tx) =>
      tx.query("SELECT id FROM members"));        // A-context: only A's rows visible
    expect(rows.rowCount).toBeGreaterThan(0);     // rows DO exist for A
  });
  test("isolation: co-op A context sees NONE of co-op B's members", async () => {
    const rows = await withTenantTx(COOP_A, (tx) =>
      tx.query("SELECT id FROM members WHERE co_op_id = $1", [COOP_B]));
    expect(rows.rowCount).toBe(0);
  });
  test("fail-closed: no tenant context returns zero rows (though rows exist)", async () => {
    const tx = await pool.connect();              // NO set_config — context unset
    const rows = await tx.query("SELECT id FROM members");
    tx.release();
    expect(rows.rowCount).toBe(0);                // HIDDEN, not absent — proven by the positive control above
  });
  ```
- [ ] **Step 2: Run, verify they fail** for the right reason (seed/tables absent) — not a false green. Run: `npx vitest run tests/rls/isolation.test.ts`
- [ ] **Step 3:** Make them pass via Task 4 policies + Task 7 seed (no test edits to force green).
- [ ] **Step 4: Run, verify PASS** — all three: A sees A's rows, A sees none of B's, no-context sees zero.
- [ ] **Step 5: Commit.** `git commit -m "test(rls): mandatory fail-closed isolation invariant + positive control"`

---

## Task 6: Auth lifecycle + the session-resolved entry point (impl §3a.1, ADR-0004 §3)

**Files:**
- Create: `platform/identity/{session,password,magic-link,invite,session-tx}.ts`

**Interfaces (server-side only; nothing client-settable):**
- `createSession(userId, coOpId) → {token}` · `resolveSession(token) → {userId, coOpId, role} | null` (live read, honors `revoked_at`/`expires_at`) · `revokeSession(token)`
- `issueInvite(byMemberId, coOpId) → token` (single-use, expiring) · `redeemInvite(token) → userId @ status='probationary'`
- `withSessionTx(sessionToken, fn: (tx, ctx:{userId,coOpId,role}) => Promise<T>) → Promise<T>` — **the SOLE app-facing DB entry point.** Resolves the live session row server-side → derives the trusted `coOpId` → calls internal `withTenantTx(coOpId, …)`. App/UI never passes a tenant id; an invalid/expired/revoked token throws **before any query runs**.

- [ ] **Step 1:** `password.ts` — argon2 `hash`/`verify`.
- [ ] **Step 2:** `session.ts` — create (insert row, signed httpOnly cookie), resolve (**reads the live session row** → revocation is immediate, impl §3a.1), revoke.
- [ ] **Step 3:** `magic-link.ts` — single-use expiring login token. `invite.ts` — worker invite (admin-issued, single-use, expiring) → redeem creates user `role='worker'`, member `status='probationary'`; transition recorded.
- [ ] **Step 4:** `session-tx.ts` — implement the door:
  ```ts
  export async function withSessionTx<T>(token: string, fn: (tx, ctx) => Promise<T>): Promise<T> {
    const s = await resolveSession(token);          // live session row — server-resolved provenance
    if (!s) throw new Error("no valid session");    // invalid/expired/revoked → throw before any query
    return withTenantTx(s.coOpId, (tx) => fn(tx, s)); // trusted coOpId only
  }
  ```
  This is the only export app code may use for tenant DB work; the Task 1 boundary check flags any app import of the internal `withTenantTx`.
- [ ] **Step 5: Tests** — revoked session resolves to `null` and `withSessionTx` throws (no query runs); redeemed invite cannot be reused; a forged/absent token never reaches a query.
- [ ] **Step 6: Commit.** `git commit -m "feat(identity): session lifecycle + withSessionTx server-resolved tenant entry point"`

---

## Task 7: Seed — one co-op + the dormant second co-op (RLS fixture)

**Files:** Create `ops/seed.ts`. The dormant co-op B is the isolation fixture; **never delete it** (onboarding §1). Seed runs as **`app_owner`**.

- [ ] **Step 1: Provision both co-ops (no tenant context — `co_ops` is not FORCEd).** As `app_owner`, INSERT co-op A and co-op B into `co_ops`. Capture their ids.
- [ ] **Step 2: Seed each co-op's rows UNDER ITS OWN context** (so the generic `WITH CHECK` passes under FORCE — exercising the real policy path, making the fixture itself evidence the policy works):
  ```ts
  await withTenantTx(COOP_A, async (tx) => {        // co-op A: admin user + member
    const u = await insertUser(tx, COOP_A, "admin", "a-admin@example.test");
    await insertMember(tx, COOP_A, u.id, "member");
  });
  await withTenantTx(COOP_B, async (tx) => {        // dormant co-op B: one user + one member
    const u = await insertUser(tx, COOP_B, "worker", "b-worker@example.test");
    await insertMember(tx, COOP_B, u.id, "member"); // enough to PROVE isolation hides EXISTING rows
  });
  ```
- [ ] **Step 3:** Export `COOP_A`, `COOP_B` (and the A member id) as fixtures for the Task 5 tests.
- [ ] **Step 4:** Run `OWNER_DATABASE_URL=... npx tsx ops/seed.ts`; confirm the three Task 5 tests pass green.
- [ ] **Step 5: Commit.** `git commit -m "ops: seed co-op A + dormant co-op B (members rows) isolation fixture"`

---

## Task 8: Backups + restore drill (impl §3 — "the single most important line")

**Files:**
- Create: `ops/backup/pgbackrest.conf`, `ops/backup/restore-drill.sh`, `ops/backup/verify-suite.sql`, `ops/runbook.md`

**Interfaces:**
- Produces: a drill that **exits non-zero** (→ pages) on a bad/empty/skipped restore.

- [ ] **Step 1:** `pgbackrest.conf` — stanza, `repo1-cipher-type=aes-256-cbc` (encrypted at rest), repo on B2/Storage Box (off-box), retention (daily 30 / weekly 12 / monthly 12). Enable WAL archiving toward RPO ≤ 5 min.
- [ ] **Step 2:** `verify-suite.sql` — post-restore assertions: expected row counts; **RLS still isolates** (A-context sees 0 of B's `members`); (later) pricing breakdown sums.
- [ ] **Step 3:** `restore-drill.sh` — restore **latest** backup into the `scratch` compose instance → run `verify-suite.sql` → **non-zero exit on any failure _or_ if no fresh backup exists** (skipped = failed) → emit a structured event with `co_op_id`/severity/trace id; CI step pages on-call.
- [ ] **Step 4:** `ops/runbook.md` — how to restore, fail over, rotate the cert, **who is paged and on what channel** (std §7 — a name, not "a human").
- [ ] **Step 5: Run the drill locally** (onboarding §3): backup → restore to scratch (**never the working DB**) → verify PASS.
- [ ] **Step 6: Reproducible-rebuild check** (impl §3.6): on a clean volume, `docker compose up` + `migrations` + `restore` = working system.
- [ ] **Step 7: Commit.** `git commit -m "ops: pgBackRest off-site encrypted backups + paging restore drill + runbook"`

---

## Task 9: CI gates (std §2)

**Files:** Create `.github/workflows/fast-gate.yml`, `.github/workflows/heavy-gate.yml`

- [ ] **Step 1: Fast gate (every PR, all must pass to merge):** (1) strict typecheck, (2) lint + import-ban + `check-boundaries.ts`, (3) unit + integration incl. `tests/rls/isolation.test.ts`, (4) fast verification queries (RLS isolation vs seeded co-op B).
- [ ] **Step 2: Heavy gate (nightly + pre-release):** full restore drill to scratch + verify suite; a **failed or skipped drill pages** (std §2/§7). Export round-trip stub (wired fully at step 8 of the build order).
- [ ] **Step 3:** Open a deliberate-violation PR (a `/platform→/sectors` import) → confirm fast gate **blocks merge**. Revert.
- [ ] **Step 4: Commit.** `git commit -m "ci: fast gate (typecheck/import-ban/RLS) + heavy gate (restore drill)"`

---

## Definition of Done — Phase 1 (std §3)

- [ ] Fail-closed RLS isolation test green in the fast gate — **positive control** (A sees A's `members`), isolation (A sees 0 of B's), fail-closed (no-context sees 0 though rows exist).
- [ ] `/platform → /sectors` import + a secretly-cleaning-specific `/platform` module + an app import of internal `withTenantTx` all fail CI.
- [ ] App connects as **non-superuser, non-BYPASSRLS** `app_user`; the **only** app-facing DB door is `withSessionTx`, which sets `SET LOCAL` tenant context from the **live session row** (internal string helper is not app-importable).
- [ ] A restore drill **has passed** from off-site encrypted backup onto a scratch box; runbook names who is paged.
- [ ] Reproducible rebuild proven once (`compose up` + migrate + restore).
- [ ] All money columns (when introduced) integer cents; all timestamps UTC.
- [ ] PR checklist (§5) completed; runbook updated; ADR-0004 merged ahead of code.

## Self-review notes (against the specs)
- **Coverage:** impl §7.1 (Foundation), §3 (durability), §3a (auth→RLS), §3a.1 (lifecycle), §8a (RLS + boundary tests), std §0/§1/§2/§3/§7 — all mapped to Tasks 0–9. Steps 2–8 features are intentionally **out of Phase 1** (forward map only) to honor "do not broaden scope".
- **Deferred & flagged, not lost:** `webhook_events` tenancy decision → step 5; CPA/counsel → §9; federation → §9. (See threat-model "Deferred".)
- **Density:** load-bearing tasks carry full code/SQL; scaffolding carries file lists + commands — deliberate per std §1, not a placeholder gap.

## Revision log (v2) — the eight review fixes
1. **`customers` test/seed mismatch →** Task 5 + Task 7 now use `members` (a real Phase 1 table). No `customers`; foundation scope not broadened.
2. **`app_user` role contradiction →** one pattern chosen (ADR-0004 §4): app connects directly as `app_user` (`LOGIN, NOSUPERUSER, NOBYPASSRLS`); `app_owner` owns/migrates/seeds. Role def, connection strings, and comments aligned.
3. **Entry-point provenance →** string-taking `withTenantTx` is internal/non-exported; sole app door is `withSessionTx`, resolving `co_op_id` from the live session (Task 4 + Task 6, ADR-0004 §3); boundary check flags app imports of the internal helper.
4. **`co_ops.co_op_id` self-reference →** removed; `co_ops` is keyed by its own `id` (Task 3, ADR-0004 §5).
5. **`co_ops` chicken-and-egg →** bespoke `ENABLE`-not-`FORCE`, SELECT-only policy; provisioning via `app_owner` without context (Task 4 §1b, ADR-0004 §5) — explicit exception to the verbatim rule.
6. **Fail-closed false-green →** positive control added: prove A sees A's rows, then prove no-context sees zero (Task 5).
7. **citext extension →** `CREATE EXTENSION IF NOT EXISTS citext;` precedes use (Task 3).
8. **Email uniqueness →** `UNIQUE (co_op_id, email)` — per-tenant, not global (Task 3).
