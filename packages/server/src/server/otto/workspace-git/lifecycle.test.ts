import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import {
  listReopenWorktrees,
  listWorkspaceMoveTargets,
  moveWorkspaceChat,
  reopenWorktree,
} from "@getpaseo/plugin/otto/workspace-git";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "../../workspace-registry.js";
import { createOttoWorkspaceLifecycle } from "./lifecycle.js";

const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const created: string[] = [];
const stamp = "2026-11-20T00:00:00.000Z";
const scope = { hostId: "host", projectId: "project" };

afterEach(async () => {
  for (const root of created.splice(0)) {
    if (!root.startsWith(temporary)) throw new Error("Fixture boundary");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  await mkdir(temporary, { recursive: true });
  const scratch = await mkdtemp(path.join(temporary, "worktree-lifecycle-"));
  created.push(scratch);
  const root = await realpath(scratch);
  const archivedPath = path.join(root, "archived");
  const orphanPath = path.join(root, "orphan");
  const livePath = path.join(root, "current");
  await Promise.all([archivedPath, orphanPath, livePath].map((dir) => mkdir(dir)));
  const project = createPersistedProjectRecord({
    projectId: "project",
    rootPath: root,
    kind: "git",
    displayName: "Test project",
    createdAt: stamp,
    updatedAt: stamp,
  });
  const makeRecord = (workspaceId: string, cwd: string) =>
    createPersistedWorkspaceRecord({
      workspaceId,
      projectId: scope.projectId,
      kind: "worktree",
      cwd,
      displayName: workspaceId,
      worktreeRoot: cwd,
      mainRepoRoot: root,
      branch: workspaceId,
      createdAt: stamp,
      updatedAt: stamp,
    });
  const archived = { ...makeRecord("archived-id", archivedPath), archivedAt: stamp };
  const live = makeRecord("live-id", livePath);
  const destination = makeRecord("destination-id", path.join(root, "destination"));
  const hidden = {
    ...makeRecord("background-id", path.join(root, "background")),
    background: true,
  };
  const records = new Map(
    [archived, live, destination, hidden].map((record) => [record.workspaceId, record]),
  );
  const publish = vi.fn(async () => undefined);
  const move = vi.fn(async (input: { validateDestination(): Promise<void> }) =>
    input.validateDestination(),
  );
  const create = vi.fn(async () => {
    const record = makeRecord("adopted-id", orphanPath);
    records.set(record.workspaceId, record);
    return record;
  });
  const unarchive = vi.fn(async () => {
    const record = { ...archived, archivedAt: null };
    records.set(record.workspaceId, record);
    return record;
  });
  const host = createOttoWorkspaceLifecycle({
    serverId: () => "host",
    paseoHome: root,
    workspaceRegistry: {
      list: async () => [...records.values()],
      get: async (id) => records.get(id) ?? null,
    },
    projectRegistry: {
      list: async () => [project],
      get: async (id) => (id === scope.projectId ? project : null),
    },
    workspaceGitService: {
      resolveRepoRoot: async () => root,
      listWorktrees: async () =>
        [archivedPath, orphanPath, livePath].map((file) => ({
          path: file,
          branchName: path.basename(file),
          createdAt: stamp,
        })),
    },
    workspaceProvisioning: {
      createWorkspaceForWorktree: create,
      ensureWorkspaceRecordUnarchived: unarchive,
    },
    agentManager: { moveChatWorkspace: move },
    publish,
  });
  return { host, orphanPath, livePath, move, create, unarchive, publish };
}

test("moves only to a visible destination on the owning host and publishes both workspace IDs", async () => {
  const f = await fixture();
  const options = listWorkspaceMoveTargets.output.parse(
    await f.host.invoke(listWorkspaceMoveTargets.name, { hostId: "host", workspaceId: "live-id" }),
  );
  expect(options).toMatchObject({ ok: true, value: [{ workspaceId: "destination-id" }] });
  const input = { agentId: "agent", fromWorkspaceId: "live-id", workspaceId: "destination-id" };
  expect(await f.host.invoke(moveWorkspaceChat.name, { hostId: "peer", ...input })).toMatchObject({
    ok: false,
  });
  expect(f.move).not.toHaveBeenCalled();
  expect(
    await f.host.invoke(moveWorkspaceChat.name, {
      hostId: "host",
      ...input,
      workspaceId: "background-id",
    }),
  ).toMatchObject({ ok: false });
  expect(f.publish).not.toHaveBeenCalled();
  expect(await f.host.invoke(moveWorkspaceChat.name, { hostId: "host", ...input })).toMatchObject({
    ok: true,
    value: { workspaceId: input.workspaceId },
  });
  expect(f.publish).toHaveBeenCalledWith(["live-id", "destination-id"]);
});

test("reopens a retained archive ID, lists orphans, and admits an orphan only once across concurrent requests", async () => {
  const f = await fixture();
  expect(await f.host.invoke(listReopenWorktrees.name, scope)).toMatchObject({
    ok: true,
    value: expect.arrayContaining([
      expect.objectContaining({ target: { kind: "archived", workspaceId: "archived-id" } }),
      expect.objectContaining({ target: { kind: "worktree", path: f.orphanPath } }),
    ]),
  });
  const open = (target: unknown) => f.host.invoke(reopenWorktree.name, { ...scope, target });
  expect(await open({ kind: "archived", workspaceId: "archived-id" })).toEqual({
    ok: true,
    value: { workspaceId: "archived-id" },
  });
  expect(f.unarchive).toHaveBeenCalledTimes(1);
  expect(await open({ kind: "worktree", path: f.livePath })).toMatchObject({ ok: false });
  const target = { kind: "worktree", path: f.orphanPath };
  const results = await Promise.all([open(target), open(target)]);
  expect(results).toContainEqual({ ok: true, value: { workspaceId: "adopted-id" } });
  expect(f.create).toHaveBeenCalledTimes(1);
});
