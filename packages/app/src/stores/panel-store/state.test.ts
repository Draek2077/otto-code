import { describe, expect, it } from "vitest";
import {
  buildExplorerCheckoutKey,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "@/stores/explorer-tab-memory";
import {
  buildOpenFileExplorerPatch,
  buildToggleFileExplorerPatch,
  migratePanelState,
  selectIsAgentListOpen,
  selectIsCompactFileExplorerOpen,
  setMobilePanelTarget,
  type PanelCoreState,
} from "./state";

function makePanelState(overrides: Partial<PanelCoreState> = {}): PanelCoreState {
  return {
    mobilePanel: { target: "agent", revision: 0 },
    desktop: {
      agentListOpen: false,
      focusModeEnabled: false,
    },
    explorerTab: "changes",
    explorerTabByCheckout: {},
    ...overrides,
  };
}

describe("panel-store explorer tab resolution", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo";

  it("defaults to changes for git checkouts", () => {
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {},
      }),
    ).toBe("changes");
  });

  it("defaults to files for non-git checkouts", () => {
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: false,
        explorerTabByCheckout: {},
      }),
    ).toBe("files");
  });

  it("restores a stored files tab for git checkouts", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {
          [key]: "files",
        },
      }),
    ).toBe("files");
  });

  it("falls back to default when stored tab is invalid", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {
          [key]: "terminals" as unknown as ExplorerTab,
        },
      }),
    ).toBe("changes");
  });

  it("coerces stored changes to files for non-git checkouts", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: false,
        explorerTabByCheckout: {
          [key]: "changes",
        },
      }),
    ).toBe("files");
  });
});

describe("panel-store migration", () => {
  it("preserves Otto explorer modes and persisted panel widths", () => {
    const state = migratePanelState(
      {
        explorerTab: "search",
        explorerTabByCheckout: { "host::/repo": "search" },
        explorerViewModeByCheckout: { "host::/repo": "solution" },
        explorerSolutionByCheckout: { "host::/repo": "/repo/App.sln" },
        contextSidebarWidth: 410,
        projectKnowledgeSidebarWidth: 430,
      },
      12,
    );

    expect(state).toMatchObject({
      explorerTab: "search",
      explorerTabByCheckout: { "host::/repo": "search" },
      explorerViewModeByCheckout: { "host::/repo": "solution" },
      explorerSolutionByCheckout: { "host::/repo": "/repo/App.sln" },
      contextSidebarWidth: 410,
      projectKnowledgeSidebarWidth: 430,
    });
  });

  it("drops the superseded desktop Explorer state while keeping compact selection memory", () => {
    const state = migratePanelState(
      {
        desktop: {
          agentListOpen: true,
          focusModeEnabled: false,
          fileExplorerOpen: true,
        },
        explorerWidth: 520,
        explorerFilesSplitRatio: 0.5,
        explorerTab: "search",
      },
      16,
    );

    expect(state.desktop?.fileExplorerOpen).toBeUndefined();
    expect(state.explorerWidth).toBeUndefined();
    expect(state.explorerFilesSplitRatio).toBeUndefined();
    expect(state.explorerTab).toBe("search");
  });

  it("defaults hidden-file visibility to showing hidden files", () => {
    const state = migratePanelState({}, 10);

    expect(state.explorerShowHiddenFiles).toBe(true);
  });

  it("initializes diffCollapsedFoldersByWorkspace for pre-v12 state", () => {
    const state = migratePanelState({}, 11);

    expect(state.diffCollapsedFoldersByWorkspace).toEqual({});
  });

  it("preserves an existing diffCollapsedFoldersByWorkspace map", () => {
    const state = migratePanelState({ diffCollapsedFoldersByWorkspace: { ws: ["src/app"] } }, 12);

    expect(state.diffCollapsedFoldersByWorkspace).toEqual({ ws: ["src/app"] });
  });

  it("drops persisted compact panel state so cold starts return to content", () => {
    const state = migratePanelState(
      { mobileView: "agent-list", mobilePanel: { target: "file-explorer", revision: 42 } },
      11,
    );

    expect(state.mobileView).toBeUndefined();
    expect(state.mobilePanel).toBeUndefined();
  });
});

describe("panel-store visibility selectors", () => {
  it("increments the mobile panel revision only when the target changes", () => {
    const initial = { target: "agent" as const, revision: 4 };

    expect(setMobilePanelTarget(initial, "agent")).toBe(initial);
    expect(setMobilePanelTarget(initial, "agent-list")).toEqual({
      target: "agent-list",
      revision: 5,
    });
  });

  it("uses the mobile panel target for compact layout visibility", () => {
    const state = makePanelState({
      mobilePanel: { target: "file-explorer", revision: 1 },
      desktop: { agentListOpen: true, focusModeEnabled: false },
    });

    expect(selectIsAgentListOpen(state, { isCompact: true })).toBe(false);
    expect(selectIsCompactFileExplorerOpen(state)).toBe(true);
  });

  it("uses the desktop flag for expanded agent-list visibility", () => {
    const state = makePanelState({
      mobilePanel: { target: "file-explorer", revision: 1 },
      desktop: { agentListOpen: true, focusModeEnabled: false },
    });

    expect(selectIsAgentListOpen(state, { isCompact: false })).toBe(true);
  });
});

describe("panel-store compact file explorer actions", () => {
  it("opens the compact explorer and resolves the tab from the explicit checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    const state = makePanelState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "files" },
    });

    const patch = buildOpenFileExplorerPatch(state, checkout);

    expect(patch.mobilePanel).toEqual({ target: "file-explorer", revision: 1 });
    expect(patch.explorerTab).toBe("files");
  });

  it("toggles the explorer closed without changing the active tab", () => {
    const state = makePanelState({
      mobilePanel: { target: "file-explorer", revision: 1 },
      explorerTab: "files",
    });

    const patch = buildToggleFileExplorerPatch(state, {
      serverId: "server-1",
      cwd: "/tmp/repo",
      isGit: true,
    });

    expect(patch).toEqual({ mobilePanel: { target: "agent", revision: 2 } });
  });

  it("coerces changes to files for a non-git checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: false };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    const state = makePanelState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "changes" },
    });

    const patch = buildOpenFileExplorerPatch(state, checkout);

    expect(patch.explorerTab).toBe("files");
  });

  it("opens with the default files tab for an explicit non-git checkout with no stored tab", () => {
    const state = makePanelState({ explorerTab: "changes", explorerTabByCheckout: {} });

    const patch = buildOpenFileExplorerPatch(state, {
      serverId: "server-1",
      cwd: "/tmp/non-git",
      isGit: false,
    });

    expect(patch.mobilePanel).toEqual({ target: "file-explorer", revision: 1 });
    expect(patch.explorerTab).toBe("files");
  });
});
