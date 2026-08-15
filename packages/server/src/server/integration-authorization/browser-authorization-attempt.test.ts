import { describe, expect, test, vi } from "vitest";
import { BrowserAuthorizationAttemptManager } from "./browser-authorization-attempt.js";

describe("BrowserAuthorizationAttemptManager", () => {
  test("replaces only Otto's earlier attempt and rejects its stale completion", async () => {
    const manager = new BrowserAuthorizationAttemptManager<string>();
    const cancelled: string[] = [];
    const first = await manager.replace({
      key: "zoom-team-chat:primary",
      timeoutMs: 60_000,
      start: async () => ({ value: "first", cancel: () => cancelled.push("first") }),
      onTimeout: () => {},
    });
    const second = await manager.replace({
      key: "zoom-team-chat:primary",
      timeoutMs: 60_000,
      start: async () => ({ value: "second", cancel: () => cancelled.push("second") }),
      onTimeout: () => {},
    });

    expect(cancelled).toEqual(["first"]);
    expect(manager.take(first.attempt.key, first.attempt.id)).toBeNull();
    expect(manager.get(second.attempt.key, second.attempt.id)?.value).toBe("second");
  });

  test("releases the listener before recording an unfinished attempt timeout", async () => {
    vi.useFakeTimers();
    try {
      const manager = new BrowserAuthorizationAttemptManager<string>();
      const events: string[] = [];
      await manager.replace({
        key: "zoom-team-chat:primary",
        timeoutMs: 10,
        start: async () => ({ value: "attempt", cancel: () => events.push("closed") }),
        onTimeout: () => events.push("timed-out"),
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(events).toEqual(["closed", "timed-out"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
