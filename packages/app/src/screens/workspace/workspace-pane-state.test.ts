import { describe, expect, it } from "vitest";
import {
  deriveWorkspacePaneState,
  getWorkspacePaneDescriptors,
  resolveSideFileOpenPlacement,
  resolveWorkspaceNewChatPlacement,
} from "@/screens/workspace/workspace-pane-state";
import type { WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/stores/workspace-tabs-store";

function createTab(tabId: string, target: WorkspaceTab["target"]): WorkspaceTab {
  return {
    tabId,
    target,
    createdAt: 1,
  };
}

describe("workspace-pane-state", () => {
  it("selects the focused pane and keeps its tab order", () => {
    const tabs: WorkspaceTab[] = [
      createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" }),
      createTab("file_/repo/README.md", { kind: "file", path: "/repo/README.md" }),
      createTab("terminal_term-1", { kind: "terminal", terminalId: "term-1" }),
    ];
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "group-root",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            {
              kind: "pane",
              pane: {
                id: "left",
                tabIds: ["file_/repo/README.md", "agent_agent-a"],
                focusedTabId: "agent_agent-a",
              },
            },
            {
              kind: "pane",
              pane: {
                id: "right",
                tabIds: ["terminal_term-1"],
                focusedTabId: "terminal_term-1",
              },
            },
          ],
        },
      },
      focusedPaneId: "left",
    };

    const state = deriveWorkspacePaneState({ layout, tabs });

    expect(state.pane?.id).toBe("left");
    expect(state.tabs.map((tab) => tab.descriptor.tabId)).toEqual([
      "file_/repo/README.md",
      "agent_agent-a",
    ]);
    expect(state.activeTabId).toBe("agent_agent-a");
  });

  it("falls back to the first ordered pane tab when focusedTabId is empty", () => {
    const pane = {
      id: "main",
      tabIds: ["draft_1", "draft_2"],
      focusedTabId: " ",
    };
    const tabs: WorkspaceTab[] = [
      createTab("draft_2", { kind: "draft", draftId: "draft_2" }),
      createTab("draft_1", { kind: "draft", draftId: "draft_1" }),
    ];

    const state = deriveWorkspacePaneState({ pane, tabs });

    expect(state.activeTabId).toBe("draft_1");
    expect(getWorkspacePaneDescriptors({ pane, tabs }).map((tab) => tab.tabId)).toEqual([
      "draft_1",
      "draft_2",
    ]);
  });

  it("prefers a matching target over stale focused tab state", () => {
    const pane = {
      id: "main",
      tabIds: ["agent_agent-a", "file_/repo/README.md"],
      focusedTabId: "agent_agent-a",
    };
    const tabs: WorkspaceTab[] = [
      createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" }),
      createTab("file_/repo/README.md", { kind: "file", path: "/repo/README.md" }),
    ];

    const state = deriveWorkspacePaneState({
      pane,
      tabs,
      preferredTarget: { kind: "file", path: "\\repo\\README.md" },
    });

    expect(state.activeTabId).toBe("file_/repo/README.md");
    expect(state.activeTab?.descriptor.target).toEqual({
      kind: "file",
      path: "/repo/README.md",
    });
  });

  it("resolves side file opens to an existing file tab", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "pane",
        pane: {
          id: "main",
          tabIds: ["file_/repo/README.md"],
          focusedTabId: "file_/repo/README.md",
        },
      },
      focusedPaneId: "main",
    };
    const tabs = [createTab("file_/repo/README.md", { kind: "file", path: "/repo/README.md" })];

    expect(
      resolveSideFileOpenPlacement({
        layout,
        sourcePaneId: "main",
        tabs,
        target: { kind: "file", path: "/repo/README.md" },
      }),
    ).toEqual({ kind: "open-in-source" });
  });

  it("resolves side file opens to an existing file tab when only the line range differs", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "pane",
        pane: {
          id: "main",
          tabIds: ["file_/repo/README.md"],
          focusedTabId: "file_/repo/README.md",
        },
      },
      focusedPaneId: "main",
    };
    const tabs = [createTab("file_/repo/README.md", { kind: "file", path: "/repo/README.md" })];

    expect(
      resolveSideFileOpenPlacement({
        layout,
        sourcePaneId: "main",
        tabs,
        target: { kind: "file", path: "/repo/README.md", lineStart: 12, lineEnd: 20 },
      }),
    ).toEqual({ kind: "open-in-source" });
  });

  it("resolves side file opens to an existing right pane", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "group-root",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            {
              kind: "pane",
              pane: { id: "left", tabIds: ["agent_agent-a"], focusedTabId: "agent_agent-a" },
            },
            {
              kind: "pane",
              pane: { id: "right", tabIds: [], focusedTabId: null },
            },
          ],
        },
      },
      focusedPaneId: "left",
    };

    expect(
      resolveSideFileOpenPlacement({
        layout,
        sourcePaneId: "left",
        tabs: [createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" })],
        target: { kind: "file", path: "/repo/README.md" },
      }),
    ).toEqual({ kind: "focus-side-pane", paneId: "right" });
  });

  it("reuses an existing left pane when the source is the rightmost pane", () => {
    // The Visualizer opens as a split to the RIGHT of the chat, so its only
    // neighbor is to the left — it must reuse that pane, not split a new one.
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "group-root",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            {
              kind: "pane",
              pane: { id: "left", tabIds: ["agent_agent-a"], focusedTabId: "agent_agent-a" },
            },
            {
              kind: "pane",
              pane: { id: "right", tabIds: ["visualizer"], focusedTabId: "visualizer" },
            },
          ],
        },
      },
      focusedPaneId: "right",
    };

    expect(
      resolveSideFileOpenPlacement({
        layout,
        sourcePaneId: "right",
        tabs: [
          createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" }),
          createTab("visualizer", { kind: "visualizer" }),
        ],
        target: { kind: "file", path: "/repo/README.md" },
      }),
    ).toEqual({ kind: "focus-side-pane", paneId: "left" });
  });

  it("splits a pane between the chat and the Visualizer instead of reusing it", () => {
    // The document must never displace the Visualizer. With the Visualizer to
    // the right of the chat, a fresh pane is split off the chat (source) — it
    // lands between the chat and the Visualizer.
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "group-root",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            {
              kind: "pane",
              pane: { id: "left", tabIds: ["agent_agent-a"], focusedTabId: "agent_agent-a" },
            },
            {
              kind: "pane",
              pane: { id: "right", tabIds: ["visualizer"], focusedTabId: "visualizer" },
            },
          ],
        },
      },
      focusedPaneId: "left",
    };

    expect(
      resolveSideFileOpenPlacement({
        layout,
        sourcePaneId: "left",
        tabs: [
          createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" }),
          createTab("visualizer", { kind: "visualizer" }),
        ],
        target: { kind: "file", path: "/repo/README.md" },
      }),
    ).toEqual({ kind: "split-side-pane", paneId: "left" });
  });

  it("resolves side file opens to a split when the source pane is alone", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "pane",
        pane: { id: "main", tabIds: ["agent_agent-a"], focusedTabId: "agent_agent-a" },
      },
      focusedPaneId: "main",
    };

    expect(
      resolveSideFileOpenPlacement({
        layout,
        sourcePaneId: "main",
        tabs: [createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" })],
        target: { kind: "file", path: "/repo/README.md" },
      }),
    ).toEqual({ kind: "split-side-pane", paneId: "main" });
  });
});

describe("resolveWorkspaceNewChatPlacement", () => {
  const splitLayout: WorkspaceLayout = {
    root: {
      kind: "group",
      group: {
        id: "group-root",
        direction: "horizontal",
        sizes: [0.5, 0.5],
        children: [
          {
            kind: "pane",
            pane: { id: "left", tabIds: ["agent_agent-a"], focusedTabId: "agent_agent-a" },
          },
          {
            kind: "pane",
            pane: { id: "right", tabIds: ["visualizer"], focusedTabId: "visualizer" },
          },
        ],
      },
    },
    focusedPaneId: "right",
  };
  const splitTabs: WorkspaceTab[] = [
    createTab("agent_agent-a", { kind: "agent", agentId: "agent-a" }),
    createTab("visualizer", { kind: "visualizer" }),
  ];

  it("reuses the sibling pane when a new chat targets the Visualizer's pane", () => {
    expect(
      resolveWorkspaceNewChatPlacement({
        layout: splitLayout,
        tabs: splitTabs,
        requestedPaneId: "right",
        supportsPaneSplits: true,
      }),
    ).toEqual({ kind: "reuse-pane", paneId: "left" });
  });

  it("reuses the sibling pane when the Visualizer's pane is focused and no pane is requested", () => {
    expect(
      resolveWorkspaceNewChatPlacement({
        layout: splitLayout,
        tabs: splitTabs,
        requestedPaneId: null,
        supportsPaneSplits: true,
      }),
    ).toEqual({ kind: "reuse-pane", paneId: "left" });
  });

  it("splits a new pane to the left when the Visualizer stands alone", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "pane",
        pane: { id: "only", tabIds: ["visualizer"], focusedTabId: "visualizer" },
      },
      focusedPaneId: "only",
    };

    expect(
      resolveWorkspaceNewChatPlacement({
        layout,
        tabs: [createTab("visualizer", { kind: "visualizer" })],
        requestedPaneId: "only",
        supportsPaneSplits: true,
      }),
    ).toEqual({ kind: "split-left", targetPaneId: "only" });
  });

  it("opens in place when the target pane has no Visualizer tab", () => {
    expect(
      resolveWorkspaceNewChatPlacement({
        layout: splitLayout,
        tabs: splitTabs,
        requestedPaneId: "left",
        supportsPaneSplits: true,
      }),
    ).toEqual({ kind: "open-in-pane" });
  });

  it("opens in place when pane splits are unsupported (native/compact)", () => {
    expect(
      resolveWorkspaceNewChatPlacement({
        layout: splitLayout,
        tabs: splitTabs,
        requestedPaneId: "right",
        supportsPaneSplits: false,
      }),
    ).toEqual({ kind: "open-in-pane" });
  });

  it("opens in place when there is no layout yet", () => {
    expect(
      resolveWorkspaceNewChatPlacement({
        layout: null,
        tabs: [],
        requestedPaneId: null,
        supportsPaneSplits: true,
      }),
    ).toEqual({ kind: "open-in-pane" });
  });
});
