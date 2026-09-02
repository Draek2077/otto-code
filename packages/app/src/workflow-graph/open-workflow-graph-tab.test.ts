import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildWorkspaceTabPersistenceKey: vi.fn(),
  navigateToWorkspace: vi.fn(),
  openTabFocused: vi.fn(),
}));

vi.mock("@/constants/platform", () => ({ isDev: false }));
vi.mock("@/stores/workspace-tabs-store", () => ({
  buildWorkspaceTabPersistenceKey: mocks.buildWorkspaceTabPersistenceKey,
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: {
    getState: () => ({ openTabFocused: mocks.openTabFocused }),
  },
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: mocks.navigateToWorkspace,
}));

import { openOrchestrationGraphTab } from "./open-workflow-graph-tab";

beforeEach(() => {
  mocks.buildWorkspaceTabPersistenceKey.mockReturnValue("workspace-key");
  mocks.navigateToWorkspace.mockReset();
  mocks.openTabFocused.mockReset();
});

describe("openOrchestrationGraphTab", () => {
  it("opens the Graph Workflow designer in a production build", () => {
    expect(
      openOrchestrationGraphTab({
        serverId: "host-1",
        workspaceId: "workspace-1",
        graphId: "graph-1",
        runId: "run-1",
      }),
    ).toBe(true);

    expect(mocks.openTabFocused).toHaveBeenCalledWith(
      "workspace-key",
      { kind: "orchestrationGraph", graphId: "graph-1", runId: "run-1" },
      { insertAfterFocusedTab: true },
    );
    expect(mocks.navigateToWorkspace).toHaveBeenCalledWith({
      serverId: "host-1",
      workspaceId: "workspace-1",
    });
  });
});
