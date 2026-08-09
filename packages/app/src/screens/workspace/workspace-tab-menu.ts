import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";
import { encodeFilePathForPathSegment, encodeWorkspaceIdForPathSegment } from "@/utils/host-routes";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

export type WorkspaceTabMenuSurface = "desktop" | "mobile";

export interface WorkspaceTabMenuLabels {
  copyResumeCommand: string;
  copyAgentId: string;
  copyTerminalId: string;
  copyFilePath: string;
  rename: string;
  moveToWorkspace: string;
  closeAbove: string;
  closeBelow: string;
  closeLeft: string;
  closeRight: string;
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
  copyFilePath: i18n.t("workspace.tabs.menu.copyFilePath"),
  rename: i18n.t("workspace.tabs.menu.rename"),
  moveToWorkspace: i18n.t("workspace.tabs.menu.moveToWorkspace"),
  closeAbove: i18n.t("workspace.tabs.menu.closeAbove"),
  closeBelow: i18n.t("workspace.tabs.menu.closeBelow"),
  closeLeft: i18n.t("workspace.tabs.menu.closeLeft"),
  closeRight: i18n.t("workspace.tabs.menu.closeRight"),
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
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  menuTestIDBase: string;
  // User mode omits the developer-only entries (copy resume command, copy agent
  // id, copy file path, reload agent); tab-management entries stay.
  isDeveloperMode: boolean;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
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
  labels?: WorkspaceTabMenuLabels;
}

interface BuildWorkspaceDesktopTabActionsInput {
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  isDeveloperMode: boolean;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
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
  labels?: WorkspaceTabMenuLabels;
}

export interface WorkspaceDesktopTabActions {
  contextMenuTestId: string;
  menuEntries: WorkspaceTabMenuEntry[];
  closeButtonTestId: string;
}

function buildCloseBeforeLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "mobile" ? labels.closeAbove : labels.closeLeft;
}

function buildCloseAfterLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "mobile" ? labels.closeBelow : labels.closeRight;
}

function buildCloseBeforeTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "mobile" ? "close-above" : "close-left";
}

function buildCloseAfterTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "mobile" ? "close-below" : "close-right";
}

function getCloseButtonTestId(tab: WorkspaceTabDescriptor): string {
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
  if (tab.target.kind === "visualizer") {
    return "workspace-visualizer-close";
  }
  if (tab.target.kind === "contextManagement") {
    return "workspace-context-management-close";
  }
  if (tab.target.kind === "projectKnowledge") return "workspace-project-knowledge-close";
  if (tab.target.kind === "orchestrationGraph") {
    return `workspace-orchestration-graph-close-${tab.target.graphId}`;
  }
  if (tab.target.kind === "refine") {
    return `workspace-refine-close-${encodeFilePathForPathSegment(tab.target.paths[0] ?? "")}`;
  }
  if (tab.target.kind === "provider_subagent") {
    return `workspace-provider-subagent-close-${tab.target.subagentId}`;
  }
  if (tab.target.kind === "commit_diff") {
    return `workspace-commit-diff-close-${encodeFilePathForPathSegment(tab.target.sha)}`;
  }
  if (tab.target.kind === "working_diff") {
    return `workspace-working-diff-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  return `workspace-file-close-${encodeFilePathForPathSegment(tab.target.path)}`;
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

export function buildWorkspaceTabMenuEntries(
  input: BuildWorkspaceTabMenuEntriesInput,
): WorkspaceTabMenuEntry[] {
  const {
    surface,
    tab,
    index,
    tabCount,
    menuTestIDBase,
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
    entries.push({
      kind: "item",
      key: "copy-file-path",
      label: labels.copyFilePath,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-file-path`,
      onSelect: () => {
        void onCopyFilePath(filePath);
      },
    });
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

  if (tab.target.kind === "agent" || tab.target.kind === "terminal") {
    entries.push({
      kind: "separator",
      key: "rename-separator",
    });
  }

  const managesChat = appendChatManagementMenuEntries({
    tab,
    entries,
    labels,
    menuTestIDBase,
    onArchiveAgent,
    onDeleteAgent,
  });
  if (!managesChat) {
    entries.push({
      kind: "item",
      key: "close-before",
      label: buildCloseBeforeLabel(surface, labels),
      icon: "arrow-left-to-line",
      disabled: isFirstTab,
      testID: `${menuTestIDBase}-${buildCloseBeforeTestIDSuffix(surface)}`,
      onSelect: () => {
        void onCloseTabsBefore(tab.tabId);
      },
    });
    entries.push({
      kind: "item",
      key: "close-after",
      label: buildCloseAfterLabel(surface, labels),
      icon: "arrow-right-to-line",
      disabled: isLastTab,
      testID: `${menuTestIDBase}-${buildCloseAfterTestIDSuffix(surface)}`,
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
        kind: "separator",
        key: "reload-rename-separator",
      });
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
  const contextMenuTestId = `workspace-tab-context-${buildDeterministicWorkspaceTabId(input.tab.target)}`;
  return {
    contextMenuTestId,
    menuEntries: buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: input.tab,
      index: input.index,
      tabCount: input.tabCount,
      menuTestIDBase: contextMenuTestId,
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
      labels: input.labels,
    }),
    closeButtonTestId: getCloseButtonTestId(input.tab),
  };
}
