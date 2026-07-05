// Scenario: duplicate webhook delivery is a no-op (existing Phase 1 behavior).
//
// Run:  set -a; source .env; set +a; pnpm exec tsx tests/scenarios/duplicate-webhook.ts
//       KEEP_TRACE=1 pnpm exec tsx tests/scenarios/duplicate-webhook.ts   # skip cleanup
//
// Unlike the vitest suite this is NOT rollback-isolated — it COMMITS against the dev DB so
// it exercises the real capture path (webhook_events UNIQUE(stripe_event_id) idempotency).
// It fires capturePayment twice with the same stripePaymentIntentId and asserts:
//   1st call  -> captured:true,  job 'paid', exactly one webhook_events row
//   2nd call  -> captured:false (no-op), job still 'paid', still exactly one webhook_events row
// It prints the rows it created (the inspectable trace) and, unless KEEP_TRACE=1, deletes its
// own fixtures afterward so it is re-runnable. Verdict is a clear PASS/FAIL + exit code.
import { Client } from "pg";
import { withTenantTx, pool } from "../../platform/db/internal/tenant-tx";
import { createCleaningBooking } from "../../sectors/cleaning/booking";
import { capturePayment } from "../../platform/payments/stripe";
import { COOP_A } from "../../ops/fixtures";

const KEEP = process.env.KEEP_TRACE === "1";
// Unique per run so re-runs never collide on webhook_events UNIQUE(stripe_event_id).
const INTENT = `pi_scenario_dupe_${Date.now()}`;
const CHARGE = `ch_scenario_${Date.now()}`;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  let jobId = "";
  let customerId = "";
  try {
    await withTenantTx(COOP_A, async (tx) => {
      const cust = await tx.query(
        "INSERT INTO customers (co_op_id, contact) VALUES ($1,$2) RETURNING id",
        [COOP_A, "dupe-webhook-scenario"],
      );
      customerId = cust.rows[0].id as string;
      await tx.query(
        `INSERT INTO policy_settings (co_op_id, key, value_json)
         VALUES ($1,'surplus_split','{"fraction":0.2}')`,
        [COOP_A],
      );
      const booked = await createCleaningBooking(tx, COOP_A, {
        customerId,
        details: { sqft: 1000, bedrooms: 2, bathrooms: 1, addons: [] },
      });
      jobId = booked.jobId;
      await tx.query(
        "UPDATE jobs SET status='done', final_price_cents=quoted_price_cents WHERE id=$1",
        [jobId],
      );

      // --- first delivery: real capture ---
      const first = await capturePayment(tx, COOP_A, jobId, INTENT, CHARGE);
      assert(first.captured === true, `1st delivery should capture; got captured=${first.captured}`);

      // --- duplicate delivery: same intent id -> no-op ---
      const second = await capturePayment(tx, COOP_A, jobId, INTENT, CHARGE);
      assert(second.captured === false, `2nd delivery must be a no-op; got captured=${second.captured}`);

      const job = await tx.query("SELECT status, stripe_charge_id FROM jobs WHERE id=$1", [jobId]);
      assert(job.rows[0].status === "paid", `job should be 'paid'; got '${job.rows[0].status}'`);
      assert(job.rows[0].stripe_charge_id === CHARGE, "stripe_charge_id should be written");

      const wh = await tx.query(
        "SELECT count(*)::int AS n FROM webhook_events WHERE stripe_event_id=$1",
        [INTENT],
      );
      assert(wh.rows[0].n === 1, `exactly one webhook_events row expected; got ${wh.rows[0].n}`);

      const pay = await tx.query("SELECT count(*)::int AS n FROM payments WHERE job_id=$1", [jobId]);
      assert(pay.rows[0].n === 1, `exactly one payments row expected; got ${pay.rows[0].n}`);

      console.log("trace (committed rows):");
      console.log(`  job_id           = ${jobId}  (status=paid)`);
      console.log(`  stripe_intent_id = ${INTENT}`);
      console.log(`  stripe_charge_id = ${CHARGE}`);
      console.log(`  webhook_events   = 1 row, payments = 1 row`);
    });

    console.log("\nVERDICT: PASS — duplicate delivery is a no-op; no double-charge, no duplicate ledger row.");
  } finally {
    if (jobId && !KEEP) {
      // Several of these tables are append-only for app_user (no DELETE grant: payments,
      // webhook_events, payout_ledger). Cleanup runs as app_owner (owns the tables) with the
      // tenant context set so FORCE-RLS policies still pass — an admin/drill path, not the app.
      const owner = new Client({ connectionString: process.env.OWNER_DATABASE_URL });
      await owner.connect();
      try {
        await owner.query("BEGIN");
        await owner.query("SELECT set_config('app.current_co_op', $1, true)", [COOP_A]);
        // FK-safe delete order (children first).
        await owner.query("DELETE FROM payments WHERE job_id=$1", [jobId]);
        await owner.query("DELETE FROM webhook_events WHERE job_id=$1", [jobId]);
        await owner.query("DELETE FROM job_cleaning_checklists WHERE job_id=$1", [jobId]);
        await owner.query("DELETE FROM payout_ledger WHERE job_id=$1", [jobId]);
        await owner.query("DELETE FROM job_cleaning_details WHERE job_id=$1", [jobId]);
        await owner.query("DELETE FROM jobs WHERE id=$1", [jobId]);
        if (customerId) await owner.query("DELETE FROM customers WHERE id=$1", [customerId]);
        await owner.query("COMMIT");
      } catch (e) {
        await owner.query("ROLLBACK");
        throw e;
      } finally {
        await owner.end();
      }
      console.log("cleanup: fixtures removed (re-runnable). Use KEEP_TRACE=1 to retain them.");
    } else if (KEEP) {
      console.log("KEEP_TRACE=1: fixtures left in place for inspection.");
    }
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(`\nVERDICT: FAIL — ${err instanceof Error ? err.message : String(err)}`);
    await pool.end();
    process.exit(1);
  });
