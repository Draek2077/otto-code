import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { FileBackedProjectRegistry, createPersistedProjectRecord } from "../workspace-registry.js";

const parent = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected project metadata fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "project-metadata-"));
  roots.push(root);
  const file = path.join(root, "projects.json");
  const project = createPersistedProjectRecord({
    projectId: "project-1",
    rootPath: root,
    kind: "git",
    displayName: "Original",
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-24T00:00:00Z",
  });
  const record = {
    ...project,
    kanban: { adapter: "github", boardId: "7", future: { enabled: true } },
    knowledgeLocation: "host",
    knowledgeDirectoryName: "preserved-directory",
    futureField: { values: [1, 2, 3] },
  };
  await writeFile(file, JSON.stringify([record]));
  const registry = new FileBackedProjectRegistry(file, pino({ level: "silent" }));
  const bytes = () => readFile(file, "utf8");
  return { file, record, registry, metadata: registry.ottoMetadata, bytes };
}

it("keeps the original registry when final storage ownership validation fails", async () => {
  const f = await fixture();
  const origin = await f.metadata.read("project-1");
  const before = await f.bytes();
  await expect(
    f.metadata.update({
      projectId: "project-1",
      expectedRevision: origin.revision,
      patch: { knowledgeDirectoryName: "explicit-retained-choice" },
      beforePublish: async () => {
        throw new Error("Ownership marker changed while queued");
      },
    }),
  ).rejects.toThrow("Ownership marker changed");
  expect(await f.bytes()).toBe(before);
});

it("keeps initialized inherited stores, including archived projects, under the project queue through default publication", async () => {
  const f = await fixture();
  const inherited = { ...f.record, knowledgeLocation: null };
  const archived = {
    ...inherited,
    projectId: "archived-project",
    archivedAt: "2026-01-01T00:00:00Z",
  };
  const explicit = { ...inherited, projectId: "explicit-project", knowledgeLocation: "repository" };
  await writeFile(f.file, JSON.stringify([inherited, archived, explicit]));
  let signal = () => {};
  let release = () => {};
  const entered = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let published = false;
  const keep = f.metadata.retainKnowledgeHostStores({
    initialized: async () => {
      signal();
      await gate;
      return true;
    },
    publish: async () => {
      expect(JSON.parse(await f.bytes())).toEqual([
        { ...inherited, knowledgeLocation: "host" },
        { ...archived, knowledgeLocation: "host" },
        explicit,
      ]);
      published = true;
      return "saved";
    },
  });
  await entered;
  const rename = f.registry.update("project-1", (project) => ({
    ...project,
    displayName: "Queued rename",
  }));
  release();
  expect(await keep).toBe("saved");
  await rename;
  expect(published).toBe(true);
  expect((await f.metadata.read("project-1")).record).toEqual({
    ...inherited,
    knowledgeLocation: "host",
    displayName: "Queued rename",
  });
});

it("retains protective bindings when default publication fails and never rolls back unrelated values", async () => {
  const f = await fixture();
  const original = { ...f.record, knowledgeLocation: null };
  await writeFile(f.file, JSON.stringify([original]));
  await expect(
    f.metadata.retainKnowledgeHostStores({
      initialized: async () => true,
      publish: async () => {
        throw new Error("Default publication denied");
      },
    }),
  ).rejects.toThrow("publication denied");
  expect(JSON.parse(await f.bytes())).toEqual([{ ...original, knowledgeLocation: "host" }]);
});

it("preserves an external registry edit observed during store-retention preparation", async () => {
  const f = await fixture();
  const original = { ...f.record, knowledgeLocation: null };
  await writeFile(f.file, JSON.stringify([original]));
  const peer = JSON.stringify([{ ...original, futureField: { peer: true } }]);
  let published = false;
  await expect(
    f.metadata.retainKnowledgeHostStores({
      initialized: async () => {
        await writeFile(f.file, peer);
        return true;
      },
      publish: async () => {
        published = true;
      },
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(published).toBe(false);
  expect(await f.bytes()).toBe(peer);
});

it("allows defaults for a genuinely new host but refuses an existing empty or corrupt project registry", async () => {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "project-defaults-empty-"));
  roots.push(root);
  const file = path.join(root, "projects.json");
  const registry = new FileBackedProjectRegistry(file, pino({ level: "silent" }));
  expect(
    await registry.ottoMetadata.retainKnowledgeHostStores({
      initialized: async () => false,
      publish: async () => "new-host",
    }),
  ).toBe("new-host");
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(file, "");
  let published = false;
  await expect(
    registry.ottoMetadata.retainKnowledgeHostStores({
      initialized: async () => true,
      publish: async () => {
        published = true;
      },
    }),
  ).rejects.toThrow();
  expect(published).toBe(false);
  expect(await readFile(file, "utf8")).toBe("");
});

it("reads preserved metadata without exposing it in Paseo runtime records or changing bytes", async () => {
  const f = await fixture();
  const before = await f.bytes();
  expect((await f.metadata.read("project-1")).record).toEqual(f.record);
  expect(await f.registry.get("project-1")).not.toHaveProperty("kanban");
  expect(await f.bytes()).toBe(before);
});

it("updates owned fields atomically and preserves every unrelated record value", async () => {
  const f = await fixture();
  const before = await f.metadata.read("project-1");
  const target = { adapter: "github", boardId: "8", future: { enabled: true } };
  const next = await f.metadata.update({
    projectId: "project-1",
    expectedRevision: before.revision,
    patch: { kanban: target },
  });
  expect(next.record).toEqual({ ...f.record, kanban: target });
  expect(next.revision).not.toBe(before.revision);
  expect(await f.metadata.read("project-1")).toEqual(next);
  expect(JSON.parse(await f.bytes())).toEqual([next.record]);
});

it("serializes feature and ordinary project edits through the same queue", async () => {
  const f = await fixture();
  const before = await f.metadata.read("project-1");
  await Promise.all([
    f.metadata.update({
      projectId: "project-1",
      expectedRevision: before.revision,
      patch: { knowledgeDirectoryName: "allocated-once" },
    }),
    f.registry.update("project-1", (record) => ({ ...record, displayName: "Renamed" })),
  ]);
  expect((await f.metadata.read("project-1")).record).toEqual({
    ...f.record,
    displayName: "Renamed",
    knowledgeDirectoryName: "allocated-once",
  });
});

it("rejects a stale feature edit after an ordinary rename without losing either field", async () => {
  const f = await fixture();
  const before = await f.metadata.read("project-1");
  await f.registry.update("project-1", (record) => ({ ...record, displayName: "Peer rename" }));
  const bytes = await f.bytes();
  await expect(
    f.metadata.update({
      projectId: "project-1",
      expectedRevision: before.revision,
      patch: { kanban: null },
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(await f.bytes()).toBe(bytes);
});

it("admits only one of two concurrent writes from the same originating revision", async () => {
  const f = await fixture();
  const before = await f.metadata.read("project-1");
  const outcomes = await Promise.allSettled([
    f.metadata.update({
      projectId: "project-1",
      expectedRevision: before.revision,
      patch: { knowledgeLocation: "repository" },
    }),
    f.metadata.update({
      projectId: "project-1",
      expectedRevision: before.revision,
      patch: { kanban: null },
    }),
  ]);
  expect(outcomes.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
  expect((await f.metadata.read("project-1")).record).toEqual({
    ...f.record,
    knowledgeLocation: "repository",
  });
});

it.each(["archive", "remove"] as const)(
  "does not resurrect a project after %s",
  async (operation) => {
    const f = await fixture();
    const before = await f.metadata.read("project-1");
    if (operation === "archive") await f.registry.archive("project-1", "2026-10-24T01:00:00Z");
    else await f.registry.remove("project-1");
    const bytes = await f.bytes();
    await expect(
      f.metadata.update({
        projectId: "project-1",
        expectedRevision: before.revision,
        patch: { kanban: null },
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(await f.bytes()).toBe(bytes);
  },
);

it("refuses attempts to change Paseo identity or paths through the extension adapter", async () => {
  const f = await fixture();
  const before = await f.metadata.read("project-1");
  const bytes = await f.bytes();
  await expect(
    f.metadata.update({
      projectId: "project-1",
      expectedRevision: before.revision,
      patch: { rootPath: "/unrelated" },
    }),
  ).rejects.toMatchObject({ kind: "invalid" });
  expect(await f.bytes()).toBe(bytes);
});

it.each(["{broken", "{}"])(
  "preserves a corrupt registry instead of repairing it (%s)",
  async (contents) => {
    const f = await fixture();
    await f.metadata.read("project-1");
    await writeFile(f.file, contents);
    await expect(f.metadata.read("project-1")).rejects.toThrow("left unchanged");
    expect(await f.bytes()).toBe(contents);
  },
);

it("refuses duplicate raw identities before overwriting any record", async () => {
  const f = await fixture();
  const contents = JSON.stringify([f.record, { ...f.record, rootPath: "another-root" }]);
  await writeFile(f.file, contents);
  await expect(f.metadata.read("project-1")).rejects.toThrow("left unchanged");
  expect(await f.bytes()).toBe(contents);
});
