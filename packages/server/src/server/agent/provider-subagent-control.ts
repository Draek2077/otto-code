import {
  ProviderSubagentStore,
  type ProviderSubagentDescriptor,
  type ProviderSubagentInputEvent,
  type ProviderSubagentStoreEvent,
} from "./provider-subagents/store.js";
import type { AgentProvider, AgentSession } from "./agent-sdk-types.js";

export function providerSubagentArchiveLabel(id: string): string {
  return `otto.provider-subagent.archived.${encodeURIComponent(id)}`;
}

export interface ControlledProviderSubagent extends ProviderSubagentDescriptor {
  archivedAt?: string;
  stopScope: "child" | "parent";
}

// Otto-owned lifecycle metadata wraps upstream ingestion. Archive tombstones
// live on the parent's persisted labels, so replay cannot resurrect a row.
export class ControlledProviderSubagentStore extends ProviderSubagentStore {
  constructor(
    private readonly owner: (parentId: string) =>
      | {
          labels: Record<string, string>;
          session?: Pick<AgentSession, "stopProviderSubagent"> | null;
        }
      | undefined,
  ) {
    super();
  }

  private controlled(row: ProviderSubagentDescriptor): ControlledProviderSubagent {
    const owner = this.owner(row.parentAgentId);
    return {
      ...row,
      archivedAt: owner?.labels[providerSubagentArchiveLabel(row.id)],
      stopScope: owner?.session?.stopProviderSubagent ? "child" : "parent",
    };
  }

  override apply(
    parentId: string,
    provider: AgentProvider,
    event: ProviderSubagentInputEvent,
  ): ProviderSubagentStoreEvent {
    const result = super.apply(parentId, provider, event);
    return result.type === "upsert"
      ? { ...result, subagent: this.controlled(result.subagent) }
      : result;
  }

  override get(parentId: string, childId: string): ControlledProviderSubagent | null {
    const row = super.get(parentId, childId);
    return row ? this.controlled(row) : null;
  }

  override list(parentId: string): ControlledProviderSubagent[] {
    return super.list(parentId).map((row) => this.controlled(row));
  }

  override listAll(): ControlledProviderSubagent[] {
    return super.listAll().map((row) => this.controlled(row));
  }
}
