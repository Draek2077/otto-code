import { expect, test, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { ArtifactDaemonService } from "./service.js";
import * as storage from "./storage.js";
import { ArtifactError } from "./files.js";
import * as artifactFiles from "./files.js";
import { artifactData } from "./content.js";
import { createArtifactTools } from "./tools.js";
import type { ArtifactSchedulePort } from "./sources.js";
import type { StoredSchedule } from "@getpaseo/protocol/schedule/types";
import { ScheduleNotFoundError } from "../../schedule/service.js";
import { OTTO_CONFIG_FILENAME } from "../config-migration.js";
import {
  artifactHostDefaults,
  setArtifactHostDefaults,
  setArtifactStorage,
  aggregateArtifacts,
  readArtifact,
  type ArtifactScope,
} from "@getpaseo/plugin/otto/artifacts";
const html =
  '<!doctype html><html><head><title>Report</title></head><body><h1>Report</h1><script id="otto-artifact-data" type="application/json">{"value":1}</script><script>document.body.dataset.ready="yes"</script></body></html>';
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).toReversed()) await dispose();
});
test("corrupt metadata is held for explicit repair and the damaged JSON is preserved", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const doc = await f.service.read(f.ref(created.id)),
    file = doc.path.replace(/\.html$/, ".json");
  // A mid-regeneration snapshot must not strand repair behind a permanent spinner.
  await writeFile(
    `${file}.last-good`,
    JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), status: "generating" }),
  );
  await writeFile(file, "{broken-metadata");
  const damaged = await f.service.read(f.ref(created.id));
  expect(damaged.html).toBeNull();
  expect(damaged.artifact.status).toBe("error");
  expect(damaged.artifact.error).toContain("metadata");
  await f.service.change({
    ...f.ref(created.id),
    expectedRevision: damaged.artifact.revision,
    command: { type: "repair", userApprovedRepair: true },
  });
  expect((await f.service.read(f.ref(created.id))).artifact.previewAvailable).toBe(true);
  const recovery = (await readdir(path.dirname(file))).find(
    (name) => name.startsWith(".recovery-") && name.endsWith(".json"),
  );
  expect(await readFile(path.join(path.dirname(file), recovery!), "utf8")).toBe("{broken-metadata");
});
test("an inspected empty lock requires current identity and explicit recovery, never automatic expiry", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const doc = await f.service.read(f.ref(created.id)),
    lock = path.join(path.dirname(doc.path), `.artifact-${created.id}.lock`);
  await mkdir(lock);
  const locked = await f.service.read(f.ref(created.id));
  expect(locked.lock?.canRecover).toBe(true);
  await expect(
    f.service.change({
      ...f.ref(created.id),
      expectedRevision: locked.artifact.revision,
      command: { type: "metadata", name: "Cannot write", description: "", starred: false },
    }),
  ).rejects.toThrow("locked");
  await expect(
    f.service.change({
      ...f.ref(created.id),
      expectedRevision: locked.artifact.revision,
      command: {
        type: "recover_lock",
        expectedLockRevision: "stale",
        userVerifiedNoActiveWriter: true,
      },
    }),
  ).rejects.toThrow("changed");
  await f.service.change({
    ...f.ref(created.id),
    expectedRevision: locked.artifact.revision,
    command: {
      type: "recover_lock",
      expectedLockRevision: locked.lock!.revision,
      userVerifiedNoActiveWriter: true,
    },
  });
  expect((await f.service.read(f.ref(created.id))).lock).toBeNull();
});
async function fixture(schedules?: ArtifactSchedulePort) {
  const base = path.resolve(import.meta.dirname, "../../../../../../.tmp");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "artifact-fixture-")),
    home = path.join(root, "host"),
    repo = path.join(root, "project"),
    peer = path.join(root, "peer");
  await mkdir(home);
  await mkdir(repo);
  await mkdir(peer);
  let resolveGeneration!: (value: { html: string }) => void,
    rejectGeneration!: (error: Error) => void;
  const pending = new Promise<{ html: string }>((resolve, reject) => {
    resolveGeneration = resolve;
    rejectGeneration = reject;
  });
  let version = 0;
  const generationErrors: unknown[] = [];
  const records: Record<string, Record<string, unknown>> = { project: {}, peer: {} };
  const project = (id: string) => ({
    projectId: id,
    rootPath: id === "project" ? repo : peer,
    revision: String(version).padStart(64, "0"),
    record: records[id],
  });
  const ports = {
    reportGenerationError: (error: unknown) => {
      generationErrors.push(error);
    },
    schedules,
    home,
    hostId: "host",
    generation: async () => ({ ...(await pending), provider: "fixture", model: "fixture-model" }),
    projects: async () => [
      { projectId: "project", archivedAt: null },
      { projectId: "peer", archivedAt: null },
    ],
    workspaces: {
      get: async (id: string) => ({
        workspaceId: id,
        projectId: "project",
        cwd: repo,
        archivedAt: null,
        createdAt: "",
        updatedAt: "",
        name: "",
      }),
    },
    metadata: {
      read: async (id: string) => {
        if (!records[id]) throw new Error("No project");
        return project(id);
      },
      update: async (input: {
        projectId: string;
        expectedRevision: string;
        patch: Readonly<Record<string, unknown>>;
      }) => {
        if (input.expectedRevision !== project(input.projectId).revision)
          throw new Error("conflict");
        records[input.projectId] = { ...records[input.projectId], ...input.patch };
        version++;
        return project(input.projectId);
      },
    },
  };
  const service = new ArtifactDaemonService(ports);
  const scope: ArtifactScope = { hostId: "host", target: { kind: "project", id: "project" } };
  disposers.push(async () => {
    await service.close();
    resolveGeneration({ html });
    await rm(root, { recursive: true, force: true });
  });
  const create = () =>
    service.create(
      { scope, name: "Report", description: "Build a report" },
      { kind: "chat", agentId: "chat" },
    );
  return {
    root,
    home,
    repo,
    peer,
    scope,
    ports,
    service,
    create,
    resolve: () => resolveGeneration({ html }),
    reject: () => rejectGeneration(new Error("private provider diagnostic")),
    records,
    ref: (id: string) => ({ scope, id, location: "repository" as const }),
    project,
    generationErrors,
  };
}
test("independent generations publish concurrently while library reads observe both", async () => {
  const f = await fixture();
  await Promise.all([f.create(), f.create()]);
  f.resolve();
  await expect
    .poll(async () => ({
      items: (await f.service.list({ scope: f.scope })).items.map((item) => ({
        status: item.status,
        error: item.error,
      })),
      diagnostics: f.generationErrors.map((error) =>
        error instanceof Error
          ? { message: error.message, code: "code" in error ? String(error.code) : null }
          : String(error),
      ),
    }))
    .toEqual({
      items: [
        { status: "ready", error: null },
        { status: "ready", error: null },
      ],
      diagnostics: [],
    });
});

test("shutdown drains a ready record's final snapshot and lock cleanup", async () => {
  const f = await fixture();
  const created = await f.create();
  const publish = artifactFiles.publish;
  let entered!: () => void, release!: () => void;
  const paused = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = vi.spyOn(artifactFiles, "publish").mockImplementation(async (file, text) => {
    if (file.endsWith(".last-good")) {
      entered();
      await resume;
    }
    return publish(file, text);
  });
  let closing: Promise<void> | undefined;
  const closed = vi.fn();
  try {
    f.resolve();
    await paused;
    expect((await f.service.read(f.ref(created.id))).artifact.status).toBe("ready");
    closing = f.service.close().then(closed);
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
  } finally {
    release();
    await closing;
    intercepted.mockRestore();
  }
  const names = await readdir(path.join(f.repo, ".otto", "artifacts"));
  expect(names).toContain(`${created.id}.json.last-good`);
  expect(names.some((name) => name.endsWith(".lock") || name.endsWith(".tmp"))).toBe(false);
  expect(closed).toHaveBeenCalledTimes(1);
});
function sourceSchedule(): StoredSchedule {
  return {
    id: "schedule",
    name: "Daily report",
    prompt: "Refresh report",
    cadence: { type: "every", everyMs: 60000 },
    target: { type: "new-agent", config: { provider: "fixture", cwd: "/project" } },
    status: "active",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: "now",
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs: [
      {
        id: "run",
        status: "running",
        agentId: "agent",
        workspaceId: "workspace",
        scheduledFor: "now",
        startedAt: "now",
        endedAt: null,
        output: "Refresh accepted",
        error: null,
      },
    ],
  };
}
test("Schedule tool writes persist exact source and manual data refresh replaces stale attribution", async () => {
  const schedule = sourceSchedule();
  const f = await fixture({ inspect: async () => schedule });
  const tools = createArtifactTools({
    host: f.service,
    policy: async () => true,
    caller: () => ({
      workspaceId: "workspace",
      agentId: "agent",
      labels: {
        "paseo.schedule-id": "schedule",
        "paseo.schedule-run": "run",
      },
    }),
  });
  const create = tools.find((tool) => tool.name === "create_artifact")!;
  const result = await create.handler(
    { name: "Scheduled report", description: "Create report" },
    {},
  );
  expect(result.isError).toBeUndefined();
  const listed = await f.service.list({ scope: f.scope });
  const ref = f.ref(listed.items[0].id);
  f.resolve();
  await expect.poll(async () => (await f.service.read(ref)).artifact.status).toBe("ready");
  const original = await f.service.read(ref);
  expect(original.artifact.source).toEqual({
    kind: "schedule",
    scheduleId: "schedule",
    runId: "run",
  });
  const update = tools.find((tool) => tool.name === "update_artifact_data")!;
  const input = {
    artifactId: ref.id,
    location: ref.location,
    expectedRevision: original.artifact.revision,
    json: '{"value":2}',
  };
  expect((await update.handler(input, {})).isError).toBeUndefined();
  const refreshed = await f.service.read(ref);
  expect(refreshed.artifact.source).toEqual(original.artifact.source);
  expect(refreshed.html!.replace(/\{\s*"value": 2\s*\}/, "DATA")).toBe(
    original.html!.replace('{"value":1}', "DATA"),
  );
  expect((await update.handler(input, {})).isError).toBe(true);
  expect((await f.service.read(ref)).artifact.revision).toBe(refreshed.artifact.revision);
  schedule.runs[0].status = "succeeded";
  expect(
    (
      await update.handler(
        { ...input, expectedRevision: refreshed.artifact.revision, json: '{"value":3}' },
        {},
      )
    ).isError,
  ).toBeUndefined();
  expect((await f.service.read(ref)).artifact.source).toEqual({ kind: "chat", agentId: "agent" });
});
test("Schedule source inspection resolves only the exact same-project run and retains unavailable sources", async () => {
  const schedule = sourceSchedule();
  let deleted = false;
  const f = await fixture({
    inspect: async () => {
      if (deleted) throw new ScheduleNotFoundError("schedule");
      return schedule;
    },
  });
  const created = await f.service.create(
    { scope: f.scope, name: "Source report", description: "Report" },
    { kind: "schedule", scheduleId: "schedule", runId: "run" },
  );
  const ref = f.ref(created.id);
  expect(await f.service.readSource(ref)).toMatchObject({
    kind: "schedule",
    name: "Daily report",
    run: { id: "run", output: "Refresh accepted" },
  });
  f.ports.workspaces.get = async () => ({
    workspaceId: "workspace",
    projectId: "peer",
    cwd: f.peer,
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    name: "",
  });
  expect(await f.service.readSource(ref)).toMatchObject({ kind: "unavailable" });
  deleted = true;
  expect(await f.service.readSource(ref)).toMatchObject({ kind: "unavailable" });
  expect((await f.service.read(ref)).artifact.source).toEqual({
    kind: "schedule",
    scheduleId: "schedule",
    runId: "run",
  });
});
test("create settles into durable output and reopening a new owner preserves data and provenance", async () => {
  const f = await fixture(),
    created = await f.create();
  expect(created.status).toBe("generating");
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  await f.service.close();
  const reopened = new ArtifactDaemonService(f.ports);
  disposers.push(() => reopened.close());
  const doc = await reopened.read(f.ref(created.id));
  expect(doc.artifact.source).toEqual({ kind: "chat", agentId: "chat" });
  expect(doc.data).toBe('{"value":1}');
  expect(doc.runs.map((run) => run.status)).toEqual(["succeeded"]);
  expect(doc.html).toContain("Content-Security-Policy");
});
test.each([false, true])(
  "published admission stays generating while its startup read is paused (shutdown=%s)",
  async (shutdown) => {
    const f = await fixture(),
      read = storage.readArtifactAt;
    let entered!: () => void, release!: () => void;
    const paused = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      resume = new Promise<void>((resolve) => {
        release = resolve;
      });
    const intercepted = vi
      .spyOn(storage, "readArtifactAt")
      .mockImplementationOnce(async (...args) => {
        entered();
        await resume;
        return read(...args);
      });
    const creating = f.create();
    try {
      await paused;
      const listed = await f.service.list({ scope: f.scope });
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].status).toBe("generating");
      const doc = await f.service.read(f.ref(listed.items[0].id));
      expect(doc.artifact.status).toBe("generating");
      expect(doc.runs[0].status).toBe("running");
      if (shutdown) await f.service.close();
    } finally {
      release();
      intercepted.mockRestore();
    }
    if (shutdown) {
      await expect(creating).rejects.toThrow("shutting down");
    } else {
      const created = await creating;
      f.resolve();
      await expect
        .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
        .toBe("ready");
    }
  },
);
test("revision-pinned data update preserves raw design and stale writes do nothing", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const doc = await f.service.read(f.ref(created.id));
  await f.service.change({
    ...f.ref(created.id),
    expectedRevision: doc.artifact.revision,
    command: { type: "data", json: '{"value":2}' },
  });
  const raw = await readFile(doc.path, "utf8");
  expect(raw.replace(artifactData(raw)!, "DATA")).toBe(html.replace(artifactData(html)!, "DATA"));
  await expect(
    f.service.change({
      ...f.ref(created.id),
      expectedRevision: doc.artifact.revision,
      command: { type: "data", json: '{"value":3}' },
    }),
  ).rejects.toThrow("changed");
  expect(await readFile(doc.path, "utf8")).toBe(raw);
});
test("cancel revokes late publication and accounts for canceled requests until they settle", async () => {
  const f = await fixture(),
    created = await f.create();
  await f.service.change({
    ...f.ref(created.id),
    expectedRevision: created.revision,
    command: { type: "cancel" },
  });
  f.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const doc = await f.service.read(f.ref(created.id));
  expect(doc.artifact.status).toBe("error");
  expect(doc.html).toBeNull();
  expect(doc.runs[0].status).toBe("failed");
});
test("failed regeneration retains the previous output and a failed attempt", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  await f.service.close();
  const failing = new ArtifactDaemonService({
    ...f.ports,
    generation: async () => {
      throw new Error("private-key-secret");
    },
  });
  disposers.push(() => failing.close());
  const initial = await failing.read(f.ref(created.id));
  await failing.change({
    ...f.ref(created.id),
    expectedRevision: initial.artifact.revision,
    command: { type: "regenerate", instruction: "New design", userApprovedDesignChange: true },
  });
  await expect
    .poll(async () => (await failing.read(f.ref(created.id))).artifact.status)
    .toBe("error");
  const doc = await failing.read(f.ref(created.id));
  expect(await readFile(doc.path, "utf8")).toBe(html);
  expect(doc.artifact.error).not.toContain("private-key");
  expect(doc.runs.map((run) => run.status)).toEqual(["succeeded", "failed"]);
});
test("interrupted generation is recoverable after owner shutdown without publishing a late response", async () => {
  const f = await fixture(),
    created = await f.create();
  await f.service.close();
  const reopened = new ArtifactDaemonService(f.ports);
  disposers.push(() => reopened.close());
  const recovered = await reopened.read(f.ref(created.id));
  expect(recovered.artifact.status).toBe("error");
  expect(recovered.artifact.error).toContain("interrupted");
  f.resolve();
});
test("invalid external HTML is preserved and explicit repair retains the damaged bytes", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const before = await f.service.read(f.ref(created.id));
  await writeFile(before.path, "damaged external HTML");
  const damaged = await f.service.read(f.ref(created.id));
  expect(damaged.html).toBeNull();
  expect(damaged.artifact.repairAvailable).toBe(true);
  await f.service.change({
    ...f.ref(created.id),
    expectedRevision: damaged.artifact.revision,
    command: { type: "repair", userApprovedRepair: true },
  });
  expect(await readFile(before.path, "utf8")).toBe(html);
  const retained = (await readdir(path.dirname(before.path))).find((name) =>
    name.startsWith(".recovery-"),
  );
  expect(await readFile(path.join(path.dirname(before.path), retained!), "utf8")).toBe(
    "damaged external HTML",
  );
});
test("moving output is project-local, explicit, visible in both stores and does not change preferences", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const doc = await f.service.read(f.ref(created.id));
  await f.service.change({
    ...f.ref(created.id),
    expectedRevision: doc.artifact.revision,
    command: { type: "move", destination: "host", userApprovedMove: true },
  });
  const listing = await f.service.list({ scope: f.scope });
  expect(listing.items.map((item) => item.location)).toEqual(["host"]);
  expect(f.records.project.artifactLocation).toBeUndefined();
  expect((await f.service.read({ ...f.ref(created.id), location: "host" })).data).toBe(
    '{"value":1}',
  );
  expect(
    (await f.service.list({ scope: { hostId: "host", target: { kind: "project", id: "peer" } } }))
      .items,
  ).toEqual([]);
});
test("legacy records remain readable and a location preference neither hides nor migrates them", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const doc = await f.service.read(f.ref(created.id));
  const raw = JSON.parse(await readFile(doc.path.replace(/\.html$/, ".json"), "utf8"));
  delete raw.lastGoodHtml;
  raw.future = { retained: true };
  const directory = path.join(f.home, "artifacts");
  await mkdir(directory);
  await writeFile(path.join(directory, "legacy.json"), JSON.stringify({ ...raw, id: "legacy" }));
  await writeFile(path.join(directory, "legacy.html"), html);
  const settings = await f.service.list({ scope: f.scope });
  await f.service.invoke(setArtifactStorage.name, {
    scope: f.scope,
    expectedRevision: settings.settingsRevision,
    location: "host",
  });
  const listing = await f.service.list({ scope: f.scope });
  expect(listing.items.map((item) => item.location).sort()).toEqual(["legacy", "repository"]);
  expect(
    (await f.service.read({ ...f.ref("legacy"), location: "legacy" })).artifact.previewAvailable,
  ).toBe(true);
});
test("host defaults are independently revisioned and foreign-host calls are rejected", async () => {
  const f = await fixture();
  const initial = artifactHostDefaults.output.parse(
    await f.service.invoke(artifactHostDefaults.name, { hostId: "host" }),
  );
  if (!initial.ok) throw new Error("fixture defaults");
  const saved = setArtifactHostDefaults.output.parse(
    await f.service.invoke(setArtifactHostDefaults.name, {
      hostId: "host",
      expectedRevision: initial.value.revision,
      location: "host",
    }),
  );
  expect(saved.ok).toBe(true);
  const stale = setArtifactHostDefaults.output.parse(
    await f.service.invoke(setArtifactHostDefaults.name, {
      hostId: "host",
      expectedRevision: initial.value.revision,
      location: "repository",
    }),
  );
  expect(stale.ok).toBe(false);
  const denied = readArtifact.output.parse(
    await f.service.invoke(readArtifact.name, {
      ...f.ref("safe"),
      scope: { ...f.scope, hostId: "foreign" },
    }),
  );
  expect(denied.ok).toBe(false);
});
test("aggregate library resolves only registered projects and bounded invalid files remain diagnostic", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const directory = path.join(f.repo, ".otto", "artifacts");
  await writeFile(path.join(directory, "bad.json"), "{invalid");
  const aggregate = aggregateArtifacts.output.parse(
    await f.service.invoke(aggregateArtifacts.name, { hostId: "host" }),
  );
  if (!aggregate.ok) throw new Error("fixture aggregate");
  expect(aggregate.value.items.map((item) => item.id)).toEqual([created.id]);
  expect(aggregate.value.diagnostics).toHaveLength(1);
  expect(await readFile(path.join(directory, "bad.json"), "utf8")).toBe("{invalid");
});
test("outside-chat tools require an explicit workspace and chat tools cannot cross workspace scope", async () => {
  const f = await fixture();
  const external = createArtifactTools({
    host: f.service,
    policy: async () => true,
    caller: () => ({ workspaceId: null }),
  }).find((tool) => tool.name === "list_artifacts")!;
  expect((await external.handler({}, {})).isError).toBe(true);
  const listed = await external.handler({ workspaceId: "workspace" }, {});
  expect(listed.isError).toBeUndefined();
  expect(listed.structuredContent).toMatchObject({ projectId: "project", items: [] });
  const chat = createArtifactTools({
    host: f.service,
    policy: async () => true,
    caller: () => ({ workspaceId: "workspace", agentId: "chat", provider: "fixture" }),
  }).find((tool) => tool.name === "list_artifacts")!;
  expect((await chat.handler({ workspaceId: "other" }, {})).isError).toBe(true);
  expect(await readdir(f.repo)).toEqual([]);
});
test("eight unresolved generations retain capacity after cancellation without admitting a ninth", async () => {
  const f = await fixture();
  const created = await Promise.all(Array.from({ length: 8 }, () => f.create()));
  await expect(f.create()).rejects.toThrow("eight");
  const doc = await f.service.read(f.ref(created[0].id));
  await f.service.change({
    ...f.ref(created[0].id),
    expectedRevision: doc.artifact.revision,
    command: { type: "cancel" },
  });
  await expect(f.create()).rejects.toThrow("eight");
  expect((await f.service.read(f.ref(created[0].id))).artifact.status).toBe("error");
});
test("retained independent host defaults select a pinned host store without rewriting the old config", async () => {
  const f = await fixture(),
    file = path.join(f.home, OTTO_CONFIG_FILENAME),
    retained = JSON.stringify({
      projectArtifacts: { defaultStoreLocation: "host" },
      future: { retained: true },
    });
  await writeFile(file, retained);
  const created = await f.create();
  expect(created.location).toBe("host");
  expect(f.records.project.artifactDirectoryName).toMatch(/^project-/);
  expect(await readFile(file, "utf8")).toBe(retained);
});
test("0.9 regeneration backups recover from canonical project paths without following retained filePath", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const doc = await f.service.read(f.ref(created.id)),
    metadata = doc.path.replace(/\.html$/, ".json"),
    record = JSON.parse(await readFile(metadata, "utf8"));
  delete record.lastGoodHtml;
  record.status = "generating";
  record.filePath = "/untrusted/outside.html";
  record.future = { preserved: true };
  await writeFile(metadata, JSON.stringify(record));
  await rename(doc.path, `${doc.path}.bak`);
  const recovered = await f.service.read(f.ref(created.id));
  expect(recovered.artifact.status).toBe("error");
  expect(recovered.artifact.previewAvailable).toBe(true);
  expect(await readFile(doc.path, "utf8")).toBe(html);
  expect(await readFile(`${doc.path}.bak`, "utf8")).toBe(html);
  expect(JSON.parse(await readFile(metadata, "utf8")).future).toEqual({ preserved: true });
});
test("a different daemon reading the same repository never settles another host's active generation", async () => {
  const f = await fixture(),
    created = await f.create(),
    peer = new ArtifactDaemonService({ ...f.ports, hostId: "other-host" });
  disposers.push(() => peer.close());
  const reference = { ...f.ref(created.id), scope: { ...f.scope, hostId: "other-host" } };
  expect((await peer.read(reference)).artifact.status).toBe("generating");
  expect((await peer.list({ scope: reference.scope })).items[0].status).toBe("generating");
  expect((await f.service.read(f.ref(created.id))).artifact.status).toBe("generating");
});
test("a changing record is diagnosed without aborting the library or altering either deliverable", async () => {
  const f = await fixture();
  // This case observes settled documents. Do not race background publication
  // merely to arrange the unrelated guarded-read conflict under test.
  const created = [];
  for (const id of ["one", "two"]) {
    const directory = path.join(f.repo, ".otto", "artifacts");
    await mkdir(directory, { recursive: true });
    const record = {
      id,
      name: id,
      description: "Settled report",
      projectId: "project",
      status: "ready" as const,
      starred: false,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
      generationProvider: "fixture",
      generationModel: "fixture-model",
      errorMessage: null,
      lastGoodHtml: html,
      runs: [],
    } satisfies storage.StoredArtifact;
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify(record));
    await writeFile(path.join(directory, `${id}.html`), html);
    created.push((await f.service.read(f.ref(id))).artifact);
  }
  expect((await f.service.list({ scope: f.scope })).items.map((item) => item.status)).toEqual([
    "ready",
    "ready",
  ]);
  const documents = await Promise.all(created.map((item) => f.service.read(f.ref(item.id)))),
    files = documents.flatMap((doc) => [doc.path, doc.path.replace(/\.html$/, ".json")]),
    before = await Promise.all(files.map((file) => readFile(file, "utf8"))),
    changing = created.map((item) => item.id).sort()[0];
  // Inject the guarded reader's observed lstat/open conflict. Stores and the
  // deliverable bytes remain real; this avoids a timing-dependent race test.
  const opening = vi
    .spyOn(storage, "readArtifactAt")
    .mockRejectedValueOnce(new ArtifactError("conflict", "Artifact changed while opening."));
  try {
    const result = await f.service.list({ scope: f.scope });
    expect(opening).toHaveBeenCalled();
    expect(result.items.map((item) => item.id)).toEqual(
      created.filter((item) => item.id !== changing).map((item) => item.id),
    );
    expect(result.diagnostics).toEqual([
      `Artifact ${changing} could not be refreshed consistently. Refresh this project before editing it.`,
    ]);
    expect(await Promise.all(files.map((file) => readFile(file, "utf8")))).toEqual(before);
  } finally {
    opening.mockRestore();
  }
});
test("routine tool inspection omits presentation bytes and data has an explicit bounded read", async () => {
  const f = await fixture(),
    created = await f.create();
  f.resolve();
  await expect
    .poll(async () => (await f.service.read(f.ref(created.id))).artifact.status)
    .toBe("ready");
  const tools = createArtifactTools({
      host: f.service,
      policy: async () => true,
      caller: () => ({ workspaceId: "workspace" }),
    }),
    input = { artifactId: created.id, location: "repository" };
  const inspected = await tools
    .find((tool) => tool.name === "inspect_artifact")!
    .handler(input, {});
  expect(inspected.structuredContent).toHaveProperty("artifact.revision");
  expect(inspected.structuredContent).not.toHaveProperty("html");
  expect(inspected.structuredContent).not.toHaveProperty("data");
  const data = await tools.find((tool) => tool.name === "get_artifact_data")!.handler(input, {});
  expect(data.structuredContent).toMatchObject({ data: '{"value":1}' });
  expect(data.structuredContent).not.toHaveProperty("html");
});
