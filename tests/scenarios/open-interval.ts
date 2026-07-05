// Scenario: "forgotten clock-out" — a worker clocks in and never clocks out, leaving an
// open time interval that breaks payroll close.
//
// Run:  set -a; source .env; set +a; pnpm exec tsx tests/scenarios/open-interval.ts
//
// STATUS FOR PHASE 1: NOT IMPLEMENTED — and this script says so loudly rather than passing.
// The `time_entries` table (clock in/out actuals) is a PHASE 2 platform table; it does not
// exist in the Phase 1 schema (there is no clock-in/out, only estimateJobDuration + the
// self-reported job_assignments.hours_logged). So there is no open interval to detect and no
// alert/SLA path to trigger yet.
//
// When Phase 2 lands time_entries, this script becomes real: seed a clock-in with clock_out
// NULL, then assert the query below finds it and that the untyped_time_block / SLA path fires.
//
// Exit codes:  0 = detected an open interval (real, once Phase 2 exists)
//              2 = NOT IMPLEMENTED (the feature/table is absent) — deliberately non-zero so
//                  CI/automation never mistakes "nothing to check" for a pass.
import { pool } from "../../platform/db/internal/tenant-tx";

const OPEN_INTERVAL_HOURS = Number(process.env.OPEN_INTERVAL_HOURS ?? "8");

async function tableExists(name: string): Promise<boolean> {
  const r = await pool.query("SELECT to_regclass($1) AS reg", [name]);
  return r.rows[0].reg !== null;
}

async function main(): Promise<number> {
  if (!(await tableExists("time_entries"))) {
    console.log("VERDICT: NOT IMPLEMENTED");
    console.log("  `time_entries` does not exist — clock in/out is a Phase 2 feature.");
    console.log("  Phase 1 has no open-interval concept (no clock-out to forget).");
    console.log("  This scenario becomes runnable when Phase 2 Task 2 lands time_entries.");
    return 2;
  }

  // --- Phase 2 path (dormant until the table exists) ---
  // Detects any interval left open longer than the threshold — the forgotten clock-out.
  const r = await pool.query(
    `SELECT id, member_id, job_id, clock_in
       FROM time_entries
      WHERE clock_out IS NULL
        AND clock_in < now() - ($1 || ' hours')::interval
      ORDER BY clock_in ASC`,
    [OPEN_INTERVAL_HOURS],
  );
  if (r.rowCount === 0) {
    console.log(`VERDICT: PASS — no open interval older than ${OPEN_INTERVAL_HOURS}h.`);
    return 0;
  }
  console.log(`VERDICT: DETECTED — ${r.rowCount} open interval(s) older than ${OPEN_INTERVAL_HOURS}h:`);
  for (const row of r.rows) {
    console.log(`  time_entry ${row.id} member=${row.member_id} job=${row.job_id} clock_in=${row.clock_in?.toISOString?.() ?? row.clock_in}`);
  }
  console.log("  -> would emit untyped_time_block + fire the pay-period-close SLA alert (Phase 2 Task 2/6).");
  return 0;
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (err) => {
    console.error(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
    await pool.end();
    process.exit(1);
  });
