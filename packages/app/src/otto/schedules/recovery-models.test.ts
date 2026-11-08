import { expect, test, vi } from "vitest";
import { ScheduleDocument } from "@getpaseo/plugin/otto/schedules";
import { createScheduleApi } from "./api";
import { ScheduleStorageModel } from "./storage-model";
import { ScheduleTransferModel } from "./transfer-model";
import { ScheduleDetailModel } from "./detail-model";
import type { ScheduleOperation } from "./operation";
import { deferred } from "../workflows/test-fixtures";

const scope = { hostId: "host", projectId: "project" };
const document = ScheduleDocument.parse({
  ref: { scope, id: "schedule", location: "repository", storeKey: "repository:project" },
  revision: "a".repeat(64),
  schedule: {
    id: "schedule",
    name: "Task",
    prompt: "Run",
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
    cadence: { type: "every", everyMs: 60000 },
    status: "paused",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: "now",
    maxRuns: null,
    expiresAt: null,
  },
});
const storage = {
  scope,
  hostLabel: "Host",
  projectLabel: "Project",
  location: "repository",
  override: null,
  revision: "b".repeat(64),
  hostDefault: "repository",
};
const receipt = {
  found: true,
  scope,
  operationId: "transfer",
  revision: "c".repeat(64),
  source: document.ref,
  destination: { ...document.ref, location: "host", storeKey: "host:project" },
  operation: "copy",
  status: "reconciliation_required",
  needsReconciliation: true,
  recordedAt: "now",
  sourceDigest: "d".repeat(64),
  destinationDigest: null,
  sourceMatches: true,
  destinationMatches: false,
  locks: [],
};
async function idle(lane: ScheduleOperation) {
  if (!lane.getSnapshot().busy) return;
  await new Promise<void>((resolve) => {
    const release = lane.subscribe(() => {
      if (!lane.getSnapshot().busy) {
        release();
        resolve();
      }
    });
  });
}
function fixture() {
  const invoke = vi.fn(
    async (_plugin: string, method: string, _input: unknown): Promise<unknown> => {
      if (method.includes("defaults.read"))
        return { ok: true, value: { location: "repository", revision: "e".repeat(64) } };
      if (method === "schedules.storage.read.request") return { ok: true, value: storage };
      if (method.includes("history.list"))
        return { ok: true, value: { runs: [], total: 0, revision: document.revision } };
      return { ok: true, value: document };
    },
  );
  return { invoke, api: createScheduleApi({ invokePluginRpc: invoke }) };
}
test("host default and project override saves retain separate original revision domains", async () => {
  const f = fixture(),
    model = new ScheduleStorageModel(f.api, "host", "project");
  model.activate();
  await idle(model.lane);
  model.default("host");
  f.invoke.mockResolvedValueOnce({
    ok: true,
    value: { location: "host", revision: "f".repeat(64) },
  });
  await model.saveDefault();
  expect(f.invoke.mock.calls.at(-1)).toEqual([
    "otto-schedules",
    "schedules.defaults.save.request",
    { hostId: "host", expectedRevision: "e".repeat(64), location: "host" },
  ]);
  model.project("host");
  f.invoke.mockResolvedValueOnce({
    ok: true,
    value: { ...storage, override: "host", location: "host", revision: "1".repeat(64) },
  });
  await model.saveProject();
  expect(f.invoke.mock.calls.at(-1)?.[2]).toEqual({
    scope,
    expectedRevision: storage.revision,
    location: "host",
  });
  expect(model.getSnapshot().defaults?.revision).toBe("f".repeat(64));
});
test("storage conflict preserves choices and requires confirmed reload, never automatic rebasing", async () => {
  const f = fixture(),
    model = new ScheduleStorageModel(f.api, "host", "project");
  model.activate();
  await idle(model.lane);
  model.project("host");
  f.invoke.mockResolvedValueOnce({
    ok: false,
    error: { code: "conflict", message: "Peer changed storage" },
  });
  await model.saveProject();
  expect(model.getSnapshot()).toMatchObject({
    projectDraft: "host",
    storage: { revision: storage.revision },
  });
  expect(model.lane.getSnapshot().blocked).toBe(true);
  const count = f.invoke.mock.calls.length;
  await model.saveProject();
  expect(f.invoke.mock.calls).toHaveLength(count);
  await model.reload(async () => false);
  expect(model.getSnapshot().projectDraft).toBe("host");
  expect(f.invoke.mock.calls).toHaveLength(count);
  await model.reload(async () => true);
  expect(model.getSnapshot().projectDraft).toBeNull();
  expect(model.lane.getSnapshot().blocked).toBe(false);
});
test("local transfer validation can be corrected; an admitted intent cannot be replayed or retargeted", async () => {
  const f = fixture(),
    model = new ScheduleTransferModel(f.api, scope, document, "invalid intent");
  model.activate();
  await model.start(async () => true);
  expect(f.invoke).not.toHaveBeenCalled();
  expect(model.canStart()).toBe(true);
  model.operationId("transfer");
  f.invoke.mockResolvedValueOnce({
    ok: true,
    value: { ...receipt, status: "committed", needsReconciliation: false },
  });
  await model.start(async () => true);
  expect(model.canStart()).toBe(false);
  model.operationId("another");
  model.destination("repository");
  await model.start(async () => true);
  expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot()).toMatchObject({ operationId: "transfer", destination: "host" });
});
test("unknown transfer is inspected without replay; reconciliation pins exact receipt and both digests", async () => {
  const f = fixture(),
    model = new ScheduleTransferModel(f.api, scope, document, "transfer");
  model.activate();
  f.invoke.mockRejectedValueOnce(new Error("lost"));
  await model.start(async () => true);
  expect(model.lane.getSnapshot().blocked).toBe(true);
  await model.reconcile("complete", async () => true);
  expect(f.invoke).toHaveBeenCalledTimes(1);
  f.invoke.mockResolvedValueOnce({ ok: true, value: receipt });
  await model.inspect();
  expect(f.invoke.mock.calls.at(-1)?.[1]).toBe("schedules.storage.transfer.inspect.request");
  f.invoke.mockRejectedValueOnce(new Error("unknown reconciliation"));
  await model.reconcile("complete", async () => true);
  expect(f.invoke.mock.calls.at(-1)?.[2]).toEqual({
    scope,
    operationId: "transfer",
    expectedRevision: receipt.revision,
    expectedSourceDigest: receipt.sourceDigest,
    expectedDestinationDigest: null,
    decision: "complete",
  });
  expect(model.getSnapshot().receiptInspected).toBe(false);
  await model.reconcile("complete", async () => true);
  expect(f.invoke).toHaveBeenCalledTimes(3);
});
test("late transfer acknowledgements stay unconfirmed across hide/reactivation", async () => {
  const f = fixture(),
    model = new ScheduleTransferModel(f.api, scope, document, "transfer"),
    held = deferred<unknown>(),
    entered = deferred<void>();
  const release = model.activate();
  f.invoke.mockImplementationOnce(() => {
    entered.resolve();
    return held.promise;
  });
  const started = model.start(async () => true);
  await entered.promise;
  release();
  model.activate();
  expect(model.lane.getSnapshot()).toMatchObject({ busy: true, blocked: true });
  held.resolve({ ok: true, value: receipt });
  await started;
  expect(model.getSnapshot().receipt).toBeNull();
  expect(model.canStart()).toBe(false);
  expect(model.lane.getSnapshot()).toMatchObject({ busy: false, blocked: true });
});
test("run admission uses captured origin/revision and unknown outcomes require inspected reload", async () => {
  const f = fixture(),
    model = new ScheduleDetailModel(f.api, document.ref);
  model.activate();
  await idle(model.lane);
  f.invoke.mockResolvedValueOnce({ ok: true, value: { entry: document, acceptedRunId: "run" } });
  await model.control({ type: "run-once" }, async () => true);
  expect(f.invoke.mock.calls.at(-1)?.[2]).toEqual({
    ref: document.ref,
    expectedRevision: document.revision,
    command: { type: "run-once" },
  });
  expect(model.getSnapshot().acceptedRunId).toBe("run");
  f.invoke.mockRejectedValueOnce(new Error("lost"));
  await model.control({ type: "pause" }, async () => true);
  expect(model.lane.getSnapshot().blocked).toBe(true);
  const count = f.invoke.mock.calls.length;
  await model.control({ type: "run-once" }, async () => true);
  expect(f.invoke.mock.calls).toHaveLength(count);
  await model.refresh();
  expect(model.lane.getSnapshot().blocked).toBe(true);
  await model.refresh(async () => true);
  expect(model.lane.getSnapshot().blocked).toBe(false);
});
