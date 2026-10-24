import { expect, it, vi } from "vitest";
import { BrainOwnerRpc, type BrainRpcClient } from "./owner-rpc.js";

function frame(cursor: string, revision = "origin") {
  return {
    ok: true,
    value: {
      controlRevision: revision,
      cursor,
      connection: "connecting",
      status: null,
      logs: [],
      firstLogIndex: 10,
      nextLogIndex: 10,
      error: null,
    },
  };
}
function client(invoke: BrainRpcClient["invokePluginRpc"]): BrainRpcClient {
  return { getLastServerInfoMessage: () => null, invokePluginRpc: invoke };
}

it("keeps one status lease through connecting frames and releases it once on cancellation", async () => {
  const controller = new AbortController();
  let reads = 0;
  const invoke = vi.fn<BrainRpcClient["invokePluginRpc"]>(async (_plugin, method) => {
    if (method === "brain.status.release") return { ok: true, value: { released: true } };
    if (method !== "brain.status.wait") throw new Error("Unexpected fixture call");
    if (++reads === 2) controller.abort();
    return frame(`cursor-${reads}`);
  });
  const receive = vi.fn();
  await new BrainOwnerRpc(client(invoke), "origin").events(receive, controller.signal);
  expect(receive).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(3);
  const first: unknown = invoke.mock.calls[0][2];
  expect(invoke.mock.calls[1][2]).toEqual(
    expect.objectContaining({ cursor: "cursor-1", afterLogIndex: 10, instanceId: null }),
  );
  if (!first || typeof first !== "object" || !("leaseId" in first))
    throw new Error("Missing lease");
  expect(invoke.mock.calls[2]).toEqual([
    "otto-brain",
    "brain.status.release",
    { leaseId: first.leaseId },
  ]);
});

it("does not follow a connection changed by a peer and still releases its exact lease", async () => {
  const invoke = vi.fn<BrainRpcClient["invokePluginRpc"]>(async (_plugin, method) =>
    method === "brain.status.release"
      ? { ok: true, value: { released: true } }
      : frame("changed", "different-origin"),
  );
  await expect(
    new BrainOwnerRpc(client(invoke), "origin").events(vi.fn(), new AbortController().signal),
  ).rejects.toMatchObject({ status: "conflict" });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1]).toBe("brain.status.release");
});

it("pins a command to its origin and cancels only its wait when a late admission settles", async () => {
  const controller = new AbortController();
  let settle!: (value: unknown) => void;
  const invoke = vi.fn<BrainRpcClient["invokePluginRpc"]>(async (_plugin, method) => {
    if (method === "brain.resources.release") return { ok: true, value: { released: true } };
    return new Promise((resolve) => {
      settle = resolve;
    });
  });
  const pending = new BrainOwnerRpc(client(invoke), "origin")
    .command({ operation: "inventory" }, "owner-lifetime", controller.signal)
    .catch((error: unknown) => error);
  controller.abort();
  settle({ ok: true, value: { admitted: true } });
  expect(await pending).toBeInstanceOf(Error);
  expect(invoke.mock.calls[0][2]).toEqual(
    expect.objectContaining({
      connectionRevision: "origin",
      instanceId: "owner-lifetime",
      request: { operation: "inventory" },
      requestId: expect.any(String),
    }),
  );
  const first: unknown = invoke.mock.calls[0][2];
  if (!first || typeof first !== "object" || !("requestId" in first))
    throw new Error("Missing request");
  expect(invoke.mock.calls[1]).toEqual([
    "otto-brain",
    "brain.resources.release",
    { requestId: first.requestId },
  ]);
  expect(invoke).toHaveBeenCalledTimes(2);
});
