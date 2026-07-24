import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMessagePlaybackActive,
  getActiveMessagePlaybackTurnKey,
  resetMessagePlaybackActivity,
  setMessagePlaybackActive,
  subscribeMessagePlaybackActivity,
} from "./message-playback-activity";

afterEach(() => {
  resetMessagePlaybackActivity();
});

describe("message playback activity", () => {
  it("has no active turn until one claims playback", () => {
    expect(getActiveMessagePlaybackTurnKey()).toBeNull();
  });

  it("records the claiming turn", () => {
    setMessagePlaybackActive("turn-a");
    expect(getActiveMessagePlaybackTurnKey()).toBe("turn-a");
  });

  it("clears the claim when the claiming turn stops", () => {
    setMessagePlaybackActive("turn-a");
    clearMessagePlaybackActive("turn-a");
    expect(getActiveMessagePlaybackTurnKey()).toBeNull();
  });

  it("a superseded turn unwinding does not clear the newcomer's claim", () => {
    setMessagePlaybackActive("turn-a");
    setMessagePlaybackActive("turn-b");
    // turn-a's in-flight request finally settles and releases its claim.
    clearMessagePlaybackActive("turn-a");
    expect(getActiveMessagePlaybackTurnKey()).toBe("turn-b");
  });

  it("notifies subscribers on claim and release", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMessagePlaybackActivity(listener);

    setMessagePlaybackActive("turn-a");
    expect(listener).toHaveBeenCalledTimes(1);

    clearMessagePlaybackActive("turn-a");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setMessagePlaybackActive("turn-b");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify when the same turn re-claims", () => {
    setMessagePlaybackActive("turn-a");
    const listener = vi.fn();
    subscribeMessagePlaybackActivity(listener);
    setMessagePlaybackActive("turn-a");
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify when a turn that never claimed releases", () => {
    const listener = vi.fn();
    subscribeMessagePlaybackActivity(listener);
    clearMessagePlaybackActive("turn-a");
    expect(listener).not.toHaveBeenCalled();
  });
});
