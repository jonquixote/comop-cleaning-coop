// Scenario: daily overtime — a worker logs 10 hours in one day; payroll close should emit an
// `ot_daily` earning-code row for the 2 hours over 8.
//
// Run:  set -a; source .env; set +a; pnpm exec tsx tests/scenarios/daily-ot.ts
//
// STATUS FOR PHASE 1: NOT IMPLEMENTED — reported explicitly, never a silent pass.
// Phase 1 has none of the machinery this needs:
//   - no `time_entries` (clock actuals to total a day from),
//   - no payroll close from actuals,
//   - no earning codes at all (payroll_export_lines / the ot_daily code are Phase 2).
// The one existing labor signal is the self-reported job_assignments.hours_logged, which is
// not day-bucketed and carries no overtime concept.
//
// When Phase 2 lands (Task 3 day-compliance + Task 6 payroll close), this becomes real: seed
// 10h of time_entries on one work_date, run the close, and assert an ot_daily line for 2.0h.
//
// Exit codes:  0 = ot_daily row correctly produced (real, once Phase 2 exists)
//              2 = NOT IMPLEMENTED — the export/earning-code machinery is absent (non-zero on
//                  purpose so automation never reads "can't check" as "passed").
import { pool } from "../../platform/db/internal/tenant-tx";

async function tableExists(name: string): Promise<boolean> {
  const r = await pool.query("SELECT to_regclass($1) AS reg", [name]);
  return r.rows[0].reg !== null;
}

async function main(): Promise<number> {
  const haveTimeEntries = await tableExists("time_entries");
  const haveExportLines = await tableExists("payroll_export_lines");

  if (!haveTimeEntries || !haveExportLines) {
    console.log("VERDICT: NOT IMPLEMENTED");
    console.log(`  time_entries present:        ${haveTimeEntries}`);
    console.log(`  payroll_export_lines present: ${haveExportLines}`);
    console.log("  Phase 1 has no payroll close and no earning codes (regular/ot_daily/...).");
    console.log("  Daily-OT (>8h/day at 1.5x) is a Phase 2 Task 3 forecast + Task 6 settlement.");
    console.log("  Cannot assert an ot_daily export line against a schema that has none.");
    return 2;
  }

  // --- Phase 2 path (dormant until the tables exist) ---
  const r = await pool.query(
    `SELECT hours, amount_cents
       FROM payroll_export_lines
      WHERE earning_code = 'ot_daily'
      ORDER BY hours DESC
      LIMIT 1`,
  );
  if (r.rowCount === 0) {
    console.log("VERDICT: FAIL — payroll close produced no ot_daily line for a 10h day.");
    return 1;
  }
  console.log(`VERDICT: PASS — ot_daily line present: ${r.rows[0].hours}h / ${r.rows[0].amount_cents}¢.`);
  return 0;
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (err) => {
    console.error(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
    await pool.end();
    process.exit(1);
  });
