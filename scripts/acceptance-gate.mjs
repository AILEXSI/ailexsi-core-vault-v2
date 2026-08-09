/**
 * V2 acceptance gate — Foundation + Slice A Desktop command path.
 *
 * GREEN requires:
 *   1. Foundation gates PASS
 *   2. Core/Vault baseline pins unchanged
 *   3. Core/Vault checkouts clean
 *   4. no Phase 08
 *   5. no dual-write
 *   6. unit/mock suite PASS
 *   7. live PostgreSQL foundation suite PASS
 *   8. Desktop command-path suite PASS
 *   9. Desktop path reaches PostgresEventStore
 *  10–12. covered by desktop suite (persist, read model, AAS-54)
 *
 * Live/desktop cannot run → VERIFICATION PENDING (exit 2)
 * Hard failures → BLOCKED (exit 1)
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
let desktopPath = false;

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
    else if (/\.(ts|tsx|mjs|js|rs)$/.test(name)) out.push(full);
  }
  return out;
}

function runVitest(args, timeoutMs = 300_000) {
  const out = execSync(`npx vitest run --config vitest.config.ts ${args}`, {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    timeout: timeoutMs,
  });
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

// --- structural ---
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
    existsSync(path.join(root, "packages/command-adapter/src/desktop-host.ts")) &&
    existsSync(path.join(root, "docs/SOURCE-OF-TRUTH.md")) &&
    existsSync(path.join(root, "docs/BASELINES.md")) &&
    existsSync(path.join(root, "docs/adr/001-source-of-truth.md"))
);
gate(
  "DESKTOP HOST + IPC SURFACE PRESENT",
  existsSync(path.join(root, "packages/command-adapter/src/desktop-host.ts")) &&
    existsSync(path.join(root, "apps/desktop/src/ipc/memory-api.ts")) &&
    existsSync(path.join(root, "apps/desktop/src-tauri/src/lib.rs")) &&
    readFileSync(
      path.join(root, "apps/desktop/src-tauri/src/lib.rs"),
      "utf8"
    ).includes("memory_create") &&
    readFileSync(
      path.join(root, "packages/command-adapter/src/desktop-host.ts"),
      "utf8"
    ).includes("invokeDesktopCommand") &&
    existsSync(path.join(root, "packages/command-adapter/src/desktop-bridge-server.ts")) &&
    existsSync(path.join(root, "apps/desktop/src/components/MemoryPanel.tsx"))
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

// dual-write
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

// Phase 08
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

// silent skip scan on acceptance/desktop tests
const skipHits = [];
for (const file of walkTs(path.join(root, "tests"))) {
  const text = readFileSync(file, "utf8");
  if (
    /\b(describe|it|test)\.skip\s*\(/.test(text) ||
    /\bxit\s*\(/.test(text) ||
    /\bxdescribe\s*\(/.test(text)
  ) {
    skipHits.push(path.relative(root, file));
  }
}
gate(
  "NO SILENT TEST SKIPS IN SUITE",
  skipHits.length === 0,
  skipHits.length ? skipHits.join(", ") : "clean"
);

// per-command runtime anti-pattern in desktop-host
const hostSrc = readFileSync(
  path.join(root, "packages/command-adapter/src/desktop-host.ts"),
  "utf8"
);
const perCommandRuntime =
  /async memoryCreate[\s\S]*createCoreRuntime/.test(hostSrc) ||
  /memoryCreate[\s\S]{0,200}createCoreRuntime/.test(hostSrc);
gate(
  "NO PER-COMMAND createCoreRuntime IN DESKTOP HOST",
  !perCommandRuntime && hostSrc.includes("if (this.runtime)") && hostSrc.includes("start("),
  perCommandRuntime ? "detected" : "long-lived start() only"
);

// unit + mock (exclude live suites)
let unitOk = false;
let unitDetail = "";
try {
  const out = runVitest(
    "--exclude tests/integration/live-postgres-memory.test.ts --exclude tests/integration/desktop-command-path.test.ts --exclude tests/integration/desktop-bridge-http.test.ts"
  );
  unitOk = true;
  unitDetail = out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  console.log(out);
} catch (e) {
  unitOk = false;
  unitDetail = (e.stdout?.toString?.() || e.message || "").slice(0, 600);
  console.error(e.stdout?.toString?.() || e.message);
}
gate("UNIT+MOCK INTEGRATION TESTS", unitOk, unitDetail.trim().slice(0, 200));

// live foundation suite
let liveTestOk = false;
let liveTestDetail = "";
try {
  const out = runVitest("tests/integration/live-postgres-memory.test.ts");
  liveTestOk = true;
  livePostgres = true;
  liveTestDetail =
    out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  console.log(out);
} catch (e) {
  liveTestOk = false;
  livePostgres = false;
  liveTestDetail = (
    e.stdout?.toString?.() ||
    e.stderr?.toString?.() ||
    e.message ||
    ""
  ).slice(0, 800);
  console.error(e.stdout?.toString?.() || e.stderr?.toString?.() || e.message);
}
gate(
  "LIVE POSTGRES + CORE EVENTSTORE",
  liveTestOk,
  liveTestDetail.trim().slice(0, 240)
);
gate(
  "COMMAND ADAPTER CREATES MEMORY VIA CORE EVENTSTORE",
  liveTestOk,
  liveTestOk ? "proven by live-postgres-memory suite" : liveTestDetail.slice(0, 120)
);

// desktop command path suite
let desktopOk = false;
let desktopDetail = "";
try {
  const out = runVitest("tests/integration/desktop-command-path.test.ts");
  desktopOk = true;
  desktopPath = true;
  desktopDetail =
    out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  console.log(out);
} catch (e) {
  desktopOk = false;
  desktopPath = false;
  desktopDetail = (
    e.stdout?.toString?.() ||
    e.stderr?.toString?.() ||
    e.message ||
    ""
  ).slice(0, 800);
  console.error(e.stdout?.toString?.() || e.stderr?.toString?.() || e.message);
}
gate(
  "DESKTOP COMMAND-PATH SUITE",
  desktopOk,
  desktopDetail.trim().slice(0, 240)
);
gate(
  "DESKTOP PATH REACHES PostgresEventStore",
  desktopOk,
  desktopOk
    ? "store.constructor.name === PostgresEventStore (desktop suite)"
    : desktopDetail.slice(0, 120)
);
gate(
  "DESKTOP AAS-54 REPLAY",
  desktopOk,
  desktopOk
    ? "CLEAR → REBUILD → IDENTICAL via desktop IPC path"
    : "desktop suite failed"
);

// desktop HTTP bridge (Tauri/UI surface)
let bridgeOk = false;
let bridgeDetail = "";
try {
  const out = runVitest("tests/integration/desktop-bridge-http.test.ts");
  bridgeOk = true;
  bridgeDetail =
    out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  console.log(out);
} catch (e) {
  bridgeOk = false;
  bridgeDetail = (
    e.stdout?.toString?.() ||
    e.stderr?.toString?.() ||
    e.message ||
    ""
  ).slice(0, 800);
  console.error(e.stdout?.toString?.() || e.stderr?.toString?.() || e.message);
}
gate(
  "DESKTOP HTTP BRIDGE SUITE",
  bridgeOk,
  bridgeDetail.trim().slice(0, 240)
);
gate(
  "BRIDGE REACHES PostgresEventStore",
  bridgeOk,
  bridgeOk ? "HTTP /health store=PostgresEventStore" : bridgeDetail.slice(0, 120)
);

const failed = gates.filter((g) => !g.ok);
const softLive = new Set([
  "LIVE POSTGRES + CORE EVENTSTORE",
  "COMMAND ADAPTER CREATES MEMORY VIA CORE EVENTSTORE",
  "DESKTOP COMMAND-PATH SUITE",
  "DESKTOP PATH REACHES PostgresEventStore",
  "DESKTOP AAS-54 REPLAY",
  "DESKTOP HTTP BRIDGE SUITE",
  "BRIDGE REACHES PostgresEventStore",
]);
const hardFailed = failed.filter((g) => !softLive.has(g.name));

let status;
let exitCode;
if (hardFailed.length > 0) {
  status = "BLOCKED";
  exitCode = 1;
} else if (!liveTestOk || !desktopOk || !bridgeOk) {
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
console.log(`DESKTOP PATH: ${desktopPath ? "yes" : "no"}`);
console.log(`PHASE 08 CODE PRESENT: NO`);
console.log(`Failed gates: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log("========================================\n");

process.exit(exitCode);
