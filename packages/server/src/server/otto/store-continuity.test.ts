import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import {
  FileBackedProjectRegistry,
  createPersistedProjectRecord,
  FileBackedWorkspaceRegistry,
  createPersistedWorkspaceRecord,
} from "../workspace-registry.js";
import { AgentStorage } from "../agent/agent-storage.js";
import {
  readPaseoWorktreeMetadata,
  writePaseoWorktreeMetadata,
} from "../../utils/worktree-metadata.js";

const roots: string[] = [];
const logger = pino({ level: "silent" });
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function makeTempRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "otto-store-continuity-"));
  roots.push(directory);
  return directory;
}

it("reads the metadata directory used by existing Otto worktrees", async () => {
  const directory = await makeTempRoot();
  await mkdir(path.join(directory, ".git", "otto"), { recursive: true });
  const metadata = { version: 2, baseRefName: "main", baseRef: "refs/remotes/origin/main" };
  await writeFile(path.join(directory, ".git", "otto", "worktree.json"), JSON.stringify(metadata));
  expect(readPaseoWorktreeMetadata(directory)).toEqual(metadata);
});

it("creates Otto metadata for a fresh checkout before writing it", async () => {
  const directory = await makeTempRoot();
  await mkdir(path.join(directory, ".git"));
  writePaseoWorktreeMetadata(directory, { baseRefName: "main" });
  expect(readPaseoWorktreeMetadata(directory)).toEqual({ version: 1, baseRefName: "main" });
  expect(await readdir(path.join(directory, ".git"))).toEqual(["otto"]);
});

it("retains Otto project settings on disk when Paseo renames and removes projects", async () => {
  const directory = await makeTempRoot();
  const file = path.join(directory, "projects.json");
  const record = createPersistedProjectRecord({
    projectId: "project-1",
    rootPath: directory,
    kind: "git",
    displayName: "Original",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  const otto = { kanban: { boardId: "7" }, knowledgeLocation: "repo" };
  await writeFile(file, JSON.stringify([{ ...record, ...otto }]));
  const registry = new FileBackedProjectRegistry(file, logger);
  await registry.upsert({ ...record, displayName: "Renamed" });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual([
    { ...record, displayName: "Renamed", ...otto },
  ]);
  // Otto-only values stay out of Paseo's runtime and wire projections.
  expect(await registry.get(record.projectId)).not.toHaveProperty("kanban");
  await registry.remove(record.projectId);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual([]);
});

it("retains Otto agent and nested config fields while honoring edits and removals", async () => {
  const directory = await makeTempRoot();
  const file = path.join(directory, "agent-1.json");
  const original = {
    id: "agent-1",
    provider: "claude",
    cwd: "/otto-project",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    title: "Original",
    labels: {},
    lastStatus: "closed",
    lastError: "old error",
    agentProfile: { name: "Builder" },
    config: { model: "old-model", ottoTeamId: "team-1" },
    features: [
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        value: false,
        unavailableReason: "Fast mode is unavailable",
      },
    ],
  };
  await writeFile(file, JSON.stringify(original));
  const storage = new AgentStorage(directory, logger);
  const loaded = await storage.get(original.id);
  if (!loaded) throw new Error("Fixture agent failed to load");
  expect(loaded).not.toHaveProperty("agentProfile");
  const { lastError: _removed, ...next } = loaded;
  await storage.upsert({ ...next, title: "Renamed", config: { model: "new-model" } });
  const files = await readdir(directory, { recursive: true });
  const updatedPath = files.find((entry) => entry.endsWith("agent-1.json"));
  if (!updatedPath) throw new Error("Updated agent was not saved");
  const saved = JSON.parse(await readFile(path.join(directory, updatedPath), "utf8"));
  expect(saved).toMatchObject({
    title: "Renamed",
    agentProfile: original.agentProfile,
    config: { model: "new-model", ottoTeamId: "team-1" },
    features: original.features,
  });
  expect(saved).not.toHaveProperty("lastError");
});

it("retains worktree ownership and background visibility from Otto 0.9", async () => {
  const directory = await makeTempRoot();
  const file = path.join(directory, "workspaces.json");
  const record = createPersistedWorkspaceRecord({
    workspaceId: "workspace-1",
    projectId: "project-1",
    cwd: directory,
    kind: "worktree",
    displayName: "Existing worktree",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  const { isPaseoOwnedWorktree: _ownership, background: _visibility, ...legacy } = record;
  await writeFile(file, JSON.stringify([{ ...legacy, isOttoOwnedWorktree: true, hidden: true }]));
  const registry = new FileBackedWorkspaceRegistry(file, logger);
  const loaded = await registry.get(record.workspaceId);
  expect(loaded).toMatchObject({ isPaseoOwnedWorktree: true, background: true });
  if (!loaded) throw new Error("Fixture workspace failed to load");
  await registry.upsert({ ...loaded, background: false });
  const reloaded = await new FileBackedWorkspaceRegistry(file, logger).get(record.workspaceId);
  expect(reloaded).toMatchObject({ isPaseoOwnedWorktree: true, background: false });
  expect(JSON.parse(await readFile(file, "utf8"))[0]).toMatchObject({
    isOttoOwnedWorktree: true,
    hidden: true,
  });
});
