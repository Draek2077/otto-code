import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

/**
 * Bulk "Clear all completed": drop every terminal (completed) background
 * shell task row in one gesture. Only ever called with tidy-eligible ids
 * (terminal, not attention) — it never touches a running or errored row.
 * Confirms once because clearing many rows at once is more consequential
 * than a single clear. Mirrors subagents/clear-completed-subagents.ts.
 */
export function resolveClearCompletedDialog(count: number): ConfirmDialogInput {
  const noun = count === 1 ? "completed background task" : "completed background tasks";
  return {
    title:
      count === 1
        ? "Clear completed background task?"
        : `Clear ${count} completed background tasks?`,
    message: `Remove ${count} ${noun} from the track. Running background tasks are untouched.`,
    confirmLabel: "Clear",
    cancelLabel: "Cancel",
    destructive: true,
  };
}

export interface ClearCompletedBackgroundTasksDeps {
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  clearBackgroundShellTasks: (parentAgentId: string, taskIds: readonly string[]) => Promise<void>;
  reportError: (error: unknown) => void;
}

export interface RequestClearCompletedBackgroundTasksInput {
  parentAgentId: string;
  taskIds: readonly string[];
}

export async function requestClearCompletedBackgroundTasks(
  input: RequestClearCompletedBackgroundTasksInput,
  deps: ClearCompletedBackgroundTasksDeps,
): Promise<void> {
  if (input.taskIds.length === 0) {
    return;
  }
  const confirmed = await deps.confirm(resolveClearCompletedDialog(input.taskIds.length));
  if (!confirmed) {
    return;
  }
  try {
    await deps.clearBackgroundShellTasks(input.parentAgentId, input.taskIds);
  } catch (error) {
    deps.reportError(error);
  }
}
