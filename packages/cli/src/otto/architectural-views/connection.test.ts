import { expect, test } from "vitest";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import { runViewRequest, type ViewCliClient } from "./connection.js";
const target = { kind: "endpoint" as const, host: "127.0.0.1:0" };
function fixture(available = true) {
  const calls: { plugin: string; method: string; input: unknown }[] = [];
  let closes = 0;
  const client: ViewCliClient = {
    getLastServerInfoMessage: () => ({
      serverId: "selected-host",
      features: { ottoArchitecturalViews: available },
    }),
    close: async () => {
      closes++;
    },
    invokePluginRpc: async (plugin, method, input) => {
      calls.push({ plugin, method, input });
      return {
        ok: true,
        value: {
          diagramType: "architecture",
          schema: "{}",
          commonSchema: "{}",
          guidance: "Read selected source",
        },
      };
    },
  };
  return { client, calls, closes: () => closes };
}
test("CLI capability gating precedes building a request and always releases its own client", async () => {
  const f = fixture(false);
  let builds = 0;
  await expect(
    runViewRequest(
      target,
      async () => {
        builds++;
        throw new Error("must not build");
      },
      async () => f.client,
    ),
  ).rejects.toThrow("Update the selected host");
  expect(builds).toBe(0);
  expect(f.calls).toEqual([]);
  expect(f.closes()).toBe(1);
});
test("CLI requests use the exact selected daemon identity and structural contract", async () => {
  const f = fixture();
  const result = await runViewRequest(
    target,
    async (hostId) => ({
      contract: rpc.readViewContract,
      input: {
        scope: { hostId, target: { kind: "project", id: "project-a" } },
        diagramType: "architecture",
      },
    }),
    async () => f.client,
  );
  expect(result).toMatchObject({ diagramType: "architecture" });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].plugin).toBe("otto-architectural-views");
  expect(f.calls[0].input).toMatchObject({ scope: { hostId: "selected-host" } });
  expect(f.closes()).toBe(1);
});
test("unacknowledged publication prints its exact operation identity without replay", async () => {
  const f = fixture();
  f.client.invokePluginRpc = async (plugin, method, input) => {
    f.calls.push({ plugin, method, input });
    return { ok: false, error: { code: "unknown", message: "Inspect saved outcome" } };
  };
  const input = {
    scope: { hostId: "selected-host", target: { kind: "project" as const, id: "project-a" } },
    identity: {
      viewId: "system",
      origin: { location: "repository" as const, storeKey: "a".repeat(64) },
    },
    draftId: "first",
    expectedRevision: "b".repeat(64),
    operationId: "one-publication",
    userApproved: true as const,
  };
  await expect(
    runViewRequest(
      target,
      async () => ({ contract: rpc.publishViewDraft, input }),
      async () => f.client,
    ),
  ).rejects.toThrow('"operationId":"one-publication"');
  expect(f.calls).toHaveLength(1);
  expect(f.closes()).toBe(1);
});
