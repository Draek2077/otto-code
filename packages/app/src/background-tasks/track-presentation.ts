import { formatDuration } from "@/utils/time";
import type { BackgroundShellTaskRow } from "./select";

/**
 * Which group a row is filed under. Terminal work splits two ways so a failed
 * command is never filed as if it had succeeded: it collapses out of the active
 * list like anything else that finished, but into its own "Failed" group with
 * its own clear controls.
 */
export type BackgroundTaskGroup = "active" | "completed" | "failed";

/** The two terminal groups, i.e. everything the clear controls can act on. */
export type TerminalBackgroundTaskGroup = Exclude<BackgroundTaskGroup, "active">;

/**
 * A row whose command reported failure. `status` is the single grouping signal:
 * the daemon derives it from the provider's terminal notification ("failed" to
 * "error", "stopped" to "closed", anything else to "idle"). The wire also sets
 * `requiresAttention` on a failure, but grouping deliberately ignores it so
 * there is exactly one thing to reason about. Grouping once keyed off that flag
 * instead, which left failures pinned in the active list with nothing on the
 * row to say why they would not tidy.
 */
export function isBackgroundTaskRowFailed(row: BackgroundShellTaskRow): boolean {
  return row.status === "error";
}

/** The group a row belongs to, before pinning is applied. */
export function resolveBackgroundTaskRowGroup(row: BackgroundShellTaskRow): BackgroundTaskGroup {
  if (row.status === "running") {
    return "active";
  }
  return isBackgroundTaskRowFailed(row) ? "failed" : "completed";
}

export interface PartitionedBackgroundTaskRows {
  active: BackgroundShellTaskRow[];
  completed: BackgroundShellTaskRow[];
  failed: BackgroundShellTaskRow[];
}

/**
 * Split rows into the active list and the two collapsed terminal groups.
 * Status is the only input: the track once also pinned a row the user had just
 * stopped into the active list so it wouldn't vanish under their pointer, which
 * left terminal rows counted as active until the header was toggled - a
 * cancelled-limbo group in all but name. An explicit stop now clears the row
 * outright (see stop-background-task.ts), so there is nothing left to pin.
 */
export function partitionBackgroundTaskRows(
  rows: readonly BackgroundShellTaskRow[],
): PartitionedBackgroundTaskRows {
  const partitioned: PartitionedBackgroundTaskRows = { active: [], completed: [], failed: [] };
  for (const row of rows) {
    partitioned[resolveBackgroundTaskRowGroup(row)].push(row);
  }
  return partitioned;
}

// How long a completed row must stay terminal before the auto-clear driver
// clears it. A short settle so the row is visibly finished (and its final
// elapsed readout registers) before it tidies itself away. Deliberately its own
// constant rather than a shared one with the sub-agents track: the two tracks
// carry different weight and may want to diverge.
export const BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS = 4000;

export interface BackgroundTaskAutoClearSelectionInput {
  /**
   * Which terminal group to sweep. Completed and failed auto-clear on separate
   * settings, so a driver only ever selects from the one group it is enabled for.
   */
  group: TerminalBackgroundTaskGroup;
  settleMs: number;
  now: number;
  /** Ids already clearing or previously attempted, never re-selected. */
  excludeIds?: ReadonlySet<string>;
}

/**
 * The rows in `group` due to auto-clear: exactly the set that group renders,
 * minus excluded ids, minus anything that has not been terminal for at least
 * `settleMs`. Pure so the driver's timing logic is unit-testable. Mirrors
 * subagents/track-presentation.ts's selectSubagentsToAutoClear.
 */
export function selectBackgroundTasksToAutoClear(
  rows: readonly BackgroundShellTaskRow[],
  input: BackgroundTaskAutoClearSelectionInput,
): BackgroundShellTaskRow[] {
  const due: BackgroundShellTaskRow[] = [];
  for (const row of rows) {
    if (resolveBackgroundTaskRowGroup(row) !== input.group) {
      continue;
    }
    if (input.excludeIds?.has(row.id)) {
      continue;
    }
    if (input.now - new Date(row.updatedAt).getTime() < input.settleMs) {
      continue;
    }
    due.push(row);
  }
  return due;
}

export type BackgroundTaskRowAction = "stop" | "clear";

/**
 * The row's primary action follows its state: a running task gets Stop
 * (transition to terminal, keep the row); a terminal one gets Clear (drop the
 * row). Never offer Clear on something still running.
 */
export function resolveBackgroundTaskRowAction(
  status: BackgroundShellTaskRow["status"],
): BackgroundTaskRowAction {
  return status === "running" ? "stop" : "clear";
}

/** True while the task is still running - the row live-ticks its elapsed time. */
export function isBackgroundTaskRowRunning(status: BackgroundShellTaskRow["status"]): boolean {
  return status === "running";
}

/**
 * Frozen run duration (createdAt → updatedAt) for a terminal row, e.g. "3m 12s".
 * Returns null while the row is still running - the track renders a live
 * ticker for those instead.
 */
export function formatBackgroundTaskElapsed(row: BackgroundShellTaskRow): string | null {
  if (isBackgroundTaskRowRunning(row.status)) {
    return null;
  }
  const ms = new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime();
  return formatDuration(Math.max(0, ms));
}

/** "2 completed background tasks", with the noun pluralized off the count. */
function formatGroupCount(count: number, state: string): string {
  return `${count} ${state} ${count === 1 ? "background task" : "background tasks"}`;
}

/**
 * Header summary for the collapsed track. Mirrors the list's own
 * active/completed/failed split (the same wording subagents/track-presentation.ts
 * uses) so the header reads as a summary of the groups below it rather than a
 * third framing. "3 background tasks · 1 running" said nothing about what the
 * other two were, and folding failures into "completed" said something wrong.
 */
export function formatHeaderLabel({
  active,
  completed,
  failed,
}: PartitionedBackgroundTaskRows): string {
  const parts: string[] = [];
  if (active.length > 0) {
    parts.push(formatGroupCount(active.length, "active"));
  }
  if (completed.length > 0) {
    parts.push(formatGroupCount(completed.length, "completed"));
  }
  if (failed.length > 0) {
    parts.push(formatGroupCount(failed.length, "failed"));
  }
  return parts.join(" · ");
}

const FALLBACK_LABEL = "Shell command";

/** Best available label for a row: command, then description, then a generic fallback. */
export function resolveRowLabel(row: BackgroundShellTaskRow): string {
  const command = row.command?.trim();
  if (command) {
    return command;
  }
  const description = row.description?.trim();
  if (description) {
    return description;
  }
  return FALLBACK_LABEL;
}
