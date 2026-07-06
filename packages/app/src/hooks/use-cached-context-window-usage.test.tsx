/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useContextUsageCacheStore } from "@/stores/context-usage-cache-store";
import {
  useCachedContextWindowUsage,
  type ContextWindowUsageValues,
} from "./use-cached-context-window-usage";

describe("useCachedContextWindowUsage", () => {
  beforeEach(() => {
    useContextUsageCacheStore.setState({ entries: {} });
  });

  it("returns live values as-is when they're present", () => {
    const { result } = renderHook(() =>
      useCachedContextWindowUsage("server-a", "agent-1", {
        maxTokens: 1000,
        usedTokens: 250,
        totalCostUsd: 0.5,
      }),
    );

    expect(result.current).toEqual({ maxTokens: 1000, usedTokens: 250, totalCostUsd: 0.5 });
  });

  it("falls back to the cached usage once live data drops to null", () => {
    const { result, rerender } = renderHook(
      ({ live }: { live: ContextWindowUsageValues }) =>
        useCachedContextWindowUsage("server-a", "agent-1", live),
      {
        initialProps: {
          live: { maxTokens: 1000, usedTokens: 250, totalCostUsd: 0.5 } as ContextWindowUsageValues,
        },
      },
    );

    expect(result.current).toEqual({ maxTokens: 1000, usedTokens: 250, totalCostUsd: 0.5 });

    rerender({ live: { maxTokens: null, usedTokens: null, totalCostUsd: null } });

    expect(result.current).toEqual({ maxTokens: 1000, usedTokens: 250, totalCostUsd: 0.5 });
  });

  it("returns nulls when neither live nor cached data is available", () => {
    const { result } = renderHook(() =>
      useCachedContextWindowUsage("server-a", "brand-new-agent", {
        maxTokens: null,
        usedTokens: null,
        totalCostUsd: null,
      }),
    );

    expect(result.current).toEqual({ maxTokens: null, usedTokens: null, totalCostUsd: null });
  });

  it("scopes the cache per agent id so a new draft never inherits another chat's usage", () => {
    renderHook(() =>
      useCachedContextWindowUsage("server-a", "agent-1", {
        maxTokens: 1000,
        usedTokens: 900,
        totalCostUsd: 1.2,
      }),
    );

    const { result } = renderHook(() =>
      useCachedContextWindowUsage("server-a", "draft-tab-1", {
        maxTokens: null,
        usedTokens: null,
        totalCostUsd: null,
      }),
    );

    expect(result.current).toEqual({ maxTokens: null, usedTokens: null, totalCostUsd: null });
  });
});
