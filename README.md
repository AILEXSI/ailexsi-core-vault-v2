# AILEXSI Core Vault V2

This repository is **AILEXSI Core Vault V2**.

It is a **new generation** of the Vault.

It uses **AILEXSI Core** as the canonical Cortex foundation.

The original Core and Vault repositories remain independent reference baselines.

---

## Baselines (frozen)

| Role | Repository | SHA |
|------|------------|-----|
| **CORE BASELINE** (canonical Cortex) | `AILEXSI/ailexsi-core` | `652d01eb06dd0841c3b475023883675af6dcd698` |
| **VAULT REFERENCE** (capability reference) | `AILEXSI/ailexsi-core-vault` | `061e444389090c54e431b0e8243e82764f2c198e` |

These are **dependencies/references**, not files to copy into V2.

```text
CORE = READ ONLY
CURRENT VAULT = READ ONLY
V2 = ONLY WRITE TARGET
```

Do **not** modify Core, do **not** modify the current Vault, do **not** implement Core Phase 08 here.

---

## Architectural principle

> **The Core is authoritative for canonical facts. Vault V2 is authoritative for derived cognition, presentation, cultivation, retrieval and user interaction.**

See:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/SOURCE-OF-TRUTH.md](docs/SOURCE-OF-TRUTH.md)
- [docs/CORE-INTEGRATION.md](docs/CORE-INTEGRATION.md)
- [docs/CONTINUITY.md](docs/CONTINUITY.md)
- [docs/MIGRATION.md](docs/MIGRATION.md)
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)

---

## Repository layout

```text
ailexsi-core-vault-v2/
  apps/desktop/          Tauri 2 + React + TypeScript foundation
  packages/
    command-adapter/     V2 → Core MemoryDomain command path
    read-models/         Classified V2 read models (rebuildable)
    cultivation/         AI proposals + acceptance writeback
    continuity/          Derived portable Continuity artifacts
    migration/           Read-only scan/parse/validate/report
    connectome/          Presentation graph (no Core Relation domain)
    test-kit/            In-memory EventStore double for tests
  tests/
    unit/
    integration/
    migration/
    acceptance/
  docs/
  config/
  scripts/
```

---

## Quick start

```bash
# 1) Install deps
npm install

# 2) Fetch pinned Core (and optional Vault reference) into .deps/ (gitignored)
npm run setup:core

# 3) Run tests
npm test

# 4) Acceptance gate
npm run acceptance

# 5) Desktop UI (web mode)
npm run desktop:dev
```

### Environment

Copy `config/env.example` → `.env`:

- `CORE_DATABASE_URL` — Core EventStore DB for this V2 environment only  
- `V2_DATABASE_URL` — optional derived/index DB (**DERIVED / REBUILDABLE / NON-CANONICAL**)

Never connect V2 development to production Core databases.

---

## Foundation milestone status labels

| Capability | Status |
|------------|--------|
| Memory command path (create/get/update/archive/restore/getHistory) | VERIFIED (tests) |
| Read models (classified, rebuildable) | VERIFIED (tests) |
| Continuity package foundation | VERIFIED (tests) |
| Cultivation + AI writeback safety | VERIFIED (tests) |
| Migration scanner (no production write) | VERIFIED (tests) |
| Connectome MVP presentation | PARTIAL |
| Desktop Tauri shell | PARTIAL (foundation UI) |
| Physics / Knowledge / Reflection / Learning / Trust / Scheduler | PLANNED (Core) |
| Full Connectome ontology | PLANNED |
| Production vault migration writeback | NOT STARTED (foundation tooling only) |

---

## Safety rules

1. **No canonical V2 fact may be persisted outside the Core event path.**
2. Filesystem may hold exports, snapshots, imports, logs, UI artifacts — never as authoritative canonical store.
3. AI proposals are never auto-canonical; only accepted mutations enter Core commands.
4. Continuity is a **derived portable artifact**, not EventStore replacement.

---

## License

MIT — AILEXSI
