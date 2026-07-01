# ADR-0009: Export/import — dynamic table discovery + deterministic UUID re-mapping

- **Status:** Accepted
- **Date:** 2026-06-30 (build-order step 8, before code)
- **Context:** The exit right is a per-tenant export that re-imports into a *fresh* co-op. Three re-mapping ambiguities must be resolved first: how `stripe_event_id` global uniqueness survives a re-import, how `set_by_proposal_id` (and other) FK chains reconstruct, and how re-import stays idempotent (importing twice must not double rows).

## Decisions

1. **Dynamic tenant-table discovery (sector-agnostic).** `exportCoOpData` discovers every table with a `co_op_id` column (plus the `co_ops` anchor) from the catalog, **excludes** the ADR-0002 globals (`sector_registry`, `system_config`, `service_category_taxonomy`) and `schema_migrations`, and topo-sorts them FK-safe. The platform export **names no sector table** (ADR-0001) — a new sector's extension table exports automatically. *(A hardcoded list naming `job_cleaning_details` in `/platform` would be platform knowing a sector's schema — an ADR-0001 smell that passes the boundary grep only on an underscore technicality. Discovery avoids it.)*

2. **Consistent UUID re-map; `co_op_id` → `newCoOpId`.** Import builds an old→new uuid map pre-seeded with `{sourceCoOpId → newCoOpId}`. Every uuid-valued **top-level** column (PKs and FKs alike) passes through it. Because a FK value equals some PK value, the same old uuid maps to the same new uuid everywhere → FK chains (`set_by_proposal_id`, `policy_version_id`, `job_id`, …) reconstruct automatically. `co_op_id` and `co_ops.id` (both = `sourceCoOpId`) map to `newCoOpId`.

3. **Deterministic remap (uuidv5-style) for idempotency.** The new uuid is a deterministic function of `(newCoOpId, oldUuid)` (sha1-derived, v5-shaped). Re-importing the same document as the same co-op yields identical new uuids → PK conflict → `ON CONFLICT DO NOTHING` → no duplicate rows. **Importing twice is safe.**

4. **Text natural keys (e.g. `stripe_event_id`) are NOT remapped.** They are idempotency/business keys, not entity ids. Into a *fresh* co-op they cannot collide; `ON CONFLICT DO NOTHING` covers re-import and any incidental collision. The same real Stripe event remains the same event.

5. **`jsonb` is opaque.** `breakdown_json` / `value_json` / `transparency_snapshot_json` are frozen denormalized snapshots; internal id copies (e.g. a `policy_version_id` embedded in `breakdown_json`) are historical, not live FKs, and are **not** deep-remapped. All *live* foreign keys are top-level columns and are remapped. The round-trip invariant depends only on top-level data.

6. **`sessions` are excluded.** Sessions are transient auth credentials (server-side login state), not the co-op's data. The charter's exit right mandates machine-readable export of **customers, schedules, and history** — not login tokens. Excluding them also avoids exporting a security credential and sidesteps the global `token_hash` uniqueness (which is not a portable entity key). `schema_migrations` and the ADR-0002 globals are likewise excluded.

## Consequences
- Re-import is idempotent, FK-safe, and sector-agnostic — "the system accepts its own output."
- `verifyRoundTrip` checks the invariant on the export *documents* (row counts, payout surplus sum, per-period allocation conservation, policy-chain resolution) — never on raw ids, which legitimately change.
- A jsonb-internal id copy may still reference a pre-remap uuid; documented and out of scope for the exit-right invariant. Making those live later is an additive deep-remap change.
