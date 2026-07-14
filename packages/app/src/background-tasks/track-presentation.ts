import { formatDuration } from "@/utils/time";
import type { BackgroundShellTaskRow } from "./select";

/**
 * A row is tidy-eligible (auto-collapses into the "Completed" group) once it
 * is terminal AND not flagged for attention — a failed command stays visible
 * so the failure signal is never buried. Mirrors
 * subagents/track-presentation.ts's isSubagentRowTidyEligible, but every
 * background shell task uses the same status set (no attend distinction).
 */
export function isBackgroundTaskRowTidyEligible(row: BackgroundShellTaskRow): boolean {
  if (row.requiresAttention) {
    return false;
  }
  return row.status === "error" || row.status === "closed" || row.status === "idle";
}

export interface PartitionedBackgroundTaskRows {
  active: BackgroundShellTaskRow[];
  completed: BackgroundShellTaskRow[];
}

/**
 * Split rows into the active list and the collapsed "Completed" group. Rows
 * in `pinnedIds` stay active even when tidy-eligible — the track pins a row
 * the user just stopped so it doesn't instantly vanish into the collapsed
 * group under their pointer. Mirrors subagents/track-presentation.ts's
 * partitionSubagentRows.
 */
export function partitionBackgroundTaskRows(
  rows: readonly BackgroundShellTaskRow[],
  pinnedIds?: ReadonlySet<string>,
): PartitionedBackgroundTaskRows {
  const active: BackgroundShellTaskRow[] = [];
  const completed: BackgroundShellTaskRow[] = [];
  for (const row of rows) {
    if (isBackgroundTaskRowTidyEligible(row) && !pinnedIds?.has(row.id)) {
      completed.push(row);
    } else {
      active.push(row);
    }
  }
  return { active, completed };
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

/** True while the task is still running — the row live-ticks its elapsed time. */
export function isBackgroundTaskRowRunning(status: BackgroundShellTaskRow["status"]): boolean {
  return status === "running";
}

/**
 * Frozen run duration (createdAt → updatedAt) for a terminal row, e.g. "3m 12s".
 * Returns null while the row is still running — the track renders a live
 * ticker for those instead.
 */
export function formatBackgroundTaskElapsed(row: BackgroundShellTaskRow): string | null {
  if (isBackgroundTaskRowRunning(row.status)) {
    return null;
  }
  const ms = new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime();
  return formatDuration(Math.max(0, ms));
}

export function formatHeaderLabel(rows: readonly BackgroundShellTaskRow[]): string {
  let runningCount = 0;
  for (const row of rows) {
    if (row.status === "running") {
      runningCount += 1;
    }
  }
  const parts = [`${rows.length} ${rows.length === 1 ? "background task" : "background tasks"}`];
  if (runningCount > 0) {
    parts.push(`${runningCount} running`);
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
