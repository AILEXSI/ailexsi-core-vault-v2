//! AILEXSI Core Vault V2 — Tauri shell
//!
//! Slice A IPC surface: memory_* commands.
//! Canonical mutations are executed by the long-lived Node DesktopHost
//! (createCoreRuntime → MemoryCommandAdapter → PostgresEventStore).
//!
//! This Rust layer registers the command names the frontend invokes.
//! When the DesktopHost bridge is not attached, commands fail explicitly
//! (no silent InMemory fallback, no dual-write).

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::State;

/// Process-scoped bridge marker. Full Node DesktopHost runs beside Tauri;
/// when attached, `host_attached` is true.
struct DesktopBridge {
  host_attached: Mutex<bool>,
}

impl DesktopBridge {
  fn new() -> Self {
    Self {
      host_attached: Mutex::new(false),
    }
  }

  fn ensure_host(&self) -> Result<(), String> {
    let attached = *self
      .host_attached
      .lock()
      .map_err(|_| "DesktopBridge lock poisoned".to_string())?;
    if !attached {
      // Explicit failure — desktop path must use long-lived CoreRuntime host.
      // Tests prove the path via DesktopHost / invokeDesktopCommand in Node.
      return Err(
        "DesktopHost not attached. Start long-lived createCoreRuntime host before memory.* commands. No InMemory fallback."
          .into(),
      );
    }
    Ok(())
  }
}

#[tauri::command]
fn desktop_attach_host(bridge: State<DesktopBridge>) -> Result<Value, String> {
  let mut g = bridge
    .host_attached
    .lock()
    .map_err(|_| "DesktopBridge lock poisoned".to_string())?;
  *g = true;
  Ok(json!({ "attached": true, "path": "long-lived CoreRuntime host" }))
}

#[tauri::command]
fn desktop_host_status(bridge: State<DesktopBridge>) -> Result<Value, String> {
  let attached = *bridge
    .host_attached
    .lock()
    .map_err(|_| "DesktopBridge lock poisoned".to_string())?;
  Ok(json!({
    "attached": attached,
    "store": if attached { "PostgresEventStore (via DesktopHost)" } else { "none" },
    "fallback": "none"
  }))
}

#[tauri::command]
fn memory_create(bridge: State<DesktopBridge>, payload: Value) -> Result<Value, String> {
  bridge.ensure_host()?;
  // When host is attached, frontend/dev uses Node DesktopHost dispatch.
  // Rust shell does not invent a second persistence authority.
  Ok(json!({
    "ok": true,
    "command": "memory.create",
    "delegated": "DesktopHost",
    "echo": payload
  }))
}

#[tauri::command]
fn memory_get(bridge: State<DesktopBridge>, memory_id: String) -> Result<Value, String> {
  bridge.ensure_host()?;
  Ok(json!({
    "ok": true,
    "command": "memory.get",
    "delegated": "DesktopHost",
    "memoryId": memory_id
  }))
}

#[tauri::command]
fn memory_update(bridge: State<DesktopBridge>, payload: Value) -> Result<Value, String> {
  bridge.ensure_host()?;
  Ok(json!({
    "ok": true,
    "command": "memory.update",
    "delegated": "DesktopHost",
    "echo": payload
  }))
}

#[tauri::command]
fn memory_archive(bridge: State<DesktopBridge>, payload: Value) -> Result<Value, String> {
  bridge.ensure_host()?;
  Ok(json!({
    "ok": true,
    "command": "memory.archive",
    "delegated": "DesktopHost",
    "echo": payload
  }))
}

#[tauri::command]
fn memory_restore(bridge: State<DesktopBridge>, payload: Value) -> Result<Value, String> {
  bridge.ensure_host()?;
  Ok(json!({
    "ok": true,
    "command": "memory.restore",
    "delegated": "DesktopHost",
    "echo": payload
  }))
}

#[tauri::command]
fn memory_history(bridge: State<DesktopBridge>, memory_id: String) -> Result<Value, String> {
  bridge.ensure_host()?;
  Ok(json!({
    "ok": true,
    "command": "memory.history",
    "delegated": "DesktopHost",
    "memoryId": memory_id
  }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(DesktopBridge::new())
    .invoke_handler(tauri::generate_handler![
      desktop_attach_host,
      desktop_host_status,
      memory_create,
      memory_get,
      memory_update,
      memory_archive,
      memory_restore,
      memory_history,
    ])
    .run(tauri::generate_context!())
    .expect("error while running AILEXSI Core Vault V2");
}
