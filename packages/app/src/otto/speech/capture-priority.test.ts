import { expect, it, vi } from "vitest";
import { createCapturePriority } from "./capture-priority";
import { speechDeferred } from "../../../test-speech";

it("silences output before starting and holds priority through late start and actual stop", async () => {
  const started = speechDeferred<void>();
  const stopped = speechDeferred<void>();
  const order: string[] = [];
  const release = vi.fn();
  const source = {
    start: vi.fn(() => {
      order.push("start");
      return started.promise;
    }),
    stop: vi.fn(() => stopped.promise),
  };
  const priority = createCapturePriority(
    () => source,
    () => {
      order.push("silence");
      return release;
    },
  );
  const starting = priority.start();
  await Promise.resolve();
  expect(order).toEqual(["silence", "start"]);
  priority.close();
  expect(release).not.toHaveBeenCalled();
  expect(source.stop).not.toHaveBeenCalled();
  started.resolve();
  await starting;
  await vi.waitFor(() => expect(source.stop).toHaveBeenCalledOnce());
  expect(release).not.toHaveBeenCalled();
  stopped.resolve();
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
  await expect(priority.start()).rejects.toThrow("closed");
});

it("releases priority after a failed recording start and preserves its error", async () => {
  const error = new Error("Permission denied");
  const release = vi.fn();
  const source = {
    start: vi.fn(async () => {
      throw error;
    }),
    stop: vi.fn(async () => {}),
  };
  const priority = createCapturePriority(
    () => source,
    () => release,
  );
  await expect(priority.start()).rejects.toBe(error);
  expect(release).toHaveBeenCalledOnce();
  await priority.stop();
  expect(release).toHaveBeenCalledOnce();
});

it("releases once even when the actual recorder stop fails", async () => {
  const error = new Error("Recorder cleanup failed");
  const release = vi.fn();
  const source = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {
      throw error;
    }),
  };
  const priority = createCapturePriority(
    () => source,
    () => release,
  );
  await priority.start();
  await expect(priority.stop()).rejects.toBe(error);
  expect(release).toHaveBeenCalledOnce();
});
