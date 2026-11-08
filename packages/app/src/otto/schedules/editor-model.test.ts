import { expect, test, vi } from "vitest";
import { ScheduleDocument } from "@getpaseo/plugin/otto/schedules";
import { createScheduleApi } from "./api";
import { ScheduleEditorModel } from "./editor-model";

const scope = { hostId: "host", projectId: "project" };
const target = { type: "agent" as const, agentId: "00000000-0000-4000-8000-000000000001" };
const document = ScheduleDocument.parse({
  ref: { scope, id: "schedule", location: "repository", storeKey: "repository:project" },
  revision: "a".repeat(64),
  schedule: {
    id: "schedule",
    name: "Saved",
    prompt: "Task",
    target,
    cadence: { type: "cron", expression: "0 9 * * *", timezone: "UTC" },
    status: "active",
    createdAt: "now",
    updatedAt: "now",
    lastRunAt: null,
    nextRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    otto: {
      version: 1,
      scope,
      location: "repository",
      storeKey: "repository:project",
      creation: { operationId: "intent", fingerprint: "b".repeat(64) },
    },
  },
});
function fixture(existing = false) {
  const invoke = vi.fn(
    async (_plugin: string, method: string, _value: unknown): Promise<unknown> => {
      if (method.includes("preview"))
        return {
          ok: true,
          value: {
            from: "2026-11-08T00:00:00.000Z",
            next: [
              "2026-11-08T09:00:00.000Z",
              "2026-11-09T09:00:00.000Z",
              "2026-11-10T09:00:00.000Z",
            ],
            timezone: "UTC",
          },
        };
      if (method.includes("review"))
        return {
          ok: true,
          value: { target, summary: "One existing chat, normal permissions", autopilot: null },
        };
      return { ok: true, value: document };
    },
  );
  const model = new ScheduleEditorModel(
    createScheduleApi({ invokePluginRpc: invoke }),
    scope,
    "intent",
    existing ? document : null,
  );
  const close = model.activate();
  model.target(target, "Existing chat");
  model.field("prompt", "Task");
  const ready = async () => {
    await model.preview();
    await model.review();
    model.approve(true);
  };
  return { model, invoke, close, ready };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("review and preview cannot dispatch work; save needs a separate explicit approval", async () => {
  const f = fixture();
  expect(await f.model.save()).toBeNull();
  await f.model.preview();
  await f.model.review();
  expect(await f.model.save()).toBeNull();
  expect(f.invoke.mock.calls.map((row) => row[1])).toEqual([
    "schedules.cadence.preview.request",
    "schedules.target.review.request",
  ]);
  f.model.approve(true);
  expect(await f.model.save()).toEqual(document);
  expect(f.invoke.mock.calls.at(-1)?.[2]).toMatchObject({
    operationId: "intent",
    draft: { runOnCreate: false },
  });
});
test("target and cadence edits invalidate their respective reviews, never reconstruct the draft", async () => {
  const f = fixture();
  await f.ready();
  f.model.field("name", "Typed name");
  f.model.cadence({ type: "cron", expression: "0 10 * * *", timezone: "UTC" });
  expect(f.model.canSave()).toBe(false);
  expect(f.model.getSnapshot().fields.name).toBe("Typed name");
  await f.model.preview();
  expect(f.model.canSave()).toBe(true);
  f.model.target(target, "Captured label");
  expect(f.model.getSnapshot()).toMatchObject({
    review: null,
    approved: false,
    targetLabel: "Captured label",
  });
});
test("one write retains its originating revision and cannot be doubled by another submit", async () => {
  const f = fixture(true);
  await f.ready();
  const held = deferred<unknown>();
  f.invoke.mockImplementationOnce(() => held.promise);
  const saving = f.model.save();
  expect(await f.model.save()).toBeNull();
  f.model.field("prompt", "Must not replace in-flight draft");
  expect(f.invoke.mock.calls.at(-1)?.[2]).toMatchObject({
    expectedRevision: document.revision,
    ref: document.ref,
    draft: { prompt: "Task" },
  });
  held.resolve({ ok: true, value: { ...document, revision: "c".repeat(64) } });
  await saving;
  expect(f.model.getSnapshot().document?.revision).toBe("c".repeat(64));
});
test("unknown save keeps draft and nonce blocked; inspection is read-only and does not rebase", async () => {
  const f = fixture();
  await f.ready();
  f.invoke.mockRejectedValueOnce(new Error("private transport error"));
  await f.model.save();
  expect(f.model.getSnapshot()).toMatchObject({ blocked: true, fields: { prompt: "Task" } });
  expect(await f.model.save()).toBeNull();
  await f.model.inspect();
  expect(f.invoke.mock.calls.at(-1)?.[1]).toBe("schedules.document.created.read.request");
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    inspected: document,
    document: null,
  });
  await f.model.reloadInspected(async () => true);
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: false,
    document,
    review: null,
    approved: false,
    generation: 1,
  });
  expect(f.model.operationId).toBe("intent");
});
test("a missing inspection result cannot authorize replay of an unconfirmed create", async () => {
  const f = fixture();
  await f.ready();
  f.invoke.mockRejectedValueOnce(new Error("lost"));
  await f.model.save();
  f.invoke.mockResolvedValueOnce({ ok: true, value: null });
  await f.model.inspect();
  await f.model.reloadInspected(async () => true);
  expect(f.model.getSnapshot().blocked).toBe(true);
  expect(await f.model.save()).toBeNull();
});
test("host rejection is conservatively blocked until explicit origin inspection and reload", async () => {
  const f = fixture(true);
  await f.ready();
  f.invoke.mockResolvedValueOnce({
    ok: false,
    error: { code: "conflict", message: "Peer changed the record" },
  });
  await f.model.save();
  expect(f.model.getSnapshot()).toMatchObject({ blocked: true, document });
  const peer = {
    ...document,
    revision: "d".repeat(64),
    schedule: { ...document.schedule, prompt: "Peer prompt" },
  };
  f.invoke.mockResolvedValueOnce({ ok: true, value: peer });
  await f.model.inspect();
  expect(f.model.getSnapshot().fields.prompt).toBe("Task");
  await f.model.reloadInspected(async () => true);
  expect(f.model.getSnapshot().fields.prompt).toBe("Peer prompt");
});
test("hidden in-flight writes retain their lock and require reload without adopting a late acknowledgement", async () => {
  const f = fixture();
  await f.ready();
  const held = deferred<unknown>();
  f.invoke.mockImplementationOnce(() => held.promise);
  const saving = f.model.save();
  f.close();
  const closeAgain = f.model.activate();
  expect(f.model.getSnapshot()).toMatchObject({ blocked: true, busy: true });
  expect(await f.model.save()).toBeNull();
  held.resolve({ ok: true, value: document });
  expect(await saving).toBeNull();
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    busy: false,
    document: null,
    saved: null,
  });
  closeAgain();
});
test("late read-only review is ignored across reactivation and never grants approval", async () => {
  const f = fixture();
  const held = deferred<unknown>();
  f.invoke.mockImplementationOnce(() => held.promise);
  const reviewing = f.model.review();
  f.close();
  f.model.activate();
  held.resolve({ ok: true, value: { target, summary: "stale", autopilot: null } });
  await reviewing;
  expect(f.model.getSnapshot()).toMatchObject({
    busy: false,
    blocked: false,
    review: null,
    approved: false,
  });
});
test("a reload confirmation cannot replace a draft after its activation ended", async () => {
  const f = fixture(true);
  f.model.field("prompt", "Local draft");
  await f.model.inspect();
  const confirmation = deferred<boolean>(),
    pending = f.model.reloadInspected(() => confirmation.promise);
  f.close();
  f.model.activate();
  confirmation.resolve(true);
  await pending;
  expect(f.model.getSnapshot()).toMatchObject({ generation: 0, fields: { prompt: "Local draft" } });
});
