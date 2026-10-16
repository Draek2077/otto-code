import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import type { WorkspaceDescriptorPayload } from "@otto-code/protocol/messages";
import { connectToDaemon } from "../../utils/client.js";
import { render } from "../../output/render.js";
import { runLsCommand } from "./ls.js";
import { createWorkspaceCommand } from "./index.js";

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(),
  getDaemonHost: () => "test-daemon",
}));

function workspace(id: string, projectId: string): WorkspaceDescriptorPayload {
  return {
    id,
    projectId,
    projectDisplayName: "Same name",
    projectRootPath: "/same/directory",
    workspaceDirectory: "/same/directory",
    projectKind: "non_git",
    workspaceKind: "local_checkout",
    name: "Development",
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    archivingAt: null,
    scripts: [],
  };
}

beforeEach(() => vi.mocked(connectToDaemon).mockReset());

describe("workspace ls", () => {
  function mockClient() {
    const client = {
      fetchWorkspaces: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [workspace("ws-1", "proj-1")],
          pageInfo: { nextCursor: "page-2" },
        })
        .mockResolvedValueOnce({
          entries: [workspace("ws-2", "proj-2")],
          pageInfo: { nextCursor: null },
        }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(connectToDaemon).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof connectToDaemon>>,
    );
    return client;
  }

  it("adds authoritative projectId while preserving fields, columns, and default paging", async () => {
    const client = mockClient();
    const result = await runLsCommand({}, new Command());
    expect(JSON.parse(render(result, { format: "json" }))).toEqual([
      {
        workspaceId: "ws-1",
        project: "Same name",
        projectId: "proj-1",
        name: "Development",
        isolation: "local",
        cwd: "/same/directory",
      },
      {
        workspaceId: "ws-2",
        project: "Same name",
        projectId: "proj-2",
        name: "Development",
        isolation: "local",
        cwd: "/same/directory",
      },
    ]);
    expect(result.schema.columns.map((column) => column.field)).toEqual([
      "workspaceId",
      "project",
      "name",
      "isolation",
      "cwd",
    ]);
    expect(render(result, { quiet: true })).toBe("ws-1\nws-2");
    expect(client.fetchWorkspaces.mock.calls).toEqual([
      [{ page: { limit: 200 } }],
      [{ page: { limit: 200, cursor: "page-2" } }],
    ]);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("keeps the daemon project filter on every page", async () => {
    const client = mockClient();
    await runLsCommand({ project: " proj-1 " }, new Command());
    expect(client.fetchWorkspaces.mock.calls).toEqual([
      [{ filter: { projectId: "proj-1" }, page: { limit: 200 } }],
      [{ filter: { projectId: "proj-1" }, page: { limit: 200, cursor: "page-2" } }],
    ]);
  });

  it("rejects an empty project ID before connecting", async () => {
    await expect(runLsCommand({ project: " " }, new Command())).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
    });
    expect(connectToDaemon).not.toHaveBeenCalled();
  });

  it("advertises exact project filtering", () => {
    expect(
      createWorkspaceCommand()
        .commands.find((command) => command.name() === "ls")
        ?.helpInformation(),
    ).toContain("--project <project-id>");
  });
});
