import { useCallback, useEffect, useState } from "react";
import {
  bridgeHealth,
  createMemory,
  getMemory,
  listMemories,
  type MemoryDetailView,
  type MemoryListItem,
} from "../ipc/memory-client";

export function MemoryPanel() {
  const [text, setText] = useState("");
  const [items, setItems] = useState<MemoryListItem[]>([]);
  const [selected, setSelected] = useState<MemoryDetailView | null>(null);
  const [status, setStatus] = useState<string>("checking bridge…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    const h = await bridgeHealth();
    if (h.ok) {
      setStatus("DesktopHost connected");
      setStore(h.store);
      setError(null);
    } else {
      setStatus("DesktopHost offline");
      setStore(null);
      setError(
        h.detail ||
          "Start bridge: npm run desktop:host (requires CORE_DATABASE_URL)"
      );
    }
    return h.ok;
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const list = await listMemories();
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await refreshHealth();
      if (ok) await refreshList();
    })();
  }, [refreshHealth, refreshList]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const view = await createMemory(text.trim());
      setText("");
      setSelected(view);
      await refreshList();
      await refreshHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSelect(id: string) {
    setBusy(true);
    setError(null);
    try {
      const view = await getMemory(id);
      setSelected(view);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="memory-panel">
      <div className="card">
        <h2>Memory — Core-backed</h2>
        <p className="muted">
          Path: UI → Bridge → long-lived DesktopHost → MemoryCommandAdapter →
          PostgresEventStore → Projection → Read Model
        </p>
        <p className="muted">
          Status: <strong>{status}</strong>
          {store ? (
            <>
              {" "}
              · store: <code>{store}</code>
            </>
          ) : null}
        </p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Create</h2>
        <form onSubmit={onCreate} className="memory-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a memory…"
            rows={4}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !text.trim()}>
            {busy ? "Saving…" : "Create via Core"}
          </button>
        </form>
      </div>

      <div className="memory-grid">
        <div className="card">
          <div className="row-between">
            <h2>List</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => void refreshList()}
              disabled={busy}
            >
              Refresh
            </button>
          </div>
          {items.length === 0 ? (
            <p className="muted">No memories in read model yet.</p>
          ) : (
            <ul className="memory-list">
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={
                      selected?.id === m.id ? "memory-item active" : "memory-item"
                    }
                    onClick={() => void onSelect(m.id)}
                  >
                    <span className="title">{m.title}</span>
                    <span className="meta">
                      v{m.version} · {m.lifecycleState} · {m.shortId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Detail</h2>
          {!selected ? (
            <p className="muted">Select a memory to load via memory.get</p>
          ) : (
            <div className="detail">
              <p>
                <span className="badge core">CANONICAL</span>
                <code>{selected.id}</code>
              </p>
              <p className="muted">
                version {selected.currentVersion.value} · lifecycle{" "}
                {selected.lifecycle.value.state}
              </p>
              <pre className="content-block">
                {selected.content.value?.text ??
                  JSON.stringify(selected.content.value, null, 2)}
              </pre>
              <p className="muted">
                displayTitle (DERIVED): {selected.displayTitle.value}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
