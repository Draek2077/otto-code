import type { Run } from "@otto-code/protocol/workflow";
import { supportsDesktopPaneSplits } from "@/constants/layout";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceTabTarget,
} from "@/stores/workspace-tabs-store";
import {
  collectAllTabs,
  createDefaultLayout,
  findPaneContainingTab,
  normalizeLayout,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { collectWorkflowWorkerAgentIds } from "./workflow-workers";

function isRootFolderWorkspace(workspace: WorkspaceDescriptor): boolean {
  return (
    workspace.workspaceKind !== "worktree" &&
    normalizeWorkspacePath(workspace.workspaceDirectory) ===
      normalizeWorkspacePath(workspace.projectRootPath)
  );
}

function belongsToRunProject(
  workspace: WorkspaceDescriptor,
  run: Pick<Run, "cwd" | "workflowStorage">,
): boolean {
  const projectId = run.workflowStorage?.projectId;
  if (projectId && workspace.projectId === projectId) {
    return true;
  }
  const projectRoot = normalizeWorkspacePath(workspace.projectRootPath);
  return (
    projectRoot !== null &&
    (projectRoot === normalizeWorkspacePath(run.workflowStorage?.projectRoot) ||
      projectRoot === normalizeWorkspacePath(run.cwd))
  );
}

/**
 * Where a run opens. Its own workspace while that is still open - that is where
 * its chats live - otherwise the project's root folder workspace, the one a
 * user reaches for when the run's worktree is gone. Null when neither is open.
 */
export function resolveWorkflowWorkspaceId(
  run: Pick<Run, "workspaceId" | "cwd" | "workflowStorage">,
  workspaces: ReadonlyMap<string, WorkspaceDescriptor> | undefined,
): string | null {
  if (!workspaces) {
    return null;
  }
  const own = run.workspaceId ? workspaces.get(run.workspaceId) : undefined;
  if (own && !own.archivingAt) {
    return own.id;
  }
  for (const workspace of workspaces.values()) {
    if (
      !workspace.archivingAt &&
      isRootFolderWorkspace(workspace) &&
      belongsToRunProject(workspace, run)
    ) {
      return workspace.id;
    }
  }
  return null;
}

export interface OpenWorkflowRunTabInput {
  serverId: string;
  workspaceId: string;
  runId: string;
  /** Carry the user to the workspace. The Workflows page lives outside every
   * workspace, so an open there is invisible without it. */
  navigate?: boolean;
}

/** Open (or focus) a run's detail tab. One per run per workspace. */
export function openWorkflowRunTab(input: OpenWorkflowRunTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  const target: WorkspaceTabTarget = { kind: "workflowRun", runId: input.runId };
  useWorkspaceLayoutStore.getState().openTabFocused(workspaceKey, target, {
    insertAfterFocusedTab: true,
  });
  if (input.navigate) {
    // The named target is authoritative, per docs/expo-router.md, so an
    // attention chat cannot open over the tab the user asked for.
    navigateToWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId, target });
  }
  return true;
}

export interface OpenWorkflowChatTabInput {
  serverId: string;
  workspaceId: string;
  run: Pick<Run, "id" | "phases">;
  agentId: string;
}

/**
 * Open one of a run's chats beside its Workflow tab. The first one splits to
 * the right; later ones join the pane that already shows the run's chats, so
 * reading several never stacks a new split per chat. Pinned, because a worker
 * is archived once the run settles and an unpinned archived chat's tab is
 * pruned on the next reconcile.
 */
export function openWorkflowChatTab(input: OpenWorkflowChatTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  const store = useWorkspaceLayoutStore.getState();
  const target: WorkspaceTabTarget = { kind: "agent", agentId: input.agentId };
  const layout = normalizeLayout(store.layoutByWorkspace[workspaceKey] ?? createDefaultLayout());
  const tabs = collectAllTabs(layout.root);
  const paneOf = (tabId: string) => findPaneContainingTab(layout.root, tabId)?.id ?? null;

  const alreadyOpen = tabs.some(
    (tab) => tab.target.kind === "agent" && tab.target.agentId === input.agentId,
  );
  if (alreadyOpen) {
    store.openTab({ workspaceKey, target, intent: "reveal", pin: true });
    return true;
  }

  const runTab = tabs.find(
    (tab) => tab.target.kind === "workflowRun" && tab.target.runId === input.run.id,
  );
  const runPaneId = runTab ? paneOf(runTab.tabId) : null;
  const workerIds = collectWorkflowWorkerAgentIds(input.run);
  const companionTab = tabs.find(
    (tab) =>
      tab.target.kind === "agent" &&
      workerIds.has(tab.target.agentId) &&
      paneOf(tab.tabId) !== runPaneId,
  );
  const companionPaneId = companionTab ? paneOf(companionTab.tabId) : null;
  if (companionPaneId) {
    store.openTab({
      workspaceKey,
      target,
      intent: "reveal",
      pin: true,
      placement: { mode: "prefer", paneId: companionPaneId },
    });
    return true;
  }

  const tabId = store.openTab({ workspaceKey, target, intent: "reveal", pin: true });
  if (tabId && runPaneId && supportsDesktopPaneSplits()) {
    const opened = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    if (opened && findPaneContainingTab(normalizeLayout(opened).root, tabId)?.id === runPaneId) {
      // Depth-capped splits return null; the tab then stays beside the run.
      useWorkspaceLayoutStore.getState().splitPane(workspaceKey, {
        tabId,
        targetPaneId: runPaneId,
        position: "right",
      });
    }
  }
  return true;
}
