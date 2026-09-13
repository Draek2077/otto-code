import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { AgentStorage } from "./agent/agent-storage.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import { ProjectRelocationService } from "./project-relocation-service.js";
import {
  isProjectOffline,
  observeOfflineProjects,
  protectOfflineWorkspaceRecords,
  relocateProjectPath,
  withProjectRelocationWrites,
} from "./project-availability.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import { bootstrapWorkspaceRegistries } from "./workspace-registry-bootstrap.js";
import { createNoopWorkspaceGitService } from "./test-utils/workspace-git-service-stub.js";
import { assertOnlineProjectRequest } from "./project-offline-request.js";
import { AgentManager } from "./agent/agent-manager.js";
import { MockLoadTestAgentClient } from "./agent/providers/mock-load-test-agent.js";

const logger = createTestLogger();
const timestamp = "2026-09-13T00:00:00.000Z";
let temp: string;
let root: string;
let moved: string;
let ottoHome: string;
let projectRegistry: FileBackedProjectRegistry;
let workspaceRegistry: FileBackedWorkspaceRegistry;
let agentStorage: AgentStorage;
let service: ProjectRelocationService;
const workspacePath = () => path.join(ottoHome, "projects", "workspaces.json");

beforeEach(async () => {
  const scratch = path.resolve(import.meta.dirname, "../../../../.tmp");
  mkdirSync(scratch, { recursive: true });
  temp = mkdtempSync(path.join(scratch, "project-relocation-"));
  root = path.join(temp, "Projects", "App");
  moved = path.join(temp, "Work", "App");
  ottoHome = path.join(temp, "otto-home");
  mkdirSync(path.join(root, "sub"), { recursive: true });
  projectRegistry = new FileBackedProjectRegistry(
    path.join(ottoHome, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(workspacePath(), logger);
  agentStorage = new AgentStorage(path.join(ottoHome, "agents"), logger);
  await agentStorage.initialize();
  await projectRegistry.upsert(
    createPersistedProjectRecord({
      projectId: "project",
      rootPath: root,
      kind: "non_git",
      displayName: "App",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  for (const [id, directory] of [
    ["root", root],
    ["nested", path.join(root, "sub")],
    ["archived", path.join(root, "removed")],
  ]) {
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: id,
        projectId: "project",
        cwd: directory,
        kind: "directory",
        displayName: id,
        title: `Title ${id}`,
        pinnedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: id === "archived" ? timestamp : null,
      }),
    );
  }
  await agentStorage.upsert({
    id: "chat",
    provider: "codex",
    workspaceId: "nested",
    cwd: path.join(root, "sub"),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastStatus: "closed",
    labels: { keep: "this" },
    config: null,
    persistence: {
      provider: "codex",
      sessionId: "native-session",
      metadata: { cwd: path.join(root, "sub") },
    },
  });
  protectOfflineWorkspaceRecords(projectRegistry, workspaceRegistry);
  service = new ProjectRelocationService({
    ottoHome,
    projectRegistry,
    workspaceRegistry,
    agentStorage,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (!temp.startsWith(path.resolve(import.meta.dirname, "../../../../.tmp") + path.sep))
    throw new Error("Invalid test cleanup path");
  rmSync(temp, { recursive: true, force: true });
});

function moveParent() {
  renameSync(path.dirname(root), path.dirname(moved));
}

test("parent rename, reconciliation and startup leave all workspace and chat records untouched", async () => {
  const before = readFileSync(workspacePath(), "utf8");
  const chat = await agentStorage.get("chat");
  moveParent();
  const git = createNoopWorkspaceGitService();
  const getCheckout = vi.spyOn(git, "getCheckout");
  await new WorkspaceReconciliationService({
    projectRegistry,
    workspaceRegistry,
    workspaceGitService: git,
    logger,
  }).runOnce();
  await bootstrapWorkspaceRegistries({
    ottoHome,
    projectRegistry,
    workspaceRegistry,
    agentStorage,
    workspaceGitService: git,
    logger,
  });
  expect(readFileSync(workspacePath(), "utf8")).toBe(before);
  expect(await agentStorage.get("chat")).toEqual(chat);
  expect((await projectRegistry.get("project"))?.offline).toBe(true);
  expect(getCheckout).not.toHaveBeenCalled();
  expect(existsSync(root)).toBe(false);
});

test("Offline rejects direct registry edits, deletion and workspace RPCs", async () => {
  moveParent();
  await observeOfflineProjects(projectRegistry);
  const before = readFileSync(workspacePath(), "utf8");
  await expect(workspaceRegistry.archive("root", timestamp)).rejects.toThrow("Offline");
  await expect(
    workspaceRegistry.update("nested", (record) => ({ ...record, title: "changed" })),
  ).rejects.toThrow("Offline");
  await expect(workspaceRegistry.remove("root")).rejects.toThrow("Offline");
  await expect(
    assertOnlineProjectRequest(
      { type: "refresh_agent_request", agentId: "chat", requestId: "request" },
      projectRegistry,
      workspaceRegistry,
      agentStorage,
    ),
  ).rejects.toThrow("Offline");
  expect(readFileSync(workspacePath(), "utf8")).toBe(before);
  // Even if something recreates the old path, reconnection remains explicit.
  mkdirSync(root, { recursive: true });
  expect(isProjectOffline((await projectRegistry.get("project"))!)).toBe(true);
});

test("reconnects existing identities and relative paths while preserving archive state and provider handle", async () => {
  const workspaces = await workspaceRegistry.list();
  const chat = (await agentStorage.get("chat"))!;
  moveParent();
  await service.relocate("project", root, moved);
  expect(await workspaceRegistry.list()).toEqual(
    workspaces.map((workspace) =>
      Object.assign({}, workspace, {
        cwd: relocateProjectPath(workspace.cwd, root, moved),
      }),
    ),
  );
  expect(await agentStorage.get("chat")).toEqual({ ...chat, cwd: path.join(moved, "sub") });
  expect(await projectRegistry.get("project")).toMatchObject({
    projectId: "project",
    rootPath: moved,
    offline: false,
  });
  const reloaded = new AgentStorage(path.join(ottoHome, "agents"), logger);
  expect(await reloaded.list()).toHaveLength(1);
  expect((await reloaded.get("chat"))?.cwd).toBe(path.join(moved, "sub"));
  expect(existsSync(root)).toBe(false);
});

test("invalid destinations and stale edits leave records intact and create no directories", async () => {
  moveParent();
  const before = readFileSync(workspacePath(), "utf8");
  const missing = path.join(temp, "missing");
  await expect(service.relocate("project", root, missing)).rejects.toThrow("unavailable");
  await expect(service.relocate("project", root + "-stale", moved)).rejects.toThrow("changed");
  const wrong = path.join(temp, "wrong");
  mkdirSync(wrong);
  await expect(service.relocate("project", root, wrong)).rejects.toThrow("missing workspace");
  expect(readFileSync(workspacePath(), "utf8")).toBe(before);
  expect(existsSync(missing)).toBe(false);
});

test("a partial write rolls back every path and keeps the project Offline", async () => {
  const workspaces = await workspaceRegistry.list();
  const chat = await agentStorage.get("chat");
  moveParent();
  const original = workspaceRegistry.upsert.bind(workspaceRegistry);
  let writes = 0;
  vi.spyOn(workspaceRegistry, "upsert").mockImplementation(async (record) => {
    if (++writes === 2) throw new Error("Disk write failed");
    await original(record);
  });
  await expect(service.relocate("project", root, moved)).rejects.toThrow("Disk write failed");
  expect(await workspaceRegistry.list()).toEqual(workspaces);
  expect(await agentStorage.get("chat")).toEqual(chat);
  expect(await projectRegistry.get("project")).toMatchObject({ rootPath: root, offline: true });
});

test("startup rolls back a persisted interrupted relocation before loading workspaces", async () => {
  const project = (await projectRegistry.get("project"))!;
  const workspaces = await workspaceRegistry.list();
  const agents = await agentStorage.list();
  moveParent();
  const journals = path.join(ottoHome, "projects", "relocations");
  mkdirSync(journals, { recursive: true });
  writeFileSync(
    path.join(journals, "interrupted.json"),
    JSON.stringify({ project, workspaces, agents }),
  );
  await withProjectRelocationWrites("project", async () =>
    workspaceRegistry.upsert({ ...workspaces[0]!, cwd: moved }),
  );
  await service.recover();
  expect(await workspaceRegistry.list()).toEqual(workspaces);
  expect(await projectRegistry.get("project")).toMatchObject({ rootPath: root, offline: true });
  expect(existsSync(path.join(journals, "interrupted.json"))).toBe(false);
});

test("a final project write failure rolls back already rebased workspace and chat paths", async () => {
  const workspaces = await workspaceRegistry.list();
  const chat = await agentStorage.get("chat");
  moveParent();
  const original = projectRegistry.update.bind(projectRegistry);
  vi.spyOn(projectRegistry, "update").mockImplementation(async (id, updater) => {
    const current = await projectRegistry.get(id);
    if (current && updater(current).offline === false) throw new Error("Final write failed");
    return original(id, updater);
  });
  await expect(service.relocate("project", root, moved)).rejects.toThrow("Final write failed");
  expect(await workspaceRegistry.list()).toEqual(workspaces);
  expect(await agentStorage.get("chat")).toEqual(chat);
  expect(await projectRegistry.get("project")).toMatchObject({ rootPath: root, offline: true });
});

test("reconnection refuses a destination registered to another project", async () => {
  moveParent();
  const before = readFileSync(workspacePath(), "utf8");
  await projectRegistry.upsert(
    createPersistedProjectRecord({
      projectId: "other",
      rootPath: process.platform === "win32" ? moved.toUpperCase() : moved,
      kind: "non_git",
      displayName: "Other",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  await expect(service.relocate("project", root, moved)).rejects.toThrow("already belongs");
  expect(readFileSync(workspacePath(), "utf8")).toBe(before);
});

test("path remapping respects directory boundaries", () => {
  expect(relocateProjectPath(root + "-other/file", root, moved)).toBe(root + "-other/file");
});

test("relocation close and resume retain a transcript even when the provider has no saved history", async () => {
  const manager = new AgentManager({ clients: { mock: new MockLoadTestAgentClient() }, logger });
  const agent = await manager.createAgent(
    {
      provider: "mock",
      cwd: root,
      model: "ten-second-stream",
      featureValues: { mockAssistantResponse: "Keep this conversation." },
    },
    undefined,
    { workspaceId: "root" },
  );
  try {
    await manager.runAgent(agent.id, "Remember this message.");
    await manager.flush();
    const history = manager.getTimeline(agent.id);
    expect(history.some((item) => item.type === "assistant_message")).toBe(true);
    const handle = manager.getAgent(agent.id)!.persistence!;
    await manager.closeAgent(agent.id, { preserveTimeline: true });
    moveParent();
    await manager.resumeAgentFromPersistence(handle, { cwd: moved }, agent.id);
    await manager.hydrateTimelineFromProvider(agent.id);
    expect(manager.getTimeline(agent.id)).toEqual(history);
    expect(manager.getAgent(agent.id)?.cwd).toBe(moved);
  } finally {
    if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
    await manager.flush();
  }
});
