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

  it("reopens one tab per run rather than stacking duplicates", () => {
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
});
