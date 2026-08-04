import type { AgentStorage } from "./agent/agent-storage.js";
import { findOccupyingWorkspaceForCwd } from "./otto-worktree-service.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

export interface RevealScheduleRunWorkspaceDeps {
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "list" | "upsert">;
  agentStorage: Pick<AgentStorage, "list" | "upsert">;
  /** Record-only archive (no directory removal) - the transient record's disposal. */
  archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
  now?: () => Date;
}

export type RevealScheduleRunWorkspaceOutcome =
  | { kind: "noop" }
  | { kind: "revealed"; workspaceId: string }
  | {
      kind: "reattached";
      workspaceId: string;
      occupantWorkspaceId: string;
      movedAgentIds: string[];
    };

/**
 * Disposition for a finished schedule run's hidden workspace.
 *
 * Schedule runs mint their workspace `hidden: true` and are therefore exempt
 * from the occupancy guard (`WorkspaceDirectoryOccupiedError`). That exemption
 * is granted on the promise that the record stays invisible - so revealing one
 * onto a directory a visible workspace already backs would break the promise and
 * mint exactly the duplicate the guard refuses at creation time. One directory
 * is one physical git checkout; two visible workspaces on it can never be
 * independent.
 *
 * So when the directory is occupied we **reattach instead of revealing**: the
 * run's agents move to the occupying workspace and the transient record is
 * archived. The run is already over by the time either caller reaches here
 * (post-run disposal, or interrupted-run recovery at startup), so nothing is
 * mid-flight. The outcome stays visible - in the workspace the user already has
 * open on that folder, which is where they would look for it anyway.
 *
 * Worktree-isolation runs get a fresh directory that nothing else can occupy, so
 * they always take the plain reveal path.
 */
export async function revealScheduleRunWorkspace(
  workspaceId: string,
  deps: RevealScheduleRunWorkspaceDeps,
): Promise<RevealScheduleRunWorkspaceOutcome> {
  const existing = await deps.workspaceRegistry.get(workspaceId);
  if (!existing || !existing.hidden || existing.archivedAt) {
    return { kind: "noop" };
  }

  const timestamp = (deps.now?.() ?? new Date()).toISOString();
  const occupant = findOccupyingWorkspaceForCwd(await deps.workspaceRegistry.list(), existing.cwd);

  if (!occupant) {
    await deps.workspaceRegistry.upsert({ ...existing, hidden: false, updatedAt: timestamp });
    return { kind: "revealed", workspaceId };
  }

  const movedAgentIds: string[] = [];
  for (const record of await deps.agentStorage.list()) {
    if (record.workspaceId !== workspaceId) {
      continue;
    }
    await deps.agentStorage.upsert({ ...record, workspaceId: occupant.workspaceId });
    movedAgentIds.push(record.id);
  }
  // Archive after the move so the cascade finds nothing left to take with it.
  await deps.archiveWorkspaceRecord(workspaceId);

  return {
    kind: "reattached",
    workspaceId,
    occupantWorkspaceId: occupant.workspaceId,
    movedAgentIds,
  };
}
