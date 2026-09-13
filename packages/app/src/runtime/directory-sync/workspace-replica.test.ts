import { expect, it } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type {
  WorkspaceDescriptorPayload,
  WorkspaceScriptPayload,
} from "@otto-code/protocol/messages";
import {
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  useSessionStore,
} from "@/stores/session-store";
import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { WorkspaceDirectoryReplica } from "./workspace-replica";

function workspace(id: string, projectId = "project"): WorkspaceDescriptorPayload {
  return {
    id,
    projectId,
    projectDisplayName: projectId,
    projectRootPath: `/repo/${projectId}`,
    workspaceDirectory: `/repo/${projectId}/${id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
    title: id,
    status: "done",
    activityAt: null,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

it("projects Offline and explicit reconnection through live workspace and cache updates", () => {
  const serverId = "offline-project-reconnection";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);
  const original = normalizeWorkspaceDescriptor(workspace("kept"));
  const unrelated = normalizeWorkspaceDescriptor(workspace("other", "other-project"));
  replica.commitSnapshot(
    {
      workspaces: new Map([
        [original.id, original],
        [unrelated.id, unrelated],
      ]),
      projects: new Map(),
    },
    [],
  );
  const project = {
    projectId: "project",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    projectKind: "git" as const,
  };
  const offline = replica.applyDelta({
    kind: "upsert",
    project: { ...project, projectOffline: true },
  });
  expect(useSessionStore.getState().sessions[serverId]?.workspaces.get(original.id)).toMatchObject({
    id: original.id,
    projectOffline: true,
    workspaceDirectory: original.workspaceDirectory,
  });
  expect(offline).toContainEqual({
    kind: "workspace",
    type: "upsert",
    id: original.id,
    value: expect.objectContaining({ projectOffline: true }),
  });
  const reconnected = replica.applyDelta({
    kind: "upsert",
    project: { ...project, projectOffline: false, projectRootPath: "/moved/project" },
  });
  expect(useSessionStore.getState().sessions[serverId]?.workspaces.get(original.id)).toMatchObject({
    id: original.id,
    projectOffline: false,
    projectRootPath: "/moved/project",
  });
  expect(reconnected).toContainEqual({
    kind: "workspace",
    type: "upsert",
    id: original.id,
    value: expect.objectContaining({ projectOffline: false }),
  });
  expect(replica.snapshot().workspaces.get(unrelated.id)).toBe(unrelated);
  store.clearSession(serverId);
});

it("projects script updates into the matching workspace and cache mutation", () => {
  const serverId = "workspace-scripts";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);
  const main = normalizeWorkspaceDescriptor(workspace("main"));
  const other = normalizeWorkspaceDescriptor(workspace("other"));
  replica.commitSnapshot(
    {
      workspaces: new Map([
        [main.id, main],
        [other.id, other],
      ]),
      projects: new Map(),
    },
    [],
  );
  const script: WorkspaceScriptPayload = {
    scriptName: "web",
    type: "service",
    hostname: "web.otto.localhost",
    port: 3000,
    proxyUrl: "http://web.otto.localhost:6788",
    lifecycle: "running",
    health: "healthy",
    exitCode: null,
    terminalId: null,
  };
  const mutations = replica.applyDelta({
    kind: "script_status",
    update: { workspaceId: main.id, scripts: [script] },
  });
  const updated = replica.snapshot().workspaces.get(main.id);
  expect(updated?.scripts).toEqual([script]);
  expect(useSessionStore.getState().sessions[serverId]?.workspaces.get(main.id)?.scripts).toEqual([
    script,
  ]);
  expect(replica.snapshot().workspaces.get(other.id)).toBe(other);
  expect(mutations).toEqual([{ kind: "workspace", type: "upsert", id: main.id, value: updated }]);
  expect(
    replica.applyDelta({
      kind: "script_status",
      update: { workspaceId: main.id, scripts: [{ ...script }] },
    }),
  ).toEqual([]);
  expect(replica.snapshot().workspaces.get(main.id)).toBe(updated);
  expect(
    replica.applyDelta({
      kind: "script_status",
      update: { workspaceId: "missing", scripts: [script] },
    }),
  ).toEqual([]);
  expect(replica.snapshot().workspaces.has("missing")).toBe(false);
  store.clearSession(serverId);
});

it("commits workspace and project-parent state with filtered removals", () => {
  const serverId = "workspace-replica";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);
  const empty = normalizeProjectDescriptor({
    projectId: "empty",
    projectDisplayName: "Empty",
    projectRootPath: "/repo/empty",
    projectKind: "git",
  });
  replica.commitSnapshot(
    {
      workspaces: new Map([
        ["kept", normalizeWorkspaceDescriptor(workspace("kept"))],
        ["filtered", normalizeWorkspaceDescriptor(workspace("filtered", "filtered-project"))],
      ]),
      projects: new Map([[empty.projectId, empty]]),
    },
    [{ kind: "remove", id: "filtered", removedProjectId: "filtered-project" }],
  );

  const session = useSessionStore.getState().sessions[serverId];
  expect(Array.from(session?.workspaces.keys() ?? [])).toEqual(["kept"]);
  expect(Array.from(session?.projects.keys() ?? [])).toEqual(["empty"]);
  store.clearSession(serverId);
});

it("commits the authoritative snapshot before buffered project updates", () => {
  const serverId = "project-update-replica";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);
  const attachedMain = normalizeWorkspaceDescriptor(workspace("attached-main", "attached"));
  const attachedFeature = normalizeWorkspaceDescriptor(workspace("attached-feature", "attached"));
  const removed = normalizeWorkspaceDescriptor(workspace("removed", "removed"));
  const unrelated = normalizeWorkspaceDescriptor(workspace("unrelated", "unrelated"));
  const staleAttachedProject = normalizeProjectDescriptor({
    projectId: "attached",
    projectDisplayName: "Stale attached project",
    projectRootPath: "/repo/attached",
    projectKind: "git",
  });
  const removedProject = normalizeProjectDescriptor({
    projectId: "removed",
    projectDisplayName: "Removed project",
    projectRootPath: "/repo/removed",
    projectKind: "git",
  });
  const unchangedEmptyProject = normalizeProjectDescriptor({
    projectId: "unchanged-empty",
    projectDisplayName: "Unchanged empty project",
    projectRootPath: "/repo/unchanged-empty",
    projectKind: "git",
  });

  replica.commitSnapshot(
    {
      workspaces: new Map([
        [attachedMain.id, attachedMain],
        [attachedFeature.id, attachedFeature],
        [removed.id, removed],
        [unrelated.id, unrelated],
      ]),
      projects: new Map([
        [staleAttachedProject.projectId, staleAttachedProject],
        [removedProject.projectId, removedProject],
        [unchangedEmptyProject.projectId, unchangedEmptyProject],
      ]),
    },
    [
      {
        kind: "upsert",
        project: {
          projectId: "attached",
          projectKey: "remote:github.com/acme/attached",
          projectDisplayName: "Renamed attached project",
          projectCustomName: "Personal name",
          projectRootPath: "/moved/attached",
          projectKind: "directory",
        },
      },
      {
        kind: "upsert",
        project: {
          projectId: "new-empty",
          projectDisplayName: "New empty project",
          projectRootPath: "/repo/new-empty",
          projectKind: "directory",
        },
      },
      { kind: "remove", projectId: "removed" },
    ],
  );

  const session = useSessionStore.getState().sessions[serverId];
  expect(session?.workspaces.get(attachedMain.id)).toMatchObject({
    projectDisplayName: "Renamed attached project",
    projectCustomName: "Personal name",
    projectRootPath: "/moved/attached",
    projectKind: "directory",
  });
  expect(session?.workspaces.get(attachedFeature.id)).toMatchObject({
    projectDisplayName: "Renamed attached project",
    projectRootPath: "/moved/attached",
  });
  expect(session?.workspaces.has(removed.id)).toBe(false);
  expect(session?.workspaces.get(unrelated.id)).toBe(unrelated);
  expect(Array.from(session?.projects.keys() ?? [])).toEqual([
    "attached",
    "unchanged-empty",
    "new-empty",
  ]);
  expect(session?.projects.get("unchanged-empty")).toBe(unchangedEmptyProject);
  expect(session?.projects.get("new-empty")).toMatchObject({
    projectDisplayName: "New empty project",
    projectRootPath: "/repo/new-empty",
  });
  store.clearSession(serverId);
});

it("preserves unchanged project identity when another project changes", () => {
  const serverId = "project-identity";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);
  const first = normalizeProjectDescriptor({
    projectId: "first",
    projectDisplayName: "First",
    projectRootPath: "/repo/first",
    projectKind: "git",
  });
  const second = normalizeProjectDescriptor({
    projectId: "second",
    projectDisplayName: "Second",
    projectRootPath: "/repo/second",
    projectKind: "git",
  });
  replica.commitSnapshot(
    {
      workspaces: new Map(),
      projects: new Map([
        ["first", first],
        ["second", second],
      ]),
    },
    [],
  );
  const previousSecond = useSessionStore.getState().sessions[serverId]?.projects.get("second");

  replica.commitSnapshot(
    {
      workspaces: new Map(),
      projects: new Map([
        ["first", { ...first, projectDisplayName: "Updated" }],
        ["second", { ...second }],
      ]),
    },
    [],
  );

  expect(useSessionStore.getState().sessions[serverId]?.projects.get("second")).toBe(
    previousSecond,
  );
  store.clearSession(serverId);
});

it("does not invent a null-key project from a workspace update", () => {
  const serverId = "workspace-before-project-update";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);

  replica.applyDelta({ kind: "upsert", workspace: workspace("main", "fresh-project") });

  const session = useSessionStore.getState().sessions[serverId];
  expect(session?.workspaces.has("main")).toBe(true);
  expect(session?.projects.has("fresh-project")).toBe(false);
  store.clearSession(serverId);
});

it("does not restore a targeted cached workspace while its archive is pending", () => {
  const serverId = "cached-workspace-during-archive";
  const workspaceId = "archived-workspace";
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null as unknown as DaemonClient);
  const replica = new WorkspaceDirectoryReplica(serverId);
  markWorkspaceArchivePending({ serverId, workspaceId });

  try {
    replica.commitCachedWorkspace(normalizeWorkspaceDescriptor(workspace(workspaceId)), undefined);

    expect(useSessionStore.getState().sessions[serverId]?.workspaces.has(workspaceId)).toBe(false);
  } finally {
    clearWorkspaceArchivePending({ serverId, workspaceId });
    store.clearSession(serverId);
  }
});
