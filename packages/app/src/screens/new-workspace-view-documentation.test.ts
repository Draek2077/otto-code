import { describe, expect, it, vi } from "vitest";

const navigateToPreparedWorkspaceTab = vi.fn();
const setFileViewModeFor = vi.fn();

vi.mock("@/utils/workspace-navigation", () => ({
  navigateToPreparedWorkspaceTab: (input: unknown) => navigateToPreparedWorkspaceTab(input),
}));
vi.mock("@/stores/file-view-store", () => ({
  setFileViewModeFor: (input: unknown) => setFileViewModeFor(input),
}));
vi.mock("@/stores/workspace-tabs-store", () => ({
  buildWorkspaceTabPersistenceKey: (input: { serverId: string; workspaceId: string }) =>
    `${input.serverId}:${input.workspaceId}`,
}));
vi.mock("@/workspace/file-open", () => ({
  createWorkspaceFileTabTarget: (input: { path: string }) => ({ kind: "file", path: input.path }),
}));

const { runViewDocumentation } = await import("./new-workspace-view-documentation");

describe("runViewDocumentation", () => {
  it("opens the README in the workspace already backing the directory instead of creating one", async () => {
    const ensureWorkspace = vi.fn();
    const onError = vi.fn();

    await runViewDocumentation({
      readmeFileName: "README.md",
      findExistingWorkspaceId: () => "workspace-existing",
      ensureWorkspace,
      serverId: "server-abc",
      sourceDirectory: "/sample/repo",
      onError,
    });

    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(navigateToPreparedWorkspaceTab).toHaveBeenCalledWith({
      serverId: "server-abc",
      workspaceId: "workspace-existing",
      target: { kind: "file", path: "README.md" },
    });
  });

  it("creates a workspace when the directory does not back one yet", async () => {
    navigateToPreparedWorkspaceTab.mockClear();
    const ensureWorkspace = vi.fn().mockResolvedValue({ id: "workspace-new" });
    const onError = vi.fn();

    await runViewDocumentation({
      readmeFileName: "README.md",
      findExistingWorkspaceId: () => null,
      ensureWorkspace,
      serverId: "server-abc",
      sourceDirectory: "/sample/repo",
      onError,
    });

    expect(ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/sample/repo",
      prompt: "",
      attachments: [],
      withInitialAgent: false,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(navigateToPreparedWorkspaceTab).toHaveBeenCalledWith({
      serverId: "server-abc",
      workspaceId: "workspace-new",
      target: { kind: "file", path: "README.md" },
    });
  });
});
