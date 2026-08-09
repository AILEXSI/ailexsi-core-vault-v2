/**
 * Unified Memory client for Desktop UI.
 *
 * Prefer order:
 *  1) Tauri invoke → Rust proxy → DesktopHost HTTP bridge
 *  2) Direct HTTP to DesktopHost bridge (Vite dev / fallback)
 *
 * Never stores canonical memory in UI state as authority.
 */

import { TAURI_MEMORY_COMMANDS } from "./memory-api";

export type MemoryDetailView = {
  id: string;
  shortId: string;
  content: { class: string; value: { type?: string; text?: string } };
  lifecycle: { value: { state: string } };
  currentVersion: { value: number };
  displayTitle: { value: string };
  timestamps: { value: { confirmedAt?: string } };
};

export type MemoryListItem = {
  id: string;
  shortId: string;
  title: string;
  lifecycleState: string;
  version: number;
  tags: string[];
  updatedAt: string;
};

const DEFAULT_BRIDGE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_DESKTOP_HOST_URL ||
  "http://127.0.0.1:17890";

function bridgeBase(): string {
  return (
    (import.meta as { env?: Record<string, string> }).env
      ?.VITE_DESKTOP_HOST_URL || DEFAULT_BRIDGE
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tauriInvoke(cmd: string, args: Record<string, any>): Promise<unknown> {
  // Tauri 2 global
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const core = w.__TAURI__?.core ?? w.__TAURI_INTERNALS__;
  if (!core?.invoke) {
    throw new Error("Tauri invoke not available");
  }
  return core.invoke(cmd, args);
}

export async function isTauri(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

export async function bridgeHealth(): Promise<{
  ok: boolean;
  store: string | null;
  running: boolean;
  detail?: string;
}> {
  try {
    const res = await fetch(`${bridgeBase()}/health`);
    const body = await res.json();
    return {
      ok: Boolean(body.ok),
      store: body.store ?? null,
      running: Boolean(body.running),
      detail: body.path,
    };
  } catch (e) {
    return {
      ok: false,
      store: null,
      running: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function httpCommand(
  command: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any> = {}
): Promise<unknown> {
  const res = await fetch(`${bridgeBase()}/commands/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `bridge ${command} failed (${res.status})`);
  }
  return body.result;
}

/**
 * Dispatch a memory command through Tauri bridge or HTTP DesktopHost.
 */
export async function memoryCommand(
  command:
    | "memory.create"
    | "memory.get"
    | "memory.list"
    | "memory.update"
    | "memory.archive"
    | "memory.restore"
    | "memory.history",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any> = {}
): Promise<unknown> {
  if (await isTauri()) {
    const map: Record<string, string> = {
      "memory.create": TAURI_MEMORY_COMMANDS.create,
      "memory.get": TAURI_MEMORY_COMMANDS.get,
      "memory.list": "memory_list",
      "memory.update": TAURI_MEMORY_COMMANDS.update,
      "memory.archive": TAURI_MEMORY_COMMANDS.archive,
      "memory.restore": TAURI_MEMORY_COMMANDS.restore,
      "memory.history": TAURI_MEMORY_COMMANDS.history,
    };
    const tauriCmd = map[command];
    try {
      // Rust returns { ok, result } or result directly
      const raw = await tauriInvoke(tauriCmd, {
        payload: args,
        memoryId: args.memoryId,
        memory_id: args.memoryId,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = raw as any;
      if (r && typeof r === "object" && "result" in r) return r.result;
      return raw;
    } catch {
      // Fall through to HTTP if Rust proxy unavailable
    }
  }
  return httpCommand(command, args);
}

export async function createMemory(text: string): Promise<MemoryDetailView> {
  const now = new Date().toISOString();
  return (await memoryCommand("memory.create", {
    content: { type: "text", text },
    provenance: {
      sourceType: "user",
      capturedAt: now,
      parentMemoryIds: [],
      evidenceIds: [],
    },
    createdBy: "v2-desktop-ui",
  })) as MemoryDetailView;
}

export async function getMemory(id: string): Promise<MemoryDetailView | null> {
  return (await memoryCommand("memory.get", { memoryId: id })) as MemoryDetailView | null;
}

export async function listMemories(): Promise<MemoryListItem[]> {
  return (await memoryCommand("memory.list", {
    includeArchived: true,
  })) as MemoryListItem[];
}
