import { expect, test, vi } from "vitest";
import type { Run } from "@otto-code/protocol/orchestration";

import {
  attachStartRunLifecycle,
  formatStartRunCompletionNotification,
} from "./start-run-lifecycle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_1",
    title: "Build a feature",
    status: "done",
    phases: [
      {
        id: "deliver",
        type: "deliver",
        title: "Deliver",
        task: "deliver it",
        status: "done",
        candidates: [{ agentId: "worker_1", summary: "The feature is complete." }],
      },
    ],
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for lifecycle callback");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makePort(overrides?: {
  conductorHasInFlightTurn?: boolean;
  archiveWorker?: (agentId: string) => Promise<void>;
}) {
  const archived: string[] = [];
  const notifications: string[] = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    archived,
    notifications,
    logger,
    port: {
      conductorHasInFlightTurn: () => overrides?.conductorHasInFlightTurn ?? false,
      notifyConductor: async (text: string) => {
        notifications.push(text);
      },
      archiveWorker: async (agentId: string) => {
        archived.push(agentId);
        await overrides?.archiveWorker?.(agentId);
      },
      logger,
    },
  };
}

test("returns through the original tool turn without queuing a duplicate notification", async () => {
  const { port, archived, notifications } = makePort({ conductorHasInFlightTurn: true });
  attachStartRunLifecycle({
    runId: "run_1",
    settled: Promise.resolve(makeRun()),
    conductorAgentId: "conductor_1",
    workerAgentIds: new Set(["worker_1", "judger_1"]),
    port,
  });

  await waitFor(() => archived.length === 2);
  expect(archived).toEqual(["worker_1", "judger_1"]);
  expect(notifications).toEqual([]);
});

test("queues one aggregate completion hand-back when the original conductor turn is gone", async () => {
  const { port, archived, notifications } = makePort({ conductorHasInFlightTurn: false });
  attachStartRunLifecycle({
    runId: "run_1",
    settled: Promise.resolve(makeRun()),
    conductorAgentId: "conductor_1",
    workerAgentIds: new Set(["worker_1"]),
    port,
  });

  await waitFor(() => notifications.length === 1);
  expect(archived).toEqual(["worker_1"]);
  expect(notifications[0]).toContain('orchestration run "Build a feature" (run_1) finished');
  expect(notifications[0]).toContain("The feature is complete.");
  expect(notifications[0]).toContain("report the outcome to the user");
});

test("still notifies the conductor when retiring a completed worker fails", async () => {
  const { port, logger, notifications } = makePort({
    archiveWorker: async () => {
      throw new Error("archive failed");
    },
  });
  attachStartRunLifecycle({
    runId: "run_1",
    settled: Promise.resolve(makeRun({ status: "failed", error: "The check failed." })),
    conductorAgentId: "conductor_1",
    workerAgentIds: new Set(["worker_1"]),
    port,
  });

  await waitFor(() => notifications.length === 1);
  expect(logger.warn).toHaveBeenCalledOnce();
  expect(notifications[0]).toContain("Reason: The check failed.");
});

test("bounds a large aggregate result in the completion hand-back", () => {
  const notification = formatStartRunCompletionNotification(
    makeRun({
      phases: [
        {
          id: "deliver",
          type: "deliver",
          title: "Deliver",
          task: "deliver it",
          status: "done",
          candidates: [{ agentId: "worker_1", summary: "x".repeat(4_001) }],
        },
      ],
    }),
  );
  expect(notification).toContain("truncated; use get_run_status for the full result");
});
