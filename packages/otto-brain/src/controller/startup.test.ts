import { expect, test, vi } from "vitest";
import { BrainStartup } from "./startup.js";

function fixture(intent = { enabled: true, autoStart: true, mode: "local" as "local" | "remote" }) {
  const ports = {
    connection: vi.fn(() => intent),
    isRunning: vi.fn(() => false),
    start: vi.fn(async (_signal?: AbortSignal) => {}),
  };
  return { ports, startup: new BrainStartup(ports) };
}

test.each([
  { enabled: false, autoStart: true, mode: "local" as const },
  { enabled: true, autoStart: false, mode: "local" as const },
  { enabled: false, autoStart: false, mode: "local" as const },
  { enabled: true, autoStart: true, mode: "remote" as const },
])("does not start or inspect a model for saved intent %j", async (intent) => {
  const f = fixture(intent);
  expect(f.ports.connection).not.toHaveBeenCalled();
  await expect(f.startup.apply()).resolves.toBe("skipped");
  expect(f.ports.isRunning).not.toHaveBeenCalled();
  expect(f.ports.start).not.toHaveBeenCalled();
});

test("starts once and shares the in-flight result without changing saved intent", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const first = f.startup.apply(signal);
  expect(f.startup.apply(signal)).toBe(first);
  await expect(first).resolves.toBe("started");
  await expect(f.startup.apply()).resolves.toBe("started");
  expect(f.ports.start).toHaveBeenCalledExactlyOnceWith(signal);
  expect(f.ports.connection()).toEqual({ enabled: true, autoStart: true, mode: "local" });
});

test("an existing owner is left alone without reading model configuration or starting again", async () => {
  const f = fixture();
  f.ports.isRunning.mockReturnValue(true);
  await expect(f.startup.apply()).resolves.toBe("already-running");
  expect(f.ports.start).not.toHaveBeenCalled();
});

test("failed startup is not retried; cancellation before startup has no host or file effects", async () => {
  const f = fixture();
  const failure = new Error("Owner startup failed");
  f.ports.start.mockRejectedValue(failure);
  await expect(f.startup.apply()).rejects.toBe(failure);
  await expect(f.startup.apply()).rejects.toBe(failure);
  expect(f.ports.start).toHaveBeenCalledTimes(1);
  const canceled = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(canceled.startup.apply(controller.signal)).rejects.toThrow();
  expect(canceled.ports.connection).not.toHaveBeenCalled();
  expect(canceled.ports.start).not.toHaveBeenCalled();
});
