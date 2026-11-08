import type {
  ScheduleAudit,
  ScheduleRun,
  ScheduleRuntimeHooks,
  ScheduleSettlement,
  ScheduleStorePort,
  StoredSchedule,
  ScheduleTarget,
} from "./types.js";

/** Conservative admission comparison: an edited target waits for a fresh claim/admission. */
export function sameScheduleTarget(left: ScheduleTarget, right: ScheduleTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pauseForRepair(schedule: StoredSchedule, reason: string, now: string): StoredSchedule {
  return {
    ...schedule,
    status: "paused",
    pausedAt: now,
    nextRunAt: null,
    otto: schedule.otto ? { ...schedule.otto, repairReason: reason } : undefined,
  };
}
export function recoverScheduleTarget(
  schedule: StoredSchedule,
  index: number,
  hooks: ScheduleRuntimeHooks,
  now: string,
): StoredSchedule {
  const recovered = hooks.recover(schedule, schedule.runs[index]);
  const next = {
    ...schedule,
    runs: schedule.runs.map((run, slot) => (slot === index ? recovered.run : run)),
  };
  return recovered.pauseReason ? pauseForRepair(next, recovered.pauseReason, now) : next;
}
export function settleScheduleTarget(
  schedule: StoredSchedule,
  runId: string,
  hooks: ScheduleRuntimeHooks,
  outcome: ScheduleSettlement,
  now: string,
): StoredSchedule {
  const run = schedule.runs.find((entry) => entry.id === runId);
  if (!run) throw new Error("Schedule run no longer exists.");
  const settled = hooks.settle(schedule, run, outcome);
  const next = {
    ...schedule,
    runs: schedule.runs.map((entry) => (entry.id === runId ? settled.run : entry)),
  };
  return settled.pauseReason ? pauseForRepair(next, settled.pauseReason, now) : next;
}
export async function stampScheduleRun(
  store: Pick<ScheduleStorePort, "update">,
  scheduleId: string,
  runId: string,
  audit: Partial<ScheduleAudit>,
  now: () => Date,
): Promise<void> {
  const result = await store.update(scheduleId, (schedule) => {
    const run = schedule.runs.find((entry) => entry.id === runId);
    if (!run?.otto || run.status !== "running")
      throw new Error("Schedule run authority has ended.");
    const stamped: ScheduleRun = {
      ...run,
      otto: { ...run.otto, ...audit, requestedTarget: run.otto.requestedTarget },
    };
    return {
      ...schedule,
      updatedAt: now().toISOString(),
      runs: schedule.runs.map((entry) => (entry.id === runId ? stamped : entry)),
    };
  });
  if (!result) throw new Error("Schedule no longer exists.");
}
