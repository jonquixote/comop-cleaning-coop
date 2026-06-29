// Zero-dependency architectural boundary test (ADR-0001 + ADR-0003).
// Runs with plain Node (no install needed) so the load-bearing boundary check
// works even before/independent of the lint toolchain.
//
// Enforces two things the import-lint cannot fully see:
//   1. ADR-0001: no file under /platform references a sector by name or path
//      (catches the "technically in /platform but secretly cleaning-specific" case).
//   2. ADR-0004 §3: no file under /apps imports the INTERNAL tenant-tx helper
//      (the only sanctioned app door is identity/session-tx → withSessionTx).
//
// Exit code 1 on any violation (CI release-blocking).

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SECTOR_NAMES = ["cleaning", "landscaping", "junk-removal", "janitorial"];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const violations = [];

function scan(file, tests) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const { re, msg } of tests) {
      if (re.test(line)) violations.push(`${file}:${i + 1}  ${msg}\n    ${line.trim()}`);
    }
  });
}

// 1. /platform must know nothing about any sector.
const sectorWord = new RegExp(`\\b(${SECTOR_NAMES.join("|")})\\b`, "i");
for (const f of walk("platform")) {
  scan(f, [
    { re: /['"][^'"]*\/sectors\//, msg: "ADR-0003: /platform references a sector path" },
    { re: sectorWord, msg: "ADR-0001: /platform references a sector by name (must be sector-agnostic)" }
  ]);
}

// 2. /apps must not import the internal tenant-tx helper (use withSessionTx).
for (const f of walk("apps")) {
  scan(f, [
    { re: /db\/internal\/tenant-tx/, msg: "ADR-0004 §3: app imports the INTERNAL tenant-tx; use identity/session-tx withSessionTx" }
  ]);
}

if (violations.length) {
  console.error(`✗ boundary check failed (${violations.length}):\n`);
  console.error(violations.join("\n\n"));
  process.exit(1);
}
console.log("✓ boundary check passed (ADR-0001 / ADR-0003 / ADR-0004 §3)");
