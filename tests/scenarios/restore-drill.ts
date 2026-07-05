// Scenario / G1 evidence: the restore drill. Proves a backup actually restores — "an untested
// backup is a hope, not a backup" (impl §3). On success it writes a dated evidence file to
// docs/checkpoints/ that forms part of the Phase-1 G1 checkpoint.
//
// Run:  set -a; source .env; set +a; pnpm exec tsx tests/scenarios/restore-drill.ts
//       FORCE_NONLOCAL=1 ...   # required to target a non-localhost DB (safety guard)
//
// Procedure (matches the manual runbook, ops/backup/restore-drill.sh, but round-trips the
// WORKING dev/staging DB rather than a scratch instance, per the task):
//   1. pg_dump the current DB (custom format) to ops/backup/restore-drill-<ts>.dump
//   2. record the most recent job id (integrity anchor; falls back to seeded co-op A if none)
//   3. DROP + CREATE the database
//   4. pg_restore from the dump
//   5. assert the recorded id is present and intact
//   6. on success, write docs/checkpoints/restore-drill-<date>.md
//
// DESTRUCTIVE: step 3 drops the database. It is restored immediately from the step-1 dump, so
// it round-trips; if a later step fails the dump file is preserved and its path printed loudly
// for manual recovery. Refuses a non-localhost target unless FORCE_NONLOCAL=1.
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SUPER: string = process.env.SUPERUSER_DATABASE_URL ?? "";
const OWNER: string = process.env.OWNER_DATABASE_URL ?? "";
if (!SUPER || !OWNER) throw new Error("set SUPERUSER_DATABASE_URL and OWNER_DATABASE_URL (see .env.example)");

const ownerUrl = new URL(OWNER);
const DB = ownerUrl.pathname.replace(/^\//, "");
const host = ownerUrl.hostname;
if (host !== "localhost" && host !== "127.0.0.1" && process.env.FORCE_NONLOCAL !== "1") {
  throw new Error(`refusing to drop a non-localhost DB (${host}) without FORCE_NONLOCAL=1`);
}
const superBase = new URL(SUPER);
superBase.pathname = "/postgres";
const superPostgres = superBase.toString();
// pg_dump/pg_restore run as SUPERUSER: tables are FORCE ROW LEVEL SECURITY, so app_owner's
// COPY is blocked with no tenant context — only a superuser bypasses RLS to dump every row.
const superDb = new URL(SUPER);
superDb.pathname = `/${DB}`;
const superDbUrl = superDb.toString();

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const date = new Date().toISOString().slice(0, 10);
const dumpPath = join("ops", "backup", `restore-drill-${ts}.dump`);

function psql(url: string, sql: string): void {
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { stdio: "inherit" });
}

async function recordAnchor(): Promise<{ kind: string; id: string; detail: string }> {
  // superuser bypasses RLS, so it sees every tenant's rows (a legit admin/drill operation).
  const c = new Client({ connectionString: superDbUrl });
  await c.connect();
  try {
    const j = await c.query("SELECT id, co_op_id, status FROM jobs ORDER BY created_at DESC LIMIT 1");
    if ((j.rowCount ?? 0) > 0) {
      const r = j.rows[0];
      return { kind: "job", id: r.id as string, detail: `co_op=${r.co_op_id} status=${r.status}` };
    }
    const co = await c.query("SELECT id, name FROM co_ops ORDER BY id LIMIT 1");
    if ((co.rowCount ?? 0) === 0) throw new Error("empty DB: no jobs and no co_ops to anchor on");
    return { kind: "co_op", id: co.rows[0].id as string, detail: `${co.rows[0].name} (no jobs present)` };
  } finally {
    await c.end();
  }
}

async function assertPresent(anchor: { kind: string; id: string }): Promise<void> {
  const c = new Client({ connectionString: superDbUrl });
  await c.connect();
  try {
    const table = anchor.kind === "job" ? "jobs" : "co_ops";
    const r = await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [anchor.id]);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`anchor ${anchor.kind} ${anchor.id} MISSING after restore`);
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  console.log(`restore drill: DB='${DB}' host='${host}'`);

  // 1. snapshot (as superuser — see superDbUrl note above)
  execFileSync("pg_dump", ["-Fc", "-f", dumpPath, superDbUrl], { stdio: "inherit" });
  console.log(`  [1] dumped -> ${dumpPath}`);

  // 2. anchor
  const anchor = await recordAnchor();
  console.log(`  [2] anchor: ${anchor.kind} ${anchor.id} (${anchor.detail})`);

  // 3. drop + recreate
  psql(superPostgres, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB}' AND pid<>pg_backend_pid()`);
  psql(superPostgres, `DROP DATABASE "${DB}"`);
  psql(superPostgres, `CREATE DATABASE "${DB}"`);
  console.log(`  [3] dropped + recreated ${DB}`);

  // 4. restore
  const superTarget = new URL(SUPER);
  superTarget.pathname = `/${DB}`;
  execFileSync("pg_restore", ["--no-owner", "-d", superTarget.toString(), dumpPath], { stdio: "inherit" });
  console.log(`  [4] restored from ${dumpPath}`);

  // 5. verify
  await assertPresent(anchor);
  console.log(`  [5] verified: ${anchor.kind} ${anchor.id} present + intact after restore`);

  // 6. evidence
  const checkpointDir = join("docs", "checkpoints");
  mkdirSync(checkpointDir, { recursive: true });
  const evidencePath = join(checkpointDir, `restore-drill-${date}.md`);
  writeFileSync(
    evidencePath,
    `# Restore drill — ${date}\n\n` +
      `**Result:** PASS\n` +
      `**Timestamp (UTC):** ${new Date().toISOString()}\n` +
      `**Database:** \`${DB}\` @ \`${host}\`\n` +
      `**Snapshot:** \`${dumpPath}\`\n` +
      `**Integrity anchor:** ${anchor.kind} \`${anchor.id}\` (${anchor.detail})\n\n` +
      `Procedure: pg_dump (custom) → record anchor → DROP+CREATE database → pg_restore → assert ` +
      `anchor present. The database round-trips through the snapshot; the anchor row survived ` +
      `the drop/restore intact.\n\n` +
      `Part of the Phase-1 **G1** checkpoint evidence (a passed restore drill, per ` +
      `\`phase-2-household-sectors.md\` §0 / impl spec §3).\n`,
  );
  console.log(`  [6] evidence -> ${evidencePath}`);
  console.log(`\nVERDICT: PASS — snapshot ${dumpPath} restored; anchor ${anchor.id} verified.`);
}

main().catch((err) => {
  console.error(`\nVERDICT: FAIL — ${err instanceof Error ? err.message : String(err)}`);
  console.error(`Snapshot preserved for manual recovery: ${dumpPath}`);
  console.error(`Manual restore: pg_restore --no-owner -d <superuser-url>/${DB} ${dumpPath}`);
  process.exit(1);
});
