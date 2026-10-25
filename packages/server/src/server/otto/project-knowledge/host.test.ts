import { mkdir, mkdtemp, readFile, rm, writeFile, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
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
  readKnowledgeLinkHealth,
  inspectKnowledgeFormat,
  applyKnowledgeFormat,
  setKnowledgeLocation,
  readKnowledgeHostDefaults,
  saveKnowledgeHostDefaults,
  inspectKnowledgeStorage,
  bindKnowledgeStorage,
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

async function storagePreview(f: Awaited<ReturnType<typeof fixture>>) {
  const result = inspectKnowledgeStorage.output.parse(
    await f.host.invoke(inspectKnowledgeStorage.name, { scope: f.scope }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function retainedMarker(input: {
  f: Awaited<ReturnType<typeof fixture>>;
  directoryName: string;
  marker?: Record<string, unknown>;
}) {
  const directory = path.join(input.f.home, "project-knowledge", input.directoryName);
  await mkdir(directory, { recursive: true });
  const bytes = JSON.stringify({
    projectId: "project-a",
    projectKey: null,
    rootPath: input.f.repo,
    updatedAt: "2026-01-01T00:00:00Z",
    ...input.marker,
  });
  const file = path.join(directory, "project.json");
  await writeFile(file, bytes);
  return { directory, file, bytes };
}
async function hostDefault(f: Awaited<ReturnType<typeof fixture>>) {
  await writeFile(
    path.join(f.home, "otto-config.json"),
    JSON.stringify({ projectKnowledge: { defaultStoreLocation: "host" }, untouched: true }),
  );
}

it("sets up a fresh inherited Host store only through an explicit inspected choice and human-approved MCP action", async () => {
  const f = await fixture();
  await hostDefault(f);
  const original = await f.registry.ottoMetadata.read("project-a");
  const homeFiles = await readdir(f.home);
  const plan = await storagePreview(f);
  expect(plan).toMatchObject({ required: true, candidates: [], otherStores: 0 });
  expect(await readdir(f.home)).toEqual(homeFiles);
  const tool = createKnowledgeTools(f.host, async () => f.scope).find(
    (item) => item.name === "configure_project_knowledge_storage",
  );
  if (!tool) throw new Error("Missing setup tool");
  const input = {
    expectedRevision: plan.revision,
    choice: { kind: "new" },
    userApprovedStorageChange: false,
  };
  expect((await tool.handler(input, {})).structuredContent).toMatchObject({
    ok: false,
    error: { code: "invalid" },
  });
  expect(await f.registry.ottoMetadata.read("project-a")).toEqual(original);
  const result = bindKnowledgeStorage.output.parse(
    (await tool.handler({ ...input, userApprovedStorageChange: true }, {})).structuredContent,
  );
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.directoryName).toMatch(/^project-[a-f0-9-]+$/);
  const project = await f.registry.ottoMetadata.read("project-a");
  expect(project.record).toMatchObject({
    knowledgeLocation: "host",
    knowledgeDirectoryName: result.value.directoryName,
    future: { retained: true },
    kanban: { adapter: "github", boardId: "7" },
  });
  const store = await f.host.resolver.resolve("project-a");
  expect(JSON.parse(await readFile(path.join(store.base, "project.json"), "utf8"))).toMatchObject({
    projectId: "project-a",
    rootPath: f.repo,
  });
  expect(await f.create()).toMatchObject({ ok: true });
  expect(await readdir(f.repo)).toEqual([]);
  expect(await readdir(f.worktree)).toEqual([]);
  expect((await storagePreview(f)).required).toBe(false);
  expect(
    await f.host.invoke(bindKnowledgeStorage.name, {
      scope: f.scope,
      expectedRevision: plan.revision,
      choice: { kind: "new" },
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
});

it("offers retained ownership by stable project ID or canonical root and reconnects without rewriting old bytes", async () => {
  const f = await fixture();
  await f.create();
  const source = path.join(f.repo, ".otto/knowledge/requirements/fixture-page.md");
  const raw = await readFile(source);
  const current = await f.registry.ottoMetadata.read("project-a");
  await f.registry.ottoMetadata.update({
    projectId: "project-a",
    expectedRevision: current.revision,
    patch: { knowledgeLocation: "host" },
  });
  const retained = await retainedMarker({
    f,
    directoryName: "new",
    marker: { rootPath: path.join(f.root, "previous-root"), future: "preserved-only" },
  });
  await retainedMarker({ f, directoryName: "by-root", marker: { projectId: null } });
  await retainedMarker({
    f,
    directoryName: "foreign",
    marker: { projectId: "other", rootPath: path.join(f.root, "other-root") },
  });
  await mkdir(path.join(f.home, "project-knowledge/unmarked"));
  await mkdir(path.join(retained.directory, "knowledge/requirements"), { recursive: true });
  await writeFile(path.join(retained.directory, "knowledge/requirements/fixture-page.md"), raw);
  const plan = await storagePreview(f);
  expect(plan.candidates.map((item) => item.directoryName)).toEqual(["by-root", "new"]);
  expect(plan.otherStores).toBe(2);
  expect(JSON.stringify(plan)).not.toContain("preserved-only");
  expect(
    await f.host.invoke(bindKnowledgeStorage.name, {
      scope: f.scope,
      expectedRevision: plan.revision,
      choice: { kind: "retained", directoryName: "new" },
    }),
  ).toMatchObject({ ok: true, value: { directoryName: "new" } });
  expect(await readFile(retained.file, "utf8")).toBe(retained.bytes);
  expect(
    await readFile(path.join(retained.directory, "knowledge/requirements/fixture-page.md")),
  ).toEqual(raw);
  expect(await readFile(source)).toEqual(raw);
  expect(
    (await f.host.service.read({ projectId: "project-a", kind: "requirement", id: "fixture-page" }))
      .statement,
  ).toBe("Verified fixture");
});

it("lets a new project choose Repository instead of allocating a Host store under the Host default", async () => {
  const f = await fixture();
  await hostDefault(f);
  const plan = await storagePreview(f);
  const original = await readFile(path.join(f.home, "otto-config.json"));
  expect(
    await f.host.invoke(bindKnowledgeStorage.name, {
      scope: f.scope,
      expectedRevision: plan.revision,
      choice: { kind: "repository" },
    }),
  ).toMatchObject({ ok: true, value: { location: "repository", directoryName: null } });
  expect((await f.registry.ottoMetadata.read("project-a")).record).toMatchObject({
    knowledgeLocation: "repository",
    future: { retained: true },
  });
  expect(
    (await f.registry.ottoMetadata.read("project-a")).record.knowledgeDirectoryName,
  ).toBeUndefined();
  expect(await readdir(f.home)).not.toContain("project-knowledge");
  expect(await f.create()).toMatchObject({ ok: true });
  expect(
    await readFile(path.join(f.repo, ".otto/knowledge/requirements/fixture-page.md"), "utf8"),
  ).toContain("Verified fixture");
  expect(await readFile(path.join(f.home, "otto-config.json"))).toEqual(original);
});

it.each(["project", "marker"] as const)(
  "rejects a setup preview after its %s origin changes without allocating another directory",
  async (changed) => {
    const f = await fixture();
    await hostDefault(f);
    const retained = await retainedMarker({ f, directoryName: "retained" });
    const plan = await storagePreview(f);
    if (changed === "marker")
      await writeFile(
        retained.file,
        JSON.stringify({ ...JSON.parse(retained.bytes), future: "peer change" }),
      );
    else {
      const project = await f.registry.ottoMetadata.read("project-a");
      await f.registry.ottoMetadata.update({
        projectId: "project-a",
        expectedRevision: project.revision,
        patch: { kanban: { future: "peer change" } },
      });
    }
    const before = await readFile(retained.file);
    expect(
      await f.host.invoke(bindKnowledgeStorage.name, {
        scope: f.scope,
        expectedRevision: plan.revision,
        choice: { kind: "retained", directoryName: "retained" },
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      (await f.registry.ottoMetadata.read("project-a")).record.knowledgeDirectoryName,
    ).toBeUndefined();
    expect(await readdir(path.dirname(retained.directory))).toEqual(["retained"]);
    expect(await readFile(retained.file)).toEqual(before);
  },
);

it("does not offer a directory bound to another archived project even if its marker matches this root", async () => {
  const f = await fixture();
  await hostDefault(f);
  const retained = await retainedMarker({ f, directoryName: "retained" });
  const preview = await storagePreview(f);
  const current = await f.registry.ottoMetadata.read("project-a");
  const archived = {
    ...current.record,
    projectId: "other",
    rootPath: path.join(f.root, "other"),
    archivedAt: "2026-01-01T00:00:00Z",
    knowledgeDirectoryName: "retained",
  };
  await writeFile(path.join(f.home, "projects.json"), JSON.stringify([current.record, archived]));
  const plan = await storagePreview(f);
  expect(plan).toMatchObject({ candidates: [], otherStores: 1 });
  expect(
    await f.host.invoke(bindKnowledgeStorage.name, {
      scope: f.scope,
      expectedRevision: preview.revision,
      choice: { kind: "retained", directoryName: "retained" },
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(
    await f.registry.ottoMetadata
      .update({
        projectId: "project-a",
        expectedRevision: current.revision,
        patch: { knowledgeDirectoryName: "retained" },
      })
      .then(
        () => "accepted",
        () => "rejected",
      ),
  ).toBe("rejected");
  expect(await readFile(retained.file, "utf8")).toBe(retained.bytes);
});

it("refuses host-store symlinks and client-supplied paths before publishing an identity", async () => {
  const f = await fixture();
  await hostDefault(f);
  const retained = await retainedMarker({ f, directoryName: "retained" });
  await symlink(retained.directory, path.join(f.home, "project-knowledge/linked"), "junction");
  expect(await f.host.invoke(inspectKnowledgeStorage.name, { scope: f.scope })).toMatchObject({
    ok: false,
    error: { code: "unavailable" },
  });
  expect(
    await f.host.invoke(bindKnowledgeStorage.name, {
      scope: f.scope,
      expectedRevision: "a".repeat(64),
      choice: { kind: "retained", directoryName: "../outside" },
    }),
  ).toMatchObject({ ok: false, error: { code: "invalid" } });
  expect(
    await f.host.invoke(inspectKnowledgeStorage.name, { scope: { ...f.scope, hostId: "wrong" } }),
  ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
  expect(
    (await f.registry.ottoMetadata.read("project-a")).record.knowledgeDirectoryName,
  ).toBeUndefined();
});

it("publishes host defaults without redirecting initialized inherited stores or rewriting retained settings", async () => {
  const f = await fixture();
  const legacy = JSON.stringify({
    projectKnowledge: { defaultStoreLocation: "host" },
    future: "retained",
    providers: { key: "private-fixture" },
  });
  await writeFile(path.join(f.home, "otto-config.json"), legacy);
  const origin = await f.registry.ottoMetadata.read("project-a");
  await f.registry.ottoMetadata.update({
    projectId: "project-a",
    expectedRevision: origin.revision,
    patch: { knowledgeDirectoryName: "retained-name" },
  });
  expect(await f.create()).toMatchObject({ ok: true });
  const store = await f.host.resolver.resolve("project-a");
  const file = path.join(store.base, "knowledge/requirements/fixture-page.md");
  const bytes = await readFile(file, "utf8");
  const defaults = readKnowledgeHostDefaults.output.parse(
    await f.host.invoke(readKnowledgeHostDefaults.name, { hostId: "host-a" }),
  );
  if (!defaults.ok) throw new Error("Expected host defaults");
  expect(JSON.stringify(defaults)).not.toContain("private-fixture");
  expect(
    await f.host.invoke(saveKnowledgeHostDefaults.name, {
      hostId: "host-a",
      expectedRevision: defaults.value.revision,
      defaultStoreLocation: "repository",
    }),
  ).toMatchObject({ ok: true, value: { defaultStoreLocation: "repository" } });
  expect((await f.registry.ottoMetadata.read("project-a")).record).toMatchObject({
    knowledgeLocation: "host",
    knowledgeDirectoryName: "retained-name",
    future: { retained: true },
    kanban: { adapter: "github", boardId: "7" },
  });
  expect((await f.host.resolver.resolve("project-a")).base).toBe(store.base);
  expect(await readFile(file, "utf8")).toBe(bytes);
  expect(await readFile(path.join(f.home, "otto-config.json"), "utf8")).toBe(legacy);
  expect(
    await f.host.invoke(saveKnowledgeHostDefaults.name, {
      hostId: "host-a",
      expectedRevision: defaults.value.revision,
      defaultStoreLocation: "host",
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(f.notifications).toContain("all");
});

it("leaves dormant host copies unbound when the old default was repository and refuses foreign settings owners", async () => {
  const f = await fixture();
  const origin = await f.registry.ottoMetadata.read("project-a");
  await f.registry.ottoMetadata.update({
    projectId: "project-a",
    expectedRevision: origin.revision,
    patch: { knowledgeDirectoryName: "dormant-copy" },
  });
  await mkdir(path.join(f.home, "project-knowledge/dormant-copy"), { recursive: true });
  const defaults = readKnowledgeHostDefaults.output.parse(
    await f.host.invoke(readKnowledgeHostDefaults.name, { hostId: "host-a" }),
  );
  if (!defaults.ok) throw new Error("Expected host defaults");
  for (const method of [readKnowledgeHostDefaults.name, saveKnowledgeHostDefaults.name]) {
    const input =
      method === readKnowledgeHostDefaults.name
        ? { hostId: "other" }
        : {
            hostId: "other",
            expectedRevision: defaults.value.revision,
            defaultStoreLocation: "host",
          };
    expect(await f.host.invoke(method, input)).toMatchObject({
      ok: false,
      error: { code: "wrong_host" },
    });
  }
  expect(await readdir(path.join(f.home, "project-knowledge"))).toEqual(["dormant-copy"]);
  expect(
    await f.host.invoke(saveKnowledgeHostDefaults.name, {
      hostId: "host-a",
      expectedRevision: defaults.value.revision,
      defaultStoreLocation: "host",
    }),
  ).toMatchObject({ ok: true });
  expect(
    (await f.registry.ottoMetadata.read("project-a")).record.knowledgeLocation,
  ).toBeUndefined();
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
  const notifications: string[] = [];
  const host = new KnowledgeDaemonService({
    hostId: "host-a",
    home,
    metadata: registry.ottoMetadata,
    workspaces: { get: async (id) => (id === workspace.workspaceId ? workspace : null) },
    now: () => new Date(now),
    observations: {
      notifyAll: () => notifications.push("all"),
      notify: (id) => {
        notifications.push(id);
      },
      wait: async () => ({ cursor: "fixture", error: null }),
      release: async () => {},
      releaseClient: async () => {},
      close: async () => {},
    },
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
  return { root, home, repo, worktree, registry, host, scope, catalogInput, create, notifications };
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
  expect(await f.create()).toMatchObject({ ok: true });
  expect(f.notifications).toEqual(["project-a"]);
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

it("requires explicit human deletion agreement in the shared MCP tool", async () => {
  const f = await fixture();
  await f.create();
  const page = await f.host.service.read({
    projectId: "project-a",
    kind: "requirement",
    id: "fixture-page",
  });
  const manage = createKnowledgeTools(f.host, async () => f.scope).find(
    (tool) => tool.name === "manage_project_knowledge",
  );
  if (!manage) throw new Error("Missing shared tool");
  const command = {
    action: "purge",
    kind: "requirement",
    id: page.metadata.id,
    expectedRevision: page.revision,
    reason: "Explicit human approval",
  };
  expect((await manage.handler({ command }, {})).structuredContent).toMatchObject({
    ok: false,
    error: { code: "invalid" },
  });
  expect(
    (await f.host.service.read({ projectId: "project-a", kind: "requirement", id: "fixture-page" }))
      .revision,
  ).toBe(page.revision);
  expect(
    (await manage.handler({ command, userApprovedDeletion: true }, {})).structuredContent,
  ).toMatchObject({ ok: true });
  await expect(
    f.host.service.read({ projectId: "project-a", kind: "requirement", id: "fixture-page" }),
  ).rejects.toThrow("removed");
});

it("discovers custom host-owned Knowledge guidance without injecting its body and exposes it only on demand", async () => {
  const f = await fixture();
  await f.create();
  const policy = "Specific project Knowledge guidance, not automatic system instructions.";
  await writeFile(path.join(f.repo, ".otto/KNOWLEDGE.md"), policy);
  const prompt = await f.host.sessionPrompt("workspace-a");
  expect(prompt).toContain("read_project_knowledge_policy");
  expect(prompt).not.toContain(policy);
  const readPolicy = createKnowledgeTools(f.host, async () => f.scope).find(
    (tool) => tool.name === "read_project_knowledge_policy",
  );
  if (!readPolicy) throw new Error("Missing policy tool");
  expect((await readPolicy.handler({}, {})).structuredContent).toMatchObject({
    ok: true,
    value: { body: policy, custom: true },
  });
  expect(await readFile(path.join(f.repo, ".otto/KNOWLEDGE.md"), "utf8")).toBe(policy);
});

it("shares bounded link-health RPC and MCP results through the canonical workspace binding", async () => {
  const f = await fixture();
  await f.create();
  const target = { projectId: "project-a", kind: "requirement", id: "fixture-page" } as const;
  const draft = await f.host.service.read(target);
  const changed = await f.host.service.updateTruth({
    ...target,
    expectedRevision: draft.revision,
    statement: "[[missing-b]] [[missing-a]]",
    reason: "Link fixture",
  });
  await f.host.records.review({
    ...target,
    expectedRevision: changed.revision,
    status: "confirmed",
    reason: "Explicit fixture agreement",
  });
  const input = { scope: f.scope, offset: 0, limit: 1 };
  const first = readKnowledgeLinkHealth.output.parse(
    await f.host.invoke(readKnowledgeLinkHealth.name, input),
  );
  expect(first).toMatchObject({
    ok: true,
    value: {
      total: 2,
      nextOffset: 1,
      issues: [{ target: "missing-a", source: { type: "page", id: target.id } }],
    },
  });
  expect(JSON.stringify(first)).not.toContain(f.repo);
  expect(
    await f.host.invoke(readKnowledgeLinkHealth.name, {
      ...input,
      scope: { ...f.scope, hostId: "other" },
    }),
  ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
  const tool = createKnowledgeTools(f.host, async () => f.scope).find(
    (entry) => entry.name === "lint_project_knowledge_links",
  );
  if (!tool) throw new Error("Missing shared link tool");
  expect((await tool.handler({ limit: 1 }, {})).structuredContent).toEqual(first);
  expect(await f.host.invoke(readKnowledgeLinkHealth.name, { ...input, offset: 1 })).toMatchObject({
    ok: true,
    value: { nextOffset: null, issues: [{ target: "missing-b" }] },
  });
});

it("exposes explicit old-format inspection and approved conversion through the same RPC and MCP host", async () => {
  const f = await fixture();
  await mkdir(path.join(f.repo, ".otto"));
  const source = path.join(f.repo, ".otto/project-knowledge.json");
  const raw = JSON.stringify({
    version: 1,
    records: [
      {
        id: "legacy-page",
        kind: "requirement",
        title: "Legacy",
        statement: "Retained truth",
        tags: [],
        status: "confirmed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        future: { retained: true },
      },
    ],
  });
  await writeFile(source, raw);
  const inspected = inspectKnowledgeFormat.output.parse(
    await f.host.invoke(inspectKnowledgeFormat.name, { scope: f.scope }),
  );
  if (!inspected.ok) throw new Error(inspected.error.message);
  expect(inspected.value).toMatchObject({
    required: true,
    count: 1,
    changes: [{ id: "legacy-page", action: "import-json" }],
  });
  expect(await readFile(source, "utf8")).toBe(raw);
  expect(await readdir(path.join(f.repo, ".otto"))).toEqual(["project-knowledge.json"]);
  const tools = createKnowledgeTools(f.host, async () => f.scope);
  const inspect = tools.find((tool) => tool.name === "inspect_project_knowledge_format");
  const migrate = tools.find((tool) => tool.name === "migrate_project_knowledge_format");
  if (!inspect || !migrate) throw new Error("Missing format tools");
  expect((await inspect.handler({}, {})).structuredContent).toEqual(inspected);
  const input = {
    expectedRevision: inspected.value.revision,
    reason: "Human approved this conversion",
    userApprovedMigration: false,
  };
  expect((await migrate.handler(input, {})).structuredContent).toMatchObject({
    ok: false,
    error: { code: "invalid" },
  });
  expect(await readdir(path.join(f.repo, ".otto"))).toEqual(["project-knowledge.json"]);
  expect(
    (await migrate.handler({ ...input, userApprovedMigration: true }, {})).structuredContent,
  ).toMatchObject({ ok: true, value: { converted: 1 } });
  const converted = await f.host.service.read({
    projectId: "project-a",
    kind: "requirement",
    id: "legacy-page",
  });
  expect(converted.metadata).toMatchObject({ status: "confirmed", future: { retained: true } });
  expect(await readFile(source, "utf8")).toBe(raw);
  expect(
    await f.host.invoke(applyKnowledgeFormat.name, {
      scope: f.scope,
      expectedRevision: inspected.value.revision,
      reason: "No stale replay",
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(
    await f.host.invoke(inspectKnowledgeFormat.name, { scope: { ...f.scope, hostId: "other" } }),
  ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
  expect(f.notifications).toContain("project-a");
});
