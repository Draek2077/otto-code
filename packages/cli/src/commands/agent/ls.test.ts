import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import YAML from "yaml";
import type { FetchAgentsResponseMessage } from "@otto-code/protocol/messages";
import { AgentSnapshotPayloadSchema } from "@otto-code/protocol/messages";
import { connectToDaemon } from "../../utils/client.js";
import { render } from "../../output/render.js";
import { addLsOptions, buildAgentLsFetchOptions, runLsCommand } from "./ls.js";

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(),
  getDaemonHost: () => "test-daemon",
}));

type Entry = FetchAgentsResponseMessage["payload"]["entries"][number];

function entry(id: string, projectId: string, workspaceId?: string): Entry {
  return {
    agent: AgentSnapshotPayloadSchema.parse({
      id,
      provider: "codex",
      cwd: "/same/directory",
      workspaceId,
      model: "test-model",
      createdAt: "2026-10-16T12:00:00.000Z",
      updatedAt: "2026-10-16T12:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Example",
      labels: {},
      archivedAt: null,
    }),
    project: {
      projectKey: projectId,
      projectName: "Same display name",
      checkout: {
        cwd: "/same/directory",
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isOttoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function mockClient(entries: Entry[], supportsWorkspaceFilter = true) {
  const client = {
    fetchAgents: vi
      .fn()
      .mockResolvedValue({ entries, pageInfo: { nextCursor: null, hasMore: false } }),
    getLastServerInfoMessage: () => ({
      features: { agentWorkspaceFilter: supportsWorkspaceFilter },
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(connectToDaemon).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof connectToDaemon>>,
  );
  return client;
}

beforeEach(() => {
  vi.mocked(connectToDaemon).mockReset();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-16T12:00:10.000Z"));
});
afterEach(() => vi.restoreAllMocks());

describe("buildAgentLsFetchOptions", () => {
  it("fetches active agents by default", () => {
    expect(buildAgentLsFetchOptions({})).toEqual({
      scope: "active",
    });
  });

  it("keeps label and thinking filters within the active scope", () => {
    expect(
      buildAgentLsFetchOptions({
        label: ["surface=workspace"],
        thinking: " medium ",
      }),
    ).toEqual({
      scope: "active",
      filter: {
        labels: { surface: "workspace" },
        thinkingOptionId: "medium",
      },
    });
  });

  it("fetches global non-archived agents for -g", () => {
    expect(buildAgentLsFetchOptions({ global: true })).toEqual({});
  });

  it("keeps -a within the active scope", () => {
    expect(buildAgentLsFetchOptions({ all: true })).toEqual({
      scope: "active",
      filter: {
        includeArchived: true,
      },
    });
  });

  it("fetches all global agents for -a -g", () => {
    expect(buildAgentLsFetchOptions({ all: true, global: true })).toEqual({
      filter: {
        includeArchived: true,
      },
    });
  });

  it("applies filters to global queries", () => {
    expect(
      buildAgentLsFetchOptions({
        global: true,
        label: ["surface=workspace"],
        thinking: " medium ",
      }),
    ).toEqual({
      filter: {
        labels: { surface: "workspace" },
        thinkingOptionId: "medium",
      },
    });
  });

  it("intersects exact ownership IDs with the selected scope and existing filters", () => {
    expect(
      buildAgentLsFetchOptions({
        project: " proj-1 ",
        workspace: " ws-2 ",
        label: ["team=a"],
        thinking: "high",
        all: true,
      }),
    ).toEqual({
      scope: "active",
      filter: {
        projectKeys: ["proj-1"],
        workspaceId: "ws-2",
        labels: { team: "a" },
        thinkingOptionId: "high",
        includeArchived: true,
      },
    });
    expect(
      buildAgentLsFetchOptions({ project: "proj-1", workspace: "ws-2", global: true }),
    ).toEqual({
      filter: { projectKeys: ["proj-1"], workspaceId: "ws-2" },
    });
  });
});

describe("agent ls ownership output and filtering", () => {
  it("preserves every existing JSON/YAML field and distinguishes same-directory ownership", async () => {
    const client = mockClient([
      entry("agent-1", "proj-1", "ws-1"),
      entry("agent-2", "proj-2", "ws-2"),
    ]);
    const result = await runLsCommand({}, new Command());
    const expected = [
      {
        id: "agent-1",
        shortId: "agent-1",
        name: "Example",
        provider: "codex/test-model",
        thinking: "auto",
        status: "idle",
        cwd: "/same/directory",
        created: "just now",
        projectId: "proj-1",
        workspaceId: "ws-1",
      },
      {
        id: "agent-2",
        shortId: "agent-2",
        name: "Example",
        provider: "codex/test-model",
        thinking: "auto",
        status: "idle",
        cwd: "/same/directory",
        created: "just now",
        projectId: "proj-2",
        workspaceId: "ws-2",
      },
    ];
    expect(JSON.parse(render(result, { format: "json" }))).toEqual(expected);
    expect(YAML.parse(render(result, { format: "yaml" }))).toEqual(expected);
    expect(result.schema.columns.map((column) => column.field)).toEqual([
      "shortId",
      "name",
      "provider",
      "thinking",
      "status",
      "cwd",
      "created",
    ]);
    expect(render(result, { quiet: true })).toBe("agent-1\nagent-2");
    expect(client.fetchAgents).toHaveBeenCalledExactlyOnceWith({ scope: "active" });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("reports omitted legacy workspace ownership as null without inferring from cwd", async () => {
    mockClient([entry("legacy", "proj-1")], false);
    const result = await runLsCommand({}, new Command());
    expect(JSON.parse(render(result, { format: "json" }))[0]).toMatchObject({
      projectId: "proj-1",
      workspaceId: null,
    });
  });

  it("sends ownership filtering to the daemon instead of filtering the first global page", async () => {
    const client = mockClient([entry("match", "proj-1", "ws-2")]);
    const result = await runLsCommand(
      { project: "proj-1", workspace: "ws-2", global: true, all: true },
      new Command(),
    );
    expect(client.fetchAgents).toHaveBeenCalledExactlyOnceWith({
      filter: { projectKeys: ["proj-1"], workspaceId: "ws-2", includeArchived: true },
    });
    expect(result.data.map((row) => row.id)).toEqual(["match"]);
  });

  it("uses the existing project filter on an older host", async () => {
    const client = mockClient([], false);
    await runLsCommand({ project: "unknown-full-id" }, new Command());
    expect(client.fetchAgents).toHaveBeenCalledExactlyOnceWith({
      scope: "active",
      filter: { projectKeys: ["unknown-full-id"] },
    });
  });

  it("requires workspace capability before issuing any listing request", async () => {
    const client = mockClient([], false);
    await expect(runLsCommand({ workspace: "ws-1" }, new Command())).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to filter chats by workspace ID.",
    });
    expect(client.fetchAgents).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each([{ project: "" }, { project: "  " }, { workspace: "" }, { workspace: "  " }])(
    "rejects an empty ownership ID before connecting: %j",
    async (options) => {
      await expect(runLsCommand(options, new Command())).rejects.toMatchObject({
        code: "INVALID_OPTIONS",
      });
      expect(connectToDaemon).not.toHaveBeenCalled();
    },
  );

  it("preserves archived exclusion and status ordering in default output", async () => {
    const archived = entry("archived", "proj-1", "ws-1");
    archived.agent.archivedAt = "2026-10-16T12:00:00.000Z";
    const running = entry("running", "proj-1", "ws-1");
    running.agent.status = "running";
    mockClient([entry("idle", "proj-1", "ws-1"), archived, running]);
    expect((await runLsCommand({}, new Command())).data.map((row) => row.id)).toEqual([
      "running",
      "idle",
    ]);
    expect(
      (await runLsCommand({ all: true, global: true }, new Command())).data.map((row) => row.id),
    ).toEqual(["running", "idle", "archived"]);
  });

  it("parses both full-ID options and rejects a missing value", () => {
    const command = addLsOptions(new Command())
      .exitOverride()
      .configureOutput({ writeErr: () => undefined });
    command.parse(["--project", "proj-1", "--workspace", "ws-2"], { from: "user" });
    expect(command.opts()).toMatchObject({ project: "proj-1", workspace: "ws-2" });
    expect(() => command.parse(["--workspace"], { from: "user" })).toThrow();
  });
});
