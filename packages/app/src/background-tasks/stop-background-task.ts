/**
 * Stop a running background shell task and drop its row. An explicit Stop is a
 * dismissal: the user has said they are done with this task, so making them
 * clear it afterwards is a second chore for a decision they already made. Only
 * an explicit stop removes the row — a task that ends on its own still settles
 * into Completed or Failed, which is where the outcome of work nobody stopped
 * belongs.
 *
 * The clear is gated on the stop succeeding, and never runs on its own. Clearing
 * archives the row daemon-side and only best-effort stops a live task, so
 * clearing blindly could retire the row while its process is still running. If
 * the stop fails the row stays put and the error surfaces.
 */
export interface StopBackgroundTaskDeps {
  stopBackgroundShellTask: (parentAgentId: string, taskId: string) => Promise<void>;
  clearBackgroundShellTasks: (parentAgentId: string, taskIds: readonly string[]) => Promise<void>;
  reportError: (error: unknown) => void;
}

export interface RequestStopBackgroundTaskInput {
  parentAgentId: string;
  taskId: string;
}

export async function requestStopBackgroundTask(
  input: RequestStopBackgroundTaskInput,
  deps: StopBackgroundTaskDeps,
): Promise<void> {
  try {
    await deps.stopBackgroundShellTask(input.parentAgentId, input.taskId);
  } catch (error) {
    deps.reportError(error);
    return;
  }
  try {
    await deps.clearBackgroundShellTasks(input.parentAgentId, [input.taskId]);
  } catch (error) {
    deps.reportError(error);
  }
}
