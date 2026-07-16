import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityStatsStore } from "./activity-stats-store.js";

describe("ActivityStatsStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "activity-stats-"));
    filePath = join(dir, "activity-stats.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts every rollup at zero when no file exists", async () => {
    const store = new ActivityStatsStore(filePath);
    const rollups = await store.getRollups();
    expect(rollups.today.messagesSent).toBe(0);
    expect(rollups.allTime.messagesSent).toBe(0);
  });

  it("increments both today and all-time", async () => {
    const store = new ActivityStatsStore(filePath);
    await store.increment("messagesSent");
    await store.increment("messagesSent");
    await store.increment("tokensReceived", 42);

    const rollups = await store.getRollups();
    expect(rollups.today.messagesSent).toBe(2);
    expect(rollups.allTime.messagesSent).toBe(2);
    expect(rollups.today.tokensReceived).toBe(42);
    expect(rollups.last7Days.messagesSent).toBe(2);
    expect(rollups.last30Days.messagesSent).toBe(2);
  });

  it("persists across store instances", async () => {
    const first = new ActivityStatsStore(filePath);
    await first.increment("artifactsCreated", 3);

    const second = new ActivityStatsStore(filePath);
    const rollups = await second.getRollups();
    expect(rollups.allTime.artifactsCreated).toBe(3);
    expect(rollups.today.artifactsCreated).toBe(3);
  });

  it("serializes concurrent increments without losing counts", async () => {
    const store = new ActivityStatsStore(filePath);
    await Promise.all(Array.from({ length: 25 }, () => store.increment("toolsCalled")));

    const rollups = await store.getRollups();
    expect(rollups.allTime.toolsCalled).toBe(25);
  });

  it("treats yesterday as zero when nothing happened yesterday", async () => {
    const store = new ActivityStatsStore(filePath);
    await store.increment("schedulesExecuted");
    const rollups = await store.getRollups();
    expect(rollups.yesterday.schedulesExecuted).toBe(0);
  });

  it("ignores a corrupt file and starts empty", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "{not json", "utf8");
    const store = new ActivityStatsStore(filePath);
    const rollups = await store.getRollups();
    expect(rollups.allTime.messagesSent).toBe(0);
  });

  it("coalesces a burst of increments into a single change notification", async () => {
    vi.useFakeTimers();
    try {
      const store = new ActivityStatsStore(filePath);
      const listener = vi.fn();
      store.onDidChange(listener);

      await store.increment("messagesSent");
      await store.increment("toolsCalled");
      await store.increment("thoughts", 5);
      expect(listener).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(listener).toHaveBeenCalledTimes(1);

      // A later increment opens a fresh window and notifies again.
      await store.increment("messagesReceived");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not notify when no listener is registered", async () => {
    vi.useFakeTimers();
    try {
      const store = new ActivityStatsStore(filePath);
      await store.increment("messagesSent");
      await vi.advanceTimersByTimeAsync(5_000);
      // Nothing to assert beyond "no crash": scheduling is skipped entirely.
      const rollups = await store.getRollups();
      expect(rollups.allTime.messagesSent).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
