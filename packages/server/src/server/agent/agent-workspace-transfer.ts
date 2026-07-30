import type { StoredAgentRecord } from "./agent-storage.js";

/**
 * Moving a chat into another workspace.
 *
 * This is a one-field re-stamp and nothing more. Ownership *is* `workspaceId`
 * (see `ManagedAgent.workspaceId`): agent state on disk is keyed by agent id,
 * the timeline store is keyed by agent id, and clients derive which workspace
 * shows a chat from that single field. So there is nothing to migrate alongside
 * it, and no reason to restrict which workspace may receive it.
 *
 * `cwd` is deliberately untouched. The two answer different questions, and the
 * daemon has never required them to agree: an agent's cwd can already be a
 * subdirectory of its workspace, and nothing validates one against the other. A
 * moved chat keeps running where it was started, which is the only behaviour
 * that is true to a session already rooted on disk.
 */

/** Just enough of a workspace to decide whether it can receive a chat. */
export interface TransferTargetWorkspace {
  workspaceId: string;
  archivedAt: string | null;
  hidden?: boolean;
}

export interface AgentWorkspaceTransferDependencies {
  /** Resolves the chat's current owner, live or closed. Null when unknown. */
  getAgentWorkspaceId: (agentId: string) => Promise<{ workspaceId: string | undefined } | null>;
  getWorkspace: (workspaceId: string) => Promise<TransferTargetWorkspace | null>;
  transfer: (
    agentId: string,
    workspaceId: string,
  ) => Promise<{ record: StoredAgentRecord; live: boolean }>;
}

export type AgentWorkspaceTransferResult =
  | {
      status: "transferred";
      record: StoredAgentRecord;
      live: boolean;
      /** Null for a legacy chat that was never stamped with an owner. */
      previousWorkspaceId: string | null;
      workspaceId: string;
    }
  /**
   * The chat already lives there. Success, not an error: two clients racing the
   * same move, or a double-tapped menu item, should not raise a failure for a
   * state the user already wanted.
   */
  | { status: "unchanged"; workspaceId: string }
  | { status: "refused"; error: string };

export async function transferAgentWorkspaceCommand(
  dependencies: AgentWorkspaceTransferDependencies,
  input: { agentId: string; workspaceId: string },
): Promise<AgentWorkspaceTransferResult> {
  const agent = await dependencies.getAgentWorkspaceId(input.agentId);
  if (!agent) {
    return { status: "refused", error: "Chat not found" };
  }

  if (agent.workspaceId === input.workspaceId) {
    return { status: "unchanged", workspaceId: input.workspaceId };
  }

  const target = await dependencies.getWorkspace(input.workspaceId);
  if (!target) {
    return { status: "refused", error: "Workspace not found" };
  }
  if (target.archivedAt) {
    return { status: "refused", error: "That workspace has been archived" };
  }
  // Hidden workspaces are transient schedule-run scaffolding the daemon pretends
  // does not exist. A chat moved into one would be stranded somewhere no client
  // ever lists.
  if (target.hidden) {
    return { status: "refused", error: "That workspace is not available" };
  }

  const { record, live } = await dependencies.transfer(input.agentId, input.workspaceId);
  return {
    status: "transferred",
    record,
    live,
    previousWorkspaceId: agent.workspaceId ?? null,
    workspaceId: input.workspaceId,
  };
}
