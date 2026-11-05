import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { workflowFixture } from "./test-utils/fixture.js";
import { workflowDirectory } from "./files.js";

describe("independent project Workflow storage", () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;
  beforeEach(async () => {
    f = await workflowFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("new-host reads are inert and do not inherit Knowledge/Artifact choices", async () => {
    const before = await f.metadata.read("project-1");
    const storage = await f.stores.storage(f.scope);
    expect(storage).toMatchObject({
      location: "repository",
      override: null,
      hostDefault: "repository",
    });
    expect(await readdir(f.repo)).toEqual([]);
    expect(await readdir(f.home)).toEqual([]);
    expect(await f.metadata.read("project-1")).toEqual(before);
  });
  test("reads retained 0.9 host defaults without rewriting them", async () => {
    const original = JSON.stringify({
      projectWorkflows: { defaultStoreLocation: "host" },
      unknown: { preserve: true },
    });
    await writeFile(path.join(f.home, "otto-config.json"), original);
    expect((await f.stores.storage(f.scope)).location).toBe("host");
    expect(await readFile(path.join(f.home, "otto-config.json"), "utf8")).toBe(original);
    expect(await readdir(f.home)).toEqual(["otto-config.json"]);
  });
  test("existing repository wins over inherited host default", async () => {
    await mkdir(path.join(f.repo, ".otto", "workflows"), { recursive: true });
    const before = await f.stores.defaults();
    await f.stores.saveDefaults(before.revision, "host");
    expect((await f.stores.storage(f.scope)).location).toBe("repository");
  });
  test("project override and explicit inheritance preserve unrelated data", async () => {
    const before = await f.stores.storage(f.scope);
    const host = await f.stores.saveStorage(f.scope, before.revision, "host");
    expect(host).toMatchObject({ location: "host", override: "host" });
    const inherited = await f.stores.saveStorage(f.scope, host.revision, null);
    expect(inherited).toMatchObject({ location: "repository", override: null });
    expect((await f.metadata.read("project-1")).record).toMatchObject({
      knowledgeLocation: "host",
      artifactLocation: "host",
      future: { keep: true },
    });
  });
  test("stale project and host saves retain the accepted choices", async () => {
    const project = await f.stores.storage(f.scope);
    await f.stores.saveStorage(f.scope, project.revision, "host");
    await expect(
      f.stores.saveStorage(f.scope, project.revision, "repository"),
    ).rejects.toMatchObject({ kind: "conflict" });
    const host = await f.stores.defaults();
    await f.stores.saveDefaults(host.revision, "host");
    await expect(f.stores.saveDefaults(host.revision, "repository")).rejects.toMatchObject({
      kind: "conflict",
    });
    expect((await f.stores.defaults()).location).toBe("host");
  });
  test("host preference saves retain unknown fields and return their own acknowledgment", async () => {
    await writeFile(
      path.join(f.home, "workflow-settings.json"),
      JSON.stringify({ location: "host", future: { keep: true } }),
    );
    const origin = await f.stores.defaults();
    const saved = await f.stores.saveDefaults(origin.revision, "repository");
    expect(saved.location).toBe("repository");
    expect((await f.stores.defaults()).revision).toBe(saved.revision);
    expect(JSON.parse(await readFile(origin.file, "utf8"))).toMatchObject({
      future: { keep: true },
    });
  });
  test("malformed settings are preserved rather than reset", async () => {
    const file = path.join(f.home, "workflow-settings.json");
    await writeFile(file, "{corrupt");
    await expect(f.stores.defaults()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{corrupt");
  });
  test("pinned and historical host directories stay discoverable across preference changes", async () => {
    const original = await f.metadata.read("project-1");
    f.put("project-1", f.repo, {
      ...original.record,
      workflowDirectoryName: "preserved-workflows",
      workflowLocation: "host",
    });
    const selected = await f.stores.selected(f.scope);
    expect(path.basename(selected.directory)).toBe("preserved-workflows");
    await workflowDirectory(f.home, selected.directory, true);
    await f.stores.saveStorage(f.scope, selected.project.revision, "repository");
    expect(
      (await f.stores.locations(f.scope)).some((s) => s.directory === selected.directory),
    ).toBe(true);
    expect((await f.stores.storage(f.scope)).location).toBe("repository");
  });
  test("host allocation is pinned once and does not retarget an existing binding", async () => {
    const store = await f.stores.at(f.scope, "host");
    const pinned = await f.stores.pin(store);
    expect(pinned.project.record.workflowDirectoryName).toBe(path.basename(store.directory));
    const again = await f.stores.pin(pinned);
    expect(again.project.revision).toBe(pinned.project.revision);
    expect(await readdir(f.home)).toEqual([]);
  });
  test("two projects and a foreign host never share allocation or authority", async () => {
    const first = await f.stores.at(f.scope, "host");
    const second = await f.stores.at({ ...f.scope, projectId: "project-2" }, "host");
    expect(first.directory).not.toBe(second.directory);
    expect(first.storeKey).not.toBe(second.storeKey);
    await expect(f.stores.locations({ ...f.scope, hostId: "host-2" })).rejects.toMatchObject({
      kind: "invalid",
    });
  });
  test("unknown and unsafe retained directory data cannot become paths", async () => {
    const before = await f.metadata.read("project-1");
    f.put("project-1", f.repo, { ...before.record, workflowDirectoryName: "../escape" });
    await expect(f.stores.locations(f.scope)).rejects.toMatchObject({ kind: "invalid" });
    f.put("project-1", f.repo, {
      ...before.record,
      knowledgeDirectoryName: "../unrelated-invalid-knowledge",
    });
    expect(await f.stores.locations(f.scope)).toHaveLength(2);
  });
});
