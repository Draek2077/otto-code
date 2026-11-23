import { beforeEach, afterEach, describe, test, expect } from "vitest";
import { AgentManager } from "../../agent/agent-manager.js";
import { createTestAgentClient } from "../../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { workflowFixture } from "./test-utils/fixture.js";
import { workflowTurnOptions } from "./turn-authority.js";
import { WORKFLOW_RUN_LABEL } from "./labels.js";
import { attachWorkflowLaunchOwner } from "./provider-policy.js";

describe("Paseo AgentManager with the narrow Workflow ownership seams", () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;
  let manager: AgentManager;
  const ids: string[] = [];
  beforeEach(async () => {
    f = await workflowFixture();
    manager = new AgentManager({
      clients: { codex: createTestAgentClient("codex") },
      logger: createTestLogger(),
    });
  });
  afterEach(async () => {
    for (const id of ids.splice(0)) await manager.closeAgent(id);
    await manager.flush();
    await f.cleanup();
  });
  async function create(owned: boolean) {
    const agent = await manager.createAgent(
      { provider: "codex", model: "gpt-5", cwd: f.repo, modeId: "bypassPermissions" },
      undefined,
      {
        workspaceId: "workspace",
        ...(owned
          ? {
              labels: { [WORKFLOW_RUN_LABEL]: "run" },
              owner: {
                kind: "daemon" as const,
                daemonId: "host",
                executionId: "otto-workflow:instance:run:worker:worker",
              },
            }
          : {}),
      },
    );
    ids.push(agent.id);
    return agent;
  }
  test("ordinary chats still run, change modes/models and continue alongside fenced worker history", async () => {
    const normal = await create(false);
    const worker = await create(true);
    await manager.runAgent(normal.id, "Hello");
    expect(() => manager.streamAgent(worker.id, "Unowned prompt")).toThrow("owning run");
    await manager.setAgentMode(normal.id, "default");
    await manager.setAgentModel(normal.id, "gpt-5");
    await manager.runAgent(normal.id, "Hello again");
    expect(manager.getAgent(normal.id)?.lifecycle).toBe("idle");
    expect(manager.hasInFlightRun(normal.id)).toBe(false);
    expect(manager.getAgent(worker.id)?.lifecycle).toBe("idle");
  });
  test("a revoked Workflow iterator releases its own Paseo pending run without starting a turn", async () => {
    const worker = await create(true);
    let active = true;
    const iterator = manager.streamAgent(
      worker.id,
      "Managed task",
      workflowTurnOptions(worker.id, () => active),
    );
    expect(manager.hasInFlightRun(worker.id)).toBe(true);
    active = false;
    await expect(iterator.next()).rejects.toThrow("owning run");
    expect(manager.hasInFlightRun(worker.id)).toBe(false);
    expect(manager.getAgent(worker.id)?.lifecycle).toBe("idle");
  });
  test("replacement, steering, out-of-band commands and config reload cannot bypass the worker ceiling", async () => {
    const worker = await create(true);
    await expect(manager.replaceAgentRun(worker.id, "Replace")).rejects.toThrow("Workflow");
    await expect(manager.steerAgentRun(worker.id, "Steer")).rejects.toThrow("Workflow");
    await expect(manager.steerOrReplaceActiveTurn(worker.id, "Steer")).rejects.toThrow("Workflow");
    expect(() => manager.tryRunOutOfBand(worker.id, "/command")).toThrow("Workflow");
    await expect(manager.reloadAgentSession(worker.id)).rejects.toThrow("captured");
    await expect(manager.setAgentMode(worker.id, "bypassPermissions")).rejects.toThrow("captured");
    await expect(manager.setAgentModel(worker.id, "other")).rejects.toThrow("captured");
    expect(manager.hasInFlightRun(worker.id)).toBe(false);
  });
  test("conductor planning stays interactive, then admitted execution accepts only host turns", async () => {
    const conductor = await create(false);
    let admitted = false;
    const detach = attachWorkflowLaunchOwner(manager, {
      binding: () => null,
      active: () => true,
      family: () => "codex",
      controlsConductor: (id) => id === conductor.id && admitted,
    });
    try {
      await manager.runAgent(conductor.id, "Clarify");
      admitted = true;
      expect(() => manager.streamAgent(conductor.id, "Overlap")).toThrow("owning run");
      await expect(manager.replaceAgentRun(conductor.id, "Replace")).rejects.toThrow("Workflow");
      const iterator = manager.streamAgent(
        conductor.id,
        "Aggregate",
        workflowTurnOptions(conductor.id, () => admitted),
      );
      for await (const _event of iterator) {
        /* Consume through Paseo's ordinary turn lifecycle. */
      }
      expect(manager.hasInFlightRun(conductor.id)).toBe(false);
      admitted = false;
      await manager.runAgent(conductor.id, "Independent follow-up");
    } finally {
      detach();
    }
  });
});
