import { expect, test } from "vitest";
import type { ScheduleRuntimeHooks, StoredSchedule } from "./types.js";
import {
  recoverScheduleTarget,
  settleScheduleTarget,
  stampScheduleRun,
  reviewScheduleRepair,
} from "./lifecycle.js";

function record(): StoredSchedule {
  const target = { type: "agent" as const, agentId: "00000000-0000-4000-8000-000000000001" };
  return {
    id: "schedule",
    name: null,
    prompt: "Review",
    target,
    cadence: { type: "every", everyMs: 60000 },
    status: "completed",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    maxRuns: 1,
    expiresAt: null,
    otto: {
      version: 1,
      scope: { hostId: "host", projectId: "project" },
      location: "repository",
      storeKey: "store",
    },
    runs: [
      {
        id: "run",
        scheduledFor: "now",
        startedAt: "now",
        endedAt: null,
        status: "running",
        agentId: null,
        output: null,
        error: null,
        otto: { requestedTarget: target },
      },
    ],
  };
}
function hooks(): ScheduleRuntimeHooks {
  return {
    requested: (schedule) => ({ requestedTarget: schedule.target }),
    acquire: () => () => {},
    execute: (input) => input.legacy(),
    settle: (_schedule, run) => ({ run, pauseReason: "Review changed authority" }),
    recover: (_schedule, run) => ({
      run: { ...run, status: "failed", otto: { ...run.otto!, disposition: "unknown" } },
      pauseReason: "Inspect interrupted work",
    }),
    stop: async () => {},
  };
}
test("target repair remains paused even after ordinary final-run completion", () => {
  const next = settleScheduleTarget(record(), "run", hooks(), {}, "later");
  expect(next.status).toBe("paused");
  expect(next.nextRunAt).toBeNull();
  expect(next.otto?.repairReason).toBe("Review changed authority");
});
test("restart preserves history and pauses unknown effects instead of replaying", () => {
  const next = recoverScheduleTarget(record(), 0, hooks(), "restart");
  expect(next.status).toBe("paused");
  expect(next.runs).toHaveLength(1);
  expect(next.runs[0].otto?.disposition).toBe("unknown");
  expect(next.otto?.repairReason).toBe("Inspect interrupted work");
});

test("repair review is explicit and records the inspected previous run without changing run audit or status", () => {
  const before = recoverScheduleTarget(record(), 0, hooks(), "restart");
  const next = {
    ...before,
    runs: [...before.runs, { ...before.runs[0], id: "new-run", status: "running" as const }],
  };
  const ref = { id: before.id, ...before.otto! };
  const mutation = { ref, expectedRevision: "a".repeat(64) };
  expect(() => reviewScheduleRepair(before, next, mutation, "review")).toThrow(
    "Inspect the uncertain outcome",
  );
  expect(reviewScheduleRepair(before, before, mutation, "review")).toBe(before);
  const reviewed = reviewScheduleRepair(
    before,
    next,
    { ...mutation, repairReviewed: true },
    "review",
  );
  expect(reviewed.status).toBe("paused");
  expect(reviewed.otto?.repairReason).toBeUndefined();
  expect(reviewed.otto?.lastRepairReview).toEqual({
    at: "review",
    runId: "run",
    reason: "Inspect interrupted work",
  });
  expect(reviewed.runs).toEqual(next.runs);
  expect(
    reviewScheduleRepair(reviewed, reviewed, { ...mutation, repairReviewed: true }, "again"),
  ).toBe(reviewed);
});
test("pre-effect audit stamping pins the claimed target and rejects ended authority", async () => {
  let current = record();
  const store = {
    update: async (
      _id: string,
      update: (value: StoredSchedule) => StoredSchedule | Promise<StoredSchedule>,
    ) => {
      current = await update(current);
      return current;
    },
  };
  // The stamping port needs only the owning store's serialized update operation.
  await stampScheduleRun(
    store,
    "schedule",
    "run",
    {
      requestedTarget: { type: "agent", agentId: "peer" },
      resolved: { kind: "agent", id: "original", title: "Original" },
    },
    () => new Date(0),
  );
  expect(current.runs[0].otto?.requestedTarget).toEqual(record().target);
  expect(current.runs[0].otto?.resolved?.id).toBe("original");
  current.runs[0].status = "succeeded";
  await expect(
    stampScheduleRun(store, "schedule", "run", { executor: "late" }, () => new Date(0)),
  ).rejects.toThrow("authority has ended");
});
