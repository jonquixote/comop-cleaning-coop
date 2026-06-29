# ADR-0002: Tenancy is Default-Deny — every table tenant-scoped under RLS unless explicitly excepted

- **Status:** Accepted
- **Date:** genesis (N=1)
- **Context:** The app runs a single co-op now but must become a federation of co-ops by *addition, not rewrite*. Tenant isolation is provided by a `co_op_id` column on platform tables plus PostgreSQL Row-Level Security (Supabase). Isolation also implements a constitutional guarantee from the federation design: **a co-op may exit with its own data** (`select where co_op_id = X`). The failure mode is asymmetric — a table that should be tenant-scoped accidentally being global is a cross-co-op **data leak** (one co-op seeing another's customers, the exact thing sovereignty and exit exist to prevent); the reverse error (over-scoping) is merely wasteful.

## Decision
**Isolation is the default; sharing is the exception that must justify itself.**
- **Every table is tenant-scoped under RLS by default**, carrying `co_op_id` and an RLS policy restricting rows to the current tenant — *from the first commit, with one co-op.*
- A table becomes **global** only by **explicit, reviewed exception**, recorded in this ADR's appendix. The global set is intentionally tiny and obvious.

### Approved global (non-tenant) tables
- `sector_registry` — the list of sectors and their adapters
- `system_config` — platform-wide configuration
- `service_category_taxonomy` — shared service-category reference data

(Any addition to this list is an amendment to this ADR and requires review.)

## Consequences
- A careless `CREATE TABLE` is **safe by default** (tenant-scoped); only a deliberate, visible decision can open a cross-tenant hole.
- When node #2 arrives, multi-tenant isolation is **already enforced by the database** — no retrofit. Adding a tenant is inserting a row into `co_ops`, not building a tenancy layer.
- Data portability / exit is a clean per-tenant export, not a forensic untangling.
- Future "platform admin" surfaces must **not** bypass RLS to read across tenants except through an explicit, audited path — admin convenience does not override isolation.
