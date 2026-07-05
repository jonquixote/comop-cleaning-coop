# ADR-0012: Stripe webhook endpoint + SDK for payment capture

- **Status:** Accepted
- **Date:** 2026-07-04
- **Context:** Phase 1 shipped `capturePayment` (`platform/payments/stripe.ts`) as a DB-only seam: it takes a Stripe PaymentIntent id + charge id as parameters and drives the idempotency ledger (`webhook_events` UNIQUE(stripe_event_id)) + `payments` row. Nothing HTTP-facing ever called it — there was no `/api/webhook` route and no `stripe` dependency, so a real Stripe delivery had nowhere to land. This ADR adds the receiving half: a signature-verified webhook endpoint that turns a genuine `payment_intent.succeeded` event into a `capturePayment` call.

## Decision

1. **Add the official `stripe` SDK** (workspace root, alongside `pg`/`next`). It is used for exactly one thing here: `stripe.webhooks.constructEvent(rawBody, sig, secret)` — signature verification. Rolling our own HMAC over the signed payload is a security boundary we decline to hand-implement (constant-time compare, timestamp tolerance, scheme versioning are easy to get subtly wrong). No Stripe API calls are made from the webhook path.
2. **`POST /api/webhook`** (`apps/customer-web/src/app/api/webhook/route.ts`) is the only endpoint. It reads the **raw** request body (signature verification requires the exact bytes), verifies the signature against `STRIPE_WEBHOOK_SECRET`, and on success hands the typed event to `processStripeEvent` (`platform/payments/webhook.ts`). Flow, deliberately minimal: **verify → resolve job → `capturePayment` → 200.**
3. **Tenant identity comes from the signed event's metadata.** The PaymentIntent carries `metadata.co_op_id` + `metadata.job_id` (set by our own server when the intent is created). Because the whole payload is signature-verified as genuinely from Stripe, that metadata is trustworthy — it is what we put there, unforgeable without the webhook secret. `processStripeEvent` runs `capturePayment` inside `withTenantTx(co_op_id, …)`; `capturePayment`'s own `WHERE id=job AND co_op_id=…` predicate fails closed if the pair is inconsistent.
4. **HTTP contract:** bad/absent signature → **400** (reject the forgery). Everything past verification returns **200** — success, a duplicate delivery (`captured:false`), an unhandled event type, or a caught `PaymentError` (e.g. the job is not `done`). A 200 tells Stripe to stop retrying an event that will never succeed; transient failures (DB down) surface as **500** so Stripe *does* retry.

## Consequences

- Idempotency is unchanged and unduplicated: replays hit `webhook_events` UNIQUE(stripe_event_id) inside `capturePayment` (ADR-0007), so a second delivery is a no-op. The webhook adds no new idempotency mechanism.
- The endpoint never trusts an amount from the event — `capturePayment` reads the settled `final_price_cents` off the job. Money is not client-/Stripe-controlled.
- **Threat model (this endpoint):** (a) *forged webhook* → signature verification with the secret + raw body rejects it (400); (b) *cross-tenant capture* → metadata tenant is signed, and `capturePayment`'s co_op_id predicate fails closed on mismatch; (c) *replay* → UNIQUE(stripe_event_id) no-op; (d) *wrong-state capture* → `PaymentError` caught, 200, job untouched. `STRIPE_WEBHOOK_SECRET` is required; without it the route rejects all deliveries (fail closed).
- **Out of scope (not built here):** creating the PaymentIntent with that metadata at checkout (the *initiation* half) is a separate feature. Until it exists, a bare `stripe trigger` produces events without our metadata, which this endpoint correctly treats as unhandled (200, no capture). The engine survives that; end-to-end "job → paid" needs the initiation half.
- ADR-0004's "don't build card processing; Stripe holds PCI" is unchanged — we added a thin, replaceable integration, not a processor.
