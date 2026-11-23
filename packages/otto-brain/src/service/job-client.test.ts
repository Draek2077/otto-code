import { expect, it } from "vitest";
import { followBrainJob, type BrainJobTransport } from "./job-client.js";
import type { BrainHostEvent } from "./event-decoder.js";

function fixture() {
  let receive: (event: BrainHostEvent) => void = () => {};
  let state = "queued";
  let reads = 0;
  let closed = 0;
  const transport: BrainJobTransport = {
    instanceId: "fixture",
    request: async () => {
      reads++;
      return { job: { id: "job", state, progress: null, result: null, error: null } };
    },
    events: (listener, signal) =>
      new Promise<void>((resolve) => {
        receive = listener;
        signal.addEventListener(
          "abort",
          () => {
            closed++;
            resolve();
          },
          { once: true },
        );
      }),
  };
  return {
    transport,
    reads: () => reads,
    closed: () => closed,
    state: (value: string) => {
      state = value;
    },
    event: (jobRevision: number, instanceId = "fixture") =>
      receive({ event: "status", data: { instanceId, jobRevision } }),
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it("reads once initially and on changed job revisions, then releases its feed", async () => {
  const value = fixture();
  const following = followBrainJob(value.transport, "job", new AbortController().signal);
  await flush();
  expect(value.reads()).toBe(1);
  value.event(1);
  await flush();
  value.event(1);
  await flush();
  expect(value.reads()).toBe(2);
  value.state("completed");
  value.event(2);
  expect((await following).state).toBe("completed");
  expect(value.closed()).toBe(1);
});

it("disconnects safely if the owning host lifetime changes", async () => {
  const value = fixture();
  const following = followBrainJob(value.transport, "job", new AbortController().signal);
  const checked = expect(following).rejects.toThrow("lifetime");
  value.event(1, "replacement");
  await checked;
  expect(value.closed()).toBe(1);
});

it("aborting the waiter releases demand without submitting a job cancellation", async () => {
  const value = fixture();
  const controller = new AbortController();
  const following = followBrainJob(value.transport, "job", controller.signal);
  const checked = expect(following).rejects.toThrow("fixture stop");
  controller.abort(new Error("fixture stop"));
  await checked;
  expect(value.closed()).toBe(1);
  expect(value.reads()).toBe(1);
});
