import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ORCHESTRATION_RUN_ID_LABEL } from "@otto-code/protocol/agent-labels";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { RunStore } from "../../orchestration/run-store.js";
import { WorkflowService } from "../../orchestration/run-service.js";
import { createOttoToolCatalog } from "./otto-tools.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, maxRetries: 3, retryDelay: 50 })),
  );
});

describe("start_workflow AI Workflow binding", () => {
  test("activates the caller's pending AI Workflow instead of minting a second run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otto-tool-orchestration-"));
    temporaryDirectories.push(dir);
    const runService = new WorkflowService({
      store: new RunStore(join(dir, "runs")),
      logger: silentLogger,
    });
    const initial = await runService.createAiRun({
      title: "User-selected Workflow title",
      description: "Keep this user configuration.",
      cwd: "/workspace/project",
      workspaceId: "workspace_1",
    });
    await runService.bindAiRunConductor({
      runId: initial.id,
      conductorAgentId: "agent_planner",
      cancelConductor: async () => {},
    });

    const agentManager = {
      getAgent: vi.fn(() => ({
        id: "agent_planner",
        cwd: "/workspace/project",
        workspaceId: "workspace_1",
        labels: { [ORCHESTRATION_RUN_ID_LABEL]: initial.id },
        config: {},
      })),
      hasInFlightRun: vi.fn(() => true),
    } as unknown as AgentManager;
    const catalog = createOttoToolCatalog({
      agentManager,
      agentStorage: {} as AgentStorage,
      providerSnapshotManager: {} as ProviderSnapshotManager,
      callerAgentId: "agent_planner",
      runService,
      logger: createTestLogger(),
    });

    expect(catalog.getTool("start_orchestration")).toBeUndefined();
    expect(catalog.getTool("start_workflow")).toMatchObject({ title: "Start Workflow" });
    expect(catalog.getTool("get_orchestration_status")).toBeUndefined();
    expect(catalog.getTool("get_workflow_status")).toMatchObject({ title: "Get Workflow status" });

    const result = await catalog.executeTool("start_workflow", {
      title: "Model-selected title must not replace the user title",
      phases: [{ id: "approval", type: "gate", title: "Approve plan", task: "Approve it." }],
    });

    expect(result.isError).not.toBe(true);
    expect(runService.listRuns()).toHaveLength(1);
    expect(runService.getRun(initial.id)).toMatchObject({
      id: initial.id,
      kind: "ai",
      title: "User-selected Workflow title",
      description: "Keep this user configuration.",
      conductorAgentId: "agent_planner",
      status: "paused",
      phases: [{ id: "approval", status: "blocked" }],
    });
    expect(runService.cancelRun(initial.id)).toBe(true);

    const status = await catalog.executeTool("get_workflow_status", { runId: initial.id });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({ run: { id: initial.id, status: "canceled" } });
  });
});
