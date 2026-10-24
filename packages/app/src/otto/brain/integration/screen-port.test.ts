import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { BrainConnectionState } from "./connection-state";
import { BrainRpc } from "./rpc";
import { BrainScreenFacade } from "./screen-port";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function fixture() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const resourceReplies = new Map<string, (reply: unknown) => void>();
  const statusReplies = new Map<string, (reply: unknown) => void>();
  const core = new BrainConnectionState(
    new BrainRpc(async (method, input) => {
      calls.push({ method, input });
      if (method === "brain.status.wait") {
        const { leaseId } = z.object({ leaseId: z.string() }).parse(input);
        return new Promise((resolve) => statusReplies.set(leaseId, resolve));
      }
      if (method === "brain.status.release") {
        const { leaseId } = z.object({ leaseId: z.string() }).parse(input);
        statusReplies.get(leaseId)?.({
          ok: false,
          error: { kind: "unavailable", message: "Released" },
        });
        statusReplies.delete(leaseId);
        return { ok: true, value: { released: true } };
      }
      if (method === "brain.resources.release") {
        const { requestId } = z.object({ requestId: z.string() }).parse(input);
        resourceReplies.get(requestId)?.({
          ok: false,
          error: { kind: "unavailable", message: "Read canceled" },
        });
        resourceReplies.delete(requestId);
        return { ok: true, value: { released: true } };
      }
      if (method === "brain.bootstrap")
        return {
          ok: true,
          value: {
            connection: {
              version: 1,
              revision: "connection",
              config: {
                enabled: true,
                autoStart: false,
                mode: "local",
                remote: { host: "", port: 1234, secure: false, certFingerprint: null },
              },
              credential: { stored: false, effectiveSource: "none" },
            },
            owner: null,
            ownerError: null,
            localRunning: false,
            endpoint: null,
          },
        };
      const request = z
        .object({ resource: z.string().optional(), action: z.string().optional() })
        .parse(input);
      if (method === "brain.query") {
        if (request.resource === "resources") {
          const { requestId } = z.object({ requestId: z.string() }).parse(input);
          return new Promise((resolve) => resourceReplies.set(requestId, resolve));
        }
        if (request.resource === "inventory")
          return { ok: true, value: { models: [], disk: null, lastModelId: "last-model" } };
        if (request.resource === "catalog") return { ok: true, value: { models: [] } };
        if (request.resource === "jobs") return { ok: true, value: { jobs: [] } };
      }
      if (request.action === "runtime-candidate")
        return { ok: true, value: { id: "opaque-candidate", build: "latest", variant: "auto" } };
      if (request.action === "install-runtime" || request.action === "job")
        return {
          ok: true,
          value: {
            job: {
              id: "job",
              operation: request.action === "job" ? "benchmark" : "runtime-install",
              state: "queued",
              subject: { modelId: null, catalogModelId: null, repo: null, quant: null },
              createdAt: "created",
              startedAt: null,
              finishedAt: null,
              error: null,
              progress: null,
            },
          },
        };
      return { ok: true, value: { accepted: true } };
    }),
  );
  const screen = new BrainScreenFacade(
    core,
    { serverId: "daemon", label: "Host" },
    { openBrain() {}, openSettings() {} },
  );
  cleanup.push(() => {
    screen.close();
    core.close();
  });
  return { core, screen, calls, resourceReplies };
}
test("Overview resource readers share one request and hiding the last reader releases that exact request", async () => {
  const f = fixture();
  await f.core.refresh();
  const first = f.screen.retain("statusResources");
  const second = f.screen.retain("statusResources");
  expect(f.resourceReplies.size).toBe(1);
  first();
  expect(f.calls.filter((call) => call.method === "brain.resources.release")).toHaveLength(0);
  second();
  for (let index = 0; index < 12; index++) await Promise.resolve();
  expect(f.calls.filter((call) => call.method === "brain.resources.release")).toHaveLength(1);
  expect(f.resourceReplies.size).toBe(0);
});
test("constructing the screen facade and its icon bridge is passive", () => {
  const f = fixture();
  expect(f.calls).toEqual([]);
  const unsubscribe = f.screen.subscribe(() => {});
  expect(f.screen.getSnapshot().host.serverId).toBe("daemon");
  expect(f.screen.ui.getSnapshot().serverId).toBe("daemon");
  expect(f.calls).toEqual([]);
  unsubscribe();
});
test("model controls call typed host operations and coalesce their canonical inventory refresh", async () => {
  const f = fixture();
  await f.core.refresh();
  f.calls.length = 0;
  await f.screen.operations.loadModel("owner/model?x=1");
  expect(f.calls[0]).toEqual({
    method: "brain.action",
    input: { action: "load", modelId: "owner/model?x=1" },
  });
  expect(
    f.calls.filter(
      (call) => call.method === "brain.query" && JSON.stringify(call.input).includes("inventory"),
    ),
  ).toHaveLength(1);
});
test("runtime acquisition submits the host-issued candidate and publishes the actual accepted job", async () => {
  const f = fixture();
  await f.core.refresh();
  const job = await f.screen.operations.installRuntime(null);
  expect(f.calls.slice(-2)).toEqual([
    { method: "brain.action", input: { action: "runtime-candidate", build: "latest" } },
    { method: "brain.action", input: { action: "install-runtime", runtimeId: "opaque-candidate" } },
  ]);
  expect(f.screen.getSnapshot().jobs.data).toEqual([job]);
});
test("benchmark with no explicit model retains the host's last-model selection", async () => {
  const f = fixture();
  await f.core.refresh();
  await f.screen.operations.benchmark(null);
  expect(f.calls.at(-1)).toEqual({
    method: "brain.action",
    input: { action: "job", operation: "benchmark", modelId: "last-model" },
  });
});
