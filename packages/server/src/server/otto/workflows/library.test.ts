import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  WorkflowRunRecord,
  normalizeWorkflowRunRecord,
  type WorkflowRef,
} from "@getpaseo/plugin/otto/workflows";
import { workflowFixture, graphDocument, aiDocument } from "./test-utils/fixture.js";
import { workflowDirectory, workflowDigest } from "./files.js";

describe("real project Workflow library", () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;
  beforeEach(async () => {
    f = await workflowFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("writes project Graph documents, origin and last-good snapshot with no global store", async () => {
    const saved = await f.library.write(f.scope, graphDocument(), null);
    expect(saved.ref).toMatchObject({ kind: "graph", location: "repository", scope: f.scope });
    expect(saved.document.value.workflowStorage).toMatchObject({
      projectId: "project-1",
      location: "repository",
      source: "project-store",
    });
    expect(await f.library.read(saved.ref)).toEqual(saved);
    expect(await readdir(f.home)).toEqual([]);
    const snapshot = path.join(
      f.repo,
      ".otto",
      "workflows",
      "definitions",
      ".otto-last-good",
      "example.json",
    );
    expect(JSON.parse(await readFile(snapshot, "utf8"))).toMatchObject({
      future: { retained: true },
    });
    expect(f.changes()).toBe(1);
  });
  test("AI definitions round-trip explicit model seats and limits", async () => {
    const saved = await f.library.write(f.scope, aiDocument(), null);
    expect((await f.library.read(saved.ref)).document).toMatchObject(aiDocument());
    expect((await f.library.list(f.scope, "definition")).items.map((i) => i.ref.kind)).toEqual([
      "ai",
    ]);
    expect((await f.library.list(f.scope, "graph")).items).toEqual([]);
  });
  test("new host records pin allocation and preserve other category choices", async () => {
    const before = await f.stores.storage(f.scope);
    await f.stores.saveStorage(f.scope, before.revision, "host");
    const saved = await f.library.write(f.scope, graphDocument(), null);
    expect(saved.ref.location).toBe("host");
    const project = await f.metadata.read("project-1");
    expect(project.record).toMatchObject({
      knowledgeLocation: "host",
      artifactLocation: "host",
      future: { keep: true },
    });
    expect(typeof project.record.workflowDirectoryName).toBe("string");
    expect(await readdir(f.repo)).toEqual([]);
  });
  test("settings change selects subsequent creates without moving or hiding existing records", async () => {
    const first = await f.library.write(f.scope, graphDocument("repository-record"), null);
    const storage = await f.stores.storage(f.scope);
    await f.stores.saveStorage(f.scope, storage.revision, "host");
    const second = await f.library.write(f.scope, aiDocument("host-record"), null);
    expect(first.ref.location).toBe("repository");
    expect(second.ref.location).toBe("host");
    expect((await f.library.list(f.scope, "definition")).items).toHaveLength(2);
    expect((await f.library.read(first.ref)).revision).toBe(first.revision);
  });
  test("a stale edit cannot replace peer bytes or its unknown fields", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    const edited = graphDocument();
    edited.value.name = "Peer";
    const peer = await f.library.write(f.scope, edited, original.revision, original.ref);
    await expect(
      f.library.write(f.scope, graphDocument(), original.revision, original.ref),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect((await f.library.read(peer.ref)).document.value).toMatchObject({
      name: "Peer",
      future: { retained: true },
    });
  });
  test("a captured edit cannot switch project, kind or identity", async () => {
    const original = await f.library.write(f.scope, graphDocument(), null);
    await expect(
      f.library.write(
        { ...f.scope, projectId: "project-2" },
        graphDocument(),
        original.revision,
        original.ref,
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      f.library.write(f.scope, graphDocument("other"), original.revision, original.ref),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      f.library.read({ ...original.ref, scope: { ...f.scope, hostId: "foreign" } }),
    ).rejects.toMatchObject({ kind: "invalid" });
  });
  test("corrupt entries stay on disk and do not hide readable records", async () => {
    await f.library.write(f.scope, graphDocument("valid"), null);
    const directory = path.join(f.repo, ".otto", "workflows", "definitions");
    const file = path.join(directory, "damaged.json");
    await writeFile(file, "{broken");
    const page = await f.library.list(f.scope, "definition");
    expect(page.items.filter((item) => item.status !== "unreadable")).toHaveLength(1);
    expect(page.items.find((item) => item.ref.id === "damaged")).toMatchObject({
      status: "unreadable",
      ref: { kind: "graph", location: "repository" },
    });
    expect(page.diagnostics).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe("{broken");
    await expect(
      f.library.read({ scope: f.scope, kind: "graph", location: "repository", id: "damaged" }),
    ).rejects.toMatchObject({ kind: "invalid" });
  });
  test("an unreadable AI record remains selectable with its snapshot-proven recovery kind", async () => {
    const saved = await f.library.write(f.scope, aiDocument(), null);
    const file = path.join(f.repo, ".otto/workflows/definitions", `${saved.ref.id}.json`);
    await writeFile(file, "{broken");
    const page = await f.library.list(f.scope, "definition");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ status: "unreadable", ref: saved.ref });
    expect(await readFile(file, "utf8")).toBe("{broken");
  });
  test("pagination exposes additional records rather than treating fifty as the entire library", async () => {
    const directory = path.join(f.repo, ".otto", "workflows", "definitions");
    await mkdir(directory, { recursive: true });
    for (let index = 0; index < 51; index++) {
      const doc = graphDocument(`graph_${String(index).padStart(3, "0")}`);
      await writeFile(path.join(directory, `${doc.value.id}.json`), JSON.stringify(doc.value));
    }
    const first = await f.library.list(f.scope, "definition");
    expect(first.items).toHaveLength(50);
    expect(first.nextOffset).toBe(50);
    const second = await f.library.list(f.scope, "definition", first.nextOffset!);
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.ref.id)).size).toBe(51);
  });
  test("legacy definitions are disclosed read-only and never silently assigned", async () => {
    const directory = path.join(f.home, "orchestration-graphs");
    await mkdir(directory);
    const file = path.join(directory, "old.json");
    const bytes = JSON.stringify(graphDocument("old").value);
    await writeFile(file, bytes);
    const before = await f.metadata.read("project-1");
    expect((await f.library.list(f.scope, "graph")).items).toEqual([]);
    const listed = await f.library.list(f.scope, "graph", 0, true);
    expect(listed.items).toHaveLength(1);
    const ref = listed.items[0].ref;
    expect(ref.location).toBe("legacy");
    await expect(
      f.library.write(f.scope, graphDocument("old"), workflowDigest(bytes), ref),
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(await readFile(file, "utf8")).toBe(bytes);
    expect(await f.metadata.read("project-1")).toEqual(before);
  });
  test("legacy runs use registry workspace ownership, never path prefixes or invented projects", async () => {
    const directory = path.join(f.home, "runs");
    await mkdir(directory);
    const own = { id: "own", title: "Own run", status: "done", workspaceId: "worktree-1" };
    await writeFile(path.join(directory, "own.json"), JSON.stringify(own));
    await writeFile(
      path.join(directory, "foreign.json"),
      JSON.stringify({ ...own, id: "foreign", workspaceId: "foreign-workspace" }),
    );
    await writeFile(
      path.join(directory, "unscoped.json"),
      JSON.stringify({ id: "unscoped", title: "Unscoped", status: "done" }),
    );
    const page = await f.library.list(f.scope, "run", 0, true);
    expect(page.items.map((i) => i.ref.id)).toEqual(["own"]);
    const entry = await f.library.read(page.items[0].ref);
    expect(entry.document).toMatchObject({ kind: "run", value: { phases: [] } });
    expect(await readFile(path.join(directory, "own.json"), "utf8")).toBe(JSON.stringify(own));
  });
  test("explicit origin disambiguates duplicate host IDs without picking a first match", async () => {
    const before = await f.metadata.read("project-1");
    f.put("project-1", f.repo, { ...before.record, workflowDirectoryName: "old-binding" });
    const stores = (await f.stores.locations(f.scope)).filter((s) => s.location === "host");
    expect(stores).toHaveLength(2);
    for (const store of stores) {
      const directory = f.stores.directory(store, "graph");
      await workflowDirectory(store.boundary, directory, true);
      await writeFile(
        path.join(directory, "same.json"),
        JSON.stringify({ ...graphDocument("same").value, name: store.storeKey }),
      );
    }
    const ref: WorkflowRef = { scope: f.scope, kind: "graph", location: "host", id: "same" };
    await expect(f.library.read(ref)).rejects.toMatchObject({ kind: "conflict" });
    expect(
      (await f.library.read({ ...ref, storeKey: stores[1].storeKey })).document.value,
    ).toMatchObject({ name: stores[1].storeKey });
  });
  test("deletion retains recovery bytes and refuses active runs", async () => {
    const graph = await f.library.write(f.scope, graphDocument(), null);
    await f.library.remove(graph.ref, graph.revision);
    expect((await f.library.list(f.scope, "graph")).items).toEqual([]);
    const recovery = path.join(f.repo, ".otto", "workflows", "definitions", ".otto-recovery");
    expect(await readdir(recovery)).toHaveLength(1);
    const run = normalizeWorkflowRunRecord(
      WorkflowRunRecord.parse({ id: "active", title: "Active", status: "running", phases: [] }),
    );
    const saved = await f.library.write(f.scope, { kind: "run", value: run }, null);
    await expect(f.library.remove(saved.ref, saved.revision)).rejects.toMatchObject({
      kind: "busy",
    });
  });
  test("a rebuilt legacy project ID needs exact canonical root proof, never a similar folder name", async () => {
    const saved = await f.library.write(f.scope, graphDocument("retained"), null),
      located = await f.library.locate(saved.ref);
    const file = f.stores.file(located.store, saved.ref.kind, saved.ref.id);
    const record = JSON.parse(located.bytes);
    record.workflowStorage.projectId = "old-otto-project-id";
    await writeFile(file, JSON.stringify(record));
    expect((await f.library.read(saved.ref)).document.value.id).toBe("retained");
    record.workflowStorage.projectRoot = f.other;
    const foreignBytes = JSON.stringify(record);
    await writeFile(file, foreignBytes);
    await expect(f.library.read(saved.ref)).rejects.toMatchObject({ kind: "unavailable" });
    expect(await readFile(file, "utf8")).toBe(foreignBytes);
  });
});
