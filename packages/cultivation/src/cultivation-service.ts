/**
 * Cultivation service.
 *
 * Core-backed state → V2 context → LLM → AI proposal → human acceptance → Core command
 *
 * Critical: proposals do not mutate EventStore until acceptCanonical.
 */

import { randomUUID } from "node:crypto";
import type { MemoryCell } from "@ailexsi/contracts";
import type { MemoryCommandAdapter } from "@ailexsi/v2-command-adapter";
import type {
  CultivationMessage,
  CultivationProposal,
  CultivationSession,
  LlmProvider,
  MemoryMutationProposal,
} from "./types.js";

function nowTs(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export class CultivationService {
  private sessions = new Map<string, CultivationSession>();

  constructor(
    private readonly llm: LlmProvider,
    private readonly memoryAdapter?: MemoryCommandAdapter
  ) {}

  createSession(): CultivationSession {
    const session: CultivationSession = {
      id: randomUUID(),
      messages: [],
      proposals: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): CultivationSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Build AI context from Core-backed memories (read path only).
   * Context assembly is V2-owned; facts remain Core-canonical.
   */
  assembleContext(memories: MemoryCell[]): string {
    const lines = memories.map((m) => {
      const text =
        m.content.type === "text" ? m.content.text : JSON.stringify(m.content);
      return `- [${m.identity.shortId}] v${m.currentVersion} (${m.lifecycle.state}): ${text}`;
    });
    return [
      "You are AILEXSI Cultivation assistant.",
      "Propose memory updates only; never claim canonical writes.",
      "Known Core-backed memories:",
      ...lines,
    ].join("\n");
  }

  async chat(
    sessionId: string,
    userText: string,
    contextMemories: MemoryCell[] = []
  ): Promise<{ message: CultivationMessage; proposal: MemoryMutationProposal }> {
    const session = this.requireSession(sessionId);
    const userMsg: CultivationMessage = {
      id: randomUUID(),
      role: "user",
      content: userText,
      createdAt: nowTs(),
      class: "EPHEMERAL",
    };
    session.messages.push(userMsg);

    const context = this.assembleContext(contextMemories);
    const raw = await this.llm.complete(userText, context);

    const assistantMsg: CultivationMessage = {
      id: randomUUID(),
      role: "assistant",
      content: raw,
      createdAt: nowTs(),
      class: "EPHEMERAL",
    };
    session.messages.push(assistantMsg);

    // Draft proposal from AI text — NOT written to Core.
    const proposal: MemoryMutationProposal = {
      id: randomUUID(),
      kind: "create_memory",
      status: "pending",
      createdAt: nowTs(),
      source: "mock",
      rationale: raw.slice(0, 500),
      draft: {
        content: { type: "text", text: raw.trim() || userText },
        provenance: {
          sourceType: "agent",
          sourceId: "cultivation",
          capturedAt: nowTs(),
          parentMemoryIds: contextMemories.map((m) => m.identity.id),
          evidenceIds: [],
        },
      },
    };
    session.proposals.push(proposal);
    return { message: assistantMsg, proposal };
  }

  /**
   * Reject / defer / mark edited without touching EventStore.
   */
  setProposalStatus(
    sessionId: string,
    proposalId: string,
    status: Exclude<MemoryMutationProposal["status"], "accepted">
  ): CultivationProposal {
    const session = this.requireSession(sessionId);
    const p = session.proposals.find((x) => x.id === proposalId);
    if (!p) throw new Error(`Proposal ${proposalId} not found`);
    p.status = status;
    return p;
  }

  /**
   * Accept a memory mutation proposal → Core command path.
   * Only this method may cause EventStore appends from cultivation.
   */
  async acceptCanonical(
    sessionId: string,
    proposalId: string,
    options?: { editedText?: string; idempotencyKey?: string }
  ): Promise<{ proposal: MemoryMutationProposal; cell: MemoryCell }> {
    if (!this.memoryAdapter) {
      throw new Error("MemoryCommandAdapter required for acceptCanonical");
    }
    const session = this.requireSession(sessionId);
    const p = session.proposals.find((x) => x.id === proposalId);
    if (!p || p.kind === "note") {
      throw new Error(`Memory mutation proposal ${proposalId} not found`);
    }
    if (p.status === "accepted") {
      throw new Error("Proposal already accepted");
    }

    const text = options?.editedText ??
      (p.draft.content.type === "text" ? p.draft.content.text : "");
    const content =
      p.draft.content.type === "text"
        ? { type: "text" as const, text }
        : p.draft.content;

    const key = options?.idempotencyKey ?? randomUUID();
    let cell: MemoryCell;

    if (p.kind === "update_memory" && p.draft.memoryId) {
      cell = await this.memoryAdapter.update({
        memoryId: p.draft.memoryId,
        content,
        changeReason: p.draft.changeReason ?? "cultivation-accepted",
        provenance: p.draft.provenance,
        idempotencyKey: key,
        createdBy: "cultivation",
      });
      p.status = options?.editedText ? "edited" : "accepted";
    } else {
      cell = await this.memoryAdapter.create({
        content,
        provenance: p.draft.provenance,
        idempotencyKey: key,
        createdBy: "cultivation",
      });
      p.status = options?.editedText ? "edited" : "accepted";
    }

    p.acceptedCommandIdempotencyKey = key;
    p.acceptedMemoryId = cell.identity.id;
    return { proposal: p, cell };
  }

  private requireSession(id: string): CultivationSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Session ${id} not found`);
    return s;
  }
}
