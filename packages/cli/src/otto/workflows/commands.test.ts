import { test, expect, vi } from "vitest";
import { workflowList } from "@getpaseo/plugin/otto/workflows";
import { runWorkflowRequest, createWorkflowCommand, assertScope } from "./commands.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
const target: DaemonTarget = { kind: "endpoint", host: "ws://fixture.invalid" };
function client(available = true) {
  return {
    getLastServerInfoMessage: () => ({
      serverId: "selected-daemon",
      features: { ottoWorkflows: available },
    }),
    invokePluginRpc: vi.fn(async () => ({
      ok: true,
      value: { items: [], nextOffset: null, diagnostics: [], version: 0 },
    })),
    close: vi.fn(async () => {}),
  };
}
test("Workflow CLI binds the selected daemon, validates envelopes, and closes its own connection", async () => {
  const host = client();
  const result = await runWorkflowRequest(
    target,
    async (hostId) => ({
      contract: workflowList,
      input: { scope: { hostId, projectId: "project" }, kind: "definition" },
    }),
    async () => host,
  );
  expect(result).toEqual({ items: [], nextOffset: null, diagnostics: [], version: 0 });
  expect(host.invokePluginRpc).toHaveBeenCalledWith("otto-workflows", workflowList.name, {
    scope: { hostId: "selected-daemon", projectId: "project" },
    kind: "definition",
  });
  expect(host.close).toHaveBeenCalledOnce();
});
test("old hosts receive no Workflow action and transport errors still close only the request connection", async () => {
  const host = client(false);
  await expect(
    runWorkflowRequest(
      target,
      async () => ({ contract: workflowList, input: {} }),
      async () => host,
    ),
  ).rejects.toThrow("Update");
  expect(host.invokePluginRpc).not.toHaveBeenCalled();
  expect(host.close).toHaveBeenCalledOnce();
});
test("generic operation calls cannot target another project or host", () => {
  const expected = { hostId: "selected", projectId: "project" };
  expect(() =>
    assertScope({ ref: { scope: { hostId: "other", projectId: "project" } } }, expected),
  ).toThrow("selected daemon");
  expect(() =>
    assertScope({ source: { scope: { hostId: "selected", projectId: "other" } } }, expected),
  ).toThrow("selected daemon");
  expect(() => assertScope({ scope: expected }, expected)).not.toThrow();
});
test("Workflow CLI exposes full structural discovery plus focused library and execution commands without effects", () => {
  expect(createWorkflowCommand().commands.map((command) => command.name())).toEqual([
    "operations",
    "ls",
    "inspect",
    "save",
    "validate",
    "review",
    "start",
    "control",
    "delete",
    "export",
    "storage",
    "call",
  ]);
});
