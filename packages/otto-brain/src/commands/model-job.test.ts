import { expect, it } from "vitest";
import { runHostedModelJob, type ModelJobPort } from "./model-job.js";
import { parseSweepBudgets } from "./sweep.js";

function fixture() {
  const requests: { route: string; body: unknown }[] = [];
  let supported = true;
  let state = "completed";
  let failFeed: (error: Error) => void = () => {};
  const port: ModelJobPort = {
    instanceId: "fixture",
    request: async (route, signal, body) => {
      signal.throwIfAborted();
      requests.push({ route, body });
      if (route.endsWith("capabilities")) return { jobs: supported, events: true, inventory: true };
      if (route.endsWith("models"))
        return {
          models: [
            { id: "repo/a", displayName: "Alpha" },
            { id: "repo/b", displayName: "Beta" },
          ],
          lastModelId: "repo/b",
        };
      if (route === "/__host/jobs") return { job: { id: "owned-job" } };
      if (route.includes("/status?"))
        return {
          job: { id: "owned-job", state, progress: null, result: { fixture: true }, error: null },
        };
      if (route.endsWith("cancel")) return { ok: true };
      throw new Error("Unexpected fixture request");
    },
    events: (_listener, signal) =>
      new Promise<void>((resolve, reject) => {
        failFeed = reject;
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  };
  return {
    port,
    requests,
    unsupported: () => {
      supported = false;
    },
    pending: () => {
      state = "running";
    },
    failFeed: () => failFeed(new Error("fixture disconnection")),
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it("uses host model identity and forwards explicit sweep budgets without a local scan", async () => {
  const value = fixture();
  const result = await runHostedModelJob(
    value.port,
    { operation: "sweep", model: "alp", budgets: [0, 128] },
    new AbortController().signal,
  );
  expect(result.model.id).toBe("repo/a");
  expect(value.requests.find((request) => request.route === "/__host/jobs")?.body).toEqual({
    operation: "sweep",
    modelId: "repo/a",
    budgets: [0, 128],
  });
});
it("keeps the host's saved last-model selection when no fragment is supplied", async () => {
  const value = fixture();
  const result = await runHostedModelJob(
    value.port,
    { operation: "calibrate" },
    new AbortController().signal,
  );
  expect(result.model.id).toBe("repo/b");
});
it("gates an old host before inventory reads or job admission", async () => {
  const value = fixture();
  value.unsupported();
  await expect(
    runHostedModelJob(
      value.port,
      { operation: "calibrate", model: "Alpha" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "UPDATE_HOST" });
  expect(value.requests.map((request) => request.route)).toEqual(["/__host/capabilities"]);
});
it("cancels only its own admitted job after an explicit interruption", async () => {
  const value = fixture();
  value.pending();
  const controller = new AbortController();
  const operation = runHostedModelJob(
    value.port,
    { operation: "calibrate", model: "Alpha" },
    controller.signal,
  );
  const checked = expect(operation).rejects.toMatchObject({ code: "CANCELED" });
  await flush();
  controller.abort();
  await checked;
  expect(value.requests.filter((request) => request.route.endsWith("cancel"))).toEqual([
    { route: "/__host/jobs/cancel", body: { id: "owned-job" } },
  ]);
});
it("leaves durable host work alone when only the event feed disconnects", async () => {
  const value = fixture();
  value.pending();
  const operation = runHostedModelJob(
    value.port,
    { operation: "calibrate", model: "Alpha" },
    new AbortController().signal,
  );
  const checked = expect(operation).rejects.toThrow("fixture disconnection");
  await flush();
  value.failFeed();
  await checked;
  expect(value.requests.some((request) => request.route.endsWith("cancel"))).toBe(false);
});
it("rejects malformed CLI budget lists instead of silently turning blanks into zero", () => {
  expect(parseSweepBudgets("0, 128,-1")).toEqual([0, 128, -1]);
  expect(parseSweepBudgets(undefined)).toBeUndefined();
  for (const raw of [
    "",
    "0,",
    "1.5",
    "-2",
    "Infinity",
    "9007199254740992",
    Array.from({ length: 65 }, () => "0").join(","),
  ])
    expect(() => parseSweepBudgets(raw)).toThrow("reasoning budgets");
});
