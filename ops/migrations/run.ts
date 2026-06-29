// ops/migrations/run.ts — applies pending SQL migrations as app_owner, in order,
// each in its own transaction, recorded in schema_migrations. Never edits prod by
// hand; never re-applies an applied file. Run: `pnpm tsx ops/migrations/run.ts`.
// Env is provided by the caller (e.g. `set -a; source .env; set +a`) — no dotenv dep.
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ownerUrl = process.env.OWNER_DATABASE_URL;
if (!ownerUrl) throw new Error("OWNER_DATABASE_URL is not set (see .env.example)");

const client = new Client({ connectionString: ownerUrl });
await client.connect();

await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

const applied = new Set(
  (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename as string),
);

const files = readdirSync(here).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
let count = 0;
for (const file of files) {
  if (applied.has(file)) { console.log(`skip    ${file}`); continue; }
  const sql = readFileSync(join(here, file), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`applied ${file}`);
    count++;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`FAILED  ${file}`);
    throw err;
  }
}
await client.end();
console.log(`done: ${count} migration(s) applied`);
