/**
 * Desktop Memory API — shared command names for Tauri invoke and Node DesktopHost.
 */

export type MemoryCommandName =
  | "memory.create"
  | "memory.get"
  | "memory.list"
  | "memory.update"
  | "memory.archive"
  | "memory.restore"
  | "memory.history";

/** Tauri command identifiers (snake_case invoke names). */
export const TAURI_MEMORY_COMMANDS = {
  create: "memory_create",
  get: "memory_get",
  list: "memory_list",
  update: "memory_update",
  archive: "memory_archive",
  restore: "memory_restore",
  history: "memory_history",
} as const;

export function toDesktopCommand(
  tauriName: (typeof TAURI_MEMORY_COMMANDS)[keyof typeof TAURI_MEMORY_COMMANDS]
): MemoryCommandName {
  switch (tauriName) {
    case "memory_create":
      return "memory.create";
    case "memory_get":
      return "memory.get";
    case "memory_list":
      return "memory.list";
    case "memory_update":
      return "memory.update";
    case "memory_archive":
      return "memory.archive";
    case "memory_restore":
      return "memory.restore";
    case "memory_history":
      return "memory.history";
  }
}
