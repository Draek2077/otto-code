import type {
  ScheduleAudit,
  ScheduleRun,
  ScheduleRuntimeHooks,
  ScheduleSettlement,
  ScheduleStorePort,
  StoredSchedule,
  ScheduleTarget,
  ScheduleMutation,
} from "./types.js";
import { ScheduleError } from "./files.js";

/** Conservative admission comparison: an edited target waits for a fresh claim/admission. */
export function sameScheduleTarget(left: ScheduleTarget, right: ScheduleTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The action owner validates the current target and obtains explicit inspection
 * acknowledgement. The store commits that receipt with resume/claim, never as a retry. */
export function reviewScheduleRepair(
  before: StoredSchedule,
  after: StoredSchedule,
  mutation: ScheduleMutation | undefined,
  at: string,
): StoredSchedule {
  const reason = before.otto?.repairReason;
  if (!reason) return after;
  const reviewed = mutation && "ref" in mutation && mutation.repairReviewed;
  if (!reviewed) {
    const active = new Set(
      before.runs.filter((run) => run.status === "running").map((run) => run.id),
    );
    if (
      after.status === "active" ||
      after.runs.some((run) => run.status === "running" && !active.has(run.id))
    )
      throw new ScheduleError(
        "conflict",
        "Inspect the uncertain outcome and explicitly acknowledge review before resuming or running this Schedule.",
      );
    return after;
  }
  if (!after.otto)
    throw new ScheduleError("invalid", "Repair review must retain the Schedule's origin.");
  const { repairReason: _reason, ...origin } = after.otto;
  return {
    ...after,
    updatedAt: at,
    otto: {
      ...origin,
      lastRepairReview: {
        at,
        runId: before.runs.at(-1)?.id ?? before.otto?.history?.lastRunId ?? null,
        reason,
      },
    },
  };
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
