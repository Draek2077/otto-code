import { describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceTabMenuEntries,
  getWorkspaceRelativeFilePath,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function createAgentTab(): WorkspaceTabDescriptor {
  return {
    key: "agent_123",
    tabId: "agent_123",
    kind: "agent",
    target: { kind: "agent", agentId: "agent-123" },
  };
}

describe("buildWorkspaceTabMenuEntries", () => {
  it.each([
    ["Files", { kind: "files" as const }],
    ["Changes", { kind: "changes_tree" as const }],
    ["Search", { kind: "project_search" as const }],
  ])("does not offer close actions for the permanent %s tab", (_label, target) => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: { key: target.kind, tabId: target.kind, kind: target.kind, target },
      index: 0,
      tabCount: 1,
      menuTestIDBase: `workspace-tab-context-${target.kind}`,
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.some((entry) => entry.kind === "item" && entry.key.startsWith("close"))).toBe(
      false,
    );
  });

  it("offers close actions for the Diff tab", () => {
    const target = { kind: "working_diff" as const };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: { key: target.kind, tabId: target.kind, kind: target.kind, target },
      index: 0,
      tabCount: 1,
      menuTestIDBase: `workspace-tab-context-${target.kind}`,
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.some((entry) => entry.kind === "item" && entry.key === "close")).toBe(true);
  });

  it("replaces Close with Archive and Delete for chats", () => {
    const archive = vi.fn();
    const deleteAgent = vi.fn();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      onArchiveAgent: archive,
      onDeleteAgent: deleteAgent,
    });

    const archiveEntry = entries.find((entry) => entry.kind === "item" && entry.key === "archive");
    const deleteEntry = entries.find((entry) => entry.kind === "item" && entry.key === "delete");
    expect(entries.some((entry) => entry.kind === "item" && entry.key === "close")).toBe(false);
    expect(archiveEntry).toMatchObject({ label: "Archive" });
    expect(deleteEntry).toMatchObject({ label: "Delete", destructive: true });
    if (archiveEntry?.kind === "item") archiveEntry.onSelect();
    if (deleteEntry?.kind === "item") deleteEntry.onSelect();
    expect(archive).toHaveBeenCalledWith("agent-123");
    expect(deleteAgent).toHaveBeenCalledWith("agent-123");
  });

  it("uses desktop tab ordering labels for desktop menus", () => {
    const onCopyResumeCommand = vi.fn();
    const onCopyAgentId = vi.fn();
    const onCopyFilePath = vi.fn();
    const onReloadAgent = vi.fn();
    const onRenameTab = vi.fn();
    const onCloseTab = vi.fn();
    const onCloseTabsBefore = vi.fn();
    const onCloseTabsAfter = vi.fn();
    const onCloseOtherTabs = vi.fn();

    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      isDeveloperMode: true,
      onCopyResumeCommand,
      onCopyTerminalId: vi.fn(),
      onCopyAgentId,
      onCopyFilePath,
      onReloadAgent,
      onRenameTab,
      onCloseTab,
      onCloseTabsBefore,
      onCloseTabsAfter,
      onCloseOtherTabs,
    });

    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy chat id",
      "Reload chat",
      "Rename",
      "Close to the left",
      "Close to the right",
      "Close other tabs",
      "Close",
    ]);
    expect(entries.filter((entry) => entry.kind === "separator").map((entry) => entry.key)).toEqual(
      ["workspace-tab-separator", "tab-close-actions-separator", "close-separator"],
    );
  });

  it("uses vertical up/down labels for desktop menus in vertical orientation", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      orientation: "vertical",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Rename",
      "Close up",
      "Close down",
      "Close other tabs",
      "Close",
    ]);
  });

  it("moves an Explorer-compatible file tab into the Explorer panel", () => {
    const moveToExplorer = vi.fn();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: {
        key: "file_readme",
        tabId: "file_readme",
        kind: "file",
        target: { kind: "file", path: "/workspace/README.md" },
      },
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-file_readme",
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      onMoveToExplorer: moveToExplorer,
      canMoveToExplorer: true,
    });

    const moveEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "move-to-explorer",
    );
    expect(moveEntry).toMatchObject({
      label: "Move to Explorer panel",
      testID: "workspace-tab-context-file_readme-move-to-explorer",
    });
    if (moveEntry?.kind === "item") moveEntry.onSelect();
    expect(moveToExplorer).toHaveBeenCalledWith("file_readme");
  });

  it("omits the developer-only entries in User interface mode", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    // Copy resume command / copy agent id / reload agent are developer surfaces;
    // the tab-management entries (rename and close variants) remain.
    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Rename",
      "Close to the left",
      "Close to the right",
      "Close other tabs",
      "Close",
    ]);
    expect(entries.filter((entry) => entry.kind === "separator").map((entry) => entry.key)).toEqual(
      ["tab-close-actions-separator", "close-separator"],
    );
  });

  it("uses stacked ordering labels for mobile menus", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-menu-agent_123",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy chat id",
      "Reload chat",
      "Rename",
      "Close tabs above",
      "Close tabs below",
      "Close other tabs",
      "Close",
    ]);
  });

  it("omits agent copy actions and rename for draft tabs", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: {
        key: "draft_123",
        tabId: "draft_123",
        kind: "draft",
        target: { kind: "draft", draftId: "draft_123" },
      },
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-menu-draft_123",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Copy agent id")).toBe(
      false,
    );
    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Reload agent")).toBe(
      false,
    );
    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Rename")).toBe(false);
    expect(entries).toContainEqual({ kind: "separator", key: "close-separator" });
  });

  it.each([
    ["project knowledge", { kind: "projectKnowledge" as const }],
    ["context management", { kind: "contextManagement" as const }],
  ])("separates Close for %s tabs", (_label, target) => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: { key: "special", tabId: "special", kind: target.kind, target },
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-menu-special",
      isDeveloperMode: false,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const closeIndex = entries.findIndex((entry) => entry.kind === "item" && entry.key === "close");
    expect(entries[closeIndex - 1]).toEqual({ kind: "separator", key: "close-separator" });
  });

  it("adds reload tooltip copy for agent tabs", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: "item",
        key: "reload-agent",
        tooltip: "Reload chat to update skills, MCPs or login status.",
      }),
    );
  });

  it("invokes onRenameTab when the rename entry is selected for agent tabs", () => {
    const onRenameTab = vi.fn();
    const tab = createAgentTab();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const renameEntry = entries.find((entry) => entry.kind === "item" && entry.label === "Rename");
    if (!renameEntry || renameEntry.kind !== "item") {
      throw new Error("Rename entry missing");
    }
    renameEntry.onSelect();

    expect(onRenameTab).toHaveBeenCalledWith(tab);
  });

  it("leads with copy terminal id and keeps rename with tab actions", () => {
    const onRenameTab = vi.fn();
    const terminalTab: WorkspaceTabDescriptor = {
      key: "terminal_abc",
      tabId: "terminal_abc",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-abc" },
    };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: terminalTab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-terminal_abc",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    // Copying the terminal id leads; rename belongs with the trailing tab
    // management actions.
    expect(labels[0]).toBe("Copy terminal id");
    expect(labels[1]).toBe("Rename");
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Copy file path");
    expect(labels).not.toContain("Reload agent");

    const renameEntry = entries.find((entry) => entry.kind === "item" && entry.label === "Rename");
    if (!renameEntry || renameEntry.kind !== "item") {
      throw new Error("Rename entry missing");
    }
    renameEntry.onSelect();
    expect(onRenameTab).toHaveBeenCalledWith(terminalTab);
  });

  it("includes filename, full path, and workspace-relative path for file tabs", () => {
    const onCopyFilePath = vi.fn();
    const fileTab: WorkspaceTabDescriptor = {
      key: "file_abc",
      tabId: "file_abc",
      kind: "file",
      target: { kind: "file", path: "/some/path.ts", lineStart: 1, lineEnd: 10 },
    };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: fileTab,
      workspaceDirectory: "/some",
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-file_abc",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath,
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(labels.slice(0, 3)).toEqual(["Copy filename", "Copy full path", "Copy workspace path"]);
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Rename");
    expect(labels).not.toContain("Reload agent");

    const copyFilenameEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-filename",
    );
    const copyFullPathEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-full-path",
    );
    const copyWorkspacePathEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-workspace-path",
    );
    if (
      !copyFilenameEntry ||
      copyFilenameEntry.kind !== "item" ||
      !copyFullPathEntry ||
      copyFullPathEntry.kind !== "item" ||
      !copyWorkspacePathEntry ||
      copyWorkspacePathEntry.kind !== "item"
    ) {
      throw new Error("File copy entries missing");
    }
    copyFilenameEntry.onSelect();
    copyFullPathEntry.onSelect();
    copyWorkspacePathEntry.onSelect();
    expect(onCopyFilePath).toHaveBeenNthCalledWith(1, "path.ts", "filename");
    expect(onCopyFilePath).toHaveBeenNthCalledWith(2, "/some/path.ts", "full-path");
    expect(onCopyFilePath).toHaveBeenNthCalledWith(3, "path.ts", "workspace-path");
  });

  it("omits the workspace path action when a file is outside the workspace", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: {
        key: "file_outside",
        tabId: "file_outside",
        kind: "file",
        target: { kind: "file", path: "/outside/path.ts", lineStart: 1, lineEnd: 1 },
      },
      workspaceDirectory: "/workspace",
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-file_outside",
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(
      entries.some((entry) => entry.kind === "item" && entry.key === "copy-workspace-path"),
    ).toBe(false);
  });

  it("uses the same rename entry shape for agent and terminal tabs", () => {
    const terminalTab: WorkspaceTabDescriptor = {
      key: "terminal_abc",
      tabId: "terminal_abc",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-abc" },
    };
    const menuTestIDBase = "workspace-tab-context";
    const sharedInput = {
      surface: "desktop" as const,
      index: 0,
      tabCount: 1,
      menuTestIDBase,
      isDeveloperMode: true,
      onCopyResumeCommand: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    };

    const agentEntries = buildWorkspaceTabMenuEntries({ ...sharedInput, tab: createAgentTab() });
    const terminalEntries = buildWorkspaceTabMenuEntries({ ...sharedInput, tab: terminalTab });

    const agentRename = agentEntries.find(
      (entry) => entry.kind === "item" && entry.key === "rename",
    );
    const terminalRename = terminalEntries.find(
      (entry) => entry.kind === "item" && entry.key === "rename",
    );
    if (!agentRename || agentRename.kind !== "item") throw new Error("Agent rename missing");
    if (!terminalRename || terminalRename.kind !== "item")
      throw new Error("Terminal rename missing");

    expect({
      key: agentRename.key,
      label: agentRename.label,
      icon: agentRename.icon,
      testID: agentRename.testID,
    }).toEqual({
      key: terminalRename.key,
      label: terminalRename.label,
      icon: terminalRename.icon,
      testID: terminalRename.testID,
    });

    const agentSeparator = agentEntries[agentEntries.indexOf(agentRename) - 2];
    const terminalSeparator = terminalEntries[terminalEntries.indexOf(terminalRename) - 1];
    expect(agentSeparator).toEqual({ kind: "separator", key: "workspace-tab-separator" });
    expect(terminalSeparator).toEqual({ kind: "separator", key: "workspace-tab-separator" });
  });
});

describe("buildWorkspaceTabMenuEntries move-to-workspace entry", () => {
  const baseInput = {
    surface: "desktop" as const,
    index: 0,
    tabCount: 1,
    menuTestIDBase: "workspace-tab-context-agent_123",
    isDeveloperMode: false,
    onCopyResumeCommand: vi.fn(),
    onCopyTerminalId: vi.fn(),
    onCopyAgentId: vi.fn(),
    onCopyFilePath: vi.fn(),
    onReloadAgent: vi.fn(),
    onRenameTab: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseTabsBefore: vi.fn(),
    onCloseTabsAfter: vi.fn(),
    onCloseOtherTabs: vi.fn(),
  };

  function labelsOf(entries: ReturnType<typeof buildWorkspaceTabMenuEntries>): string[] {
    return entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
  }

  it("offers the move entry for a chat and passes the agent id through", () => {
    const onMoveToWorkspace = vi.fn();

    const entries = buildWorkspaceTabMenuEntries({
      ...baseInput,
      tab: createAgentTab(),
      onMoveToWorkspace,
      canMoveToWorkspace: true,
    });

    const move = entries.find(
      (entry) => entry.kind === "item" && entry.key === "move-to-workspace",
    );
    expect(move).toBeDefined();
    if (move?.kind !== "item") {
      throw new Error("expected an item");
    }
    move.onSelect();
    expect(onMoveToWorkspace).toHaveBeenCalledWith("agent-123");
  });

  it("omits the entry when the host cannot move chats", () => {
    // An old daemon has no agent.workspace.transfer, and there is no degraded
    // client-side version, so the row is absent rather than shown disabled.
    const entries = buildWorkspaceTabMenuEntries({
      ...baseInput,
      tab: createAgentTab(),
      onMoveToWorkspace: undefined,
      canMoveToWorkspace: true,
    });

    expect(labelsOf(entries)).not.toContain("Move to workspace…");
  });

  it("omits the entry when there is nowhere to move to", () => {
    const entries = buildWorkspaceTabMenuEntries({
      ...baseInput,
      tab: createAgentTab(),
      onMoveToWorkspace: vi.fn(),
      canMoveToWorkspace: false,
    });

    expect(labelsOf(entries)).not.toContain("Move to workspace…");
  });

  it("does not offer the entry for a terminal tab", () => {
    const entries = buildWorkspaceTabMenuEntries({
      ...baseInput,
      tab: {
        key: "terminal_1",
        tabId: "terminal_1",
        kind: "terminal",
        target: { kind: "terminal", terminalId: "terminal-1" },
      },
      onMoveToWorkspace: vi.fn(),
      canMoveToWorkspace: true,
    });

    expect(labelsOf(entries)).not.toContain("Move to workspace…");
  });
});

describe("getWorkspaceRelativeFilePath", () => {
  it("preserves a workspace-relative path on Windows regardless of drive-letter casing", () => {
    expect(getWorkspaceRelativeFilePath("C:\\Repo\\src\\app.ts", "c:\\repo")).toBe("src/app.ts");
  });
});
