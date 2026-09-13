import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  attach: vi.fn(),
  open: vi.fn(),
  navigate: vi.fn(),
  supported: true,
  connected: true,
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => (state.connected ? { artifactAttachWorkspace: state.attach } : null),
  }),
}));
vi.mock("@/runtime/host-features", () => ({ selectHostFeature: () => state.supported }));
vi.mock("@/stores/session-store", () => ({ useSessionStore: { getState: () => ({}) } }));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: { getState: () => ({ openTabFocused: state.open }) },
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: state.navigate,
}));

import { openArtifactTab } from "./open-artifact-tab";

const input = { serverId: "remote-host", workspaceId: "workspace-2", artifactId: "artifact-1" };
beforeEach(() => {
  vi.clearAllMocks();
  state.connected = true;
  state.supported = true;
});

it("waits for durable attachment before opening the local tab", async () => {
  let complete!: (value: { success: boolean }) => void;
  state.attach.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = openArtifactTab({ ...input, navigate: true });
  expect(state.attach).toHaveBeenCalledWith({
    workspaceId: "workspace-2",
    artifactId: "artifact-1",
  });
  expect(state.open).not.toHaveBeenCalled();
  complete({ success: true });
  await expect(pending).resolves.toBe(true);
  expect(state.open).toHaveBeenCalledWith("remote-host:workspace-2", {
    kind: "artifact",
    artifactId: "artifact-1",
  });
  expect(state.navigate).toHaveBeenCalledWith({
    serverId: "remote-host",
    workspaceId: "workspace-2",
  });
});

it("surfaces a rejected attachment without opening a misleading local tab", async () => {
  state.attach.mockResolvedValue({
    success: false,
    error: "Artifact belongs to a different project",
  });
  await expect(openArtifactTab(input)).rejects.toThrow("different project");
  expect(state.open).not.toHaveBeenCalled();
});

it("requires the host capability and reports disconnection", async () => {
  state.supported = false;
  await expect(openArtifactTab(input)).rejects.toThrow("Update the host");
  expect(state.attach).not.toHaveBeenCalled();
  state.supported = true;
  state.connected = false;
  await expect(openArtifactTab(input)).rejects.toThrow("Host is disconnected");
  expect(state.open).not.toHaveBeenCalled();
});
