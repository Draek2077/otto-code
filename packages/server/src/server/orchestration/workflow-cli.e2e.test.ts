import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrchestrationGraph, Run } from "@otto-code/protocol/orchestration";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOttoDaemon, type TestOttoDaemon } from "../test-utils/otto-daemon.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../../..");
const cliEntryPoint = path.join(repositoryRoot, "packages", "cli", "src", "index.ts");

describe("Workflow Graph CLI", () => {
  let daemon: TestOttoDaemon | null = null;
  let client: DaemonClient | null = null;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    client = null;
    daemon = null;
  });

  it("runs a saved Graph through the real CLI and persists its completed run", async () => {
    daemon = await createTestOttoDaemon();
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.8.19",
    });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "workflow-cli-e2e" } });
    const workspace = await client.createWorkspace({
      source: { kind: "directory", path: daemon.ottoHome },
    });
    expect(workspace.error).toBeNull();
    expect(workspace.workspace?.workspaceDirectory).toBe(daemon.ottoHome);
    const workspaceId = workspace.workspace?.id;
    expect(workspaceId).toBeTypeOf("string");

    const graph = await client.saveOrchestrationGraph(createCliProofGraph());
    const result = await runCli([
      "workflow",
      "graph",
      "run",
      graph.id,
      "--host",
      `127.0.0.1:${daemon.port}`,
      "--cwd",
      daemon.ottoHome,
      "--orchestrator-provider",
      "claude",
      "--input",
      "question=Is the CLI execution path live?",
      "--json",
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const commandResult = JSON.parse(result.stdout) as {
      runId: string;
      graphId: string;
      agentId: string | null;
      workspaceId: string | null;
    };
    expect(commandResult.graphId).toBe(graph.id);
    expect(commandResult.runId).toMatch(/^run_/);
    expect(commandResult.agentId).toBeTypeOf("string");
    expect(commandResult.workspaceId).toBe(workspaceId);

    const run = await waitForRun(client, commandResult.runId, "done");
    expect(run).toMatchObject({
      id: commandResult.runId,
      kind: "graph",
      graphId: graph.id,
      status: "done",
      graphInputs: { question: "Is the CLI execution path live?" },
    });
    expect(run.phases).toEqual([expect.objectContaining({ id: "answer", status: "done" })]);
    // The frozen graphSnapshot is persisted with the run but deliberately not
    // sent on the wire (see toWireRun); the service tests cover it.
    expect(run.graphSnapshot).toBeUndefined();
  }, 40_000);
});

function createCliProofGraph(): OrchestrationGraph {
  return {
    id: "cli-proof-graph",
    name: "CLI proof Graph",
    inputs: [{ key: "question", label: "Question", required: true }],
    nodes: [
      { id: "root", kind: "orchestrator", title: "Orchestrator" },
      {
        id: "answer",
        kind: "agent",
        title: "Answer",
        prompt: "Answer this question: {{inputs.question}}",
        model: "claude",
      },
    ],
    edges: [{ from: "root", to: "answer" }],
  };
}

async function runCli(
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntryPoint, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function waitForRun(client: DaemonClient, runId: string, status: string): Promise<Run> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = (await client.getRunsSnapshot()).find((candidate) => candidate.id === runId);
    if (run?.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Run ${runId} did not reach ${status}`);
}
