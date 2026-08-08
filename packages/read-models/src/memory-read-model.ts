/**
 * V2 Memory read model.
 *
 * Core MemoryProjection / MemoryDomain projection
 *        ↓
 * V2 MemoryReadModel (classified view)
 *        ↓
 * Desktop UI
 *
 * Rebuildable: CLEAR → rebuildFromCells/Events → IDENTICAL for canonical fields.
 */

import type {
  MemoryCell,
  MemoryVersion,
  UUID,
  EventEnvelope,
} from "@ailexsi/contracts";
import { MemoryProjection } from "@ailexsi/projections";
import type { ClassifiedField, FactClass } from "./classification.js";
import { classify } from "./classification.js";

export interface MemoryListItem {
  id: UUID;
  shortId: string;
  title: string;
  lifecycleState: string;
  version: number;
  tags: string[];
  project?: string;
  updatedAt: string;
  classification: Record<string, FactClass>;
}

export interface MemoryDetailView {
  id: UUID;
  shortId: string;
  content: ClassifiedField<MemoryCell["content"]>;
  context: ClassifiedField<MemoryCell["context"]>;
  meaning: ClassifiedField<MemoryCell["meaning"] | undefined>;
  provenance: ClassifiedField<MemoryCell["provenance"]>;
  evidence: ClassifiedField<MemoryCell["evidence"]>;
  lifecycle: ClassifiedField<MemoryCell["lifecycle"]>;
  timestamps: ClassifiedField<MemoryCell["timestamps"]>;
  relationRefs: ClassifiedField<MemoryCell["relationRefs"]>;
  currentVersion: ClassifiedField<number>;
  /** V2-derived display title (not a Core field). */
  displayTitle: ClassifiedField<string>;
  /** Cognitive vector is Core projection placeholder (Physics PLANNED). */
  cognitiveState: ClassifiedField<MemoryCell["cognitiveState"]>;
}

function displayTitleFrom(cell: MemoryCell): string {
  if (cell.meaning?.summary) return cell.meaning.summary;
  if (cell.content.type === "text") {
    const t = cell.content.text.trim();
    return t.length > 80 ? `${t.slice(0, 77)}...` : t;
  }
  if (cell.content.type === "structured") return "structured memory";
  return cell.content.storageRef;
}

export class MemoryReadModel {
  private cells = new Map<UUID, MemoryCell>();
  private histories = new Map<UUID, MemoryVersion[]>();
  private coreProjection = new MemoryProjection();

  /** Apply a Core-projected MemoryCell into the V2 read model. */
  upsertFromCore(cell: MemoryCell, history?: MemoryVersion[]): void {
    this.cells.set(cell.identity.id, cell);
    if (history) {
      this.histories.set(cell.identity.id, [...history]);
    }
  }

  /** Rebuild from Core MemoryProjection snapshot. */
  rebuildFromCoreProjection(projection: MemoryProjection): void {
    // Do not call clear() here — clear() also wipes coreProjection.
    this.cells.clear();
    this.histories.clear();
    for (const [id, cell] of projection.snapshot()) {
      this.cells.set(id, cell);
      this.histories.set(id, projection.getHistory(id));
    }
  }

  /**
   * Rebuild from EventStore stream using Core MemoryProjection, then mirror.
   * Proves V2 read model is rebuildable from canonical events.
   */
  rebuildFromEvents(envelopes: EventEnvelope[]): void {
    this.coreProjection.rebuildFromEvents(envelopes);
    this.rebuildFromCoreProjection(this.coreProjection);
  }

  clear(): void {
    this.cells.clear();
    this.histories.clear();
    this.coreProjection.clear();
  }

  get(id: UUID): MemoryDetailView | null {
    const cell = this.cells.get(id);
    if (!cell) return null;
    return this.toDetail(cell);
  }

  list(options?: { includeArchived?: boolean }): MemoryListItem[] {
    const includeArchived = options?.includeArchived ?? true;
    const items: MemoryListItem[] = [];
    for (const cell of this.cells.values()) {
      if (!includeArchived && cell.lifecycle.state === "archived") continue;
      items.push({
        id: cell.identity.id,
        shortId: cell.identity.shortId,
        title: displayTitleFrom(cell),
        lifecycleState: cell.lifecycle.state,
        version: cell.currentVersion,
        tags: cell.context.tags ?? [],
        project: cell.context.project,
        updatedAt: cell.timestamps.confirmedAt,
        classification: {
          id: "CANONICAL",
          lifecycleState: "CANONICAL",
          version: "CANONICAL",
          title: "DERIVED",
          tags: "CANONICAL",
        },
      });
    }
    return items.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  getHistory(id: UUID): MemoryVersion[] {
    return [...(this.histories.get(id) ?? [])];
  }

  /** Snapshot of canonical cells for AAS-54 equality. */
  snapshotCells(): Map<UUID, MemoryCell> {
    return new Map(this.cells);
  }

  private toDetail(cell: MemoryCell): MemoryDetailView {
    return {
      id: cell.identity.id,
      shortId: cell.identity.shortId,
      content: classify(cell.content, "CANONICAL", "core.MemoryCell.content"),
      context: classify(cell.context, "CANONICAL", "core.MemoryCell.context"),
      meaning: classify(cell.meaning, "CANONICAL", "core.MemoryCell.meaning"),
      provenance: classify(
        cell.provenance,
        "CANONICAL",
        "core.MemoryCell.provenance"
      ),
      evidence: classify(cell.evidence, "CANONICAL", "core.MemoryCell.evidence"),
      lifecycle: classify(
        cell.lifecycle,
        "CANONICAL",
        "core.MemoryCell.lifecycle"
      ),
      timestamps: classify(
        cell.timestamps,
        "CANONICAL",
        "core.MemoryCell.timestamps"
      ),
      relationRefs: classify(
        cell.relationRefs,
        "CANONICAL",
        "core.MemoryCell.relationRefs"
      ),
      currentVersion: classify(
        cell.currentVersion,
        "CANONICAL",
        "core.MemoryCell.currentVersion"
      ),
      displayTitle: classify(
        displayTitleFrom(cell),
        "DERIVED",
        "v2.MemoryReadModel.displayTitle"
      ),
      cognitiveState: classify(
        cell.cognitiveState,
        "CANONICAL",
        "core.MemoryCell.cognitiveState (zero placeholder; Physics PLANNED)"
      ),
    };
  }
}
