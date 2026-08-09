/**
 * Bridge + UI path (HTTP):
 *   HTTP /commands/* → DesktopHost → PostgresEventStore
 *
 * Proves the same surface the Tauri proxy and Vite UI call.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  startDesktopBridgeServer,
  getDesktopHost,
  resetDesktopHostForTests,
  type DesktopBridgeServer,
} from "@ailexsi/v2-command-adapter";
import { startLivePostgres, type LivePgHandle } from "@ailexsi/v2-test-kit";
import type { Provenance } from "@ailexsi/contracts";

function provenance(): Provenance {
  return {
    sourceType: "user",
    capturedAt: "2026-08-09T12:00:00.000Z",
    parentMemoryIds: [],
    evidenceIds: [],
  };
}

async function post(base: string, command: string, body: unknown) {
  const res = await fetch(`${base}/commands/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe("Desktop HTTP bridge → long-lived DesktopHost → PostgresEventStore", () => {
  let live: LivePgHandle | null = null;
  let server: DesktopBridgeServer | null = null;
  let base = "";

  beforeAll(async () => {
    resetDesktopHostForTests();
    live = await startLivePostgres();
    server = await startDesktopBridgeServer({
      connectionString: live.connectionString,
      port: 0, // ephemeral
      environment: "test",
      producer: "v2-bridge-test",
    });
    base = server.url;
  }, 180_000);

  afterAll(async () => {
    if (server) {
      try {
        await server.close();
      } catch {
        /* ignore */
      }
    }
    try {
      await getDesktopHost().stop();
    } catch {
      /* ignore */
    }
    if (live) {
      try {
        await live.stop();
      } catch {
        /* ignore */
      }
    }
  }, 60_000);

  it("health reports PostgresEventStore", async () => {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.store).toBe("PostgresEventStore");
    expect(body.running).toBe(true);
  });

  it("CREATE + LIST + GET via HTTP bridge", async () => {
    const key = randomUUID();
    const created = await post(base, "memory.create", {
      content: { type: "text", text: `bridge-ui-${key.slice(0, 8)}` },
      provenance: provenance(),
      idempotencyKey: key,
      createdBy: "bridge-test",
    });
    expect(created.status).toBe(200);
    expect(created.json.ok).toBe(true);
    const view = created.json.result;
    expect(view.currentVersion.value).toBe(1);

    const listed = await post(base, "memory.list", { includeArchived: true });
    expect(listed.status).toBe(200);
    const items = listed.json.result as Array<{ id: string }>;
    expect(items.some((i) => i.id === view.id)).toBe(true);

    const got = await post(base, "memory.get", { memoryId: view.id });
    expect(got.json.result.id).toBe(view.id);
    expect((got.json.result.content.value as { text: string }).text).toContain(
      "bridge-ui-"
    );

    // EventStore proof
    const stream = await getDesktopHost().eventStoreHistory(view.id);
    expect(stream.length).toBe(1);
    expect(stream[0]!.event.eventType).toBe("MemoryCreated");
    expect(getDesktopHost().storeConstructorName()).toBe("PostgresEventStore");
  });

  it("long-lived host: generation stays 1 across HTTP commands", async () => {
    expect(getDesktopHost().generation).toBe(1);
    await post(base, "memory.create", {
      content: { type: "text", text: "bridge-long-lived" },
      provenance: provenance(),
      idempotencyKey: randomUUID(),
    });
    expect(getDesktopHost().generation).toBe(1);
    expect(getDesktopHost().commandsServed).toBeGreaterThan(1);
  });
});
