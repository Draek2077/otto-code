/**
 * Clear terminal (completed) background shell task rows off the track. Only
 * ever called with tidy-eligible ids (terminal, not attention) — it never
 * touches a running or errored row. Clearing is unconfirmed: a completed task
 * carries nothing you can lose by dropping its row (the output is already in
 * the chat), so a confirm dialog was pure friction. Mirrors the single-row X,
 * which has always cleared without asking.
 */
export interface ClearCompletedBackgroundTasksDeps {
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
  try {
    await deps.clearBackgroundShellTasks(input.parentAgentId, input.taskIds);
  } catch (error) {
    deps.reportError(error);
  }
}
