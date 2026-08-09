/**
 * Entry: long-lived DesktopHost HTTP bridge for UI / Tauri.
 * Run: npm run desktop:host
 *
 * Requires a *reachable* CORE_DATABASE_URL (real Postgres).
 * Default local stack: docker compose up -d
 *   CORE_DATABASE_URL=postgres://ailexsi_v2:ailexsi_v2_dev@127.0.0.1:5433/ailexsi_v2_core
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startDesktopBridgeServer,
  getDesktopHost,
} from "@ailexsi/v2-command-adapter";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Load simple KEY=VALUE lines from .env into process.env (no override if already set). */
function loadDotEnv(): void {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function redactUrl(url: string): string {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

function validateDatabaseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `CORE_DATABASE_URL is not a valid URL: ${url.slice(0, 80)}`;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return `CORE_DATABASE_URL must start with postgres:// (got ${parsed.protocol})`;
  }
  const host = parsed.hostname;
  if (
    !host ||
    host === "..." ||
    host === "…" ||
    host === "hostname" ||
    host === "host" ||
    host.includes("example")
  ) {
    return (
      `CORE_DATABASE_URL has invalid hostname "${host}". ` +
      `Do not use placeholders. Use 127.0.0.1 with docker compose (port 5433).`
    );
  }
  if (
    parsed.username === "USER" ||
    parsed.password === "PASS" ||
    parsed.password === "password" ||
    parsed.username === "user"
  ) {
    return (
      `CORE_DATABASE_URL still has placeholder credentials (USER/PASS). ` +
      `Use the docker-compose defaults or real credentials.`
    );
  }
  return null;
}

function printHelp(): void {
  console.error(`
DesktopHost needs a real PostgreSQL connection (no InMemory fallback).

Recommended local setup:

  1) Start Postgres:
       docker compose up -d

  2) Set URL (PowerShell):
       $env:CORE_DATABASE_URL="postgres://ailexsi_v2:ailexsi_v2_dev@127.0.0.1:5433/ailexsi_v2_core"

     Or copy config/env.example → .env (desktop:host loads .env automatically).

  3) Retry:
       npm run desktop:host

  4) UI (other terminal):
       npm run desktop:dev
`);
}

loadDotEnv();

const url = process.env.CORE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "CORE_DATABASE_URL (or DATABASE_URL) is required. No InMemory fallback."
  );
  printHelp();
  process.exit(1);
}

const invalid = validateDatabaseUrl(url);
if (invalid) {
  console.error(invalid);
  console.error(`Current value (redacted): ${redactUrl(url)}`);
  printHelp();
  process.exit(1);
}

const port = Number(process.env.DESKTOP_HOST_PORT || 17890);

console.log(`Connecting to ${redactUrl(url)} …`);

let server;
try {
  server = await startDesktopBridgeServer({
    connectionString: url,
    port,
    environment:
      process.env.AILEXSI_ENV === "production" ? "production" : "development",
    producer: "v2-desktop-host-server",
  });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`Failed to start DesktopHost: ${msg}`);
  if (
    /ENOTFOUND|ECONNREFUSED|authentication failed|getaddrinfo/i.test(msg)
  ) {
    console.error(
      "Hint: hostname/port/password wrong, or Postgres is not running."
    );
  }
  printHelp();
  process.exit(1);
}

console.log(`DesktopHost bridge listening on ${server.url}`);
console.log(`store: ${getDesktopHost().storeConstructorName()}`);
console.log(
  "Commands: POST /commands/memory.create|get|list|update|archive|restore|history"
);
console.log("Health:   GET  /health");

const shutdown = async () => {
  console.log("shutting down…");
  await server.close();
  await getDesktopHost().stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
