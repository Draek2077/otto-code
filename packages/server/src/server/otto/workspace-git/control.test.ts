import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { GitFetchControl } from "./control.js";
import type { WorkspaceGitFetchResult } from "../../workspace-git-fetch.js";

const result: WorkspaceGitFetchResult = { changes: [], error: null };
interface Target {
  repoGitRoot: string;
  closed: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
}
function prepare(enabled = true) {
  vi.useFakeTimers();
  const target: Target = {
    repoGitRoot: path.resolve("fixture/.git"),
    closed: false,
    intervalId: null,
  };
  let active = true;
  let control!: GitFetchControl<Target>;
  const operation = vi.fn(async () => result);
  const report = vi.fn();
  const run = vi.fn((entry: Target) => control.single(entry.repoGitRoot, operation));
  control = new GitFetchControl(
    { active: () => active, run, report },
    { enabled, intervalSeconds: 180 },
  );
  return {
    control,
    target,
    operation,
    report,
    run,
    active: (value: boolean) => {
      active = value;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});

test("default observation reuses one timer and performs the existing immediate and three-minute fetches", async () => {
  const f = prepare();
  f.control.observe(f.target);
  f.control.observe(f.target);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.operation).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.operation).toHaveBeenCalledTimes(2);
  f.control.forget(f.target);
  expect(vi.getTimerCount()).toBe(0);
});

test("a saved opt-out creates no timer or automatic work; enabling only arms the selected cadence", async () => {
  const f = prepare(false);
  f.control.observe(f.target);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(f.operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  f.control.setPolicy({ enabled: true, intervalSeconds: 60 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.operation).toHaveBeenCalledTimes(1);
  f.control.dispose();
});

test("disabling revokes both an initial and an already queued interval callback", async () => {
  const f = prepare();
  f.control.observe(f.target);
  f.control.setPolicy({ enabled: false, intervalSeconds: 180 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.operation).not.toHaveBeenCalled();
  f.control.setPolicy({ enabled: true, intervalSeconds: 60 });
  vi.advanceTimersByTime(60_000);
  f.control.setPolicy({ enabled: false, intervalSeconds: 60 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("manual requests work while disabled and canonical path aliases share one in-flight operation", async () => {
  const f = prepare(false);
  let complete!: (value: WorkspaceGitFetchResult) => void;
  const pending = new Promise<WorkspaceGitFetchResult>((resolve) => {
    complete = resolve;
  });
  f.operation.mockImplementationOnce(() => pending);
  const first = f.control.single(f.target.repoGitRoot, f.operation);
  const second = f.control.single(path.join(f.target.repoGitRoot, "nested", ".."), f.operation);
  expect(first).toBe(second);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.operation).toHaveBeenCalledTimes(1);
  complete(result);
  await expect(first).resolves.toEqual(result);
  await expect(second).resolves.toEqual(result);
  await f.control.single(f.target.repoGitRoot, f.operation);
  expect(f.operation).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("manual requests join the existing background operation without another Git process", async () => {
  const f = prepare();
  let complete!: (value: WorkspaceGitFetchResult) => void;
  const pending = new Promise<WorkspaceGitFetchResult>((resolve) => {
    complete = resolve;
  });
  f.operation.mockImplementationOnce(() => pending);
  f.control.observe(f.target);
  await vi.advanceTimersByTimeAsync(0);
  const manual = f.control.single(f.target.repoGitRoot, f.operation);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.operation).toHaveBeenCalledTimes(1);
  complete(result);
  await expect(manual).resolves.toEqual(result);
  f.control.dispose();
});

test("inactive workspaces never fetch, and reactivation retains a live cadence", async () => {
  const f = prepare();
  f.active(false);
  f.control.observe(f.target);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.operation).not.toHaveBeenCalled();
  f.active(true);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.operation).toHaveBeenCalledTimes(1);
  f.target.closed = true;
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.operation).toHaveBeenCalledTimes(1);
  f.control.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

test("an unchanged policy does not reset the timer's phase", async () => {
  const f = prepare(false);
  f.control.observe(f.target);
  f.control.setPolicy({ enabled: true, intervalSeconds: 60 });
  await vi.advanceTimersByTimeAsync(59_000);
  f.control.setPolicy({ enabled: true, intervalSeconds: 60 });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.operation).toHaveBeenCalledTimes(1);
  f.control.dispose();
});

test("failed operations release the shared slot for a new explicit request", async () => {
  const f = prepare(false),
    error = new Error("Git failed");
  f.operation.mockRejectedValueOnce(error);
  await expect(f.control.single(f.target.repoGitRoot, f.operation)).rejects.toBe(error);
  await expect(f.control.single(f.target.repoGitRoot, f.operation)).resolves.toEqual(result);
  expect(f.operation).toHaveBeenCalledTimes(2);
});

test("shutdown clears timers and refuses a queued operation before it can start", async () => {
  const f = prepare();
  f.control.observe(f.target);
  const pending = f.control.single(f.target.repoGitRoot, f.operation);
  f.control.dispose();
  await expect(pending).rejects.toThrow("Workspace Git has stopped.");
  await vi.advanceTimersByTimeAsync(1_000_000);
  expect(f.operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
