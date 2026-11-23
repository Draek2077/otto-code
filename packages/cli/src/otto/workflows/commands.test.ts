import { test, expect, vi } from "vitest";
import {
  workflowList,
  workflowStart,
  workflowControl,
  workflowSave,
} from "@getpaseo/plugin/otto/workflows";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runWorkflowRequest, createWorkflowCommand, assertScope } from "./commands.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
const target: DaemonTarget = { kind: "endpoint", host: "ws://fixture.invalid" };
async function removeFixture(root: string) {
  if (
    path.dirname(root) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith("otto-workflow-cli-")
  )
    throw new Error("Unexpected fixture cleanup");
  await rm(root, { recursive: true, force: true });
}
function client(
  available = true,
  value: unknown = { items: [], nextOffset: null, diagnostics: [], version: 0 },
) {
  return {
    getLastServerInfoMessage: () => ({
      serverId: "selected-daemon",
      features: { ottoWorkflows: available },
    }),
    invokePluginRpc: vi.fn(async () => ({
      ok: true,
      value,
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
test("actual CLI parser sends valid reviewed start and confirmed gate control contracts", async () => {
  const scope = { hostId: "selected-daemon", projectId: "project" },
    ref = { scope, kind: "run" as const, id: "run-1", location: "repository" as const };
  const host = client(true, {
    ref,
    revision: "saved",
    document: { kind: "run", value: { id: "run-1", title: "Run", status: "paused", phases: [] } },
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const run = (selected: DaemonTarget, build: Parameters<typeof runWorkflowRequest>[1]) =>
      runWorkflowRequest(selected, build, async () => host);
    await createWorkflowCommand(run).parseAsync(
      [
        "start",
        "--project",
        "project",
        "--token",
        "reviewed",
        "--operation",
        "operation-1",
        "--host",
        "ws://fixture.invalid",
        "--json",
      ],
      { from: "user" },
    );
    expect(host.invokePluginRpc).toHaveBeenLastCalledWith("otto-workflows", workflowStart.name, {
      scope,
      token: "reviewed",
      operationId: "operation-1",
    });
    await createWorkflowCommand(run).parseAsync(
      [
        "control",
        "run-1",
        "--kind",
        "run",
        "--project",
        "project",
        "--revision",
        "saved",
        "--action",
        "approve",
        "--phase",
        "gate",
        "--host",
        "ws://fixture.invalid",
        "--json",
      ],
      { from: "user" },
    );
    expect(host.invokePluginRpc).toHaveBeenLastCalledWith("otto-workflows", workflowControl.name, {
      ref,
      expectedRevision: "saved",
      action: "approve",
      phaseId: "gate",
      confirmed: true,
    });
  } finally {
    stdout.mockRestore();
  }
});
test("actual CLI save parser retains the exact update origin and revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "otto-workflow-cli-"));
  const scope = { hostId: "selected-daemon", projectId: "project" },
    ref = {
      scope,
      kind: "graph" as const,
      id: "graph",
      location: "host" as const,
      storeKey: "exact-origin",
    };
  const document = {
    kind: "graph" as const,
    value: { id: "graph", name: "Edited graph", nodes: [] },
  };
  const host = client(true, { ref, revision: "next", document });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const file = path.join(root, "document.json"),
      origin = path.join(root, "origin.json");
    await writeFile(file, JSON.stringify(document));
    await writeFile(origin, JSON.stringify(ref));
    await createWorkflowCommand((selected, build) =>
      runWorkflowRequest(selected, build, async () => host),
    ).parseAsync(
      [
        "save",
        "--input",
        file,
        "--origin",
        origin,
        "--revision",
        "saved",
        "--project",
        "project",
        "--host",
        "ws://fixture.invalid",
        "--json",
      ],
      { from: "user" },
    );
    expect(host.invokePluginRpc).toHaveBeenCalledExactlyOnceWith(
      "otto-workflows",
      workflowSave.name,
      { scope, ref, expectedRevision: "saved", document },
    );
  } finally {
    stdout.mockRestore();
    await removeFixture(root);
  }
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
    "follow",
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
