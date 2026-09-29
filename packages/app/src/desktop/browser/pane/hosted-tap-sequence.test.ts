import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelHostedTap, queueHostedTap, type PendingTap } from "./hosted-tap-sequence";

afterEach(() => vi.useRealTimers());

describe("hosted page taps", () => {
  it("sends one click after the double tap window", () => {
    vi.useFakeTimers();
    const state: { current: PendingTap | null } = { current: null };
    const send = vi.fn();

    queueHostedTap(state, { x: 10, y: 20 }, send);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 10, y: 20 }, 1);
  });

  it("sends one double click for two nearby taps", () => {
    vi.useFakeTimers();
    const state: { current: PendingTap | null } = { current: null };
    const send = vi.fn();

    queueHostedTap(state, { x: 10, y: 20 }, send);
    vi.advanceTimersByTime(100);
    queueHostedTap(state, { x: 12, y: 22 }, send);
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 12, y: 22 }, 2);
  });

  it("keeps distant taps separate and cancels a pending tap for a long press", () => {
    vi.useFakeTimers();
    const state: { current: PendingTap | null } = { current: null };
    const send = vi.fn();

    queueHostedTap(state, { x: 10, y: 20 }, send);
    queueHostedTap(state, { x: 100, y: 200 }, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 10, y: 20 }, 1);
    cancelHostedTap(state);
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
