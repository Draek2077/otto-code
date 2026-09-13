import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { resolveCompactExplorerTabs } from "@/components/compact-explorer-sidebar-host-state";
import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  filterExplorerSidebarTabs,
  isExplorerSidebarOpen,
  openExplorerSidebarTab,
  openExplorerSidebarView,
  resolveExplorerSidebarPresentation,
  toggleExplorerSidebar,
} from "@/workspace-tabs/explorer-sidebar";
import type { WorkspaceTab } from "@/workspace-tabs/model";

const WORKSPACE_KEY = "server-1:ws-main";
const CHECKOUT = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({
    mobilePanel: { target: "agent", revision: 0 },
    explorerTab: "files",
    explorerTabByCheckout: {},
  });
});

describe("Explorer sidebar", () => {
  it("selects the Explorer shell from layout and split capabilities", () => {
    expect(resolveExplorerSidebarPresentation({ isCompact: true })).toBe("overlay");
    expect(
      resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: false }),
    ).toBe("dock");
    expect(resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: true })).toBe(
      "pane",
    );
  });

  it("uses the compact explorer without creating a desktop pane", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "changes",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("creates a dedicated desktop Explorer containing only its requested tree", () => {
    openExplorerSidebarView({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "files",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    expect(paneId).not.toBeNull();
    expect(layout && collectAllTabs(layout.root).map((tab) => tab.target.kind)).toContain("files");
  });

  it("toggles the desktop Explorer independently of ordinary panes", () => {
    const input = {
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };
    openExplorerSidebarView({ ...input, view: "files" });
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(false);
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(true);
    const openedState = useWorkspaceLayoutStore.getState();
    const openedLayout = openedState.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(openedState, WORKSPACE_KEY);
    const explorerPane =
      openedLayout && explorerPaneId ? findPaneById(openedLayout.root, explorerPaneId) : null;
    const activeExplorerTarget =
      openedLayout && explorerPane
        ? collectAllTabs(openedLayout.root).find((tab) => tab.tabId === explorerPane.focusedTabId)
            ?.target.kind
        : null;
    expect(activeExplorerTarget).toBe("files");
  });

  it("toggles the compact Explorer without changing its selected view", () => {
    usePanelStore.getState().setExplorerTabForCheckout({ ...CHECKOUT, tab: "files" });
    const input = {
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };

    toggleExplorerSidebar(input);

    expect(isExplorerSidebarOpen(input)).toBe(true);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });

  it("opens Search in User mode", () => {
    openExplorerSidebarTab({
      isCompact: true,
      isDeveloperMode: false,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      tab: "search",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(usePanelStore.getState().explorerTab).toBe("search");
  });

  it("preserves the stored view while User mode presents only Files and Search", () => {
    usePanelStore.getState().setExplorerTabForCheckout({ ...CHECKOUT, tab: "changes" });
    const input = {
      isCompact: true,
      isDeveloperMode: false,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };
    toggleExplorerSidebar(input);
    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    const activeTab = usePanelStore.getState().explorerTab;
    expect(activeTab).toBe("changes");
    expect(
      resolveCompactExplorerTabs({
        activeTab,
        isDeveloperMode: false,
        isGit: true,
        hasProjectSearch: true,
        showPullRequest: true,
      }),
    ).toEqual({ activeTab: "files", tabs: ["files", "search"] });
    toggleExplorerSidebar(input);
    toggleExplorerSidebar({ ...input, isDeveloperMode: true });
    expect(usePanelStore.getState().explorerTab).toBe("changes");
    expect(
      resolveCompactExplorerTabs({
        activeTab: usePanelStore.getState().explorerTab,
        isDeveloperMode: true,
        isGit: true,
        hasProjectSearch: true,
        showPullRequest: true,
      }).activeTab,
    ).toBe("changes");
  });

  it("keeps Files and Search in the User-mode desktop Explorer", () => {
    const input = {
      isCompact: false,
      isDeveloperMode: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };
    toggleExplorerSidebar(input);

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    const pane = paneId && layout ? findPaneById(layout.root, paneId) : null;
    const focusedTab = layout
      ? (collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId) ?? null)
      : null;
    expect(focusedTab?.target.kind).toBe("files");
    const paneTabs =
      layout && pane
        ? collectAllTabs(layout.root).filter((tab) => pane.tabIds.includes(tab.tabId))
        : [];
    expect(filterExplorerSidebarTabs(paneTabs, false).map((tab) => tab.target.kind)).toEqual([
      "files",
      "project_search",
    ]);
  });

  it("keeps the registered pull-request tab out of the Explorer until a PR is detected", () => {
    const tabs: WorkspaceTab[] = [
      { tabId: "files", target: { kind: "files" }, createdAt: 1 },
      { tabId: "pr", target: { kind: "pull_request" }, createdAt: 1 },
    ];

    expect(filterExplorerSidebarTabs(tabs, true, false).map((tab) => tab.target.kind)).toEqual([
      "files",
    ]);
    expect(filterExplorerSidebarTabs(tabs, true, true).map((tab) => tab.target.kind)).toEqual([
      "files",
      "pull_request",
    ]);
  });
});
