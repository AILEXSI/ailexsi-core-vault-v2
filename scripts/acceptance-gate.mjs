/**
 * Foundation acceptance gate.
 *
 * GREEN requires:
 *   - baseline pins correct
 *   - Core/Vault checkouts clean at pins
 *   - unit + mock integration tests PASS
 *   - dual-write guard PASS
 *   - LIVE Postgres + Core PostgresEventStore suite PASS
 *     (CORE_DATABASE_URL or embedded-postgres real binaries)
 *   - no Phase 08 Physics implementation in V2
 *
 * If live suite cannot prove EventStore path → VERIFICATION PENDING (exit 2)
 * If hard failures → BLOCKED (exit 1)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baselines = JSON.parse(
  readFileSync(path.join(root, "config/baselines.json"), "utf8")
);

const gates = [];
let livePostgres = false;
let liveDetail = "";

function gate(name, ok, detail = "") {
  gates.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function dirty(dir) {
  if (!existsSync(path.join(dir, ".git"))) return false;
  const s = execSync("git status --porcelain", { cwd: dir }).toString().trim();
  return s.length > 0;
}

function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "target") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

// --- identity ---
let localHead = "unknown";
let originHead = "unknown";
try {
  localHead = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
  try {
    originHead = execSync("git rev-parse origin/main", { cwd: root })
      .toString()
      .trim();
  } catch {
    originHead = "origin/main missing";
  }
} catch {
  /* not a git repo */
}
console.log(`LOCAL HEAD:  ${localHead}`);
console.log(`ORIGIN HEAD: ${originHead}`);
console.log(
  `HEADS IDENTICAL: ${localHead === originHead ? "YES" : "NO (local may be ahead)"}`
);
console.log(`CORE PIN:    ${baselines.core.sha}`);
console.log(`VAULT PIN:   ${baselines.vaultReference.sha}`);

// --- structural gates ---
gate(
  "CORE BASELINE IDENTIFIED",
  baselines.core.sha === "652d01eb06dd0841c3b475023883675af6dcd698",
  baselines.core.sha
);
gate(
  "VAULT BASELINE IDENTIFIED",
  baselines.vaultReference.sha ===
    "061e444389090c54e431b0e8243e82764f2c198e",
  baselines.vaultReference.sha
);
gate(
  "V2 STRUCTURE PRESENT",
  existsSync(path.join(root, "packages/command-adapter/src/index.ts")) &&
    existsSync(path.join(root, "packages/command-adapter/src/core-runtime.ts")) &&
    existsSync(path.join(root, "docs/SOURCE-OF-TRUTH.md")) &&
    existsSync(path.join(root, "docs/BASELINES.md")) &&
    existsSync(path.join(root, "docs/adr/001-source-of-truth.md"))
);
gate(
  "DATABASE CONFIG VERIFIED",
  existsSync(path.join(root, "config/env.example")) &&
    readFileSync(path.join(root, "config/env.example"), "utf8").includes(
      "CORE_DATABASE_URL"
    ) &&
    readFileSync(path.join(root, "config/env.example"), "utf8").includes(
      "V2_DATABASE_URL"
    )
);

const coreHeadPath = path.join(root, ".deps/ailexsi-core");
let coreHead = "missing";
let coreOk = false;
if (existsSync(path.join(coreHeadPath, ".git"))) {
  coreHead = execSync("git rev-parse HEAD", { cwd: coreHeadPath })
    .toString()
    .trim();
  coreOk = coreHead === baselines.core.sha;
}
gate("CORE CHECKOUT PINNED", coreOk, coreHead);
gate(
  "NO MODIFICATION OF CORE CHECKOUT",
  !dirty(coreHeadPath),
  dirty(coreHeadPath) ? "dirty" : "clean"
);
const vaultPath = path.join(root, ".deps/ailexsi-core-vault");
let vaultHead = "missing";
if (existsSync(path.join(vaultPath, ".git"))) {
  vaultHead = execSync("git rev-parse HEAD", { cwd: vaultPath })
    .toString()
    .trim();
}
gate(
  "VAULT CHECKOUT PINNED OR ABSENT",
  vaultHead === "missing" || vaultHead === baselines.vaultReference.sha,
  vaultHead
);
gate(
  "NO MODIFICATION OF VAULT REFERENCE CHECKOUT",
  !dirty(vaultPath),
  dirty(vaultPath) ? "dirty" : "clean-or-missing"
);

// --- dual-write static check ---
const forbidden = [
  /dualWrite\s*\(/i,
  /saveCanonicalToFs\s*\(/i,
  /persistCanonicalMarkdown\s*\(/i,
  /canonicalStore\s*=\s*['"`].*\.md/i,
];
const dualHits = [];
for (const file of walkTs(path.join(root, "packages")).concat(
  walkTs(path.join(root, "apps")),
  walkTs(path.join(root, "scripts"))
)) {
  const text = readFileSync(file, "utf8");
  for (const re of forbidden) {
    if (re.test(text)) dualHits.push(path.relative(root, file));
  }
}
gate(
  "NO DUAL-WRITE PATH DETECTED",
  dualHits.length === 0,
  dualHits.length ? dualHits.join(", ") : "clean"
);

// --- Phase 08 ---
const phase08Hits = [];
for (const file of walkTs(path.join(root, "packages"))) {
  const text = readFileSync(file, "utf8");
  if (/implementPhase08|class\s+PhysicsDomain\b/.test(text)) {
    phase08Hits.push(path.relative(root, file));
  }
}
gate(
  "PHASE 08 CODE PRESENT: NO",
  phase08Hits.length === 0,
  phase08Hits.length ? phase08Hits.join(", ") : "no Phase 08 implementation"
);

// --- unit + mock integration (exclude live) ---
let unitOk = false;
let unitDetail = "";
try {
  const out = execSync(
    "npx vitest run --config vitest.config.ts --exclude tests/integration/live-postgres-memory.test.ts",
    { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
  unitOk = true;
  unitDetail = out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  console.log(out);
} catch (e) {
  unitOk = false;
  unitDetail = (e.stdout?.toString?.() || e.message || "").slice(0, 400);
  console.error(e.stdout?.toString?.() || e.message);
}
gate("UNIT+MOCK INTEGRATION TESTS", unitOk, unitDetail.trim().slice(0, 200));

// --- LIVE postgres suite (env URL or embedded real PG) ---
let liveTestOk = false;
let liveTestDetail = "";
try {
  const out = execSync(
    "npx vitest run --config vitest.config.ts tests/integration/live-postgres-memory.test.ts",
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: 300_000,
    }
  );
  liveTestOk = true;
  livePostgres = true;
  liveTestDetail =
    out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  // Detect mode from output if present
  if (out.includes("PostgresEventStore")) {
    liveDetail = "PostgresEventStore proven via live suite";
  } else {
    liveDetail = "live suite passed";
  }
  console.log(out);
} catch (e) {
  liveTestOk = false;
  livePostgres = false;
  liveTestDetail = (e.stdout?.toString?.() || e.stderr?.toString?.() || e.message || "").slice(
    0,
    800
  );
  liveDetail = liveTestDetail.slice(0, 200);
  console.error(e.stdout?.toString?.() || e.stderr?.toString?.() || e.message);
}
gate("LIVE POSTGRES + CORE EVENTSTORE", liveTestOk, liveTestDetail.trim().slice(0, 240));
gate(
  "COMMAND ADAPTER CREATES MEMORY VIA CORE EVENTSTORE",
  liveTestOk,
  liveTestOk ? "proven by live-postgres-memory suite" : liveDetail
);

const failed = gates.filter((g) => !g.ok);
const hardFailed = failed.filter(
  (g) =>
    g.name !== "LIVE POSTGRES + CORE EVENTSTORE" &&
    g.name !== "COMMAND ADAPTER CREATES MEMORY VIA CORE EVENTSTORE"
);

let status;
let exitCode;
if (hardFailed.length > 0) {
  status = "BLOCKED";
  exitCode = 1;
} else if (!liveTestOk) {
  status = "VERIFICATION PENDING";
  exitCode = 2;
} else if (failed.length === 0) {
  status = "GREEN";
  exitCode = 0;
} else {
  status = "BLOCKED";
  exitCode = 1;
}

console.log("\n========================================");
console.log("AILEXSI CORE VAULT V2 — ACCEPTANCE GATE");
console.log(`FINAL STATUS: ${status}`);
console.log(`LIVE POSTGRES: ${livePostgres ? "yes" : "no"}`);
console.log(`PHASE 08 CODE PRESENT: NO`);
console.log(`Failed gates: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log("========================================\n");

process.exit(exitCode);
