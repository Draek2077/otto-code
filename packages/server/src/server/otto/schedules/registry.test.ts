import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import {
  FileBackedProjectRegistry,
  createPersistedProjectRecord,
} from "../../workspace-registry.js";
import { ScheduleStores, type ScheduleOrigin } from "./stores.js";
import { ScheduleRegistry } from "./registry.js";
import type { StoredSchedule } from "./types.js";
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
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "schedule-registry-"));
  roots.push(root);
  const home = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  await mkdir(home);
  await mkdir(projectRoot);
  const record = createPersistedProjectRecord({
    projectId: "project",
    rootPath: projectRoot,
    kind: "git",
    displayName: "Project",
    createdAt: "now",
    updatedAt: "now",
  });
  const file = path.join(home, "projects.json");
  await writeFile(file, JSON.stringify([record]));
  const metadata = new FileBackedProjectRegistry(file, pino({ level: "silent" })).ottoMetadata;
  const stores = new ScheduleStores({ home, hostId: "host", hostLabel: "Host", metadata });
  const scope = { hostId: "host", projectId: "project" };
  let scans = 0;
  const registry = new ScheduleRegistry({
    stores,
    projects: async () => {
      scans++;
      return [{ projectId: "project" }];
    },
  });
  const origin = await stores.selected(scope);
  return {
    root,
    home,
    projectRoot,
    record,
    file,
    stores,
    scope,
    registry,
    origin,
    scans: () => scans,
  };
}
function draft(origin?: ScheduleOrigin): Omit<StoredSchedule, "id"> {
  return {
    name: "Review",
    prompt: "Review",
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
    cadence: { type: "every", everyMs: 60000 },
    status: "active",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    maxRuns: null,
    expiresAt: null,
    runs: [],
    ...(origin
      ? {
          otto: {
            version: 1,
            scope: origin.scope,
            location: origin.location,
            storeKey: origin.storeKey,
          },
        }
      : {}),
  };
}
test("new project records retain exact origin while changing defaults selects future creates", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const entry = await f.registry.entry(created.id);
  expect(entry?.ref.storeKey).toBe(f.origin.storeKey);
  const defaults = await f.stores.defaults();
  await f.stores.saveDefaults(defaults.revision, "host");
  const host = await f.stores.selected(f.scope);
  const next = await f.registry.create(draft(host));
  expect((await f.registry.entry(next.id))?.ref.location).toBe("host");
  expect((await f.registry.entry(created.id))?.ref.location).toBe("repository");
  expect((await f.registry.list()).map((row) => row.id)).toContain(created.id);
});
test("idle list uses one bounded discovery and mutations update its cache immediately", async () => {
  const f = await fixture();
  await f.registry.list();
  await f.registry.list();
  await f.registry.list();
  expect(f.scans()).toBe(1);
  const created = await f.registry.create(draft(f.origin));
  await f.registry.update(created.id, (row) => ({ ...row, name: "Updated" }));
  expect((await f.registry.list())[0].name).toBe("Updated");
  expect(f.scans()).toBe(1);
});
test("duplicate IDs never enter the runnable list or resolve by arbitrary store order", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const legacy = f.stores.legacy();
  await mkdir(legacy.directory, { recursive: true });
  await writeFile(
    path.join(legacy.directory, `${created.id}.json`),
    JSON.stringify({ ...draft(), id: created.id }),
  );
  await f.registry.refresh(true);
  expect(await f.registry.list()).toEqual([]);
  await expect(f.registry.get(created.id)).rejects.toMatchObject({ kind: "conflict" });
  expect(await f.registry.problems()).toContainEqual(
    expect.objectContaining({ code: "duplicate_id" }),
  );
});

test("display catalog retains duplicate origins for read-only inspection without granting mutations", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const legacy = f.stores.legacy();
  await mkdir(legacy.directory, { recursive: true });
  await writeFile(
    path.join(legacy.directory, `${created.id}.json`),
    JSON.stringify({
      ...draft(),
      id: created.id,
      name: "Legacy source",
    }),
  );
  await f.registry.refresh(true);
  const catalog = await f.registry.catalog();
  expect(catalog).toHaveLength(2);
  expect(catalog.every((entry) => entry.ambiguous)).toBe(true);
  for (const entry of catalog) {
    expect((await f.registry.inspectOrigin(entry.ref))?.schedule.name).toBe(entry.schedule.name);
    await expect(
      f.registry.update(created.id, (row) => ({ ...row, name: "Changed" }), {
        ref: entry.ref,
        expectedRevision: entry.revision,
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
  }
  expect(await f.registry.list()).toEqual([]);
  expect((await f.registry.catalog()).map((entry) => entry.schedule.name).sort()).toEqual([
    "Legacy source",
    "Review",
  ]);
});

test("catalog reads stay cached while exact-origin inspection detects an external edit", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const before = (await f.registry.catalog())[0];
  await writeFile(
    path.join(f.origin.directory, `${created.id}.json`),
    JSON.stringify({ ...created, name: "Peer edit" }),
  );
  expect((await f.registry.catalog())[0].revision).toBe(before.revision);
  expect(f.scans()).toBe(1);
  const fresh = await f.registry.inspectOrigin(before.ref);
  expect(fresh?.schedule.name).toBe("Peer edit");
  expect(fresh?.revision).not.toBe(before.revision);
  await expect(
    f.registry.update(created.id, (row) => ({ ...row, name: "Stale save" }), {
      ref: before.ref,
      expectedRevision: before.revision,
    }),
  ).rejects.toThrow("Schedule changed");
  await expect(
    f.registry.inspectOrigin({ ...before.ref, scope: { ...before.ref.scope, hostId: "foreign" } }),
  ).rejects.toMatchObject({ kind: "conflict" });
});

test("repair acknowledgement is committed atomically with resume and retained in the disk record", async () => {
  const f = await fixture();
  const initial = draft(f.origin);
  if (!initial.otto) throw new Error("Missing fixture origin");
  const created = await f.registry.create({
    ...initial,
    status: "paused",
    otto: {
      ...initial.otto,
      repairReason: "Inspect uncertain work",
    },
  });
  const entry = await f.registry.entry(created.id);
  if (!entry) throw new Error("Missing fixture Schedule");
  const mutation = { ref: entry.ref, expectedRevision: entry.revision };
  await expect(
    f.registry.update(created.id, (row) => ({ ...row, status: "active" }), mutation),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect((await f.registry.entry(created.id))?.revision).toBe(entry.revision);
  await f.registry.update(created.id, (row) => ({ ...row, status: "active" }), {
    ...mutation,
    repairReviewed: true,
  });
  const stored = JSON.parse(
    await readFile(path.join(f.origin.directory, `${created.id}.json`), "utf8"),
  );
  expect(stored.status).toBe("active");
  expect(stored.otto.repairReason).toBeUndefined();
  expect(stored.otto.lastRepairReview).toMatchObject({
    reason: "Inspect uncertain work",
    runId: null,
  });
  expect((await f.registry.list()).map((row) => row.id)).toContain(created.id);
});
test("filename aliases and dormant legacy targets remain untouched diagnostic records", async () => {
  const f = await fixture();
  const legacy = f.stores.legacy();
  await mkdir(legacy.directory, { recursive: true });
  const alias = JSON.stringify({ ...draft(), id: "other" });
  const dormant = JSON.stringify({
    ...draft(),
    id: "dormant",
    target: { type: "workflow", workflowId: "old" },
  });
  await writeFile(path.join(legacy.directory, "alias.json"), alias);
  await writeFile(path.join(legacy.directory, "dormant.json"), dormant);
  expect(await f.registry.list()).toEqual([]);
  expect(await f.registry.problems()).toHaveLength(2);
  expect(await readFile(path.join(legacy.directory, "alias.json"), "utf8")).toBe(alias);
  expect(await readFile(path.join(legacy.directory, "dormant.json"), "utf8")).toBe(dormant);
});

test("diagnostics keep invalid filenames out of refs and redact parser excerpts", async () => {
  const f = await fixture();
  const legacy = f.stores.legacy();
  await mkdir(legacy.directory, { recursive: true });
  await writeFile(path.join(legacy.directory, "bad name.json"), "TOP_SECRET_PARSER_INPUT");
  await writeFile(path.join(legacy.directory, "broken.json"), "TOP_SECRET_PARSER_INPUT");
  expect(await f.registry.list()).toEqual([]);
  const diagnostics = await f.registry.problems();
  expect(
    diagnostics.find((row) => row.message.includes("Invalid Schedule storage"))?.ref,
  ).toBeNull();
  expect(JSON.stringify(diagnostics)).not.toContain("TOP_SECRET");
});
test("queued concurrent CAS permits one originating edit and rejects the stale peer", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const entry = await f.registry.entry(created.id);
  if (!entry) throw new Error("Missing fixture entry");
  const mutation = { ref: entry.ref, expectedRevision: entry.revision };
  const result = await Promise.allSettled([
    f.registry.update(created.id, (row) => ({ ...row, name: "First" }), mutation),
    f.registry.update(created.id, (row) => ({ ...row, name: "Peer" }), mutation),
  ]);
  expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
  expect((await f.registry.get(created.id))?.name).toBe("First");
});
test("external editor race refuses publication and preserves peer bytes", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const file = path.join(f.origin.directory, `${created.id}.json`);
  const peer = JSON.stringify({ ...created, name: "External", future: { keep: true } });
  await expect(
    f.registry.update(created.id, async (row) => {
      await writeFile(file, peer);
      return { ...row, name: "Stale" };
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(await readFile(file, "utf8")).toBe(peer);
});
test("exact revision cannot authorize another host/project/store", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const entry = await f.registry.entry(created.id);
  if (!entry) throw new Error("Missing fixture entry");
  await expect(
    f.registry.update(created.id, (row) => ({ ...row, name: "Wrong host" }), {
      ref: { ...entry.ref, scope: { ...entry.ref.scope, hostId: "other" } },
      expectedRevision: entry.revision,
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect((await f.registry.get(created.id))?.name).toBe("Review");
});
test("legacy writes cannot mutate an extended record and raw unknown fields survive own edits", async () => {
  const f = await fixture();
  const input = draft(f.origin);
  const created = await f.registry.create({
    ...input,
    target: {
      type: "artifact-update",
      source: {
        scope: { hostId: "host", target: { kind: "project", id: "project" } },
        id: "artifact",
        location: "repository",
      },
      designFingerprint: "a".repeat(64),
      update: { type: "data", json: "{}" },
    },
  });
  await expect(
    f.registry.update(created.id, (row) => ({ ...row, name: "Old client" }), { legacyOnly: true }),
  ).rejects.toThrow("updated Otto client");
  const file = path.join(f.origin.directory, `${created.id}.json`);
  await writeFile(file, JSON.stringify({ ...created, future: { keep: true } }));
  await f.registry.update(created.id, (row) => ({ ...row, name: "Own edit" }));
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
    future: { keep: true },
    name: "Own edit",
  });
});
test("delete retains exact recoverable bytes and refuses active runs", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const file = path.join(f.origin.directory, `${created.id}.json`);
  const bytes = await readFile(file, "utf8");
  await f.registry.delete(created.id);
  expect(await f.registry.get(created.id)).toBeNull();
  const recovery = path.join(f.origin.directory, ".otto-recovery");
  const retained = await readdir(recovery);
  expect(retained).toHaveLength(1);
  expect(await readFile(path.join(recovery, retained[0]), "utf8")).toBe(bytes);
  const active = await f.registry.create({
    ...draft(f.origin),
    runs: [
      {
        id: "run",
        scheduledFor: "now",
        startedAt: "now",
        endedAt: null,
        status: "running",
        agentId: null,
        output: null,
        error: null,
      },
    ],
  });
  await expect(f.registry.delete(active.id)).rejects.toMatchObject({ kind: "busy" });
  expect(await f.registry.get(active.id)).not.toBeNull();
});
test("two project bindings to one physical store suppress both owners", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  await writeFile(f.file, JSON.stringify([f.record, { ...f.record, projectId: "peer" }]));
  const registry = new ScheduleRegistry({
    stores: f.stores,
    projects: async () => [{ projectId: "project" }, { projectId: "peer" }],
  });
  expect(await registry.list()).toEqual([]);
  expect(await registry.get(created.id)).toBeNull();
  expect(await registry.problems()).toContainEqual(
    expect.objectContaining({ code: "store_collision" }),
  );
});
test("legacy native name/target upsert retains canonical property-order identity", async () => {
  const f = await fixture();
  const input = draft();
  const target = { agentId: "00000000-0000-4000-8000-000000000001", type: "agent" as const };
  const created = await f.registry.upsertByNameAndTarget("Review", input.target, {
    create: () => input,
    update: (row) => row,
  });
  const next = await f.registry.upsertByNameAndTarget(" Review ", target, {
    create: () => input,
    update: (row) => ({ ...row, prompt: "Updated" }),
  });
  expect(next.id).toBe(created.id);
  expect(next.prompt).toBe("Updated");
  expect(await f.registry.list()).toHaveLength(1);
});

test("concurrent legacy upserts serialize the same canonical identity", async () => {
  const f = await fixture();
  const input = draft();
  const left = f.registry.upsertByNameAndTarget("Review", input.target, {
    create: () => input,
    update: (row) => row,
  });
  const right = f.registry.upsertByNameAndTarget(
    " Review ",
    { agentId: "00000000-0000-4000-8000-000000000001", type: "agent" },
    { create: () => input, update: (row) => row },
  );
  const results = await Promise.all([left, right]);
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].id).toHaveLength(8);
  expect(await f.registry.list()).toHaveLength(1);
});

test("unknown nested legacy fields survive edits while deliberate known removals and retargeting still apply", async () => {
  const f = await fixture();
  const created = await f.registry.create({
    ...draft(f.origin),
    target: {
      type: "new-agent",
      config: { provider: "fixture", cwd: f.projectRoot, systemPrompt: "Known prompt" },
    },
  });
  if (created.target.type !== "new-agent") throw new Error("Expected new-agent fixture");
  const file = path.join(f.origin.directory, `${created.id}.json`);
  await writeFile(
    file,
    JSON.stringify({
      ...created,
      target: {
        ...created.target,
        futureTarget: { keep: true },
        config: { ...created.target.config, futureConfig: { keep: true } },
      },
    }),
  );
  await f.registry.update(created.id, (row) => {
    if (row.target.type !== "new-agent") throw new Error("Expected new-agent fixture");
    const config = { ...row.target.config };
    delete config.systemPrompt;
    return { ...row, name: "Edited", target: { ...row.target, config } };
  });
  const edited = JSON.parse(await readFile(file, "utf8"));
  expect(edited.target.config.futureConfig).toEqual({ keep: true });
  expect(edited.target.futureTarget).toEqual({ keep: true });
  expect(edited.target.config).not.toHaveProperty("systemPrompt");
  await f.registry.update(created.id, (row) => ({
    ...row,
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
  }));
  const retargeted = JSON.parse(await readFile(file, "utf8"));
  expect(retargeted.target).toEqual({
    type: "agent",
    agentId: "00000000-0000-4000-8000-000000000001",
  });
});

test("a changed canonical project root cannot redirect a cached Schedule claim", async () => {
  const f = await fixture();
  const created = await f.registry.create(draft(f.origin));
  const peer = path.join(f.root, "other-project-root");
  await mkdir(peer);
  await writeFile(f.file, JSON.stringify([{ ...f.record, rootPath: peer }]));
  await expect(
    f.registry.update(created.id, (row) => ({ ...row, name: "Redirected" })),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(
    JSON.parse(await readFile(path.join(f.origin.directory, `${created.id}.json`), "utf8")).name,
  ).toBe("Review");
});
