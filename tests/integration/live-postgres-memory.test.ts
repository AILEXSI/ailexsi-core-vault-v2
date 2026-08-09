/**
 * LIVE PostgreSQL + Core PostgresEventStore integration.
 *
 * Preference order:
 *  1) CORE_DATABASE_URL / DATABASE_URL (docker-compose or external)
 *  2) embedded-postgres (real PG binaries; not InMemoryEventStore)
 *
 * This suite NEVER uses InMemoryEventStore. That is test-kit only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createCoreRuntime,
  probeCoreDatabase,
  type CoreRuntime,
} from "@ailexsi/v2-command-adapter";
import type { Provenance } from "@ailexsi/contracts";

function provenance(): Provenance {
  return {
    sourceType: "user",
    capturedAt: "2026-08-09T12:00:00.000Z",
    parentMemoryIds: [],
    evidenceIds: [],
  };
}

describe("LIVE Postgres + Core EventStore Memory path", () => {
  let runtime: CoreRuntime | null = null;
  let embedded: { stop: () => Promise<void>; connectionString: string } | null =
    null;
  let connectionString = "";
  let mode: "env" | "embedded" = "env";

  beforeAll(async () => {
    const probe = await probeCoreDatabase();
    if (probe.ok) {
      connectionString =
        process.env.CORE_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "";
      mode = "env";
    } else {
      // Real PostgreSQL via embedded binaries (not a mock EventStore)
      mode = "embedded";
      const EmbeddedPostgres = (await import("embedded-postgres")).default;
      const dataDir = mkdtempSync(path.join(tmpdir(), "ailexsi-v2-pg-"));
      const port = 55432 + Math.floor(Math.random() * 1000);
      const pg = new EmbeddedPostgres({
        databaseDir: dataDir,
        user: "ailexsi_v2",
        password: "ailexsi_v2_dev",
        port,
        persistent: false,
      });
      await pg.initialise();
      await pg.start();
      await pg.createDatabase("ailexsi_v2_core");
      connectionString = `postgres://ailexsi_v2:ailexsi_v2_dev@127.0.0.1:${port}/ailexsi_v2_core`;
      embedded = {
        connectionString,
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
    }

    runtime = await createCoreRuntime({
      connectionString,
      environment: "test",
      producer: "v2-live-integration",
    });
  }, 180_000);

  afterAll(async () => {
    // Close clients before stopping the server to avoid flaky afterAll failures.
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        /* ignore close races */
      }
      runtime = null;
    }
    if (embedded) {
      try {
        await embedded.stop();
      } catch {
        /* ignore stop races on Windows */
      }
      embedded = null;
    }
  }, 60_000);

  it("uses real Postgres (env or embedded), never InMemory", () => {
    expect(runtime).not.toBeNull();
    expect(connectionString.startsWith("postgres://")).toBe(true);
    expect(["env", "embedded"]).toContain(mode);
    // PostgresEventStore is constructed inside createCoreRuntime
    expect(runtime!.store.constructor.name).toBe("PostgresEventStore");
  });

  it("create Memory via Core PostgresEventStore", async () => {
    const key = randomUUID();
    const cell = await runtime!.adapter.create({
      content: { type: "text", text: `live-pg-${key.slice(0, 8)}` },
      provenance: provenance(),
      idempotencyKey: key,
      createdBy: "live-test",
    });
    expect(cell.currentVersion).toBe(1);
    expect(cell.identity.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const stream = await runtime!.store.getByAggregate(cell.identity.id);
    expect(stream.length).toBe(1);
    expect(stream[0]!.event.eventType).toBe("MemoryCreated");
    expect(stream[0]!.event.idempotencyKey).toBe(key);
    expect(typeof stream[0]!.sequenceId).toBe("number");
  });

  it("update / archive / restore through EventStore", async () => {
    const created = await runtime!.adapter.create({
      content: { type: "text", text: "lifecycle-live" },
      provenance: provenance(),
      idempotencyKey: randomUUID(),
    });
    const updated = await runtime!.adapter.update({
      memoryId: created.identity.id,
      content: { type: "text", text: "lifecycle-live-v2" },
      idempotencyKey: randomUUID(),
      changeReason: "live-update",
    });
    expect(updated.currentVersion).toBe(2);
    const archived = await runtime!.adapter.archive({
      memoryId: created.identity.id,
      idempotencyKey: randomUUID(),
      reason: "live-archive",
    });
    expect(archived.lifecycle.state).toBe("archived");
    const restored = await runtime!.adapter.restore({
      memoryId: created.identity.id,
      idempotencyKey: randomUUID(),
      reason: "live-restore",
    });
    expect(restored.lifecycle.state).toBe("active");
    const hist = await runtime!.adapter.getHistory(created.identity.id);
    expect(hist.length).toBe(4);
    const stream = await runtime!.store.getByAggregate(created.identity.id);
    expect(stream.length).toBe(4);
  });

  it("AAS-54 CLEAR → REPLAY → IDENTICAL via ProjectionEngine + V2 read model", async () => {
    const created = await runtime!.adapter.create({
      content: { type: "text", text: "replay-live-v1" },
      provenance: provenance(),
      idempotencyKey: randomUUID(),
    });
    await runtime!.adapter.update({
      memoryId: created.identity.id,
      content: { type: "text", text: "replay-live-v2" },
      idempotencyKey: randomUUID(),
    });
    await runtime!.adapter.archive({
      memoryId: created.identity.id,
      idempotencyKey: randomUUID(),
    });

    const expected = await runtime!.adapter.get(created.identity.id);
    expect(expected).not.toBeNull();

    await runtime!.rebuildAll();
    const after = await runtime!.adapter.get(created.identity.id);
    expect(after).toEqual(expected);

    const view = runtime!.readModel.get(created.identity.id);
    expect(view).not.toBeNull();
    expect(view!.content.class).toBe("CANONICAL");
    expect((view!.content.value as { text: string }).text).toBe(
      "replay-live-v2"
    );
    expect(view!.lifecycle.value.state).toBe("archived");
  });

  it("idempotent create does not duplicate EventStore rows", async () => {
    const key = randomUUID();
    const a = await runtime!.adapter.create({
      content: { type: "text", text: "idem-live" },
      provenance: provenance(),
      idempotencyKey: key,
    });
    const b = await runtime!.adapter.create({
      content: { type: "text", text: "idem-live" },
      provenance: provenance(),
      idempotencyKey: key,
    });
    expect(b.identity.id).toBe(a.identity.id);
    const stream = await runtime!.store.getByAggregate(a.identity.id);
    expect(stream.length).toBe(1);
  });
});
