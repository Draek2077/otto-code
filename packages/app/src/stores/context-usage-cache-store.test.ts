import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  buildContextUsageCacheKey,
  MAX_CACHED_ENTRIES,
  useContextUsageCacheStore,
} from "./context-usage-cache-store";

describe("context usage cache store", () => {
  beforeEach(() => {
    useContextUsageCacheStore.setState({ entries: {} });
  });

  it("builds a key that scopes an agent id to its server", () => {
    expect(buildContextUsageCacheKey("server-a", "agent-1")).toBe("server-a::agent-1");
    expect(buildContextUsageCacheKey("server-a", "agent-1")).not.toBe(
      buildContextUsageCacheKey("server-b", "agent-1"),
    );
  });

  it("stores and overwrites usage for a key", () => {
    const key = buildContextUsageCacheKey("server-a", "agent-1");
    useContextUsageCacheStore
      .getState()
      .setUsage(key, { maxTokens: 100, usedTokens: 10, totalCostUsd: 0.01, updatedAt: 1 });
    useContextUsageCacheStore
      .getState()
      .setUsage(key, { maxTokens: 100, usedTokens: 20, totalCostUsd: 0.02, updatedAt: 2 });

    expect(useContextUsageCacheStore.getState().entries[key]).toEqual({
      maxTokens: 100,
      usedTokens: 20,
      totalCostUsd: 0.02,
      updatedAt: 2,
    });
  });

  it("drops the oldest entries once the cache exceeds its cap", () => {
    const { setUsage } = useContextUsageCacheStore.getState();
    for (let i = 0; i < MAX_CACHED_ENTRIES + 5; i++) {
      setUsage(buildContextUsageCacheKey("server-a", `agent-${i}`), {
        maxTokens: 100,
        usedTokens: 1,
        totalCostUsd: null,
        updatedAt: i,
      });
    }

    const entries = useContextUsageCacheStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(MAX_CACHED_ENTRIES);
    expect(entries[buildContextUsageCacheKey("server-a", "agent-0")]).toBeUndefined();
    expect(entries[buildContextUsageCacheKey("server-a", "agent-4")]).toBeUndefined();
    expect(entries[buildContextUsageCacheKey("server-a", "agent-5")]).toBeDefined();
  });
});
