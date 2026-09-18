import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateToWorkspace = vi.fn();

// The layout store persists through AsyncStorage, which needs a `window` this
// node-environment project does not have.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/features/use-feature-enabled", () => ({
  getFeatureEnabledSnapshot: () => true,
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: (input: unknown) => navigateToWorkspace(input),
}));

import { openVisualizerTab } from "@/visualizer/open-visualizer-tab";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

const SERVER_ID = "host-a";
const WORKSPACE_ID = "workspace-a";
const WORKSPACE_KEY = `${SERVER_ID}:${WORKSPACE_ID}`;

function visualizerTabTargets() {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
  if (!layout) {
    return [];
  }
  return collectAllTabs(layout.root)
    .map((tab) => tab.target)
    .filter((target) => target.kind === "visualizer");
}

describe("openVisualizerTab", () => {
  beforeEach(() => {
    navigateToWorkspace.mockClear();
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  });

  it("carries an app-wide caller to the run's workspace with the run tab as the target", () => {
    expect(
      openVisualizerTab({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        runId: "run-1",
        navigate: true,
      }),
    ).toBe(true);

    // The named target is what keeps the route hop from opening an attention
    // agent over the Visualizer the action just asked for.
    expect(navigateToWorkspace).toHaveBeenCalledWith({
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      target: { kind: "visualizer", runId: "run-1" },
    });
    expect(visualizerTabTargets()).toEqual([{ kind: "visualizer", runId: "run-1" }]);
  });

  it("leaves an in-workspace caller's route alone", () => {
    openVisualizerTab({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });

    expect(navigateToWorkspace).not.toHaveBeenCalled();
    expect(visualizerTabTargets()).toEqual([{ kind: "visualizer" }]);
  });

  it("reopens the same run without stacking duplicates", () => {
    openVisualizerTab({
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      runId: "run-1",
      navigate: true,
    });
    openVisualizerTab({
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      runId: "run-1",
      navigate: true,
    });

    expect(visualizerTabTargets()).toEqual([{ kind: "visualizer", runId: "run-1" }]);
    expect(navigateToWorkspace).toHaveBeenCalledTimes(2);
  });

  it("retargets the existing tab when selecting another run or the workspace view", () => {
    openVisualizerTab({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, runId: "run-1" });
    const first = useWorkspaceLayoutStore.getState().getWorkspaceTabs(WORKSPACE_KEY)[0]!;
    openVisualizerTab({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, runId: "run-2" });
    expect(visualizerTabTargets()).toEqual([{ kind: "visualizer", runId: "run-2" }]);
    expect(useWorkspaceLayoutStore.getState().getWorkspaceTabs(WORKSPACE_KEY)[0]!.tabId).toBe(
      first.tabId,
    );
    openVisualizerTab({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });
    expect(visualizerTabTargets()).toEqual([{ kind: "visualizer" }]);
    expect(useWorkspaceLayoutStore.getState().getWorkspaceTabs(WORKSPACE_KEY)[0]!.tabId).toBe(
      first.tabId,
    );
  });

  it("preserves saved visualizer tabs in other hosts and workspaces", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTabFocused(WORKSPACE_KEY, { kind: "draft", draftId: "keep-chat" });
    openVisualizerTab({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });
    openVisualizerTab({ serverId: "host-b", workspaceId: "workspace-b", runId: "run-2" });
    expect(visualizerTabTargets()).toEqual([{ kind: "visualizer" }]);
    expect(
      store
        .getWorkspaceTabs(WORKSPACE_KEY)
        .map((tab) => tab.target)
        .filter((target) => target.kind === "draft"),
    ).toEqual([{ kind: "draft", draftId: "keep-chat" }]);
    expect(
      store
        .getWorkspaceTabs("host-b:workspace-b")
        .map((tab) => tab.target)
        .filter((target) => target.kind === "visualizer"),
    ).toEqual([{ kind: "visualizer", runId: "run-2" }]);
  });
});
