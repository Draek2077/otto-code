import { test, expect, vi } from "vitest";
import { workflowRead, workflowWatch } from "@getpaseo/plugin/otto/workflows";
import { followWorkflow } from "./follow.js";
const ref = {
  scope: { hostId: "host", projectId: "project" },
  kind: "run" as const,
  id: "run",
  location: "repository" as const,
};
const target = { kind: "endpoint" as const, host: "ws://fixture.invalid" };
function entry(revision: string, status: string) {
  return {
    ok: true,
    value: {
      ref,
      revision,
      document: { kind: "run", value: { id: "run", title: "Follow", status, phases: [] } },
    },
  };
}
test("following uses one connection, a versioned long poll and actual revisions until terminal", async () => {
  let reads = 0,
    watches = 0;
  const client = {
    getLastServerInfoMessage: () => ({ serverId: "host", features: { ottoWorkflows: true } }),
    close: vi.fn(async () => {}),
    invokePluginRpc: vi.fn(async (_id: string, method: string) =>
      method === workflowRead.name
        ? entry(String(++reads), reads < 3 ? "paused" : "done")
        : { ok: true, value: { version: ++watches } },
    ),
  };
  const emit = vi.fn();
  await followWorkflow(
    target,
    () => ref,
    emit,
    new AbortController().signal,
    async () => client,
  );
  expect(emit.mock.calls.map((call) => call[0].status)).toEqual(["paused", "paused", "done"]);
  expect(
    client.invokePluginRpc.mock.calls.filter((call) => call[1] === workflowWatch.name),
  ).toHaveLength(2);
  expect(client.close).toHaveBeenCalledOnce();
});
test("stopping a follower closes its own request without sending cancellation or publishing a late state", async () => {
  const controller = new AbortController();
  let rejectWatch!: (error: Error) => void;
  const waiting = new Promise<unknown>((_resolve, reject) => {
    rejectWatch = reject;
  });
  const client = {
    getLastServerInfoMessage: () => ({ serverId: "host", features: { ottoWorkflows: true } }),
    close: vi.fn(async () => {
      rejectWatch(new Error("Closed"));
    }),
    invokePluginRpc: vi.fn(async (_id: string, method: string) =>
      method === workflowRead.name ? entry("first", "running") : waiting,
    ),
  };
  const emit = vi.fn(),
    following = followWorkflow(
      target,
      () => ref,
      emit,
      controller.signal,
      async () => client,
    );
  await vi.waitFor(() => expect(client.invokePluginRpc).toHaveBeenCalledTimes(2));
  controller.abort();
  await following;
  expect(emit).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledOnce();
  expect(
    client.invokePluginRpc.mock.calls.every(
      (call) => call[1] === workflowRead.name || call[1] === workflowWatch.name,
    ),
  ).toBe(true);
});
