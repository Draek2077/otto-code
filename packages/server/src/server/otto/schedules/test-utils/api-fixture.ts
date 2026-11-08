import path from "node:path";
import { vi } from "vitest";
import type { z } from "zod";
import type * as rpc from "@getpaseo/plugin/otto/schedules";
import { workflowFixture } from "../../workflows/test-utils/fixture.js";
import { AgentManager } from "../../../agent/agent-manager.js";
import { AgentStorage } from "../../../agent/agent-storage.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ScheduleService, type ScheduleServiceOptions } from "../../../schedule/service.js";
import { ScheduleStores } from "../stores.js";
import { ScheduleRegistry } from "../registry.js";
import { ScheduleActions, type ScheduleTargetActions } from "../actions.js";
import { ScheduleDaemonService } from "../service.js";
import { ScheduleChanges } from "../changes.js";
import { deferred } from "../../workflows/test-utils/host-fixture.js";

export async function scheduleApiFixture() {
  const f = await workflowFixture();
  const stores = new ScheduleStores({
    home: f.home,
    hostId: f.scope.hostId,
    hostLabel: "Fixture",
    metadata: f.metadata,
  });
  const changes = new ScheduleChanges(f.scope.hostId);
  const registry = new ScheduleRegistry({
    stores,
    projects: async () => [...f.records.keys()].map((projectId) => ({ projectId })),
    changed: (scope) => changes.publish(scope),
  });
  const logger = createTestLogger();
  const runner = vi.fn<NonNullable<ScheduleServiceOptions["runner"]>>(async () => ({
    agentId: null,
    output: "Complete",
  }));
  const manager = new AgentManager({ logger, clients: {} });
  const scheduler = new ScheduleService({
    paseoHome: f.home,
    logger,
    agentManager: manager,
    agentStorage: new AgentStorage(path.join(f.home, "agents"), logger),
    createAgent: async () => {
      throw new Error("No provider launches in API fixtures");
    },
    createDirectoryWorkspace: async () => {
      throw new Error("No workspace launches in API fixtures");
    },
    createPaseoWorktreeWorkspace: async () => {
      throw new Error("No worktree launches in API fixtures");
    },
    archiveWorkspace: async () => {},
    store: registry,
    runner,
    now: () => new Date("2026-11-08T00:00:00Z"),
  });
  const validate = vi.fn<ScheduleTargetActions["validate"]>(async () => {});
  const cancel = vi.fn<ScheduleTargetActions["cancel"]>(async () => {});
  const review = vi.fn<ScheduleTargetActions["review"]>(async () => {
    throw new Error("Inject an owning target reviewer");
  });
  const settlementError = vi.fn();
  const actions = new ScheduleActions({
    registry,
    scheduler,
    targets: { validate, cancel, review },
    onSettlementError: settlementError,
  });
  const api = new ScheduleDaemonService(registry, actions, changes);
  const draft: rpc.ScheduleDraft = {
    name: "Review",
    prompt: "Review saved work",
    cadence: { type: "every", everyMs: 60000 },
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
    maxRuns: null,
    expiresAt: null,
    runOnCreate: false,
  };
  const create = (input: Partial<z.infer<typeof rpc.createSchedule.input>> = {}) =>
    actions.create({ scope: f.scope, draft, operationId: "create-1", ...input });
  return {
    ...f,
    stores,
    registry,
    scheduler,
    runner,
    validate,
    cancel,
    review,
    actions,
    api,
    create,
    draft,
    settlementError,
    holdRun() {
      const held = deferred<{ agentId: null; output: string }>();
      const finished = deferred<void>();
      runner.mockImplementationOnce(() => held.promise);
      const update = registry.update.bind(registry);
      const finish = vi.spyOn(registry, "update");
      finish.mockImplementation(async (...args) => {
        const saved = await update(...args);
        if (saved?.runs.some((run) => run.status === "succeeded")) finished.resolve();
        return saved;
      });
      return {
        release: () => held.resolve({ agentId: null, output: "Complete" }),
        finished: finished.promise,
      };
    },
    async cleanup() {
      await scheduler.stop();
      await api.close();
      await f.cleanup();
    },
  };
}
