import { describe, expect, it, vi } from "vitest";
import { requestStopBackgroundTask } from "./stop-background-task";

function deps(overrides?: {
  stopBackgroundShellTask?: () => Promise<void>;
  clearBackgroundShellTasks?: () => Promise<void>;
}) {
  return {
    stopBackgroundShellTask: vi.fn(overrides?.stopBackgroundShellTask ?? (() => Promise.resolve())),
    clearBackgroundShellTasks: vi.fn(
      overrides?.clearBackgroundShellTasks ?? (() => Promise.resolve()),
    ),
    reportError: vi.fn(),
  };
}

const INPUT = { parentAgentId: "agent-1", taskId: "task-1" };

describe("requestStopBackgroundTask", () => {
  it("stops the task and clears its row", async () => {
    // An explicit stop is a dismissal: the user should not have to clear the
    // row afterwards, and it must never linger in the active list.
    const d = deps();
    await requestStopBackgroundTask(INPUT, d);
    expect(d.stopBackgroundShellTask).toHaveBeenCalledWith("agent-1", "task-1");
    expect(d.clearBackgroundShellTasks).toHaveBeenCalledWith("agent-1", ["task-1"]);
    expect(d.reportError).not.toHaveBeenCalled();
  });

  it("keeps the row when the stop fails", async () => {
    // Clearing archives the row daemon-side. Dropping it after a failed stop
    // would hide a task that is very possibly still running.
    const error = new Error("no task id");
    const d = deps({ stopBackgroundShellTask: () => Promise.reject(error) });
    await requestStopBackgroundTask(INPUT, d);
    expect(d.clearBackgroundShellTasks).not.toHaveBeenCalled();
    expect(d.reportError).toHaveBeenCalledWith(error);
  });

  it("reports a failed clear without swallowing it", async () => {
    const error = new Error("daemon unavailable");
    const d = deps({ clearBackgroundShellTasks: () => Promise.reject(error) });
    await requestStopBackgroundTask(INPUT, d);
    expect(d.reportError).toHaveBeenCalledWith(error);
  });
});
