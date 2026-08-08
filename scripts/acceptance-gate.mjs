/**
 * Foundation acceptance gate runner.
 * Executes tests and prints a structured gate report.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baselines = JSON.parse(
  readFileSync(path.join(root, "config/baselines.json"), "utf8")
);

const gates = [];

function gate(name, ok, detail = "") {
  gates.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// CORE BASELINE IDENTIFIED
gate(
  "CORE BASELINE IDENTIFIED",
  baselines.core.sha === "652d01eb06dd0841c3b475023883675af6dcd698",
  baselines.core.sha
);

// V2 CLEAN CHECKOUT markers
gate(
  "V2 STRUCTURE PRESENT",
  existsSync(path.join(root, "packages/command-adapter/src/index.ts")) &&
    existsSync(path.join(root, "docs/SOURCE-OF-TRUTH.md"))
);

// DATABASE CONFIG VERIFIED
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

// Core checkout
const coreHeadPath = path.join(root, ".deps/ailexsi-core");
let coreOk = false;
let coreHead = "missing";
if (existsSync(path.join(coreHeadPath, ".git"))) {
  coreHead = execSync("git rev-parse HEAD", { cwd: coreHeadPath })
    .toString()
    .trim();
  coreOk = coreHead === baselines.core.sha;
}
gate("CORE CHECKOUT PINNED", coreOk, coreHead);

// NO MODIFICATION OF CORE / VAULT (we never write there; confirm not dirty if present)
function dirty(dir) {
  if (!existsSync(path.join(dir, ".git"))) return false;
  const s = execSync("git status --porcelain", { cwd: dir }).toString().trim();
  return s.length > 0;
}
gate(
  "NO MODIFICATION OF CORE CHECKOUT",
  !dirty(coreHeadPath),
  dirty(coreHeadPath) ? "dirty" : "clean"
);
const vaultPath = path.join(root, ".deps/ailexsi-core-vault");
gate(
  "NO MODIFICATION OF VAULT REFERENCE CHECKOUT",
  !dirty(vaultPath),
  dirty(vaultPath) ? "dirty" : "clean-or-missing"
);

// Tests
let testOk = false;
let testDetail = "";
try {
  const out = execSync("npx vitest run --config vitest.config.ts", {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  testOk = true;
  testDetail = out.split("\n").filter((l) => l.includes("Tests")).pop() ?? "ok";
  console.log(out);
} catch (e) {
  testOk = false;
  testDetail = e.stdout?.toString?.() ?? e.message;
  console.error(testDetail);
}
gate("ALL VITEST SUITES", testOk, testDetail.trim().slice(0, 200));

const failed = gates.filter((g) => !g.ok);
const status = failed.length === 0 ? "GREEN" : "BLOCKED";

console.log("\n========================================");
console.log("AILEXSI CORE VAULT V2 — ACCEPTANCE GATE");
console.log(`FINAL STATUS: ${status}`);
console.log(`Failed gates: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log("========================================\n");

process.exit(failed.length === 0 ? 0 : 1);
