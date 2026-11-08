import type {
  ScheduleDocument,
  ScheduleEntry,
  ScheduleListItem,
  ScheduleRunSummary,
  ScheduleTargetSummary,
} from "@getpaseo/plugin/otto/schedules";
import type { ScheduleRun, ScheduleTarget } from "./types.js";

/** Display projection only. Native execution config, JSON payloads and saved prompts
 * are loaded on explicit detail reads, never multiplied across a list/history page. */
export function scheduleTargetSummary(target: ScheduleTarget): ScheduleTargetSummary {
  switch (target.type) {
    case "agent":
      return { type: "agent", agentId: target.agentId };
    case "new-agent":
      return {
        type: "new-agent",
        provider: target.config.provider,
        cwd: target.config.cwd,
        title: target.config.title ?? null,
      };
    case "workflow":
      return { type: "workflow", source: target.source, workflowKind: target.source.kind };
    case "artifact-update":
      return { type: "artifact-update", source: target.source, updateKind: target.update.type };
  }
}
export function scheduleRunSummary(run: ScheduleRun): ScheduleRunSummary {
  const audit = run.otto;
  return {
    id: run.id,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    agentId: run.agentId,
    workspaceId: run.workspaceId,
    output: run.output?.slice(0, 2000) ?? null,
    error: run.error?.slice(0, 2000) ?? null,
    outputTruncated: (run.output?.length ?? 0) > 2000,
    errorTruncated: (run.error?.length ?? 0) > 2000,
    requestedTarget: audit ? scheduleTargetSummary(audit.requestedTarget) : null,
    ...(audit
      ? {
          otto: {
            resolved: audit.resolved,
            executor: audit.executor,
            disposition: audit.disposition,
            failureCode: audit.failureCode,
            result: audit.result,
          },
        }
      : {}),
  };
}
export function scheduleDocument(entry: ScheduleEntry): ScheduleDocument {
  const { runs: _history, ...head } = entry.schedule;
  return { ref: entry.ref, revision: entry.revision, schedule: head };
}
export function scheduleListItem(
  entry: ScheduleEntry & { ambiguous: boolean },
  archivedLast?: ScheduleRunSummary,
): ScheduleListItem {
  const schedule = entry.schedule;
  const last = schedule.runs.at(-1);
  return {
    ref: entry.ref,
    revision: entry.revision,
    name: schedule.name,
    promptPreview: schedule.prompt.slice(0, 200),
    target: scheduleTargetSummary(schedule.target),
    cadence: schedule.cadence,
    status: schedule.status,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    maxRuns: schedule.maxRuns,
    expiresAt: schedule.expiresAt,
    runCount: (schedule.otto?.history?.count ?? 0) + schedule.runs.length,
    lastRun: last ? scheduleRunSummary(last) : (archivedLast ?? null),
    transfer: schedule.otto?.transfer ?? null,
    repairReason: entry.ambiguous
      ? "Duplicate Schedule identity. Inspect both origins and reconcile storage before running."
      : (schedule.otto?.repairReason ?? null),
  };
}
