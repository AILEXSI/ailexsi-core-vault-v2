/**
 * Long-lived Desktop CoreRuntime host (Slice A).
 *
 * Process lifecycle:
 *   desktop startup → start() → createCoreRuntime() once
 *   Tauri/IPC commands → reuse same runtime
 *   desktop shutdown → stop() → runtime.close()
 *
 * Production path refuses InMemoryEventStore (createCoreRuntime requires Postgres URL).
 */

import { randomUUID } from "node:crypto";
import type { MemoryCell, MemoryVersion, UUID } from "@ailexsi/contracts";
import type { MemoryDetailView } from "@ailexsi/v2-read-models";
import {
  createCoreRuntime,
  type CoreRuntime,
  type CreateCoreRuntimeOptions,
} from "./core-runtime.js";
import type {
  V2CreateMemoryCommand,
  V2UpdateMemoryCommand,
  V2LifecycleCommand,
} from "./types.js";

export type DesktopMemoryCommand =
  | "memory.create"
  | "memory.get"
  | "memory.update"
  | "memory.archive"
  | "memory.restore"
  | "memory.history";

export interface DesktopHostStartOptions extends CreateCoreRuntimeOptions {
  /** Optional fixed connection string (tests). */
  connectionString?: string;
}

export class DesktopHost {
  private runtime: CoreRuntime | null = null;
  private startGeneration = 0;
  private commandCount = 0;

  /** True when a CoreRuntime is retained for process lifetime. */
  get isRunning(): boolean {
    return this.runtime !== null;
  }

  /** Monotonic start generation — used by tests to prove long-lived reuse. */
  get generation(): number {
    return this.startGeneration;
  }

  get commandsServed(): number {
    return this.commandCount;
  }

  /**
   * Start (or no-op if already running). Exactly one createCoreRuntime per process
   * unless stop() was called.
   */
  async start(options: DesktopHostStartOptions = {}): Promise<void> {
    if (this.runtime) {
      return;
    }
    this.runtime = await createCoreRuntime({
      ...options,
      producer: options.producer ?? "v2-desktop-host",
      environment: options.environment ?? "development",
    });
    this.startGeneration += 1;
  }

  async stop(): Promise<void> {
    if (!this.runtime) return;
    const rt = this.runtime;
    this.runtime = null;
    await rt.close();
  }

  /**
   * Require running host. Explicit failure — no InMemory fallback.
   */
  requireRuntime(): CoreRuntime {
    if (!this.runtime) {
      throw new Error(
        "DesktopHost is not started. Call start() during desktop startup " +
          "before issuing memory.* commands. No silent InMemory fallback."
      );
    }
    // Hard guard: production desktop path must be PostgresEventStore
    if (this.runtime.store.constructor.name !== "PostgresEventStore") {
      throw new Error(
        `DesktopHost refuses non-Postgres EventStore: ${this.runtime.store.constructor.name}`
      );
    }
    return this.runtime;
  }

  /** Provenance helper for store constructor assertions in tests. */
  storeConstructorName(): string {
    return this.requireRuntime().store.constructor.name;
  }

  /** Object identity of runtime for long-lived checks. */
  runtimeIdentity(): object {
    return this.requireRuntime();
  }

  private async syncReadModel(memoryId: UUID): Promise<MemoryDetailView | null> {
    const rt = this.requireRuntime();
    const cell = await rt.adapter.get(memoryId);
    if (!cell) {
      return null;
    }
    const history = await rt.adapter.getHistory(memoryId);
    rt.readModel.upsertFromCore(cell, history);
    return rt.readModel.get(memoryId);
  }

  async memoryCreate(
    cmd: Omit<V2CreateMemoryCommand, "idempotencyKey"> & {
      idempotencyKey?: string;
    }
  ): Promise<MemoryDetailView> {
    const rt = this.requireRuntime();
    this.commandCount += 1;
    const cell = await rt.adapter.create({
      ...cmd,
      idempotencyKey: cmd.idempotencyKey ?? randomUUID(),
      createdBy: cmd.createdBy ?? "v2-desktop",
    });
    const view = await this.syncReadModel(cell.identity.id);
    if (!view) {
      throw new Error("memory.create: read model missing after create");
    }
    return view;
  }

  async memoryGet(memoryId: UUID): Promise<MemoryDetailView | null> {
    this.requireRuntime();
    this.commandCount += 1;
    // Prefer read model; if cold, hydrate from Core then return view
    const rt = this.runtime!;
    let view = rt.readModel.get(memoryId);
    if (view) return view;
    return this.syncReadModel(memoryId);
  }

  async memoryUpdate(
    cmd: Omit<V2UpdateMemoryCommand, "idempotencyKey"> & {
      idempotencyKey?: string;
    }
  ): Promise<MemoryDetailView> {
    const rt = this.requireRuntime();
    this.commandCount += 1;
    const cell = await rt.adapter.update({
      ...cmd,
      idempotencyKey: cmd.idempotencyKey ?? randomUUID(),
      createdBy: cmd.createdBy ?? "v2-desktop",
    });
    const view = await this.syncReadModel(cell.identity.id);
    if (!view) {
      throw new Error("memory.update: read model missing after update");
    }
    return view;
  }

  async memoryArchive(
    cmd: Omit<V2LifecycleCommand, "idempotencyKey"> & {
      idempotencyKey?: string;
    }
  ): Promise<MemoryDetailView> {
    const rt = this.requireRuntime();
    this.commandCount += 1;
    const cell = await rt.adapter.archive({
      ...cmd,
      idempotencyKey: cmd.idempotencyKey ?? randomUUID(),
      createdBy: cmd.createdBy ?? "v2-desktop",
    });
    const view = await this.syncReadModel(cell.identity.id);
    if (!view) {
      throw new Error("memory.archive: read model missing after archive");
    }
    return view;
  }

  async memoryRestore(
    cmd: Omit<V2LifecycleCommand, "idempotencyKey"> & {
      idempotencyKey?: string;
    }
  ): Promise<MemoryDetailView> {
    const rt = this.requireRuntime();
    this.commandCount += 1;
    const cell = await rt.adapter.restore({
      ...cmd,
      idempotencyKey: cmd.idempotencyKey ?? randomUUID(),
      createdBy: cmd.createdBy ?? "v2-desktop",
    });
    const view = await this.syncReadModel(cell.identity.id);
    if (!view) {
      throw new Error("memory.restore: read model missing after restore");
    }
    return view;
  }

  async memoryHistory(memoryId: UUID): Promise<MemoryVersion[]> {
    const rt = this.requireRuntime();
    this.commandCount += 1;
    const history = await rt.adapter.getHistory(memoryId);
    // Keep read model histories aligned
    const cell = await rt.adapter.get(memoryId);
    if (cell) {
      rt.readModel.upsertFromCore(cell, history);
    }
    return history;
  }

  /**
   * EventStore raw stream for a memory — used by AAS-54 / history correspondence tests.
   */
  async eventStoreHistory(memoryId: UUID) {
    const rt = this.requireRuntime();
    return rt.store.getByAggregate(memoryId);
  }

  /**
   * CLEAR projections/read model then rebuild from EventStore (AAS-54).
   */
  async clearAndRebuildFromEventStore(): Promise<void> {
    const rt = this.requireRuntime();
    rt.adapter.clearProjection();
    rt.memoryProjection.clear();
    rt.readModel.clear();
    await rt.rebuildAll();
  }

  /**
   * Canonical cell snapshot for equality checks (not a second authority).
   */
  async getCanonicalCell(memoryId: UUID): Promise<MemoryCell | null> {
    return this.requireRuntime().adapter.get(memoryId);
  }
}

/** Process-lifetime singleton used by Tauri/IPC bridge. */
let processHost: DesktopHost | null = null;

export function getDesktopHost(): DesktopHost {
  if (!processHost) {
    processHost = new DesktopHost();
  }
  return processHost;
}

/** Test-only: replace process host (does not close previous). */
export function resetDesktopHostForTests(): void {
  processHost = new DesktopHost();
}

/**
 * IPC dispatch — single entry matching Tauri command names.
 * Desktop UI and integration suite MUST use this boundary.
 */
export async function invokeDesktopCommand(
  command: DesktopMemoryCommand,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any> = {}
): Promise<unknown> {
  const host = getDesktopHost();
  switch (command) {
    case "memory.create":
      return host.memoryCreate(args as Parameters<DesktopHost["memoryCreate"]>[0]);
    case "memory.get":
      return host.memoryGet(args.memoryId as UUID);
    case "memory.update":
      return host.memoryUpdate(args as Parameters<DesktopHost["memoryUpdate"]>[0]);
    case "memory.archive":
      return host.memoryArchive(args as Parameters<DesktopHost["memoryArchive"]>[0]);
    case "memory.restore":
      return host.memoryRestore(args as Parameters<DesktopHost["memoryRestore"]>[0]);
    case "memory.history":
      return host.memoryHistory(args.memoryId as UUID);
    default: {
      const _exhaustive: never = command;
      throw new Error(`Unknown desktop command: ${String(_exhaustive)}`);
    }
  }
}
