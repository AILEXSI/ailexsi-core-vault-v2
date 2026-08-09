/**
 * Resolve a real PostgreSQL connection for live suites.
 * Preference: CORE_DATABASE_URL / DATABASE_URL → embedded-postgres binaries.
 * Never returns an InMemory EventStore handle — connection string only.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type LivePgHandle = {
  connectionString: string;
  mode: "env" | "embedded";
  stop: () => Promise<void>;
};

export async function startLivePostgres(): Promise<LivePgHandle> {
  const envUrl =
    process.env.CORE_DATABASE_URL || process.env.DATABASE_URL || "";
  if (envUrl.startsWith("postgres")) {
    // Probe
    const postgres = (await import("postgres")).default;
    const sql = postgres(envUrl, { max: 1 });
    try {
      await sql`SELECT 1`;
    } finally {
      await sql.end({ timeout: 2 });
    }
    return {
      connectionString: envUrl,
      mode: "env",
      stop: async () => {},
    };
  }

  const EmbeddedPostgres = (await import("embedded-postgres")).default;
  const dataDir = mkdtempSync(path.join(tmpdir(), "ailexsi-v2-pg-"));
  const port = 55000 + Math.floor(Math.random() * 2000);
  const attempts = [
    { createPostgresUser: false as const },
    { createPostgresUser: true as const },
  ];

  let lastErr: unknown;
  for (const opts of attempts) {
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "ailexsi_v2",
      password: "ailexsi_v2_dev",
      port,
      persistent: false,
      ...opts,
    });
    try {
      await pg.initialise();
      await pg.start();
      await pg.createDatabase("ailexsi_v2_core");
      const connectionString = `postgres://ailexsi_v2:ailexsi_v2_dev@127.0.0.1:${port}/ailexsi_v2_core`;
      return {
        connectionString,
        mode: "embedded",
        stop: async () => {
          try {
            await pg.stop();
          } finally {
            try {
              rmSync(dataDir, { recursive: true, force: true });
            } catch {
              /* ignore */
            }
          }
        },
      };
    } catch (e) {
      lastErr = e;
      try {
        await pg.stop();
      } catch {
        /* ignore */
      }
    }
  }

  throw new Error(
    "VERIFICATION PENDING: cannot start live PostgreSQL " +
      "(set CORE_DATABASE_URL or run where embedded-postgres can start). " +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}
