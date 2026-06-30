# ADR-0007: `webhook_events` is tenant-scoped (co_op_id resolved from the payment), not global

- **Status:** Accepted
- **Date:** 2026-06-30 (build-order step 5, before any code)
- **Context:** The Stripe idempotency ledger `webhook_events` had **no `co_op_id`** in the spec's data-model sketch (§4) and is **not** on ADR-0002's approved global-tables list (`sector_registry`, `system_config`, `service_category_taxonomy`). ADR-0002 makes tenancy **default-deny**: a table is global only by explicit, reviewed exception. Step 5 (Stripe capture) needs this table, so the tenancy question must be resolved **before** `0008_webhook_events.sql`. Two options: **(A)** add `co_op_id`, keep it tenant-scoped; **(B)** declare it a global exception.

## Decision
**`webhook_events` is TENANT-SCOPED** — it carries `co_op_id` and the standard default-deny RLS policy. It is **not** added to the ADR-0002 global list.

1. **`co_op_id` is resolved server-side from the payment the event pertains to.** A Stripe event references a payment intent → a `jobs` row → its `co_op_id`. At capture time the tenant is always known (`capturePayment(tx, coOpId, jobId, …)` receives it), so there is no obstacle to tenant-scoping. This matches the auth→RLS chain (impl §3a): the server resolves the tenant from trusted data, never from client input.
2. **Global idempotency is preserved by a table-wide `UNIQUE (stripe_event_id)` constraint.** Unique constraints are enforced across *all* rows independent of RLS (the index check is not row-filtered), so a duplicate Stripe delivery conflicts and is dropped (`ON CONFLICT DO NOTHING`) regardless of tenant context. **Tenant-scoping does not weaken the exactly-once guarantee** (threat-model mode 2: duplicate delivery must never double-charge).
3. **Append-only**, like the payout ledger (std §3): `app_user` gets `SELECT + INSERT` only — never `UPDATE`/`DELETE`.

## Why not global
A co-op's payment-event stream is its financial data; exposing it across tenants is exactly the cross-co-op leak ADR-0002's asymmetry exists to prevent — and it buys nothing. The idempotency that motivates the "global" instinct is already delivered by the `UNIQUE` constraint, which works fine under RLS. Going global would trade real isolation for an imaginary benefit.

## Consequences
- `0008_webhook_events.sql` carries `co_op_id` + `ENABLE`/`FORCE` RLS + the `nullif(current_setting('app.current_co_op', true), '')::uuid` tenant-isolation policy, plus `UNIQUE (stripe_event_id)` and `GRANT SELECT, INSERT` only (no UPDATE/DELETE).
- The webhook handler resolves `co_op_id` from the event's linked payment **before** setting tenant context — a deliberate server-side step, consistent with §3a.
- ADR-0002's global list is unchanged. This ADR is the deliberate, reviewed decision ADR-0002 requires for a table that could have been mistaken for global.
