import { describe, expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@otto-code/protocol/agent-labels";
import { createTestLogger } from "../test-utils/test-logger.js";
import type { AgentSnapshotPayload, WorkspaceDescriptorPayload } from "./messages.js";
import { WorkspaceDirectory } from "./workspace-directory.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "./workspace-registry.js";
import type { TerminalActivity } from "@otto-code/protocol/terminal-activity";
import type { ProviderSubagentWorkspaceActivity } from "./workspace-directory.js";

const NOW = "2026-03-01T12:00:00.000Z";

class WorkspaceStatus {
  private readonly project: PersistedProjectRecord = {
    projectId: "project-1",
    rootPath: "/workspace/project",
    kind: "git",
    displayName: "project",
    customName: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };

  private readonly workspace: PersistedWorkspaceRecord = {
    workspaceId: "workspace-1",
    projectId: this.project.projectId,
    cwd: this.project.rootPath,
    kind: "local_checkout",
    displayName: "main",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };

  private readonly worktreeWorkspace: PersistedWorkspaceRecord = {
    workspaceId: "workspace-worktree",
    projectId: this.project.projectId,
    cwd: "/workspace/project/.otto/worktrees/feature",
    kind: "worktree",
    displayName: "feature",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };

  // Second workspace sharing the SAME cwd as `workspace`. Created later so the
  // deterministic-oldest fallback never attributes a stamped agent to it by cwd.
  private readonly sameCwdWorkspace: PersistedWorkspaceRecord = {
    workspaceId: "workspace-1-sibling",
    projectId: this.project.projectId,
    cwd: this.project.rootPath,
    kind: "local_checkout",
    displayName: "main-2",
    createdAt: "2026-03-02T12:00:00.000Z",
    updatedAt: "2026-03-02T12:00:00.000Z",
    archivedAt: null,
  };

  private readonly workspaces = [this.workspace];

  private readonly agents: AgentSnapshotPayload[] = [];
  private readonly providerSubagents: ProviderSubagentWorkspaceActivity[] = [];
  private readonly terminals: Array<{
    cwd: string;
    workspaceId?: string;
    activity: TerminalActivity | null;
  }> = [];
  private readonly directory = new WorkspaceDirectory({
    logger: createTestLogger(),
    projectRegistry: { list: async () => [this.project] },
    workspaceRegistry: { list: async () => this.workspaces },
    listAgentPayloads: async () => this.agents,
    listProviderSubagentActivity: async () => this.providerSubagents,
    listTerminalActivityContributions: async () => this.terminals,
    isProviderVisibleToClient: () => true,
    buildWorkspaceDescriptor: async ({ workspace }) => ({
      id: workspace.workspaceId,
      projectId: workspace.projectId,
      projectDisplayName: "project",
      projectCustomName: null,
      projectRootPath: this.project.rootPath,
      workspaceDirectory: workspace.cwd,
      projectKind: "git",
      workspaceKind: workspace.kind,
      name: workspace.displayName,
      archivingAt: null,
      status: "done",
      activityAt: null,
      diffStat: null,
      scripts: [],
      gitRuntime: null,
      githubRuntime: null,
    }),
  });

  hasRootAgent(input: AgentState): void {
    this.agents.push(
      createAgent({
        ...input,
        cwd: this.workspace.cwd,
        workspaceId: this.workspace.workspaceId,
      }),
    );
  }

  hasSiblingWorkspaceSameCwd(): void {
    this.workspaces.push(this.sameCwdWorkspace);
  }

  // A root agent owned by a specific workspace, even though both same-cwd
  // workspaces share the directory. Ownership follows workspaceId, and status is
  // computed per id: only the owning workspace reflects this agent's bucket.
  hasStampedRootAgent(input: AgentState & { workspaceId: string }): void {
    this.agents.push(
      createAgent({ ...input, cwd: this.workspace.cwd, workspaceId: input.workspaceId }),
    );
  }

  hasDelegatedAgent(input: AgentState): void {
    this.agents.push(
      createAgent({
        ...input,
        cwd: this.workspace.cwd,
        workspaceId: this.workspace.workspaceId,
        labels: { [PARENT_AGENT_ID_LABEL]: "parent-agent" },
      }),
    );
  }

  hasProviderSubagent(input: ProviderSubagentWorkspaceActivity): void {
    this.providerSubagents.push(input);
  }

  hasWorktreeWorkspace(): void {
    this.workspaces.push(this.worktreeWorkspace);
  }

  hasDelegatedAgentInWorktree(input: AgentState): void {
    this.agents.push(
      createAgent({
        ...input,
        cwd: this.worktreeWorkspace.cwd,
        workspaceId: this.worktreeWorkspace.workspaceId,
        labels: { [PARENT_AGENT_ID_LABEL]: "parent-agent" },
      }),
    );
  }

  hasDetachedAgentInWorktree(input: AgentState): void {
    this.agents.push(
      createAgent({
        ...input,
        cwd: this.worktreeWorkspace.cwd,
        workspaceId: this.worktreeWorkspace.workspaceId,
      }),
    );
  }

  async workspaceStatus(): Promise<WorkspaceDescriptorPayload["status"]> {
    const entries = await this.directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "workspace-status",
    });
    return entries.entries[0]?.status ?? "done";
  }

  async workspaceStatuses(): Promise<Record<string, WorkspaceDescriptorPayload["status"]>> {
    const entries = await this.directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "workspace-statuses",
    });
    return Object.fromEntries(entries.entries.map((entry) => [entry.id, entry.status]));
  }

  hasWorkingTerminal(changedAt: number): void {
    this.terminals.push({
      cwd: this.workspace.cwd,
      workspaceId: this.workspace.workspaceId,
      activity: { state: "working", changedAt },
    });
  }

  // A working terminal owned by a specific same-cwd workspace. Ownership follows
  // workspaceId, and status is computed per id: only the owning workspace
  // reflects this terminal's activity.
  hasStampedWorkingTerminal(input: { workspaceId: string; changedAt: number }): void {
    this.terminals.push({
      cwd: this.workspace.cwd,
      workspaceId: input.workspaceId,
      activity: { state: "working", changedAt: input.changedAt },
    });
  }

  // A terminal opened in a subdirectory still carries the owning workspace's id
  // (stamped at creation); the subdir cwd is cosmetic, ownership is the id.
  hasWorkingTerminalInSubdirectory(changedAt: number): void {
    this.terminals.push({
      cwd: `${this.workspace.cwd}/packages/app`,
      workspaceId: this.workspace.workspaceId,
      activity: { state: "working", changedAt },
    });
  }

  hasIdleTerminal(changedAt: number): void {
    this.terminals.push({
      cwd: this.workspace.cwd,
      workspaceId: this.workspace.workspaceId,
      activity: { state: "idle", changedAt },
    });
  }

  hasFinishedTerminal(changedAt: number): void {
    this.terminals.push({
      cwd: this.workspace.cwd,
      workspaceId: this.workspace.workspaceId,
      activity: { state: "idle", attentionReason: "finished", changedAt },
    });
  }

  hasUnknownTerminal(): void {
    this.terminals.push({
      cwd: this.workspace.cwd,
      workspaceId: this.workspace.workspaceId,
      activity: null,
    });
  }

  async workspaceDescriptor(): Promise<WorkspaceDescriptorPayload> {
    const entries = await this.directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "workspace-descriptor",
    });
    const entry = entries.entries[0];
    if (!entry) {
      throw new Error("No workspace descriptor found");
    }
    return entry;
  }
}

interface AgentState {
  id: string;
  status: AgentSnapshotPayload["status"];
  pendingPermissionCount?: number;
  requiresAttention?: boolean;
  attentionReason?: AgentSnapshotPayload["attentionReason"];
}

function createAgent(
  input: AgentState & { cwd: string; labels?: Record<string, string>; workspaceId?: string },
) {
  const pendingPermissionCount = input.pendingPermissionCount ?? 0;
  return {
    id: input.id,
    provider: "codex",
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    model: null,
    thinkingOptionId: null,
    effectiveThinkingOptionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastUserMessageAt: null,
    status: input.status,
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
    pendingPermissions: Array.from({ length: pendingPermissionCount }, (_, index) => ({
      id: `permission-${input.id}-${index}`,
      provider: "codex",
      name: "tool",
      kind: "tool" as const,
    })),
    persistence: null,
    runtimeInfo: {
      provider: "codex",
      sessionId: null,
    },
    title: null,
    labels: input.labels ?? {},
    requiresAttention: input.requiresAttention ?? false,
    attentionReason: input.attentionReason ?? null,
    attentionTimestamp: null,
    archivedAt: null,
  } satisfies AgentSnapshotPayload;
}

describe("WorkspaceDirectory", () => {
  test("uses root agent activity, not delegated child activity, for workspace status", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasRootAgent({ id: "root-agent", status: "running" });
    workspace.hasDelegatedAgent({
      id: "child-needs-input",
      status: "idle",
      pendingPermissionCount: 1,
    });
    workspace.hasDelegatedAgent({
      id: "child-error",
      status: "error",
      requiresAttention: true,
      attentionReason: "error",
    });

    await expect(workspace.workspaceStatus()).resolves.toBe("running");
  });

  test("same-cwd workspaces attribute agent status only to the owner", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasSiblingWorkspaceSameCwd();
    workspace.hasStampedRootAgent({
      id: "agent-a",
      status: "running",
      workspaceId: "workspace-1-sibling",
    });

    // The running agent belongs to the sibling; workspace-1 owns nothing active
    // and stays done. Status never fans out across same-cwd workspaces.
    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-1-sibling": "running",
    });
  });

  test("same-cwd workspaces attribute agent attention only to the owner", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasSiblingWorkspaceSameCwd();
    workspace.hasStampedRootAgent({
      id: "agent-a",
      status: "idle",
      pendingPermissionCount: 1,
      workspaceId: "workspace-1-sibling",
    });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-1-sibling": "needs_input",
    });
  });

  test("each same-cwd workspace reflects only its own agent", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasSiblingWorkspaceSameCwd();
    workspace.hasStampedRootAgent({
      id: "agent-a",
      status: "running",
      workspaceId: "workspace-1-sibling",
    });
    workspace.hasStampedRootAgent({
      id: "agent-b",
      status: "idle",
      pendingPermissionCount: 1,
      workspaceId: "workspace-1",
    });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "needs_input",
      "workspace-1-sibling": "running",
    });
  });

  test("terminal status attributes only to the owning workspace", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date(NOW).getTime();

    workspace.hasSiblingWorkspaceSameCwd();
    workspace.hasStampedWorkingTerminal({ workspaceId: "workspace-1-sibling", changedAt });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-1-sibling": "running",
    });
  });

  test("running same-workspace subagent contributes running to its parent workspace", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasRootAgent({ id: "parent-agent", status: "idle" });
    workspace.hasDelegatedAgent({ id: "child-agent", status: "running" });

    await expect(workspace.workspaceStatus()).resolves.toBe("running");
  });

  test("provider subagent follows its cross-workspace parent", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasWorktreeWorkspace();
    workspace.hasRootAgent({ id: "parent-agent", status: "idle" });
    workspace.hasDelegatedAgentInWorktree({ id: "worktree-child", status: "idle" });
    workspace.hasProviderSubagent({
      parentAgentId: "worktree-child",
      status: "running",
      updatedAt: "2026-03-01T12:01:00.000Z",
    });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-worktree": "running",
    });
  });

  test("running provider subagent contributes running to its parent workspace", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasRootAgent({ id: "parent-agent", status: "idle" });
    workspace.hasProviderSubagent({
      parentAgentId: "parent-agent",
      status: "running",
      updatedAt: "2026-03-01T12:01:00.000Z",
    });

    await expect(workspace.workspaceDescriptor()).resolves.toMatchObject({
      status: "running",
      statusEnteredAt: "2026-03-01T12:01:00.000Z",
    });
  });

  test("running cross-workspace subagent contributes to its own workspace", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasWorktreeWorkspace();
    workspace.hasRootAgent({ id: "parent-agent", status: "idle" });
    workspace.hasDelegatedAgentInWorktree({ id: "child-agent", status: "running" });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-worktree": "running",
    });
  });

  test("cross-workspace subagent contributes its full status bucket to its own workspace", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasWorktreeWorkspace();
    workspace.hasRootAgent({ id: "parent-agent", status: "idle" });
    workspace.hasDelegatedAgentInWorktree({
      id: "child-agent",
      status: "idle",
      pendingPermissionCount: 1,
    });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-worktree": "needs_input",
    });
  });

  test("running detached child contributes running to its own workspace", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasWorktreeWorkspace();
    workspace.hasRootAgent({ id: "parent-agent", status: "idle" });
    workspace.hasDetachedAgentInWorktree({ id: "child-agent", status: "running" });

    await expect(workspace.workspaceStatuses()).resolves.toEqual({
      "workspace-1": "done",
      "workspace-worktree": "running",
    });
  });

  test("working terminal contributes running status, beating done", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date(NOW).getTime();

    workspace.hasWorkingTerminal(changedAt);

    await expect(workspace.workspaceStatus()).resolves.toBe("running");
  });

  test("working terminal in a subdirectory contributes to the parent workspace", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date(NOW).getTime();

    workspace.hasWorkingTerminalInSubdirectory(changedAt);

    await expect(workspace.workspaceStatus()).resolves.toBe("running");
  });

  test("finished terminal contributes attention to workspace status", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date(NOW).getTime();

    workspace.hasFinishedTerminal(changedAt);

    await expect(workspace.workspaceStatus()).resolves.toBe("attention");
  });

  test("idle terminal contributes nothing to workspace status", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date(NOW).getTime();

    workspace.hasIdleTerminal(changedAt);

    await expect(workspace.workspaceStatus()).resolves.toBe("done");
  });

  test("unknown terminal contributes nothing to workspace status", async () => {
    const workspace = new WorkspaceStatus();

    workspace.hasUnknownTerminal();

    await expect(workspace.workspaceStatus()).resolves.toBe("done");
  });

  test("working terminal does not override a higher-priority needs_input agent", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date(NOW).getTime();

    workspace.hasRootAgent({ id: "agent-needs-input", status: "idle", pendingPermissionCount: 1 });
    workspace.hasWorkingTerminal(changedAt);

    await expect(workspace.workspaceStatus()).resolves.toBe("needs_input");
  });

  test("working terminal statusEnteredAt uses terminal changedAt", async () => {
    const workspace = new WorkspaceStatus();
    const changedAt = new Date("2026-05-01T10:00:00.000Z").getTime();

    workspace.hasWorkingTerminal(changedAt);

    const descriptor = await workspace.workspaceDescriptor();
    expect(descriptor.status).toBe("running");
    expect(descriptor.statusEnteredAt).toBe("2026-05-01T10:00:00.000Z");
  });

  test("statusEnteredAt picks the newest between agent updatedAt and terminal changedAt", async () => {
    const workspace = new WorkspaceStatus();
    // The createAgent helper uses NOW for updatedAt; use a terminal timestamp
    // that is newer to confirm it wins.
    const terminalChangedAt = new Date("2027-01-01T00:00:00.000Z").getTime();

    workspace.hasRootAgent({ id: "running-agent", status: "running" });
    workspace.hasWorkingTerminal(terminalChangedAt);

    const descriptor = await workspace.workspaceDescriptor();
    expect(descriptor.status).toBe("running");
    // terminal timestamp (2027) is newer than agent updatedAt (NOW = 2026-03-01)
    expect(descriptor.statusEnteredAt).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("WorkspaceDirectory empty projects", () => {
  function makeDirectory(input: {
    projects: PersistedProjectRecord[];
    workspaces: PersistedWorkspaceRecord[];
  }): WorkspaceDirectory {
    return new WorkspaceDirectory({
      logger: createTestLogger(),
      projectRegistry: { list: async () => input.projects },
      workspaceRegistry: { list: async () => input.workspaces },
      listAgentPayloads: async () => [],
      listProviderSubagentActivity: async () => [],
      listTerminalActivityContributions: async () => [],
      isProviderVisibleToClient: () => true,
      buildWorkspaceDescriptor: async ({ workspace }) => ({
        id: workspace.workspaceId,
        projectId: workspace.projectId,
        projectDisplayName: "project",
        projectCustomName: null,
        projectRootPath: "/workspace/project",
        workspaceDirectory: workspace.cwd,
        projectKind: "non_git",
        workspaceKind: workspace.kind,
        name: workspace.displayName,
        archivingAt: null,
        status: "done",
        activityAt: null,
        diffStat: null,
        gitRuntime: null,
        githubRuntime: null,
      }),
    });
  }

  function project(input: Partial<PersistedProjectRecord> & { projectId: string }) {
    return {
      rootPath: `/workspace/${input.projectId}`,
      kind: "non_git",
      displayName: input.projectId,
      customName: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      pinnedAt: null,
      ...input,
    } satisfies PersistedProjectRecord;
  }

  test("surfaces a project with no active workspaces through the compatibility projection", async () => {
    const directory = makeDirectory({
      projects: [project({ projectId: "empty", customName: "Renamed" })],
      workspaces: [],
    });

    const result = await directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "r1",
    });

    expect(result.entries).toEqual([]);
    expect(result.emptyProjects).toEqual([
      {
        projectId: "empty",
        projectDisplayName: "Renamed",
        projectCustomName: "Renamed",
        projectCustomIconRevision: null,
        projectRootPath: "/workspace/empty",
        projectKind: "non_git",
      },
    ]);
  });

  test("excludes projects that still have an active workspace", async () => {
    const directory = makeDirectory({
      projects: [project({ projectId: "with-ws" }), project({ projectId: "empty" })],
      workspaces: [
        {
          workspaceId: "ws-1",
          projectId: "with-ws",
          cwd: "/workspace/with-ws",
          kind: "directory",
          displayName: "main",
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        },
      ],
    });

    const result = await directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "r1",
    });

    expect(result.emptyProjects.map((p) => p.projectId)).toEqual(["empty"]);
  });
});

describe("WorkspaceDirectory hidden workspaces", () => {
  function workspaceRecord(
    input: Partial<PersistedWorkspaceRecord> & { workspaceId: string; projectId: string },
  ): PersistedWorkspaceRecord {
    return {
      cwd: `/workspace/${input.projectId}`,
      kind: "directory",
      displayName: "main",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      ...input,
    } satisfies PersistedWorkspaceRecord;
  }

  function projectRecord(projectId: string): PersistedProjectRecord {
    return {
      projectId,
      rootPath: `/workspace/${projectId}`,
      kind: "non_git",
      displayName: projectId,
      customName: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };
  }

  // Mutable backing array so a test can flip `hidden` in place, exactly like the
  // registry-backed reveal path does.
  function makeMutableDirectory(input: {
    projects: PersistedProjectRecord[];
    workspaces: PersistedWorkspaceRecord[];
  }): { directory: WorkspaceDirectory; workspaces: PersistedWorkspaceRecord[] } {
    const workspaces = input.workspaces;
    const directory = new WorkspaceDirectory({
      logger: createTestLogger(),
      projectRegistry: { list: async () => input.projects },
      workspaceRegistry: { list: async () => workspaces },
      listAgentPayloads: async () => [],
      listProviderSubagentActivity: async () => [],
      listTerminalActivityContributions: async () => [],
      isProviderVisibleToClient: () => true,
      buildWorkspaceDescriptor: async ({ workspace }) => ({
        id: workspace.workspaceId,
        projectId: workspace.projectId,
        projectDisplayName: "project",
        projectCustomName: null,
        projectRootPath: "/workspace/project",
        workspaceDirectory: workspace.cwd,
        projectKind: "non_git",
        workspaceKind: workspace.kind,
        name: workspace.displayName,
        archivingAt: null,
        status: "done",
        activityAt: null,
        diffStat: null,
        gitRuntime: null,
        githubRuntime: null,
      }),
    });
    return { directory, workspaces };
  }

  test("hidden workspaces are withheld from listings and descriptor maps", async () => {
    const { directory } = makeMutableDirectory({
      projects: [projectRecord("proj")],
      workspaces: [
        workspaceRecord({ workspaceId: "ws-visible", projectId: "proj" }),
        workspaceRecord({ workspaceId: "ws-hidden", projectId: "proj", hidden: true }),
      ],
    });

    const result = await directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "r1",
    });
    expect(result.entries.map((entry) => entry.id)).toEqual(["ws-visible"]);

    // The per-id descriptor map (the live-emission path) also withholds it: the
    // emission chokepoint resolves no descriptor and emits a REMOVE.
    const descriptors = await directory.buildDescriptorMap({
      includeGitData: false,
      workspaceIds: ["ws-visible", "ws-hidden"],
    });
    expect(descriptors.has("ws-visible")).toBe(true);
    expect(descriptors.has("ws-hidden")).toBe(false);
  });

  test("a revealed workspace appears in listings and descriptor maps", async () => {
    const { directory, workspaces } = makeMutableDirectory({
      projects: [projectRecord("proj")],
      workspaces: [workspaceRecord({ workspaceId: "ws-run", projectId: "proj", hidden: true })],
    });

    const before = await directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "r1",
    });
    expect(before.entries).toEqual([]);

    // Reveal = flip the flag on the persisted record; the next build resolves a
    // descriptor and the emission path upserts it.
    workspaces[0] = { ...workspaces[0], hidden: false };

    const after = await directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "r2",
    });
    expect(after.entries.map((entry) => entry.id)).toEqual(["ws-run"]);
    const descriptors = await directory.buildDescriptorMap({
      includeGitData: false,
      workspaceIds: ["ws-run"],
    });
    expect(descriptors.has("ws-run")).toBe(true);
  });

  test("a project whose only workspace is hidden renders nowhere: no entries, no empty-project ghost", async () => {
    const { directory } = makeMutableDirectory({
      projects: [projectRecord("proj")],
      workspaces: [workspaceRecord({ workspaceId: "ws-hidden", projectId: "proj", hidden: true })],
    });

    const result = await directory.listFetchEntries({
      type: "fetch_workspaces_request",
      requestId: "r1",
    });
    // The hidden workspace still counts as occupying its project, so the project
    // must not appear as an empty-project ghost row while the run is invisible.
    expect(result.entries).toEqual([]);
    expect(result.emptyProjects).toEqual([]);
  });
});

// A rebuild for named workspaceIds must fetch only those workspaces' agents
// instead of projecting every live and persisted agent in the home - while
// producing byte-identical descriptors. The subtle half is parent resolution: a
// subagent counts as its workspace's root only when its parent RESOLVES to a
// different workspace, so a scoped fetch that simply dropped out-of-scope
// parents would silently downgrade the workspace's status.
describe("WorkspaceDirectory scoped descriptor rebuild", () => {
  const SCOPED_PROJECT: PersistedProjectRecord = {
    projectId: "project-1",
    rootPath: "/workspace/project",
    kind: "git",
    displayName: "project",
    customName: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };

  const SCOPED_WORKSPACES: PersistedWorkspaceRecord[] = [
    {
      workspaceId: "ws-a",
      projectId: SCOPED_PROJECT.projectId,
      cwd: "/workspace/project",
      kind: "local_checkout",
      displayName: "main",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    },
    {
      workspaceId: "ws-b",
      projectId: SCOPED_PROJECT.projectId,
      cwd: "/workspace/project/.otto/worktrees/feature",
      kind: "worktree",
      displayName: "feature",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    },
  ];

  interface ScopeCall {
    workspaceIds: string[];
    agentIds: string[];
  }

  // The fake resolves a scope the same way session.listAgentPayloads does: an
  // agent is reachable by its owning workspaceId, or by its own id.
  function makeScopedDirectory(agents: AgentSnapshotPayload[]): {
    directory: WorkspaceDirectory;
    scopeCalls: Array<ScopeCall | null>;
  } {
    const scopeCalls: Array<ScopeCall | null> = [];
    const directory = new WorkspaceDirectory({
      logger: createTestLogger(),
      // Scoped and unscoped are two separate builds. A real clock lets them
      // straddle a millisecond boundary and disagree on `statusEnteredAt`.
      now: () => new Date(NOW),
      projectRegistry: { list: async () => [SCOPED_PROJECT] },
      workspaceRegistry: { list: async () => SCOPED_WORKSPACES },
      listAgentPayloads: async (scope) => {
        scopeCalls.push(
          scope
            ? {
                workspaceIds: [...(scope.workspaceIds ?? [])],
                agentIds: [...(scope.agentIds ?? [])],
              }
            : null,
        );
        if (!scope) {
          return agents;
        }
        return agents.filter(
          (agent) =>
            (agent.workspaceId !== undefined && scope.workspaceIds?.has(agent.workspaceId)) ||
            scope.agentIds?.has(agent.id),
        );
      },
      listProviderSubagentActivity: async () => [],
      listTerminalActivityContributions: async () => [],
      isProviderVisibleToClient: () => true,
      buildWorkspaceDescriptor: async ({ workspace }) => ({
        id: workspace.workspaceId,
        projectId: workspace.projectId,
        projectDisplayName: "project",
        projectCustomName: null,
        projectRootPath: SCOPED_PROJECT.rootPath,
        workspaceDirectory: workspace.cwd,
        projectKind: "git",
        workspaceKind: workspace.kind,
        name: workspace.displayName,
        archivingAt: null,
        status: "done",
        activityAt: null,
        diffStat: null,
        scripts: [],
        gitRuntime: null,
        githubRuntime: null,
      }),
    });
    return { directory, scopeCalls };
  }

  // Fresh instances per build so neither result can inherit the other's
  // per-workspace bucket history.
  async function buildScopedAndUnscoped(
    agents: AgentSnapshotPayload[],
    workspaceId: string,
  ): Promise<{
    scoped: WorkspaceDescriptorPayload | undefined;
    unscoped: WorkspaceDescriptorPayload | undefined;
    scopeCalls: Array<ScopeCall | null>;
  }> {
    const scopedRun = makeScopedDirectory(agents);
    const scopedMap = await scopedRun.directory.buildDescriptorMap({
      includeGitData: false,
      workspaceIds: [workspaceId],
    });
    const unscopedMap = await makeScopedDirectory(agents).directory.buildDescriptorMap({
      includeGitData: false,
    });
    return {
      scoped: scopedMap.get(workspaceId),
      unscoped: unscopedMap.get(workspaceId),
      scopeCalls: scopedRun.scopeCalls,
    };
  }

  test("fetches only the target workspace, and builds only its descriptor", async () => {
    const agents = [
      createAgent({ id: "a-1", status: "running", cwd: "/workspace/project", workspaceId: "ws-a" }),
      createAgent({
        id: "b-1",
        status: "idle",
        cwd: "/workspace/project/.otto/worktrees/feature",
        workspaceId: "ws-b",
      }),
    ];
    const { directory, scopeCalls } = makeScopedDirectory(agents);

    const descriptors = await directory.buildDescriptorMap({
      includeGitData: false,
      workspaceIds: ["ws-b"],
    });

    expect([...descriptors.keys()]).toEqual(["ws-b"]);
    expect(scopeCalls).toEqual([{ workspaceIds: ["ws-b"], agentIds: [] }]);
  });

  test("a same-workspace-only rebuild needs no parent backfill round trip", async () => {
    const agents = [
      createAgent({
        id: "b-child",
        status: "running",
        cwd: "/workspace/project/.otto/worktrees/feature",
        workspaceId: "ws-b",
        labels: { [PARENT_AGENT_ID_LABEL]: "b-parent" },
      }),
      createAgent({
        id: "b-parent",
        status: "idle",
        cwd: "/workspace/project/.otto/worktrees/feature",
        workspaceId: "ws-b",
      }),
    ];
    const { scoped, unscoped, scopeCalls } = await buildScopedAndUnscoped(agents, "ws-b");

    expect(scopeCalls).toHaveLength(1);
    expect(scoped).toEqual(unscoped);
    // The descendant contributes running activity to its in-workspace ancestor.
    expect(scoped?.status).toBe("running");
  });

  test("a subagent whose parent lives in another workspace still roots its own", async () => {
    const agents = [
      createAgent({ id: "a-1", status: "idle", cwd: "/workspace/project", workspaceId: "ws-a" }),
      createAgent({
        id: "b-child",
        status: "running",
        cwd: "/workspace/project/.otto/worktrees/feature",
        workspaceId: "ws-b",
        labels: { [PARENT_AGENT_ID_LABEL]: "a-1" },
      }),
    ];
    const { scoped, unscoped, scopeCalls } = await buildScopedAndUnscoped(agents, "ws-b");

    // The out-of-scope parent is backfilled by id, not by re-listing everything.
    expect(scopeCalls).toEqual([
      { workspaceIds: ["ws-b"], agentIds: [] },
      { workspaceIds: [], agentIds: ["a-1"] },
    ]);
    expect(scoped).toEqual(unscoped);
    expect(scoped?.status).toBe("running");
  });

  test("a subagent whose parent no longer resolves contributes nothing, scoped or not", async () => {
    const agents = [
      createAgent({
        id: "b-child",
        status: "running",
        cwd: "/workspace/project/.otto/worktrees/feature",
        workspaceId: "ws-b",
        labels: { [PARENT_AGENT_ID_LABEL]: "gone" },
      }),
    ];
    const { scoped, unscoped } = await buildScopedAndUnscoped(agents, "ws-b");

    expect(scoped).toEqual(unscoped);
    expect(scoped?.status).toBe("done");
  });

  test("scoped and unscoped agree on an attention-masked workspace", async () => {
    const agents = [
      createAgent({ id: "a-1", status: "running", cwd: "/workspace/project", workspaceId: "ws-a" }),
      createAgent({
        id: "b-1",
        status: "idle",
        cwd: "/workspace/project/.otto/worktrees/feature",
        workspaceId: "ws-b",
        requiresAttention: true,
        attentionReason: "permission",
        pendingPermissionCount: 1,
      }),
    ];
    const { scoped, unscoped } = await buildScopedAndUnscoped(agents, "ws-b");

    expect(scoped).toEqual(unscoped);
    expect(scoped?.status).not.toBe("done");
  });
});
