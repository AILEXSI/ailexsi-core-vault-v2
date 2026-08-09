/**
 * Resolve a real PostgreSQL connection for live suites.
 * Preference: CORE_DATABASE_URL / DATABASE_URL (if reachable)
 *          → embedded-postgres binaries
 * Never returns an InMemory EventStore handle — connection string only.
 *
 * If env URL is set but auth/connect fails, fall through to embedded
 * (placeholder USER/PASS must not hard-fail the suite).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type LivePgHandle = {
  connectionString: string;
  mode: "env" | "embedded";
  stop: () => Promise<void>;
};

async function tryEnvUrl(envUrl: string): Promise<LivePgHandle | null> {
  if (!envUrl.startsWith("postgres")) return null;
  const postgres = (await import("postgres")).default;
  const sql = postgres(envUrl, { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1`;
    return {
      connectionString: envUrl,
      mode: "env",
      stop: async () => {},
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[startLivePostgres] CORE_DATABASE_URL/DATABASE_URL not usable (${msg.slice(0, 120)}). Falling back to embedded-postgres.`
    );
    return null;
  } finally {
    try {
      await sql.end({ timeout: 2 });
    } catch {
      /* ignore */
    }
  }
}

async function startEmbedded(): Promise<LivePgHandle> {
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
      "(set a working CORE_DATABASE_URL or run where embedded-postgres can start). " +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

export async function startLivePostgres(): Promise<LivePgHandle> {
  const envUrl =
    process.env.CORE_DATABASE_URL || process.env.DATABASE_URL || "";
  if (envUrl) {
    const fromEnv = await tryEnvUrl(envUrl);
    if (fromEnv) return fromEnv;
  }
  return startEmbedded();
}
