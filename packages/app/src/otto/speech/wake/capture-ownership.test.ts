import { describe, expect, it, vi } from "vitest";
import {
  createWakeCaptureGuard,
  hasActiveCapture,
  registerWakeCaptureOwner,
} from "./capture-ownership";
describe("shared microphone ownership", () => {
  it("preserves the one-shot wake handoff marker through capture arbitration", async () => {
    const start = vi.fn(async (_options?: { wakeWord?: boolean }) => {});
    const capture = createWakeCaptureGuard(() => ({ start, stop: async () => {} }));
    await capture.start({ wakeWord: true });
    expect(start).toHaveBeenCalledExactlyOnceWith({ wakeWord: true });
    await capture.stop();
  });
  it("awaits detector teardown before manual capture, then releases after actual stop", async () => {
    const order: string[] = [];
    const owner = {
      pause: async () => {
        order.push("pause");
      },
      resume: async () => {
        order.push("resume");
      },
    };
    const unregister = registerWakeCaptureOwner(owner);
    const source = {
      start: async () => {
        order.push("start");
      },
      stop: async () => {
        order.push("stop");
      },
    };
    const capture = createWakeCaptureGuard(() => source);
    await capture.start();
    expect(hasActiveCapture()).toBe(true);
    await capture.stop();
    expect(order).toEqual(["pause", "start", "stop", "resume"]);
    expect(hasActiveCapture()).toBe(false);
    unregister();
  });
  it("releases priority on a rejected start, without leaving detection blocked", async () => {
    const owner = { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
    const unregister = registerWakeCaptureOwner(owner);
    const capture = createWakeCaptureGuard(() => ({
      start: async () => {
        throw new Error("permission denied");
      },
      stop: async () => {},
    }));
    await expect(capture.start()).rejects.toThrow("permission denied");
    expect(hasActiveCapture()).toBe(false);
    expect(owner.resume).toHaveBeenCalledOnce();
    unregister();
  });
  it("does not let an old owner release or resume its replacement", async () => {
    const first = { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
    const second = { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
    const remove = registerWakeCaptureOwner(first);
    const capture = createWakeCaptureGuard(() => ({ start: async () => {}, stop: async () => {} }));
    await capture.start();
    remove();
    const release = registerWakeCaptureOwner(second);
    await capture.stop();
    expect(first.resume).not.toHaveBeenCalled();
    expect(second.pause).toHaveBeenCalledOnce();
    expect(second.resume).toHaveBeenCalledOnce();
    release();
  });
});
