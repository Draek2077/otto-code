import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import pino from "pino";
import {
  FileBackedProjectRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "../../workspace-registry.js";
import { KnowledgeDaemonService } from "./host.js";
import { createKnowledgeTools } from "./tools.js";
import {
  mutateKnowledge,
  readKnowledgeCatalog,
  readKnowledgePage,
  setKnowledgeLocation,
} from "@getpaseo/plugin/otto/project-knowledge";

const parent = fileURLToPath(new URL("../../../../../../.tmp/knowledge-host/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  roots.push(root);
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "worktree");
  await mkdir(home);
  await mkdir(repo);
  await mkdir(worktree);
  const now = "2026-10-24T17:00:00Z";
  const project = createPersistedProjectRecord({
    projectId: "project-a",
    rootPath: repo,
    kind: "git",
    displayName: "Project A",
    createdAt: now,
    updatedAt: now,
  });
  const file = path.join(home, "projects.json");
  await writeFile(
    file,
    JSON.stringify([
      { ...project, future: { retained: true }, kanban: { adapter: "github", boardId: "7" } },
    ]),
  );
  const registry = new FileBackedProjectRegistry(file, pino({ level: "silent" }));
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-a",
    projectId: project.projectId,
    cwd: worktree,
    kind: "worktree",
    displayName: "Branch",
    createdAt: now,
    updatedAt: now,
  });
  const host = new KnowledgeDaemonService({
    hostId: "host-a",
    home,
    metadata: registry.ottoMetadata,
    workspaces: { get: async (id) => (id === workspace.workspaceId ? workspace : null) },
    now: () => new Date(now),
  });
  const scope = host.workspaceScope(workspace.workspaceId);
  const catalogInput = { scope, includeInactive: true, query: "", offset: 0, limit: 50 };
  const create = () =>
    host.invoke(mutateKnowledge.name, {
      scope,
      command: {
        action: "create",
        kind: "requirement",
        id: "fixture-page",
        title: "Fixture",
        statement: "Verified fixture",
        tags: ["fixture"],
      },
    });
  return { root, home, repo, worktree, registry, host, scope, catalogInput, create };
}

it("binds worktrees to the canonical project and keeps catalog metadata separate from bodies", async () => {
  const f = await fixture();
  expect(await f.create()).toEqual({ ok: true, value: { changed: true } });
  expect(await readdir(f.worktree)).toEqual([]);
  expect(
    await readFile(path.join(f.repo, ".otto/knowledge/requirements/fixture-page.md"), "utf8"),
  ).toContain("Verified fixture");
  const result = readKnowledgeCatalog.output.parse(
    await f.host.invoke(readKnowledgeCatalog.name, f.catalogInput),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected catalog");
  expect(result.value.records).toHaveLength(1);
  expect(result.value.records[0]).not.toHaveProperty("statement");
  expect(result.value.settings.projectId).toBe("project-a");
  const page = readKnowledgePage.output.parse(
    await f.host.invoke(readKnowledgePage.name, {
      scope: f.scope,
      kind: "requirement",
      id: "fixture-page",
    }),
  );
  expect(page).toMatchObject({ ok: true, value: { statement: "Verified fixture" } });
  expect(await f.host.service.catalog("project-a")).toEqual([]);
});

it("rejects foreign hosts, missing workspaces and client paths before touching stores", async () => {
  const f = await fixture();
  expect(
    await f.host.invoke(readKnowledgeCatalog.name, {
      ...f.catalogInput,
      scope: { ...f.scope, hostId: "other-host" },
    }),
  ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
  expect(
    await f.host.invoke(readKnowledgeCatalog.name, {
      ...f.catalogInput,
      scope: { ...f.scope, target: { kind: "workspace", id: "missing" } },
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(
    await f.host.invoke(mutateKnowledge.name, {
      scope: f.scope,
      command: {
        action: "create",
        kind: "finding",
        id: "../../outside",
        title: "Unsafe",
        statement: "unsafe",
        tags: [],
      },
    }),
  ).toMatchObject({ ok: false, error: { code: "invalid" } });
  expect(await readdir(f.repo)).toEqual([]);
});

it("publishes successful own writes and classifies a deleted selected page without stale data", async () => {
  const f = await fixture();
  const notify = vi.spyOn(f.host.observations, "notify");
  expect(await f.create()).toMatchObject({ ok: true });
  expect(notify).toHaveBeenCalledExactlyOnceWith("project-a");
  const file = path.join(f.repo, ".otto/knowledge/requirements/fixture-page.md");
  await rm(file);
  expect(
    await f.host.invoke(readKnowledgePage.name, {
      scope: f.scope,
      kind: "requirement",
      id: "fixture-page",
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
});

it("copies to host storage only after explicit CAS, retains repository recovery and unrelated settings", async () => {
  const f = await fixture();
  await f.create();
  const before = await f.registry.ottoMetadata.read("project-a");
  const source = path.join(f.repo, ".otto/knowledge/requirements/fixture-page.md");
  const bytes = await readFile(source);
  const result = await f.host.invoke(setKnowledgeLocation.name, {
    scope: f.scope,
    expectedRevision: before.revision,
    location: "host",
  });
  expect(result).toMatchObject({ ok: true, value: { copied: 1 } });
  const after = await f.registry.ottoMetadata.read("project-a");
  expect(after.record).toMatchObject({
    knowledgeLocation: "host",
    future: { retained: true },
    kanban: { boardId: "7" },
  });
  expect(typeof after.record.knowledgeDirectoryName).toBe("string");
  const store = await f.host.resolver.resolve("project-a");
  expect(store.location).toBe("host");
  expect(await readFile(path.join(store.base, "knowledge/requirements/fixture-page.md"))).toEqual(
    bytes,
  );
  expect(await readFile(source)).toEqual(bytes);
  expect(
    await f.host.invoke(setKnowledgeLocation.name, {
      scope: f.scope,
      expectedRevision: before.revision,
      location: "repository",
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
});

it("exposes provider-neutral tools with bounded discovery and explicit review agreement", async () => {
  const f = await fixture();
  await f.create();
  const tools = createKnowledgeTools(f.host, async () => f.scope);
  const manage = tools.find((tool) => tool.name === "manage_project_knowledge");
  const list = tools.find((tool) => tool.name === "list_project_knowledge");
  if (!manage || !list) throw new Error("Missing tools");
  const current = await f.host.service.read({
    projectId: "project-a",
    kind: "requirement",
    id: "fixture-page",
  });
  const command = {
    action: "review",
    kind: "requirement",
    id: "fixture-page",
    expectedRevision: current.revision,
    status: "confirmed",
    reason: "Explicit fixture agreement",
  };
  expect((await manage.handler({ command }, {})).structuredContent).toMatchObject({ ok: false });
  expect(
    (await manage.handler({ command, userApprovedReview: true }, {})).structuredContent,
  ).toMatchObject({ ok: true });
  const visible = await list.handler({ limit: 1 }, {});
  expect(visible.structuredContent).toMatchObject({
    ok: true,
    value: { total: 1, records: [{ id: "fixture-page" }] },
  });
  expect(JSON.stringify(visible.structuredContent)).not.toContain("Verified fixture");
});
