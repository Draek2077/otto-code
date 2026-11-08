import path from "node:path";
import { writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { AgentManager } from "../../agent/agent-manager.js";
import { AgentStorage } from "../../agent/agent-storage.js";
import { createTestAgentClient } from "../../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { workflowFixture } from "../workflows/test-utils/fixture.js";
import { deferred } from "../workflows/test-utils/host-fixture.js";
import { ScheduleService } from "../../schedule/service.js";
import { createPersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { ScheduleTarget } from "./types.js";
import { ScheduleStores } from "./stores.js";
import { ScheduleRegistry } from "./registry.js";
import { ScheduleRuntime, ScheduleExecutionError } from "./runtime.js";
import { ScheduleNativeOwner } from "./native-owner.js";
import { stampScheduleRun } from "./lifecycle.js";
import { ScheduleError } from "./files.js";

async function fixture() {
  const f = await workflowFixture();
  const logger = createTestLogger();
  const agentStorage = new AgentStorage(path.join(f.home, "agents"), logger);
  await agentStorage.initialize();
  const turn = deferred<void>();
  const started = deferred<void>();
  const client = createTestAgentClient("codex", {
    beforeTurnComplete: async () => {
      started.resolve();
      await turn.promise;
    },
  });
  const manager = new AgentManager({
    registry: agentStorage,
    clients: { codex: client },
    logger,
    rescueTimeouts: { interruptSessionMs: 5 },
  });
  const agent = await manager.createAgent(
    { provider: "codex", cwd: f.repo, title: "Test chat" },
    undefined,
    { workspaceId: "workspace-1" },
  );
  const stores = new ScheduleStores({
    home: f.home,
    hostId: f.scope.hostId,
    hostLabel: "Fixture",
    metadata: f.metadata,
  });
  const registry = new ScheduleRegistry({
    stores,
    projects: async () => [{ projectId: f.scope.projectId }],
  });
  const validate = vi.fn<() => Promise<void>>(async () => {});
  const lateError = vi.fn();
  const native = new ScheduleNativeOwner({ registry, manager, validate, onLateError: lateError });
  const runtime = new ScheduleRuntime({
    native,
    prepare: async () => {
      throw new Error("Unexpected extended target");
    },
  });
  const archived: string[] = [];
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "scheduled-workspace",
    projectId: f.scope.projectId,
    cwd: f.repo,
    kind: "directory",
    displayName: "Fixture",
    title: "Scheduled",
    branch: null,
    baseBranch: null,
    createdAt: "now",
    updatedAt: "now",
    archivedAt: null,
  });
  const scheduler = new ScheduleService({
    paseoHome: f.home,
    logger,
    agentStorage,
    agentManager: manager,
    store: registry,
    otto: runtime,
    createDirectoryWorkspace: async () => workspace,
    createPaseoWorktreeWorkspace: async () => {
      throw new Error("No worktrees in fixture");
    },
    archiveWorkspace: async (id) => {
      archived.push(id);
    },
    createAgent: async (input) => {
      if (input.kind !== "mcp") throw new Error("Expected native Schedule create port");
      const snapshot = await manager.createAgent(
        { ...input.config, provider: "codex", cwd: input.cwd ?? f.repo },
        undefined,
        { workspaceId: input.workspaceId, labels: input.labels },
      );
      return {
        snapshot,
        liveSnapshot: snapshot,
        initialPromptStarted: false,
        initialPromptError: null,
      };
    },
  });
  const create = async (
    target: ScheduleTarget = { type: "agent", agentId: agent.id },
    legacy = false,
  ) => {
    const origin = await stores.selected(f.scope);
    return scheduler.create({
      prompt: "Schedule work",
      cadence: { type: "every", everyMs: 60000 },
      target,
      runOnCreate: false,
      ...(legacy
        ? {}
        : {
            otto: {
              version: 1,
              scope: f.scope,
              location: origin.location,
              storeKey: origin.storeKey,
            },
          }),
    });
  };
  return {
    ...f,
    manager,
    agent,
    registry,
    scheduler,
    native,
    runtime,
    validate,
    lateError,
    turn,
    started,
    create,
    archived,
    async cleanup() {
      turn.resolve();
      await scheduler.stop();
      for (const item of manager.listAgents()) await manager.closeAgent(item.id);
      await f.cleanup();
    },
  };
}

test("native Schedule owns an exact existing-chat turn and stamps its deep link before execution", async () => {
  const f = await fixture();
  let running: Promise<unknown> | null = null;
  try {
    const schedule = await f.create();
    running = f.scheduler.runOnce(schedule.id);
    await f.started.promise;
    const current = await f.scheduler.inspect(schedule.id);
    expect(current.runs[0]).toMatchObject({
      agentId: f.agent.id,
      workspaceId: "workspace-1",
      status: "running",
      otto: {
        result: { kind: "chat", agentId: f.agent.id },
        resolved: { kind: "agent", id: f.agent.id },
      },
    });
    await expect(f.scheduler.runOnce(schedule.id)).rejects.toThrow("already running");
    f.turn.resolve();
    await running;
    expect((await f.scheduler.inspect(schedule.id)).runs[0]).toMatchObject({
      status: "succeeded",
      otto: { disposition: "succeeded" },
    });
  } finally {
    f.turn.resolve();
    await Promise.allSettled([running]);
    await f.cleanup();
  }
});
test("a manual turn winning native idle admission is never steered or replaced", async () => {
  const f = await fixture();
  let manual: Promise<unknown> | null = null;
  try {
    const schedule = await f.create();
    manual = f.manager.runAgent(f.agent.id, "Manual work");
    await f.started.promise;
    const replace = vi.spyOn(f.manager, "replaceAgentRun");
    const steer = vi.spyOn(f.manager, "steerOrReplaceActiveTurn");
    await f.scheduler.runOnce(schedule.id);
    const current = await f.scheduler.inspect(schedule.id);
    expect(current.status).toBe("active");
    expect(current.runs[0]).toMatchObject({ status: "failed", otto: { disposition: "failed" } });
    expect(current.otto?.repairReason).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(f.manager.hasInFlightRun(f.agent.id)).toBe(true);
    f.turn.resolve();
    await manual;
  } finally {
    f.turn.resolve();
    await Promise.allSettled([manual]);
    await f.cleanup();
  }
});
test("new-agent native execution retains Paseo workspace provisioning and archive semantics", async () => {
  const f = await fixture();
  let running: Promise<unknown> | null = null;
  try {
    const schedule = await f.create({
      type: "new-agent",
      config: { provider: "codex", cwd: f.repo, archiveOnFinish: true },
    });
    running = f.scheduler.runOnce(schedule.id);
    await f.started.promise;
    const current = await f.scheduler.inspect(schedule.id);
    expect(current.runs[0].workspaceId).toBe("scheduled-workspace");
    expect(current.runs[0].agentId).not.toBe(f.agent.id);
    f.turn.resolve();
    await running;
    expect(f.archived).toEqual(["scheduled-workspace"]);
    expect((await f.scheduler.inspect(schedule.id)).runs[0]).toMatchObject({
      status: "succeeded",
      otto: { resolved: { kind: "new-agent" } },
    });
  } finally {
    f.turn.resolve();
    await Promise.allSettled([running]);
    await f.cleanup();
  }
});
test("audited legacy runs retain their actual global origin without guessing a project", async () => {
  const f = await fixture();
  let running: Promise<unknown> | null = null;
  try {
    const schedule = await f.create(undefined, true);
    expect(schedule.otto).toBeUndefined();
    running = f.scheduler.runOnce(schedule.id);
    await f.started.promise;
    expect((await f.registry.entry(schedule.id))?.schedule.otto).toMatchObject({
      location: "legacy",
      scope: { hostId: f.scope.hostId, projectId: null },
    });
    await f.scheduler.stop();
    await running;
    const ended = await f.scheduler.inspect(schedule.id);
    expect(ended).toMatchObject({
      status: "paused",
      otto: { repairReason: expect.any(String) },
      runs: [{ status: "failed", otto: { disposition: "unknown" } }],
    });
  } finally {
    f.turn.resolve();
    await Promise.allSettled([running]);
    await f.cleanup();
  }
});
test("canceling pending provisioning revokes late turn admission without waiting for the provider", async () => {
  const f = await fixture();
  const provisioned = deferred<void>();
  const entered = deferred<void>();
  const late = deferred<void>();
  let run: Promise<unknown> | null = null;
  try {
    const schedule = await f.create();
    const runId = "pending-native";
    await f.registry.update(schedule.id, (record) => ({
      ...record,
      runs: [
        {
          id: runId,
          scheduledFor: "now",
          startedAt: "now",
          endedAt: null,
          status: "running",
          agentId: null,
          output: null,
          error: null,
          otto: { requestedTarget: record.target },
        },
      ],
    }));
    run = f.native.execute({
      schedule,
      runId,
      stamp: (audit) => stampScheduleRun(f.registry, schedule.id, runId, audit, () => new Date()),
      legacy: async (options) => {
        entered.resolve();
        await provisioned.promise;
        try {
          await options?.(f.agent.id);
          throw new Error("Revoked provisioning admitted a turn");
        } finally {
          late.resolve();
        }
      },
    });
    const outcome = run.catch((error: unknown) => error);
    await entered.promise;
    await expect(f.native.cancel(schedule.id, runId)).rejects.toThrow("uncertain outcome");
    expect(await outcome).toBeInstanceOf(ScheduleExecutionError);
    expect(f.manager.hasInFlightRun(f.agent.id)).toBe(false);
    provisioned.resolve();
    await late.promise;
    expect(f.manager.hasInFlightRun(f.agent.id)).toBe(false);
  } finally {
    provisioned.resolve();
    await Promise.allSettled([run]);
    await f.cleanup();
  }
});
test("confirmed native cancellation settles once and keeps the exact chat audit", async () => {
  const f = await fixture();
  let run: Promise<unknown> | null = null;
  try {
    const schedule = await f.create();
    run = f.scheduler.runOnce(schedule.id);
    await f.started.promise;
    const current = await f.scheduler.inspect(schedule.id);
    await f.native.cancel(schedule.id, current.runs[0].id);
    await run;
    const ended = await f.scheduler.inspect(schedule.id);
    expect(ended.runs).toHaveLength(1);
    expect(ended.runs[0]).toMatchObject({
      status: "failed",
      agentId: f.agent.id,
      otto: { disposition: "canceled", result: { kind: "chat", agentId: f.agent.id } },
    });
    expect(ended.otto?.repairReason).toBeUndefined();
  } finally {
    f.turn.resolve();
    await Promise.allSettled([run]);
    await f.cleanup();
  }
});
test("proven unavailable preflight waits for the next cadence while invalid targets require repair", async () => {
  const f = await fixture();
  try {
    const schedule = await f.create();
    f.validate.mockRejectedValueOnce(
      new ScheduleError("unavailable", "Host resources unavailable"),
    );
    await f.scheduler.runOnce(schedule.id);
    const failed = await f.scheduler.inspect(schedule.id);
    expect(failed).toMatchObject({
      status: "active",
      runs: [{ status: "failed", otto: { disposition: "failed" } }],
    });
    expect(failed.nextRunAt).toBe(schedule.nextRunAt);
    f.validate.mockRejectedValueOnce(new ScheduleError("invalid", "Restore the target chat"));
    await f.scheduler.runOnce(schedule.id);
    const repair = await f.scheduler.inspect(schedule.id);
    expect(repair.status).toBe("paused");
    expect(repair.otto?.repairReason).toBe("Restore the target chat");
    expect(repair.runs[1].otto?.disposition).toBe("repair_required");
    expect(f.manager.hasInFlightRun(f.agent.id)).toBe(false);
  } finally {
    await f.cleanup();
  }
});
test("aborted non-cooperative native work retains all five reservations instead of spawning more", async () => {
  const f = await fixture();
  const held = deferred<void>();
  const entered = Array.from({ length: 5 }, () => deferred<void>());
  const runs: Promise<unknown>[] = [];
  try {
    const schedule = await f.create();
    for (let i = 0; i < 5; i++) {
      const id = `held-${i}`;
      runs.push(
        f.native
          .execute({
            schedule,
            runId: id,
            stamp: async () => {},
            legacy: async () => {
              entered[i].resolve();
              await held.promise;
              return { agentId: null, output: "Late completion" };
            },
          })
          .catch((error: unknown) => error),
      );
      await entered[i].promise;
      await expect(f.native.cancel(schedule.id, id)).rejects.toThrow("uncertain outcome");
    }
    await expect(
      f.native.execute({
        schedule,
        runId: "capacity",
        stamp: async () => {},
        legacy: async () => {
          throw new Error("Capacity admitted another native operation");
        },
      }),
    ).rejects.toMatchObject({ disposition: "failed" });
    expect(f.validate).toHaveBeenCalledTimes(5);
    expect(
      (await Promise.all(runs)).every((value) => value instanceof ScheduleExecutionError),
    ).toBe(true);
  } finally {
    held.resolve();
    await Promise.allSettled(runs);
    await f.cleanup();
  }
});
test("restart pauses an old unaudited native attempt without inventing its historical target", async () => {
  const f = await fixture();
  try {
    const schedule = await f.create(undefined, true);
    await writeFile(
      path.join(f.home, "schedules", `${schedule.id}.json`),
      JSON.stringify({
        ...schedule,
        runs: [
          {
            id: "pre-upgrade-run",
            status: "running",
            agentId: f.agent.id,
            scheduledFor: "before",
            startedAt: "before",
            endedAt: null,
            output: null,
            error: null,
          },
        ],
      }),
    );
    await f.registry.refresh(true);
    await f.scheduler.start();
    const recovered = await f.scheduler.inspect(schedule.id);
    expect(recovered.status).toBe("paused");
    expect(recovered.otto).toMatchObject({
      location: "legacy",
      scope: { projectId: null },
      repairReason: expect.stringContaining("not replayed"),
    });
    expect(recovered.runs[0].status).toBe("failed");
    expect(recovered.runs[0].otto).toBeUndefined();
    expect(f.validate).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
