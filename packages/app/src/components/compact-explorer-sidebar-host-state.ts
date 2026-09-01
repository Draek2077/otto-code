import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { ExplorerTab } from "@/stores/panel-store";

export interface CompactExplorerSidebarHostModel {
  serverId: string;
  workspaceId: string;
  persistenceKey: string;
  workspaceRoot: string;
  isGit: boolean;
}

export function resolveCompactExplorerTabs(input: {
  activeTab: ExplorerTab;
  isDeveloperMode: boolean;
  isGit: boolean;
  hasProjectSearch: boolean;
  showPullRequest: boolean;
}): { activeTab: ExplorerTab; tabs: ExplorerTab[] } {
  if (!input.isDeveloperMode) {
    return { activeTab: "files", tabs: ["files"] };
  }
  const tabs: ExplorerTab[] = input.isGit ? ["changes", "files"] : ["files"];
  if (input.hasProjectSearch) tabs.push("search");
  if (input.isGit && input.showPullRequest) tabs.push("pr");
  let activeTab = input.activeTab;
  if (!input.isGit && (activeTab === "changes" || activeTab === "pr")) {
    activeTab = "files";
  } else if (activeTab === "search" && !input.hasProjectSearch) {
    activeTab = "files";
  } else if (activeTab === "pr" && !input.showPullRequest) {
    activeTab = input.isGit ? "changes" : "files";
  }
  return { activeTab, tabs };
}

interface ResolveCompactExplorerSidebarHostModelInput {
  previous: CompactExplorerSidebarHostModel | null;
  selection: ActiveWorkspaceSelection | null;
  workspace: WorkspaceDescriptor | null;
  isGit: boolean;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveCompactExplorerSidebarHostModel(
  input: ResolveCompactExplorerSidebarHostModelInput,
): CompactExplorerSidebarHostModel | null {
  const serverId = trimNonEmpty(input.selection?.serverId);
  const workspaceId = trimNonEmpty(input.selection?.workspaceId);
  if (!serverId || !workspaceId) {
    return null;
  }

  const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  if (!persistenceKey) {
    return null;
  }

  const previousForSelection =
    input.previous &&
    input.previous.serverId === serverId &&
    input.previous.workspaceId === workspaceId
      ? input.previous
      : null;

  return {
    serverId,
    workspaceId,
    persistenceKey,
    workspaceRoot:
      trimNonEmpty(input.workspace?.workspaceDirectory) ??
      previousForSelection?.workspaceRoot ??
      "",
    isGit: input.workspace ? input.isGit : (previousForSelection?.isGit ?? input.isGit),
  };
}
