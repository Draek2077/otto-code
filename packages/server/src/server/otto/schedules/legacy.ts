import { createHash } from "node:crypto";
import {
  type ScheduleRun as PaseoScheduleRun,
  type StoredSchedule as PaseoSchedule,
} from "@getpaseo/protocol/schedule/types";
import { isPaseoSchedule, type OttoStoredSchedule } from "@getpaseo/plugin/otto/schedules";
import type { ScheduleMutation, ScheduleRun } from "./types.js";

export function scheduleRevision(schedule: OttoStoredSchedule): string {
  return createHash("sha256").update(JSON.stringify(schedule)).digest("hex");
}
export function assertScheduleMutation(
  current: OttoStoredSchedule,
  mutation?: ScheduleMutation,
): void {
  if (!mutation) return;
  if ("legacyOnly" in mutation) {
    requirePaseoSchedule(current);
    return;
  }
  if (current.id !== mutation.ref.id || scheduleRevision(current) !== mutation.expectedRevision)
    throw new Error("Schedule changed. Reload before applying this action.");
  const origin = current.otto;
  if (
    origin &&
    (origin.scope.hostId !== mutation.ref.scope.hostId ||
      origin.scope.projectId !== mutation.ref.scope.projectId ||
      origin.location !== mutation.ref.location ||
      origin.storeKey !== mutation.ref.storeKey)
  )
    throw new Error("Schedule storage origin changed. Reload before applying this action.");
}
/** Protocol boundary only: never convert an extended target to a fake agent/prompt.
 * COMPAT(ottoScheduleLegacyWire): added v0.10.0; remove after 2027-05-08 when legacy Schedule RPCs retire. */
export function requirePaseoSchedule(schedule: OttoStoredSchedule): PaseoSchedule {
  if (!isPaseoSchedule(schedule))
    throw new Error("Use an updated Otto client to manage this Schedule target.");
  return {
    id: schedule.id,
    name: schedule.name,
    prompt: schedule.prompt,
    cadence: schedule.cadence,
    target: schedule.target,
    status: schedule.status,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    pausedAt: schedule.pausedAt,
    expiresAt: schedule.expiresAt,
    maxRuns: schedule.maxRuns,
    runs: legacyScheduleRuns(schedule.runs),
  };
}

export function legacyScheduleRuns(runs: ScheduleRun[]): PaseoScheduleRun[] {
  return runs.map((run) => ({
    id: run.id,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    agentId: run.agentId,
    output: run.output,
    error: run.error,
    ...(run.workspaceId !== undefined ? { workspaceId: run.workspaceId } : {}),
  }));
}
