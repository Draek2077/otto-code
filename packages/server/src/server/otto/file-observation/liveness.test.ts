import { afterEach, expect, test, vi } from "vitest";
import { waitForWatcherCanary } from "./liveness.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function prepare() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const reported = deferred();
  const touch = vi.fn(async () => {});
  return {
    reported,
    touch,
    input: { watchRoot: "/fixture/.git", timeoutMs: 10_000, reported: reported.promise, touch },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("an immediate callback needs no repeat write or remaining timer", async () => {
  const { input, reported, touch } = prepare();
  reported.resolve();
  await waitForWatcherCanary(input);
  expect(touch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("a missed creation is re-signaled until the actual callback proves readiness", async () => {
  const { input, reported, touch } = prepare();
  touch.mockImplementationOnce(async () => reported.resolve());
  const waiting = waitForWatcherCanary(input);
  await vi.advanceTimersByTimeAsync(999);
  expect(touch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(touch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(touch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("re-signaling never replaces a real callback or extends the original deadline", async () => {
  const { input, touch } = prepare();
  const outcome = waitForWatcherCanary(input).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await outcome).toEqual(
    new Error("Watcher for /fixture/.git did not report its liveness canary within 10000ms"),
  );
  expect(touch).toHaveBeenCalledTimes(9);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(touch).toHaveBeenCalledTimes(9);
});

test("shutdown preserves its reason and cancels the pending probe", async () => {
  const { input, touch } = prepare();
  const controller = new AbortController();
  const reason = new Error("owner stopped");
  const outcome = waitForWatcherCanary({ ...input, signal: controller.signal }).catch(
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(100);
  controller.abort(reason);
  expect(await outcome).toBe(reason);
  expect(touch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("a callback during the waiting interval cancels the next write", async () => {
  const { input, reported, touch } = prepare();
  const waiting = waitForWatcherCanary(input);
  await vi.advanceTimersByTimeAsync(500);
  reported.resolve();
  await waiting;
  expect(touch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("success waits for an in-flight write so cleanup cannot race it", async () => {
  const { input, reported, touch } = prepare();
  const write = deferred();
  touch.mockImplementationOnce(() => write.promise);
  const finished = vi.fn();
  const waiting = waitForWatcherCanary(input).then(finished);
  await vi.advanceTimersByTimeAsync(1_000);
  reported.resolve();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(finished).not.toHaveBeenCalled();
  expect(touch).toHaveBeenCalledTimes(1);
  write.resolve();
  await waiting;
  expect(finished).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("shutdown waits for an in-flight write and never starts another", async () => {
  const { input, touch } = prepare();
  const write = deferred();
  const controller = new AbortController();
  const reason = new Error("owner stopped while writing");
  touch.mockImplementationOnce(() => write.promise);
  const failed = vi.fn();
  const waiting = waitForWatcherCanary({ ...input, signal: controller.signal }).catch(failed);
  await vi.advanceTimersByTimeAsync(1_000);
  controller.abort(reason);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(failed).not.toHaveBeenCalled();
  write.resolve();
  await waiting;
  expect(failed).toHaveBeenCalledExactlyOnceWith(reason);
  expect(touch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("a failed re-signal propagates without retrying the filesystem operation", async () => {
  const { input, touch } = prepare();
  const denied = new Error("write denied");
  touch.mockRejectedValueOnce(denied);
  const outcome = waitForWatcherCanary(input).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await outcome).toBe(denied);
  expect(touch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
