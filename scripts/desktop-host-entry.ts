/**
 * Entry: long-lived DesktopHost HTTP bridge for UI / Tauri.
 * Run: npm run desktop:host
 */

import {
  startDesktopBridgeServer,
  getDesktopHost,
} from "@ailexsi/v2-command-adapter";

const url = process.env.CORE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "CORE_DATABASE_URL (or DATABASE_URL) is required. No InMemory fallback."
  );
  process.exit(1);
}

const port = Number(process.env.DESKTOP_HOST_PORT || 17890);

const server = await startDesktopBridgeServer({
  connectionString: url,
  port,
  environment:
    process.env.AILEXSI_ENV === "production" ? "production" : "development",
  producer: "v2-desktop-host-server",
});

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
