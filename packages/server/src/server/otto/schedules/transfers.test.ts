import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import {
  FileBackedProjectRegistry,
  createPersistedProjectRecord,
} from "../../workspace-registry.js";
import { ScheduleStores } from "./stores.js";
import { ScheduleRegistry } from "./registry.js";
import { ScheduleTransfers } from "./transfers.js";
import type { ScheduleTransferInput } from "./transfer-plan.js";
import { scheduleTransferLockFiles } from "./transfer-locks.js";
import { readScheduleTransfer } from "./transfer-record.js";

function interruptPublication(
  registry: ScheduleRegistry,
  number: number,
  timing: "before" | "after",
) {
  const publish = registry.publishTransfer.bind(registry);
  let calls = 0;
  return vi.spyOn(registry, "publishTransfer").mockImplementation(async (...args) => {
    const selected = ++calls === number;
    if (selected && timing === "before") throw new Error("Injected publication interruption");
    const saved = await publish(...args);
    if (selected && timing === "after") throw new Error("Injected lost publication response");
    return saved;
  });
}
function inspectedDecision(result: Awaited<ReturnType<ScheduleTransfers["inspect"]>>) {
  return {
    scope: result.scope,
    operationId: result.operationId,
    expectedRevision: result.revision,
    expectedSourceDigest: result.sourceDigest,
    expectedDestinationDigest: result.destinationDigest,
    decision: "complete" as const,
  };
}

const parent = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected transfer fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "schedule-transfer-"));
  roots.push(root);
  const home = path.join(root, "home"),
    repo = path.join(root, "repo");
  await mkdir(home);
  await mkdir(repo);
  const file = path.join(home, "projects.json");
  await writeFile(
    file,
    JSON.stringify([
      createPersistedProjectRecord({
        projectId: "project",
        rootPath: repo,
        kind: "git",
        displayName: "Project",
        createdAt: "now",
        updatedAt: "now",
      }),
    ]),
  );
  const metadata = new FileBackedProjectRegistry(file, pino({ level: "silent" })).ottoMetadata;
  const scope = { hostId: "host", projectId: "project" };
  const stores = new ScheduleStores({ home, hostId: "host", hostLabel: "Host", metadata });
  const registry = new ScheduleRegistry({
    stores,
    projects: async () => [{ projectId: "project" }],
  });
  const origin = await stores.selected(scope);
  const schedule = await registry.create({
    name: "Review",
    prompt: "Review",
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
    cadence: { type: "every", everyMs: 60000 },
    status: "active",
    createdAt: "before",
    updatedAt: "before",
    nextRunAt: "2030-01-01T00:00:00.000Z",
    lastRunAt: "before",
    pausedAt: null,
    maxRuns: null,
    expiresAt: null,
    otto: { version: 1, scope, location: origin.location, storeKey: origin.storeKey },
    runs: [
      {
        id: "old-run",
        scheduledFor: "before",
        startedAt: "before",
        endedAt: "before",
        status: "succeeded",
        agentId: null,
        output: "Preserved",
        error: null,
      },
    ],
  });
  const sourceFile = path.join(origin.directory, `${schedule.id}.json`);
  const bytes = JSON.stringify(
    {
      ...schedule,
      future: { retained: true },
      target: { ...schedule.target, futureTarget: { retained: true } },
    },
    null,
    2,
  );
  await writeFile(sourceFile, bytes);
  await registry.refresh(true);
  const entry = await registry.entry(schedule.id);
  if (!entry) throw new Error("Missing fixture source");
  const transfers = new ScheduleTransfers(registry, () => "2026-11-08T00:00:00.000Z");
  const input: ScheduleTransferInput = {
    scope,
    source: entry.ref,
    expectedRevision: entry.revision,
    operationId: "operation",
    operation: "copy",
    destination: "host",
  };
  return {
    root,
    home,
    registry,
    stores,
    scope,
    origin,
    sourceFile,
    bytes,
    entry,
    transfers,
    input,
  };
}

test("copy settings preserves exact source/history and publishes a new paused identity with unknown settings", async () => {
  const f = await fixture();
  const result = await f.transfers.transfer(f.input);
  expect(result.status).toBe("committed");
  expect(result.needsReconciliation).toBe(false);
  expect(result.destination.id).not.toBe(f.entry.ref.id);
  expect(await readFile(f.sourceFile, "utf8")).toBe(f.bytes);
  const destination = await f.registry.transferEntry(result.destination);
  expect(destination?.schedule).toMatchObject({
    status: "paused",
    nextRunAt: null,
    runs: [],
    otto: { transfer: { phase: "committed" } },
  });
  expect(JSON.parse(destination!.bytes)).toMatchObject({
    future: { retained: true },
    target: { futureTarget: { retained: true } },
  });
  expect(await f.transfers.transfer(f.input)).toEqual(result);
  expect((await f.registry.catalog()).length).toBe(2);
});

test("move keeps the same identity/history, verifies the destination and retains both original and retired bytes", async () => {
  const f = await fixture();
  const result = await f.transfers.transfer({ ...f.input, operation: "move" });
  expect(result).toMatchObject({
    status: "committed",
    needsReconciliation: false,
    sourceDigest: null,
    destination: { id: f.entry.ref.id },
  });
  const destination = await f.registry.transferEntry(result.destination);
  expect(destination?.schedule).toMatchObject({
    status: "paused",
    nextRunAt: null,
    runs: f.entry.schedule.runs,
  });
  expect(JSON.parse(destination!.bytes)).toMatchObject({
    future: { retained: true },
    target: { futureTarget: { retained: true } },
  });
  await expect(readFile(f.sourceFile)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await readFile(
      path.join(f.home, "schedule-transfers", f.input.operationId, "source.json"),
      "utf8",
    ),
  ).toBe(f.bytes);
  expect(await readdir(path.join(f.origin.directory, ".otto-recovery"))).toHaveLength(1);
  expect((await f.registry.catalog()).map((row) => row.ref)).toEqual([result.destination]);
});

test.each(["copy", "move"] as const)(
  "%s interrupted after destination publication never replays and needs an inspected completion",
  async (operation) => {
    const f = await fixture();
    const input = { ...f.input, operation };
    const interruption = interruptPublication(f.registry, 2, "after");
    const pending = await f.transfers.transfer(input);
    expect(pending).toMatchObject({
      status: "reconciliation_required",
      needsReconciliation: true,
      sourceMatches: true,
      destinationMatches: true,
    });
    expect(await f.registry.list()).toEqual([]);
    expect(await f.transfers.transfer(input)).toEqual(pending);
    expect(interruption).toHaveBeenCalledTimes(2);
    await expect(f.registry.update(input.source.id, (row) => row)).rejects.toMatchObject({
      kind: expect.stringMatching(/busy|conflict/),
    });
    interruption.mockRestore();
    const committed = await f.transfers.reconcile(inspectedDecision(pending));
    expect(committed).toMatchObject({
      status: "committed",
      needsReconciliation: false,
      destinationMatches: true,
    });
    expect((await f.registry.transferEntry(committed.destination))?.schedule.status).toBe("paused");
  },
);

test("an interruption before destination creation allows only an explicit abort and exact source restoration", async () => {
  const f = await fixture();
  const interruption = interruptPublication(f.registry, 2, "before");
  const pending = await f.transfers.transfer(f.input);
  expect(pending).toMatchObject({ needsReconciliation: true, destinationDigest: null });
  expect(await f.registry.list()).toEqual([]);
  await expect(f.transfers.reconcile(inspectedDecision(pending))).rejects.toThrow(
    "Destination no longer matches",
  );
  interruption.mockRestore();
  const aborted = await f.transfers.reconcile({ ...inspectedDecision(pending), decision: "abort" });
  expect(aborted).toMatchObject({
    status: "aborted",
    needsReconciliation: false,
    destinationDigest: null,
  });
  expect(await readFile(f.sourceFile, "utf8")).toBe(f.bytes);
  expect(await f.transfers.transfer(f.input)).toEqual(aborted);
});

test("a peer edit rejects stale and freshly inspected reconciliation without overwriting either origin", async () => {
  const f = await fixture();
  const interruption = interruptPublication(f.registry, 2, "after");
  const pending = await f.transfers.transfer(f.input);
  interruption.mockRestore();
  const destinationBefore = await f.registry.transferBytes(pending.destination);
  const source = await f.registry.transferBytes(pending.source);
  if (!source) throw new Error("Missing fenced source");
  const peer = JSON.stringify({ ...JSON.parse(source), name: "Peer edit" });
  await writeFile(f.sourceFile, peer);
  await expect(f.transfers.reconcile(inspectedDecision(pending))).rejects.toThrow(
    "changed since inspection",
  );
  const inspected = await f.transfers.inspect(f.scope, f.input.operationId);
  expect(inspected).toMatchObject({ sourceMatches: false, needsReconciliation: true });
  await expect(f.transfers.reconcile(inspectedDecision(inspected))).rejects.toThrow(
    "Copy source no longer matches",
  );
  expect(await readFile(f.sourceFile, "utf8")).toBe(peer);
  expect(await f.registry.transferBytes(pending.destination)).toBe(destinationBefore);
});

test.each(["copy", "move"] as const)(
  "%s completion after a lost final publication keeps the receipt and finishes only after inspection",
  async (operation) => {
    const f = await fixture();
    const interruption = interruptPublication(f.registry, 3, "after");
    const pending = await f.transfers.transfer({ ...f.input, operation });
    expect(pending).toMatchObject({
      status: "committed",
      needsReconciliation: operation === "copy",
    });
    interruption.mockRestore();
    const completed = await f.transfers.reconcile(inspectedDecision(pending));
    expect(completed).toMatchObject({ status: "committed", needsReconciliation: false });
  },
);

test.each(["transaction", "receipt", "backup", "source", "destination"] as const)(
  "retained %s locks need an exact inspected receipt and lock revision",
  async (kind) => {
    const f = await fixture();
    const result = await f.transfers.transfer(f.input);
    const file = path.join(f.home, "schedule-transfers", f.input.operationId, "receipt.json");
    const retained = await readScheduleTransfer(file);
    if (!retained) throw new Error("Missing fixture receipt");
    const files = await scheduleTransferLockFiles(f.registry, file, retained.record);
    const lockFile = files[kind];
    if (!lockFile) throw new Error("Missing fixture lock path");
    await mkdir(`${lockFile}.otto-lock`);
    const inspected = await f.transfers.inspect(f.scope, f.input.operationId);
    expect(inspected.locks).toHaveLength(1);
    expect(inspected.locks[0]).toMatchObject({ kind, canRecover: true });
    const recovery = {
      scope: f.scope,
      operationId: f.input.operationId,
      expectedRevision: result.revision,
      kind,
      expectedLockRevision: inspected.locks[0].revision,
      writersStopped: true as const,
    };
    await expect(
      f.transfers.recoverLock({ ...recovery, expectedLockRevision: "a".repeat(64) }),
    ).rejects.toThrow("lock changed");
    expect((await f.transfers.recoverLock(recovery)).locks).toEqual([]);
    expect(await readFile(f.sourceFile, "utf8")).toBe(f.bytes);
  },
);

test("an interrupted admission without a receipt permits inspected packet-lock recovery without guessing a source", async () => {
  const f = await fixture();
  const operationId = "orphan-admission";
  const directory = path.join(f.home, "schedule-transfers", operationId);
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(directory, "receipt.json.transaction.otto-lock"));
  const lookup = await f.transfers.lookup(f.scope, operationId);
  expect(lookup).toMatchObject({
    found: false,
    locks: [{ kind: "transaction", canRecover: true }],
  });
  const recovery = {
    scope: f.scope,
    operationId,
    expectedRevision: null,
    kind: "transaction" as const,
    expectedLockRevision: lookup.locks[0].revision,
    writersStopped: true as const,
  };
  await expect(f.transfers.recoverLock({ ...recovery, kind: "source" })).rejects.toThrow(
    "No retained receipt",
  );
  expect(await f.transfers.recoverLock(recovery)).toEqual({
    found: false,
    scope: f.scope,
    operationId,
    locks: [],
  });
  expect(await readFile(f.sourceFile, "utf8")).toBe(f.bytes);
});

test("shutdown after source fencing cannot publish a destination or silently restore execution", async () => {
  const f = await fixture();
  const publish = f.registry.publishTransfer.bind(f.registry);
  const publication = vi
    .spyOn(f.registry, "publishTransfer")
    .mockImplementationOnce(async (...args) => {
      const saved = await publish(...args);
      f.transfers.close();
      return saved;
    });
  const pending = await f.transfers.transfer(f.input);
  expect(pending).toMatchObject({ needsReconciliation: true, destinationDigest: null });
  expect(await f.registry.list()).toEqual([]);
  expect(publication).toHaveBeenCalledTimes(1);
  await expect(
    f.transfers.reconcile({ ...inspectedDecision(pending), decision: "abort" }),
  ).rejects.toThrow("host is stopping");
  publication.mockRestore();
  const restarted = new ScheduleTransfers(f.registry);
  expect(
    await restarted.reconcile({ ...inspectedDecision(pending), decision: "abort" }),
  ).toMatchObject({ status: "aborted", needsReconciliation: false });
  expect(await readFile(f.sourceFile, "utf8")).toBe(f.bytes);
});

test("a running attempt refuses transfer without changing its source or publishing a receipt", async () => {
  const f = await fixture();
  await f.registry.update(f.entry.ref.id, (row) => ({
    ...row,
    runs: row.runs.map((run) => ({ ...run, status: "running", endedAt: null })),
  }));
  const current = await f.registry.entry(f.entry.ref.id);
  if (!current) throw new Error("Missing running fixture");
  const before = await readFile(f.sourceFile, "utf8");
  await expect(
    f.transfers.transfer({ ...f.input, expectedRevision: current.revision }),
  ).rejects.toMatchObject({ kind: "busy" });
  expect(await f.transfers.lookup(f.scope, f.input.operationId)).toEqual({
    found: false,
    scope: f.scope,
    operationId: f.input.operationId,
    locks: [],
  });
  expect(await readFile(f.sourceFile, "utf8")).toBe(before);
});

test("a lost source-retirement response reconciles a move through its fenced destination without retiring again", async () => {
  const f = await fixture();
  const retire = f.registry.retireTransfer.bind(f.registry);
  const interruption = vi
    .spyOn(f.registry, "retireTransfer")
    .mockImplementationOnce(async (entry) => {
      await retire(entry);
      throw new Error("Lost source-retirement response");
    });
  const pending = await f.transfers.transfer({ ...f.input, operation: "move" });
  expect(pending).toMatchObject({
    status: "reconciliation_required",
    needsReconciliation: true,
    sourceDigest: null,
    destinationMatches: true,
  });
  expect(await f.registry.list()).toEqual([]);
  const completed = await new ScheduleTransfers(f.registry).reconcile(inspectedDecision(pending));
  expect(completed).toMatchObject({
    status: "committed",
    needsReconciliation: false,
    sourceDigest: null,
  });
  expect(interruption).toHaveBeenCalledTimes(1);
  expect(await readdir(path.join(f.origin.directory, ".otto-recovery"))).toHaveLength(1);
});

test("changed retained backup bytes prevent reconciliation and leave both fenced records untouched", async () => {
  const f = await fixture();
  const interruption = interruptPublication(f.registry, 2, "after");
  const pending = await f.transfers.transfer(f.input);
  interruption.mockRestore();
  const source = await f.registry.transferBytes(pending.source);
  const destination = await f.registry.transferBytes(pending.destination);
  const backup = path.join(f.home, "schedule-transfers", f.input.operationId, "source.json");
  await writeFile(backup, "malformed retained backup");
  await expect(f.transfers.reconcile(inspectedDecision(pending))).rejects.toThrow(
    "Transfer backup is unavailable or changed",
  );
  expect(await f.registry.transferBytes(pending.source)).toBe(source);
  expect(await f.registry.transferBytes(pending.destination)).toBe(destination);
  expect(await readFile(backup, "utf8")).toBe("malformed retained backup");
});

test("copy settings does not claim the source's create or run-repair receipts as its own", async () => {
  const f = await fixture();
  await f.registry.update(f.entry.ref.id, (row) => ({
    ...row,
    otto: {
      ...row.otto!,
      creation: { operationId: "source-create", fingerprint: "a".repeat(64) },
      lastRepairReview: { at: "before", runId: "old-run", reason: "Source result inspected" },
    },
  }));
  const source = await f.registry.entry(f.entry.ref.id);
  if (!source) throw new Error("Missing reviewed source fixture");
  const before = await readFile(f.sourceFile, "utf8");
  const result = await f.transfers.transfer({ ...f.input, expectedRevision: source.revision });
  const destination = await f.registry.transferEntry(result.destination);
  expect(destination?.schedule.otto).not.toHaveProperty("creation");
  expect(destination?.schedule.otto).not.toHaveProperty("lastRepairReview");
  expect(destination?.schedule.runs).toEqual([]);
  expect(await readFile(f.sourceFile, "utf8")).toBe(before);
});
