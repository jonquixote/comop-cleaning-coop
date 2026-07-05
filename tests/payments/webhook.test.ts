// Stripe webhook processing (ADR-0012) — the money logic behind POST /api/webhook, tested
// headlessly: synthetic (already-verified) events + an injected tenant runner so capture runs
// inside a rollback-isolated tx. Signature verification itself lives in the route and is a thin
// call to the Stripe SDK; here we prove the verify->resolve->capture->result behavior.
import { describe, test, expect, afterAll } from "vitest";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "../../platform/db/internal/tenant-tx";
import {
  extractCaptureIntent,
  processStripeEvent,
  type TenantRunner,
} from "../../platform/payments/webhook";
import { PaymentError } from "../../platform/payments/stripe";
import { COOP_A } from "../../ops/fixtures";

afterAll(async () => {
  await pool.end();
});

async function withRollback(coOpId: string, fn: (tx: PoolClient) => Promise<void>): Promise<void> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('app.current_co_op', $1, true)", [coOpId]);
    await fn(tx);
  } finally {
    await tx.query("ROLLBACK");
    tx.release();
  }
}

// Runner that executes capture inside the test's already-open, context-set rollback tx.
const runnerFor = (tx: PoolClient): TenantRunner => (_coOpId, fn) => fn(tx);

async function seedJob(tx: PoolClient, status: string, finalPrice: number | null): Promise<string> {
  const cust = await tx.query("INSERT INTO customers (co_op_id, contact) VALUES ($1,$2) RETURNING id", [
    COOP_A,
    "webhook-test",
  ]);
  const pol = await tx.query(
    `INSERT INTO policy_settings (co_op_id, key, value_json) VALUES ($1,'surplus_split','{"fraction":0.2}') RETURNING id`,
    [COOP_A],
  );
  const job = await tx.query(
    `INSERT INTO jobs (co_op_id, customer_id, sector, status, quoted_price_cents,
                       final_price_cents, policy_version_id, breakdown_json)
     VALUES ($1,$2,'cleaning',$3,200,$4,$5,'{}') RETURNING id`,
    [COOP_A, cust.rows[0].id, status, finalPrice, pol.rows[0].id],
  );
  return job.rows[0].id as string;
}

function succeededEvent(o: {
  coOpId?: string;
  jobId?: string;
  intentId: string;
  chargeId?: string | { id: string } | null;
}): Stripe.Event {
  return {
    id: `evt_${o.intentId}`,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: o.intentId,
        object: "payment_intent",
        metadata: { co_op_id: o.coOpId, job_id: o.jobId },
        latest_charge: o.chargeId ?? null,
      },
    },
  } as unknown as Stripe.Event;
}

describe("extractCaptureIntent", () => {
  test("ignores non-succeeded event types", () => {
    const e = { type: "payment_intent.created", data: { object: {} } } as unknown as Stripe.Event;
    expect(extractCaptureIntent(e)).toBeNull();
  });

  test("returns null when co_op_id / job_id metadata is missing", () => {
    expect(extractCaptureIntent(succeededEvent({ intentId: "pi_1" }))).toBeNull();
  });

  test("extracts ids; latest_charge as a string is the charge id", () => {
    const r = extractCaptureIntent(
      succeededEvent({ coOpId: COOP_A, jobId: "job-1", intentId: "pi_2", chargeId: "ch_str" }),
    );
    expect(r).toEqual({ coOpId: COOP_A, jobId: "job-1", paymentIntentId: "pi_2", chargeId: "ch_str" });
  });

  test("latest_charge as an expanded object uses its id; null charge is allowed", () => {
    expect(
      extractCaptureIntent(
        succeededEvent({ coOpId: COOP_A, jobId: "j", intentId: "pi_3", chargeId: { id: "ch_obj" } }),
      )?.chargeId,
    ).toBe("ch_obj");
    expect(
      extractCaptureIntent(succeededEvent({ coOpId: COOP_A, jobId: "j", intentId: "pi_4", chargeId: null }))
        ?.chargeId,
    ).toBeNull();
  });
});

describe("processStripeEvent", () => {
  test("payment_intent.succeeded -> job paid, webhook_events row, charge id written", async () => {
    await withRollback(COOP_A, async (tx) => {
      const jobId = await seedJob(tx, "done", 200);
      const ev = succeededEvent({ coOpId: COOP_A, jobId, intentId: "pi_ok", chargeId: "ch_ok" });

      const res = await processStripeEvent(ev, runnerFor(tx));
      expect(res).toEqual({ handled: true, captured: true });

      const job = await tx.query("SELECT status, stripe_charge_id FROM jobs WHERE id=$1", [jobId]);
      expect(job.rows[0].status).toBe("paid");
      expect(job.rows[0].stripe_charge_id).toBe("ch_ok");

      const wh = await tx.query("SELECT count(*)::int AS n FROM webhook_events WHERE stripe_event_id=$1", [
        "pi_ok",
      ]);
      expect(wh.rows[0].n).toBe(1);
      const pay = await tx.query("SELECT count(*)::int AS n, max(amount_cents) AS amt FROM payments WHERE job_id=$1", [
        jobId,
      ]);
      expect(pay.rows[0].n).toBe(1);
      expect(pay.rows[0].amt).toBe(200); // settled amount from the job, never from the event
    });
  });

  test("duplicate delivery -> second is a no-op (captured:false), one webhook_events row", async () => {
    await withRollback(COOP_A, async (tx) => {
      const jobId = await seedJob(tx, "done", 200);
      const ev = succeededEvent({ coOpId: COOP_A, jobId, intentId: "pi_dupe", chargeId: "ch_d" });

      const first = await processStripeEvent(ev, runnerFor(tx));
      expect(first.captured).toBe(true);
      const second = await processStripeEvent(ev, runnerFor(tx));
      expect(second).toEqual({ handled: true, captured: false });

      const wh = await tx.query("SELECT count(*)::int AS n FROM webhook_events WHERE stripe_event_id=$1", [
        "pi_dupe",
      ]);
      expect(wh.rows[0].n).toBe(1);
      const job = await tx.query("SELECT status FROM jobs WHERE id=$1", [jobId]);
      expect(job.rows[0].status).toBe("paid");
    });
  });

  test("succeeded for a job not in 'done' -> throws PaymentError, job not transitioned", async () => {
    await withRollback(COOP_A, async (tx) => {
      const jobId = await seedJob(tx, "quoted", null);
      const ev = succeededEvent({ coOpId: COOP_A, jobId, intentId: "pi_bad", chargeId: "ch_b" });

      await expect(processStripeEvent(ev, runnerFor(tx))).rejects.toBeInstanceOf(PaymentError);

      const job = await tx.query("SELECT status FROM jobs WHERE id=$1", [jobId]);
      expect(job.rows[0].status).toBe("quoted");
      const pay = await tx.query("SELECT count(*)::int AS n FROM payments WHERE job_id=$1", [jobId]);
      expect(pay.rows[0].n).toBe(0);
    });
  });

  test("unhandled event type -> no-op, no throw", async () => {
    const e = { type: "charge.refunded", data: { object: {} } } as unknown as Stripe.Event;
    const res = await processStripeEvent(e, () => {
      throw new Error("runner should not be called for an unhandled event");
    });
    expect(res.handled).toBe(false);
  });
});
