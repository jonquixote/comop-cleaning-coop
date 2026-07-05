// POST /api/webhook — Stripe webhook receiver (ADR-0012). The ONLY thing this route does:
// verify the Stripe signature over the raw body, then hand the verified event to
// processStripeEvent (which resolves the job from signed metadata and calls capturePayment).
//
// Contract:
//   - missing/invalid signature (or unconfigured secret) -> 400 (reject; fail closed)
//   - handled + captured, duplicate delivery (captured:false), unhandled type, or a caught
//     PaymentError (job not in a capturable state) -> 200 (Stripe stops retrying)
//   - unexpected error (e.g. DB down) -> 500 (Stripe retries)
import Stripe from "stripe";
import { processStripeEvent } from "@comop/platform/payments/webhook";
import { PaymentError } from "@comop/platform/payments/stripe";

// Stripe's SDK + raw-body reading need the Node runtime, not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
// constructEvent verifies with the webhook secret, not the API key; the key is only needed if
// we ever call the Stripe API from here (we don't). Empty is fine at construction.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export async function POST(req: Request): Promise<Response> {
  if (!webhookSecret) {
    console.error("webhook: STRIPE_WEBHOOK_SECRET is unset — rejecting delivery (fail closed)");
    return new Response("webhook not configured", { status: 400 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing stripe-signature header", { status: 400 });

  // Signature verification requires the EXACT raw bytes — never a parsed/re-serialized body.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (err) {
    console.error(`webhook: signature verification failed — ${err instanceof Error ? err.message : String(err)}`);
    return new Response("invalid signature", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof PaymentError) {
      // Not transient — the job isn't in a capturable state (e.g. not 'done'). Log + 200 so
      // Stripe stops retrying an event that will never succeed; the job is left untouched.
      console.error(`webhook: capture skipped for event ${event.id} — ${err.message}`);
      return Response.json({ received: true, captured: false, error: err.message });
    }
    console.error(`webhook: unexpected error for event ${event.id} — ${err instanceof Error ? err.message : String(err)}`);
    return new Response("internal error", { status: 500 });
  }
}
