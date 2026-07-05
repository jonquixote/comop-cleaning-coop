// Stripe webhook processing (platform, sector-agnostic). Given an ALREADY-VERIFIED Stripe
// event (the signature is checked at the route, apps/customer-web/.../api/webhook), turn a
// payment_intent.succeeded into a capturePayment call. Tenant identity comes from the signed
// event metadata (ADR-0012). Minimal by design: only payment_intent.succeeded is handled;
// every other event type is a no-op. Runs capture inside the event's own tenant context.
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { withTenantTx } from "../db/internal/tenant-tx";
import { capturePayment } from "./stripe";

export interface CaptureIntent {
  coOpId: string;
  jobId: string;
  paymentIntentId: string;
  chargeId: string | null;
}

/**
 * Pure: extract the capture coordinates from a payment_intent.succeeded event, or null if this
 * is not a capture we handle (wrong event type, or the PaymentIntent lacks our metadata). The
 * metadata is set by our own server when the PaymentIntent is created; because the event is
 * signature-verified, it is trustworthy.
 */
export function extractCaptureIntent(event: Stripe.Event): CaptureIntent | null {
  if (event.type !== "payment_intent.succeeded") return null;
  const pi = event.data.object as Stripe.PaymentIntent;
  const coOpId = pi.metadata?.co_op_id;
  const jobId = pi.metadata?.job_id;
  if (!coOpId || !jobId) return null;
  const chargeId =
    typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);
  return { coOpId, jobId, paymentIntentId: pi.id, chargeId };
}

// Injectable so tests can run capture inside a rollback-isolated tx; defaults to the real
// tenant transaction. Shape matches withTenantTx.
export type TenantRunner = <T>(coOpId: string, fn: (tx: PoolClient) => Promise<T>) => Promise<T>;

export interface WebhookResult {
  handled: boolean;
  captured?: boolean;
  reason?: string;
}

/**
 * Process a verified event: resolve the job from metadata and capture under that tenant's
 * context. May throw PaymentError (e.g. the job is not settled) — the route catches it and
 * still returns 200 so Stripe stops retrying an event that will never succeed.
 */
export async function processStripeEvent(
  event: Stripe.Event,
  runner: TenantRunner = withTenantTx,
): Promise<WebhookResult> {
  const intent = extractCaptureIntent(event);
  if (!intent) return { handled: false, reason: `unhandled event: ${event.type}` };
  const res = await runner(intent.coOpId, (tx) =>
    capturePayment(tx, intent.coOpId, intent.jobId, intent.paymentIntentId, intent.chargeId),
  );
  return { handled: true, captured: res.captured };
}
