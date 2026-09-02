import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";
import { encodeFilePathForPathSegment, encodeWorkspaceIdForPathSegment } from "@/utils/host-routes";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

export type WorkspaceTabMenuSurface = "desktop" | "mobile";
export type WorkspaceTabMenuOrientation = "horizontal" | "vertical";
export type FileTabCopyTarget = "filename" | "full-path" | "workspace-path";

export interface WorkspaceTabMenuLabels {
  copyResumeCommand: string;
  copyAgentId: string;
  copyTerminalId: string;
  copyFilename: string;
  copyFullPath: string;
  copyWorkspacePath: string;
  rename: string;
  moveToWorkspace: string;
  moveToExplorer: string;
  closeAbove: string;
  closeBelow: string;
  closeLeft: string;
  closeRight: string;
  closeUp: string;
  closeDown: string;
  closeOthers: string;
  reloadAgent: string;
  reloadAgentTooltip: string;
  close: string;
  archive?: string;
  delete?: string;
}

export const DEFAULT_WORKSPACE_TAB_MENU_LABELS: WorkspaceTabMenuLabels = {
  copyResumeCommand: i18n.t("workspace.tabs.menu.copyResumeCommand"),
  copyAgentId: i18n.t("workspace.tabs.menu.copyAgentId"),
  copyTerminalId: i18n.t("workspace.tabs.menu.copyTerminalId"),
  copyFilename: i18n.t("workspace.tabs.menu.copyFilename"),
  copyFullPath: i18n.t("workspace.tabs.menu.copyFullPath"),
  copyWorkspacePath: i18n.t("workspace.tabs.menu.copyWorkspacePath"),
  rename: i18n.t("workspace.tabs.menu.rename"),
  moveToWorkspace: i18n.t("workspace.tabs.menu.moveToWorkspace"),
  moveToExplorer: i18n.t("workspace.tabs.menu.moveToExplorer"),
  closeAbove: i18n.t("workspace.tabs.menu.closeAbove"),
  closeBelow: i18n.t("workspace.tabs.menu.closeBelow"),
  closeLeft: i18n.t("workspace.tabs.menu.closeLeft"),
  closeRight: i18n.t("workspace.tabs.menu.closeRight"),
  closeUp: i18n.t("workspace.tabs.menu.closeUp"),
  closeDown: i18n.t("workspace.tabs.menu.closeDown"),
  closeOthers: i18n.t("workspace.tabs.menu.closeOthers"),
  reloadAgent: i18n.t("workspace.tabs.menu.reloadAgent"),
  reloadAgentTooltip: i18n.t("workspace.tabs.menu.reloadAgentTooltip"),
  close: i18n.t("workspace.tabs.menu.close"),
  archive: i18n.t("workspace.tabs.confirmations.archive"),
  delete: i18n.t("workspace.tabs.confirmations.delete"),
};

export type WorkspaceTabMenuEntry =
  | {
      kind: "item";
      key: string;
      label: string;
      icon?:
        | "copy"
        | "rotate-cw"
        | "arrow-left-to-line"
        | "arrow-right-to-line"
        | "copy-x"
        | "pencil"
        | "folder-open"
        | "x";
      hint?: string;
      tooltip?: string;
      disabled?: boolean;
      destructive?: boolean;
      testID: string;
      onSelect: () => void;
    }
  | {
      kind: "separator";
      key: string;
    };

interface BuildWorkspaceTabMenuEntriesInput {
  surface: WorkspaceTabMenuSurface;
  orientation?: WorkspaceTabMenuOrientation;
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  menuTestIDBase: string;
  workspaceDirectory?: string | null;
  // User mode omits the developer-only entries (copy resume command, copy agent
  // id, copy file path, reload agent); tab-management entries stay.
  isDeveloperMode: boolean;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string, target?: FileTabCopyTarget) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsBefore: (tabId: string) => Promise<void> | void;
  onCloseTabsAfter: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
  // Absent on hosts whose daemon predates agent.workspace.transfer, and false
  // when there is nowhere to move to. Either way the entry is omitted rather
  // than shown disabled: a dead menu row teaches the user nothing.
  onMoveToWorkspace?: (agentId: string) => void;
  canMoveToWorkspace?: boolean;
  onMoveToExplorer?: (tabId: string) => void;
  canMoveToExplorer?: boolean;
  labels?: WorkspaceTabMenuLabels;
}

interface BuildWorkspaceDesktopTabActionsInput {
  tab: WorkspaceTabDescriptor;
  orientation?: WorkspaceTabMenuOrientation;
  index: number;
  tabCount: number;
  workspaceDirectory?: string | null;
  isDeveloperMode: boolean;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string, target?: FileTabCopyTarget) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
  onMoveToWorkspace?: (agentId: string) => void;
  canMoveToWorkspace?: boolean;
  onMoveToExplorer?: (tabId: string) => void;
  canMoveToExplorer?: boolean;
  labels?: WorkspaceTabMenuLabels;
}

export interface WorkspaceDesktopTabActions {
  contextMenuTestId: string;
  menuEntries: WorkspaceTabMenuEntry[];
  closeButtonTestId: string;
  canClose: boolean;
}

/** Explorer surfaces are workspace fixtures, not disposable document tabs. */
export function canCloseWorkspaceTab(tab: WorkspaceTabDescriptor): boolean {
  switch (tab.target.kind) {
    case "files":
    case "working_diff":
    case "changes_tree":
    case "project_search":
      return false;
    default:
      return true;
  }
}

// Close direction follows the axis the tabs stack along, not the surface. Mobile
// stacks vertically (up/down), desktop horizontal stacks left/right, and desktop
// vertical (the rail) stacks up/down.
function isVerticalStack(
  surface: WorkspaceTabMenuSurface,
  orientation: WorkspaceTabMenuOrientation,
): boolean {
  return surface === "mobile" || orientation === "vertical";
}

function buildCloseBeforeLabel(
  surface: WorkspaceTabMenuSurface,
  orientation: WorkspaceTabMenuOrientation,
  labels: WorkspaceTabMenuLabels,
): string {
  if (surface === "mobile") return labels.closeAbove;
  return orientation === "vertical" ? labels.closeUp : labels.closeLeft;
}

function buildCloseAfterLabel(
  surface: WorkspaceTabMenuSurface,
  orientation: WorkspaceTabMenuOrientation,
  labels: WorkspaceTabMenuLabels,
): string {
  if (surface === "mobile") return labels.closeBelow;
  return orientation === "vertical" ? labels.closeDown : labels.closeRight;
}

function buildCloseBeforeTestIDSuffix(
  surface: WorkspaceTabMenuSurface,
  orientation: WorkspaceTabMenuOrientation,
): string {
  return isVerticalStack(surface, orientation) ? "close-above" : "close-left";
}

function buildCloseAfterTestIDSuffix(
  surface: WorkspaceTabMenuSurface,
  orientation: WorkspaceTabMenuOrientation,
): string {
  return isVerticalStack(surface, orientation) ? "close-below" : "close-right";
}

/**
 * The tabs that can only ever have one instance open, so their close button
 * needs no identifier to disambiguate it. Split out from the identified kinds
 * below purely to keep either chain readable.
 */
function getSingletonCloseButtonTestId(tab: WorkspaceTabDescriptor): string | null {
  if (tab.target.kind === "visualizer") {
    return "workspace-visualizer-close";
  }
  if (tab.target.kind === "contextManagement") {
    return "workspace-context-management-close";
  }
  if (tab.target.kind === "projectKnowledge") return "workspace-project-knowledge-close";
  if (tab.target.kind === "files" || tab.target.kind === "pull_request") {
    return `workspace-${tab.target.kind}-close`;
  }
  return null;
}

/** The diff-review kinds, whose close ids are derived from what is being diffed. */
function getDiffCloseButtonTestId(tab: WorkspaceTabDescriptor): string | null {
  if (tab.target.kind === "commit_diff") {
    return `workspace-commit-diff-close-${encodeFilePathForPathSegment(tab.target.sha)}`;
  }
  if (tab.target.kind === "working_diff" || tab.target.kind === "changes_tree") {
    return `workspace-working-diff-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  return null;
}

function getCloseButtonTestId(tab: WorkspaceTabDescriptor): string {
  const diff = getDiffCloseButtonTestId(tab);
  if (diff !== null) {
    return diff;
  }
  const singleton = getSingletonCloseButtonTestId(tab);
  if (singleton !== null) {
    return singleton;
  }
  if (tab.target.kind === "agent") {
    return `workspace-agent-close-${tab.target.agentId}`;
  }
  if (tab.target.kind === "terminal") {
    return `workspace-terminal-close-${tab.target.terminalId}`;
  }
  if (tab.target.kind === "draft") {
    return `workspace-draft-close-${tab.target.draftId}`;
  }
  if (tab.target.kind === "browser") {
    return `workspace-browser-close-${tab.target.browserId}`;
  }
  if (tab.target.kind === "setup") {
    return `workspace-setup-close-${encodeWorkspaceIdForPathSegment(tab.target.workspaceId)}`;
  }
  if (tab.target.kind === "artifact") {
    return `workspace-artifact-close-${tab.target.artifactId}`;
  }
  if (tab.target.kind === "gitLog") {
    return `workspace-gitlog-close-${tab.target.operation}`;
  }
  if (tab.target.kind === "orchestrationGraph") {
    return `workspace-orchestration-graph-close-${tab.target.graphId}`;
  }
  if (tab.target.kind === "refine") {
    return `workspace-refine-close-${encodeFilePathForPathSegment(tab.target.paths[0] ?? "")}`;
  }
  if (tab.target.kind === "provider_subagent") {
    return `workspace-provider-subagent-close-${tab.target.subagentId}`;
  }

  if (tab.target.kind === "communicationsRoom") {
    return `workspace-communications-room-close-${tab.target.providerId}-${tab.target.conversationId}`;
  }
  if (tab.target.kind === "architecturalViewDraft") {
    return `workspace-architectural-view-draft-close-${tab.target.viewId}-${tab.target.draftId}`;
  }
  if (tab.target.kind === "architecturalView") {
    return `workspace-architectural-view-close-${tab.target.viewId}`;
  }
  if (tab.target.kind === "plugin") {
    return `workspace-plugin-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  if (tab.target.kind === "new_tab") {
    return `workspace-new-tab-close-${tab.tabId}`;
  }
  if (tab.target.kind === "file") {
    return `workspace-file-close-${encodeFilePathForPathSegment(tab.target.path)}`;
  }
  // Every kind is handled above or by one of the two helpers; this is the guard
  // for a tab kind added without a close id of its own.
  return `workspace-tab-close-${tab.tabId}`;
}

function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getWorkspaceRelativeFilePath(
  filePath: string,
  workspaceDirectory: string | null | undefined,
): string | null {
  if (!workspaceDirectory) return null;
  const normalizedFilePath = normalizeComparablePath(filePath);
  const normalizedWorkspaceDirectory = normalizeComparablePath(workspaceDirectory);
  if (!normalizedFilePath || !normalizedWorkspaceDirectory) return null;

  const isWindowsPath = /^[A-Za-z]:\//.test(normalizedWorkspaceDirectory);
  const fileForComparison = isWindowsPath ? normalizedFilePath.toLowerCase() : normalizedFilePath;
  const workspaceForComparison = isWindowsPath
    ? normalizedWorkspaceDirectory.toLowerCase()
    : normalizedWorkspaceDirectory;
  if (!fileForComparison.startsWith(`${workspaceForComparison}/`)) return null;
  return normalizedFilePath.slice(normalizedWorkspaceDirectory.length + 1);
}

function getFileName(filePath: string): string {
  const normalized = normalizeComparablePath(filePath);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function appendChatManagementMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  entries: WorkspaceTabMenuEntry[];
  labels: WorkspaceTabMenuLabels;
  menuTestIDBase: string;
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
}): boolean {
  const { tab, entries, labels, menuTestIDBase, onArchiveAgent, onDeleteAgent } = input;
  if (tab.target.kind !== "agent" || !onArchiveAgent || !onDeleteAgent) return false;

  const { agentId } = tab.target;
  entries.push({
    kind: "item",
    key: "archive",
    label: labels.archive ?? i18n.t("workspace.tabs.confirmations.archive"),
    testID: `${menuTestIDBase}-archive`,
    onSelect: () => {
      void onArchiveAgent(agentId);
    },
  });
  entries.push({
    kind: "item",
    key: "delete",
    label: labels.delete ?? i18n.t("workspace.tabs.confirmations.delete"),
    destructive: true,
    testID: `${menuTestIDBase}-delete`,
    onSelect: () => {
      void onDeleteAgent(agentId);
    },
  });
  return true;
}

function appendTabFunctionMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  entries: WorkspaceTabMenuEntry[];
  labels: WorkspaceTabMenuLabels;
  menuTestIDBase: string;
  isDeveloperMode: boolean;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
}): void {
  const { tab, entries, labels, menuTestIDBase, isDeveloperMode, onReloadAgent, onRenameTab } =
    input;
  if (isDeveloperMode && tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "reload-agent",
      label: labels.reloadAgent,
      icon: "rotate-cw",
      tooltip: labels.reloadAgentTooltip,
      testID: `${menuTestIDBase}-reload-agent`,
      onSelect: () => {
        void onReloadAgent(agentId);
      },
    });
  }
  if (tab.target.kind === "agent" || tab.target.kind === "terminal") {
    entries.push({
      kind: "item",
      key: "rename",
      label: labels.rename,
      icon: "pencil",
      testID: `${menuTestIDBase}-rename`,
      onSelect: () => {
        onRenameTab(tab);
      },
    });
  }
}

function appendMoveToExplorerMenuEntry(input: {
  tab: WorkspaceTabDescriptor;
  entries: WorkspaceTabMenuEntry[];
  labels: WorkspaceTabMenuLabels;
  menuTestIDBase: string;
  onMoveToExplorer?: (tabId: string) => void;
  canMoveToExplorer?: boolean;
}): void {
  const { tab, entries, labels, menuTestIDBase, onMoveToExplorer, canMoveToExplorer } = input;
  if (!onMoveToExplorer || !canMoveToExplorer) return;

  entries.push({
    kind: "item",
    key: "move-to-explorer",
    label: labels.moveToExplorer,
    icon: "arrow-right-to-line",
    testID: `${menuTestIDBase}-move-to-explorer`,
    onSelect: () => {
      onMoveToExplorer(tab.tabId);
    },
  });
}

export function buildWorkspaceTabMenuEntries(
  input: BuildWorkspaceTabMenuEntriesInput,
): WorkspaceTabMenuEntry[] {
  const {
    surface,
    orientation = "horizontal",
    tab,
    index,
    tabCount,
    menuTestIDBase,
    workspaceDirectory,
    isDeveloperMode,
    onCopyResumeCommand,
    onCopyAgentId,
    onCopyTerminalId,
    onCopyFilePath,
    onReloadAgent,
    onRenameTab,
    onCloseTab,
    onCloseTabsBefore,
    onCloseTabsAfter,
    onCloseOtherTabs,
    onArchiveAgent,
    onDeleteAgent,
    onMoveToWorkspace,
    canMoveToWorkspace,
    onMoveToExplorer,
    canMoveToExplorer,
  } = input;
  const labels = input.labels ?? DEFAULT_WORKSPACE_TAB_MENU_LABELS;
  const isFirstTab = index === 0;
  const isLastTab = index === tabCount - 1;
  const isOnlyTab = tabCount <= 1;
  const entries: WorkspaceTabMenuEntry[] = [];

  if (isDeveloperMode && tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-resume-command",
      label: labels.copyResumeCommand,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-resume-command`,
      onSelect: () => {
        void onCopyResumeCommand(agentId);
      },
    });
    entries.push({
      kind: "item",
      key: "copy-agent-id",
      label: labels.copyAgentId,
      icon: "copy",
      hint: agentId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-agent-id`,
      onSelect: () => {
        void onCopyAgentId(agentId);
      },
    });
  }

  if (tab.target.kind === "terminal") {
    const { terminalId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-terminal-id",
      label: labels.copyTerminalId,
      icon: "copy",
      hint: terminalId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-terminal-id`,
      onSelect: () => {
        void onCopyTerminalId(terminalId);
      },
    });
  }

  if (isDeveloperMode && tab.target.kind === "file") {
    const filePath = tab.target.path;
    const workspaceRelativePath = getWorkspaceRelativeFilePath(filePath, workspaceDirectory);
    entries.push({
      kind: "item",
      key: "copy-filename",
      label: labels.copyFilename,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-filename`,
      onSelect: () => {
        void onCopyFilePath(getFileName(filePath), "filename");
      },
    });
    entries.push({
      kind: "item",
      key: "copy-full-path",
      label: labels.copyFullPath,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-full-path`,
      onSelect: () => {
        void onCopyFilePath(filePath, "full-path");
      },
    });
    if (workspaceRelativePath !== null) {
      entries.push({
        kind: "item",
        key: "copy-workspace-path",
        label: labels.copyWorkspacePath,
        icon: "copy",
        testID: `${menuTestIDBase}-copy-workspace-path`,
        onSelect: () => {
          void onCopyFilePath(workspaceRelativePath, "workspace-path");
        },
      });
    }
  }

  // Chats only. A terminal is bound to its workspace's directory, so "move" would
  // mean something quite different there; a chat is just a conversation that some
  // workspace happens to show.
  if (tab.target.kind === "agent" && onMoveToWorkspace && canMoveToWorkspace) {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "move-to-workspace",
      label: labels.moveToWorkspace,
      icon: "folder-open",
      testID: `${menuTestIDBase}-move-to-workspace`,
      onSelect: () => {
        onMoveToWorkspace(agentId);
      },
    });
  }

  appendMoveToExplorerMenuEntry({
    tab,
    entries,
    labels,
    menuTestIDBase,
    onMoveToExplorer,
    canMoveToExplorer,
  });

  const managesChat = appendChatManagementMenuEntries({
    tab,
    entries,
    labels,
    menuTestIDBase,
    onArchiveAgent,
    onDeleteAgent,
  });
  if (!managesChat) {
    const hasWorkspaceEntries = entries.length > 0;
    const hasTabEntries =
      (isDeveloperMode && tab.target.kind === "agent") ||
      tab.target.kind === "agent" ||
      tab.target.kind === "terminal";

    if (hasWorkspaceEntries && hasTabEntries) {
      entries.push({
        kind: "separator",
        key: "workspace-tab-separator",
      });
    }

    appendTabFunctionMenuEntries({
      tab,
      entries,
      labels,
      menuTestIDBase,
      isDeveloperMode,
      onReloadAgent,
      onRenameTab,
    });

    if (!canCloseWorkspaceTab(tab)) {
      return entries;
    }

    if (entries.length > 0) {
      entries.push({
        kind: "separator",
        key: "tab-close-actions-separator",
      });
    }

    entries.push({
      kind: "item",
      key: "close-before",
      label: buildCloseBeforeLabel(surface, orientation, labels),
      icon: "arrow-left-to-line",
      disabled: isFirstTab,
      testID: `${menuTestIDBase}-${buildCloseBeforeTestIDSuffix(surface, orientation)}`,
      onSelect: () => {
        void onCloseTabsBefore(tab.tabId);
      },
    });
    entries.push({
      kind: "item",
      key: "close-after",
      label: buildCloseAfterLabel(surface, orientation, labels),
      icon: "arrow-right-to-line",
      disabled: isLastTab,
      testID: `${menuTestIDBase}-${buildCloseAfterTestIDSuffix(surface, orientation)}`,
      onSelect: () => {
        void onCloseTabsAfter(tab.tabId);
      },
    });
    entries.push({
      kind: "item",
      key: "close-others",
      label: labels.closeOthers,
      icon: "copy-x",
      disabled: isOnlyTab,
      testID: `${menuTestIDBase}-close-others`,
      onSelect: () => {
        void onCloseOtherTabs(tab.tabId);
      },
    });
    entries.push({
      kind: "separator",
      key: "close-separator",
    });
    entries.push({
      kind: "item",
      key: "close",
      label: labels.close,
      icon: "x",
      testID: `${menuTestIDBase}-close`,
      onSelect: () => {
        void onCloseTab(tab.tabId);
      },
    });
  }

  return entries;
}

export function buildWorkspaceDesktopTabActions(
  input: BuildWorkspaceDesktopTabActionsInput,
): WorkspaceDesktopTabActions {
  const contextMenuTestId = `workspace-tab-context-${input.tab.tabId}`;
  return {
    contextMenuTestId,
    menuEntries: buildWorkspaceTabMenuEntries({
      surface: "desktop",
      orientation: input.orientation,
      tab: input.tab,
      index: input.index,
      tabCount: input.tabCount,
      menuTestIDBase: contextMenuTestId,
      workspaceDirectory: input.workspaceDirectory,
      isDeveloperMode: input.isDeveloperMode,
      onCopyResumeCommand: input.onCopyResumeCommand,
      onCopyAgentId: input.onCopyAgentId,
      onCopyTerminalId: input.onCopyTerminalId,
      onCopyFilePath: input.onCopyFilePath,
      onReloadAgent: input.onReloadAgent,
      onRenameTab: input.onRenameTab,
      onCloseTab: input.onCloseTab,
      onCloseTabsBefore: input.onCloseTabsToLeft,
      onCloseTabsAfter: input.onCloseTabsToRight,
      onCloseOtherTabs: input.onCloseOtherTabs,
      onArchiveAgent: input.onArchiveAgent,
      onDeleteAgent: input.onDeleteAgent,
      onMoveToWorkspace: input.onMoveToWorkspace,
      canMoveToWorkspace: input.canMoveToWorkspace,
      onMoveToExplorer: input.onMoveToExplorer,
      canMoveToExplorer: input.canMoveToExplorer,
      labels: input.labels,
    }),
    closeButtonTestId: getCloseButtonTestId(input.tab),
    canClose: canCloseWorkspaceTab(input.tab),
  };
}
