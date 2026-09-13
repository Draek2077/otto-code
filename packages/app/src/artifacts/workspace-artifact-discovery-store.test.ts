import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const values = new Map<string, string>();
  return {
    default: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createWorkspaceLayoutStore, findPaneById } from "@/stores/workspace-layout-store";
import { createWorkspaceArtifactDiscoveryStore } from "./workspace-artifact-discovery-store";

beforeEach(async () => {
  await AsyncStorage.removeItem("workspace-layout-state");
  await AsyncStorage.removeItem("workspace-artifact-discovery-state");
});

it("discovers on two clients, preserves focus and persists local dismissal across reload", async () => {
  const key = "host:workspace";
  const first = createWorkspaceLayoutStore();
  const second = createWorkspaceLayoutStore();
  const firstDiscovery = createWorkspaceArtifactDiscoveryStore(first);
  const secondDiscovery = createWorkspaceArtifactDiscoveryStore(second);
  await Promise.all([
    first.persist.rehydrate(),
    second.persist.rehydrate(),
    firstDiscovery.persist.rehydrate(),
    secondDiscovery.persist.rehydrate(),
  ]);

  for (const [layoutStore, discovery] of [
    [first, firstDiscovery],
    [second, secondDiscovery],
  ] as const) {
    const chatTab = layoutStore
      .getState()
      .openTabFocused(key, { kind: "agent", agentId: "chat-1" });
    discovery.getState().discover(key, ["report-1"]);
    const layout = layoutStore.getState().layoutByWorkspace[key];
    expect(findPaneById(layout.root, layout.focusedPaneId!)?.focusedTabId).toBe(chatTab);
    expect(
      layoutStore
        .getState()
        .getWorkspaceTabs(key)
        .map((tab) => tab.target),
    ).toContainEqual({ kind: "artifact", artifactId: "report-1" });
  }
  const artifact = second
    .getState()
    .getWorkspaceTabs(key)
    .find((tab) => tab.target.kind === "artifact")!;
  second.getState().closeTab(key, artifact.tabId);
  secondDiscovery.getState().discover(key, ["report-1", "report-2"]);
  const artifactTargets = (store: typeof second) =>
    store
      .getState()
      .getWorkspaceTabs(key)
      .filter((tab) => tab.target.kind === "artifact")
      .map((tab) => tab.target);
  expect(artifactTargets(second)).toEqual([{ kind: "artifact", artifactId: "report-2" }]);

  const restored = createWorkspaceLayoutStore();
  const restoredDiscovery = createWorkspaceArtifactDiscoveryStore(restored);
  await Promise.all([restored.persist.rehydrate(), restoredDiscovery.persist.rehydrate()]);
  restoredDiscovery.getState().discover(key, ["report-1", "report-2"]);
  expect(artifactTargets(restored)).toEqual([{ kind: "artifact", artifactId: "report-2" }]);
  restoredDiscovery.getState().discover(key, []);
  expect(artifactTargets(restored)).toEqual([]);
  expect(artifactTargets(first)).toEqual([{ kind: "artifact", artifactId: "report-1" }]);
  expect(
    restored
      .getState()
      .getWorkspaceTabs("other-host:workspace")
      .filter((tab) => tab.target.kind === "artifact"),
  ).toEqual([]);
});
