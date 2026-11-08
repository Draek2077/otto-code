import { expect, test, vi } from "vitest";
import { createScheduleApi } from "./api";

const scope = { hostId: "host", projectId: "project" };
const ref = {
  scope,
  id: "schedule",
  location: "repository" as const,
  storeKey: "schedules:repository:project",
};
const document = {
  ref,
  revision: "b".repeat(64),
  schedule: {
    id: ref.id,
    name: null,
    prompt: "Task",
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
    cadence: { type: "every", everyMs: 60000 },
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
      location: ref.location,
      storeKey: ref.storeKey,
      creation: { operationId: "create-intent", fingerprint: "a".repeat(64) },
    },
  },
};
test("list and observation use the existing daemon transport with structurally validated scopes and versions", async () => {
  const page = { items: [], total: 0, diagnostics: [], diagnosticTotal: 0, version: 3 };
  const invokePluginRpc = vi.fn(async (_plugin: string, method: string) => ({
    ok: true,
    value: method.includes("watch") ? { version: 3 } : page,
  }));
  const api = createScheduleApi({ invokePluginRpc });
  expect(await api.list({ scope })).toEqual(page);
  expect(await api.watch({ scope, version: 2 })).toEqual({ version: 3 });
  expect(invokePluginRpc.mock.calls).toEqual([
    ["otto-schedules", "schedules.library.list.request", { scope }],
    ["otto-schedules", "schedules.library.watch.request", { scope, version: 2 }],
  ]);
});
test("local invalid input is distinguished from an unconfirmed write and never reaches transport", async () => {
  const invokePluginRpc = vi.fn(async () => ({}));
  const api = createScheduleApi({ invokePluginRpc });
  await expect(
    api.control({ ref, expectedRevision: "invalid", command: { type: "pause" } }),
  ).rejects.toMatchObject({ code: "invalid", origin: "local-validation" });
  expect(invokePluginRpc).not.toHaveBeenCalled();
});
test("typed host rejections retain their actionable message without claiming a pre-mutation rejection", async () => {
  const api = createScheduleApi({
    invokePluginRpc: async () => ({
      ok: false,
      error: { code: "conflict", message: "Schedule changed. Reload before applying this action." },
    }),
  });
  await expect(
    api.control({ ref, expectedRevision: "a".repeat(64), command: { type: "pause" } }),
  ).rejects.toMatchObject({
    code: "conflict",
    origin: "host-reply",
    message: "Schedule changed. Reload before applying this action.",
  });
});
test("a lost response is not retried and raw transport details are not presented to users", async () => {
  const invokePluginRpc = vi.fn(async () => {
    throw new Error("private transport detail");
  });
  const api = createScheduleApi({ invokePluginRpc });
  await expect(
    api.control({ ref, expectedRevision: "a".repeat(64), command: { type: "run-once" } }),
  ).rejects.toMatchObject({
    code: "unavailable",
    origin: "transport",
    message:
      "The owning host did not confirm this request. Reconnect and inspect the saved Schedule before another write.",
  });
  expect(invokePluginRpc).toHaveBeenCalledTimes(1);
});
test("a malformed success response remains unconfirmed instead of being accepted or retried", async () => {
  const invokePluginRpc = vi.fn(async () => ({ ok: true, value: { saved: true } }));
  const api = createScheduleApi({ invokePluginRpc });
  await expect(
    api.control({ ref, expectedRevision: "a".repeat(64), command: { type: "pause" } }),
  ).rejects.toMatchObject({ origin: "response-validation" });
  expect(invokePluginRpc).toHaveBeenCalledTimes(1);
});

test("run-once acknowledges only an exact-origin document with a durable run identity", async () => {
  const invokePluginRpc = vi.fn(async () => ({
    ok: true,
    value: { entry: document, acceptedRunId: "durable-run" },
  }));
  const api = createScheduleApi({ invokePluginRpc });
  expect(
    await api.control({ ref, expectedRevision: "a".repeat(64), command: { type: "run-once" } }),
  ).toMatchObject({ entry: document, acceptedRunId: "durable-run" });
  invokePluginRpc.mockResolvedValueOnce({
    ok: true,
    value: { entry: document, acceptedRunId: "" },
  });
  await expect(
    api.control({ ref, expectedRevision: "a".repeat(64), command: { type: "run-once" } }),
  ).rejects.toMatchObject({ origin: "response-validation" });
  expect(invokePluginRpc).toHaveBeenCalledTimes(2);
});
test("a reply for another origin cannot replace the selected Schedule", async () => {
  const api = createScheduleApi({
    invokePluginRpc: async () => ({
      ok: true,
      value: { ...document, ref: { ...ref, scope: { ...scope, hostId: "other" } } },
    }),
  });
  await expect(api.read(ref)).rejects.toMatchObject({ origin: "response-validation" });
});
test("create preserves the explicit operation nonce and accepts only its corresponding saved record", async () => {
  const invokePluginRpc = vi.fn(async () => ({ ok: true, value: document }));
  const api = createScheduleApi({ invokePluginRpc });
  const input = {
    scope,
    operationId: "create-intent",
    draft: {
      name: null,
      prompt: "Task",
      target: { type: "agent" as const, agentId: "00000000-0000-4000-8000-000000000001" },
      cadence: { type: "every" as const, everyMs: 60000 },
      maxRuns: null,
      expiresAt: null,
      runOnCreate: false,
    },
  };
  expect(await api.create(input)).toEqual(document);
  expect(invokePluginRpc.mock.calls[0]).toEqual([
    "otto-schedules",
    "schedules.document.create.request",
    input,
  ]);
  await expect(api.create({ ...input, operationId: "different-intent" })).rejects.toMatchObject({
    origin: "response-validation",
  });
});
