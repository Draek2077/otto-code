/**
 * Stop a running background shell task without removing its row — mirrors
 * subagents/stop-subagent.ts's observed path (both resolve to the provider's
 * stopTask). Never confirms — stopping is a benign, reversible-in-kind
 * gesture.
 */
export interface StopBackgroundTaskDeps {
  stopBackgroundShellTask: (parentAgentId: string, taskId: string) => Promise<void>;
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
  }
}
