# ADR-0004: Stack & Trust-Chain Decisions — self-hosted Postgres, session-resolved tenancy, `co_ops` carve-out

- **Status:** Accepted
- **Date:** 2026-06-29 (N=1, pre-Phase-1)
- **Context:** Two binding spec sets disagree on the stack, and the Phase 1 plan review surfaced three trust-chain/schema decisions that must be fixed **before the first migration makes them permanent.** This ADR records all of them under the §4 ADR tax (the design artifact lands before code). It is the deliberate, visible decision the standard demands instead of an ad-hoc choice in a migration file.

## Decisions

### 1. Self-hosted PostgreSQL — no Supabase, no managed platform
The service-spec ("build spec", "federation design") names **Supabase**. The builder implementation spec §2 overrides it: *"zero dependency on Supabase or any managed platform."* ADR-0001/0002/0003 are stack-agnostic (Postgres RLS, not Supabase RLS). **Decision:** self-hosted PostgreSQL on a single VPS (Hetzner-class), Docker/compose, committed migrations, pgBackRest → B2/Storage Box. Where the two spec sets conflict, **the builder implementation spec is the authority** ("what to build" vs the service-spec's "how").

### 2. Auth specified by property, not brand
Session auth: magic-link + password; sessions are **server-side Postgres rows**, revocable (live read). Specified by property so the monument is not anchored to one library (deprecation risk). **Default implementation:** a thin hand-rolled session layer — sessions table + signed httpOnly cookie + argon2 hashing. Any concrete dependency is chosen at implementation time after a maintenance check.

### 3. Tenant identity is server-resolved at the entry point (provenance, not convention)
The string-taking helper `withTenantTx(coOpId, fn)` is **internal and not re-exported** from the `/platform` package; only the identity module and tests may import it. The **sole app-facing** DB door is `withSessionTx(sessionToken, fn)`, which resolves `co_op_id` from the **live session row** and only then sets `SET LOCAL app.current_co_op`. **Rationale:** a bare-string entry point lets a future caller pass client-controlled tenant input into the trusted path — exactly the core RLS vulnerability in the threat model. Making provenance structural (the only callable path resolves from the session) removes the foot-gun. A CI boundary check flags any `/apps/**` import of the internal helper.

### 4. App connects as `app_user`; migrations/seed as `app_owner`
The app connects **directly as `app_user`** — `LOGIN, NOSUPERUSER, NOBYPASSRLS`, DML grants only. Migrations and seed/provisioning run as **`app_owner`** (owns the tables). **Invariant:** the runtime app role is never superuser and never holds `BYPASSRLS`. This resolves the earlier `NOLOGIN`-but-"connects-as" contradiction by choosing one pattern and making the role definition, connection strings (`APP_DATABASE_URL` vs `OWNER_DATABASE_URL`), and code comments all match it.

### 5. `co_ops` is the tenant anchor — bespoke policy, no `co_op_id` column (the carve-out)
**Status: LOCKED (2026-06-29).** Chosen deliberately over the `FORCE`-with-explicit-provisioning-policy alternative; the migration (plan Tasks 3–4) implements exactly the policy below — no ambiguity is to be (re)introduced at migration time.

`co_ops` is keyed by its own `id`; it carries **no `co_op_id` column** (removing an unconstrained self-reference that nothing enforced). Its RLS is **bespoke, not the generic copy-paste** applied to the other tables:
- `ENABLE` RLS but **do not `FORCE`** — so `app_owner` (table owner) can provision/seed co-ops **without** a tenant context. This resolves the chicken-and-egg on the very first co-op insert and on seeding the dormant second co-op.
- `app_user` policy: `FOR SELECT USING (id = current_setting('app.current_co_op', true)::uuid)` — a co-op reads only its own row; **SELECT only** (co-op creation is a provisioner action at N=1, not an app-user action).

The three non-anchor tables (`users`, `sessions`, `members`) keep `ENABLE` + `FORCE` + the generic `co_op_id = current_setting('app.current_co_op', true)::uuid` policy with `WITH CHECK`. **This is the explicit exception** to "repeat the same policy verbatim across all four tables."

## Consequences
- `co_ops` is a structural exception to ADR-0002's "every table carries `co_op_id`" — the anchor keys on `id`. It is **not** a global table; it remains tenant-isolated, just by a different column. Recorded here so the carve-out is deliberate and visible, per ADR-0002's "only a reviewed exception opens a deviation."
- Seeding exercises the real policy path (context set per co-op under `FORCE`), so the fixture itself is evidence the `WITH CHECK` works.
- App/UI code importing the internal `withTenantTx` is a boundary violation (lint/boundary-checked), keeping the session-resolved path the only door.
- A future "platform admin" cross-tenant read still goes through a separate audited role/path (ADR-0002) — never by relaxing these policies or granting the app role `BYPASSRLS`.
