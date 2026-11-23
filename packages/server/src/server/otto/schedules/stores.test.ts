import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import pino from "pino";
import {
  FileBackedProjectRegistry,
  createPersistedProjectRecord,
} from "../../workspace-registry.js";
import { ScheduleStores } from "./stores.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected Schedule fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture(extra: Record<string, unknown> = {}) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "schedule-stores-"));
  roots.push(root);
  const home = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  await mkdir(home);
  await mkdir(projectRoot);
  const file = path.join(home, "projects.json");
  const record = {
    ...createPersistedProjectRecord({
      projectId: "project",
      rootPath: projectRoot,
      kind: "git",
      displayName: "Project",
      createdAt: "now",
      updatedAt: "now",
    }),
    knowledgeLocation: "host",
    future: { keep: true },
    ...extra,
  };
  await writeFile(file, JSON.stringify([record]));
  const registry = new FileBackedProjectRegistry(file, pino({ level: "silent" }));
  const stores = new ScheduleStores({
    home,
    hostId: "host",
    hostLabel: "Host",
    metadata: registry.ottoMetadata,
  });
  return {
    home,
    root: projectRoot,
    file,
    record,
    stores,
    metadata: registry.ottoMetadata,
    scope: { hostId: "host", projectId: "project" },
  };
}
test("Schedule defaults are independent of Knowledge and existing repository directories", async () => {
  const f = await fixture();
  expect((await f.stores.selected(f.scope)).location).toBe("repository");
  await mkdir(path.join(f.root, ".otto", "schedules"), { recursive: true });
  const defaults = await f.stores.defaults();
  await f.stores.saveDefaults(defaults.revision, "host");
  expect((await f.stores.selected(f.scope)).location).toBe("host");
  expect((await f.metadata.read("project")).record.knowledgeLocation).toBe("host");
});
test("project override wins and CAS refuses stale saves without losing unknown fields", async () => {
  const f = await fixture();
  const before = await f.metadata.read("project");
  await f.stores.saveStorage(f.scope, before.revision, "host");
  await expect(f.stores.saveStorage(f.scope, before.revision, "repository")).rejects.toMatchObject({
    kind: "conflict",
  });
  expect((await f.stores.selected(f.scope)).location).toBe("host");
  expect((await f.metadata.read("project")).record).toMatchObject({
    future: { keep: true },
    knowledgeLocation: "host",
    scheduleLocation: "host",
  });
});
test("default saves preserve unknown preference fields and reject stale revisions", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.home, "schedule-settings.json"),
    JSON.stringify({ location: "host", future: { keep: true } }),
  );
  const before = await f.stores.defaults();
  await f.stores.saveDefaults(before.revision, "repository");
  await expect(f.stores.saveDefaults(before.revision, "host")).rejects.toMatchObject({
    kind: "conflict",
  });
  expect(JSON.parse(await readFile(before.file, "utf8"))).toEqual({
    location: "repository",
    future: { keep: true },
  });
});
test("retained Schedule host preference is read without rewriting config", async () => {
  const f = await fixture();
  const file = path.join(f.home, "otto-config.json");
  const bytes = JSON.stringify({ projectSchedules: { defaultStoreLocation: "host" }, future: 1 });
  await writeFile(file, bytes);
  expect((await f.stores.defaults()).location).toBe("host");
  expect(await readFile(file, "utf8")).toBe(bytes);
});
test("both locations remain discoverable after an independent setting change", async () => {
  const f = await fixture({ scheduleDirectoryName: "original" });
  const before = await f.stores.locations(f.scope);
  const defaults = await f.stores.defaults();
  await f.stores.saveDefaults(defaults.revision, "host");
  expect((await f.stores.locations(f.scope)).map((origin) => origin.storeKey)).toEqual(
    before.map((origin) => origin.storeKey),
  );
});
test("recorded legacy directory is adopted only if its Schedule directory really exists", async () => {
  const f = await fixture({ knowledgeDirectoryName: "old-directory" });
  expect(
    (await f.stores.locations(f.scope)).some(
      (origin) => path.basename(origin.directory) === "old-directory",
    ),
  ).toBe(false);
  await mkdir(path.join(f.home, "project-schedules", "old-directory"), { recursive: true });
  const origin = (await f.stores.locations(f.scope)).find(
    (item) => path.basename(item.directory) === "old-directory",
  );
  expect(origin).toBeDefined();
  if (!origin) throw new Error("Missing fixture origin");
  await f.stores.pin(origin);
  expect((await f.metadata.read("project")).record).toMatchObject({
    scheduleDirectoryName: "old-directory",
    knowledgeDirectoryName: "old-directory",
  });
});
test("stable host binding is pinned once before writing and survives project label changes", async () => {
  const f = await fixture({ scheduleLocation: "host" });
  const origin = await f.stores.pin(await f.stores.selected(f.scope));
  const pinned = await f.metadata.read("project");
  expect(pinned.record.scheduleDirectoryName).toBe(path.basename(origin.directory));
  expect((await f.stores.pin(await f.stores.selected(f.scope))).storeKey).toBe(origin.storeKey);
  expect((await f.metadata.read("project")).revision).toBe(pinned.revision);
  await writeFile(f.file, JSON.stringify([{ ...pinned.record, customName: "Renamed project" }]));
  expect((await f.stores.selected(f.scope)).storeKey).toBe(origin.storeKey);
});
test("host binding collision includes archived projects and preserves registry bytes", async () => {
  const f = await fixture();
  await writeFile(
    f.file,
    JSON.stringify([
      f.record,
      {
        ...f.record,
        projectId: "peer",
        rootPath: path.join(f.root, "peer"),
        archivedAt: "then",
        scheduleDirectoryName: "reserved",
      },
    ]),
  );
  const current = await f.metadata.read("project");
  const before = await readFile(f.file, "utf8");
  await expect(
    f.metadata.update({
      projectId: "project",
      expectedRevision: current.revision,
      patch: { scheduleDirectoryName: "reserved" },
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(await readFile(f.file, "utf8")).toBe(before);
});
test("wrong host, malformed choices and path-shaped bindings are rejected", async () => {
  const f = await fixture({ scheduleDirectoryName: "../peer" });
  await expect(f.stores.selected({ ...f.scope, hostId: "peer" })).rejects.toMatchObject({
    kind: "invalid",
  });
  await expect(f.stores.locations(f.scope)).rejects.toMatchObject({ kind: "invalid" });
  const current = await f.metadata.read("project");
  await f.metadata.update({
    projectId: "project",
    expectedRevision: current.revision,
    patch: { scheduleDirectoryName: null, scheduleLocation: "unknown" },
  });
  await expect(f.stores.selected(f.scope)).rejects.toMatchObject({ kind: "invalid" });
});
