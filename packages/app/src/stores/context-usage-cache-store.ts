import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface CachedContextWindowUsage {
  maxTokens: number;
  usedTokens: number;
  totalCostUsd: number | null;
  updatedAt: number;
}

interface ContextUsageCacheState {
  entries: Record<string, CachedContextWindowUsage>;
  setUsage: (key: string, usage: CachedContextWindowUsage) => void;
}

// Bounds storage growth across the lifetime of the app: agents get archived
// and never read again, so without a cap this would grow forever.
export const MAX_CACHED_ENTRIES = 300;

export function buildContextUsageCacheKey(serverId: string, agentId: string): string {
  return `${serverId}::${agentId}`;
}

function pruneOldestEntries(
  entries: Record<string, CachedContextWindowUsage>,
): Record<string, CachedContextWindowUsage> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_CACHED_ENTRIES) {
    return entries;
  }
  const sortedByAge = keys.sort((a, b) => entries[a].updatedAt - entries[b].updatedAt);
  const next = { ...entries };
  for (const key of sortedByAge.slice(0, keys.length - MAX_CACHED_ENTRIES)) {
    delete next[key];
  }
  return next;
}

export const useContextUsageCacheStore = create<ContextUsageCacheState>()(
  persist(
    (set) => ({
      entries: {},
      setUsage: (key, usage) => {
        set((state) => ({
          entries: pruneOldestEntries({ ...state.entries, [key]: usage }),
        }));
      },
    }),
    {
      name: "otto-context-usage-cache",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
