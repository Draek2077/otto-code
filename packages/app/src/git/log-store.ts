import { create } from "zustand";
import type { GitOperationLogEntry } from "@otto-code/protocol/messages";

// Mirrors the daemon-side cap so a long-lived pane can't grow unbounded.
const MAX_ENTRIES_PER_LOG = 500;

export function buildGitLogKey(input: {
  serverId: string;
  cwd: string;
  operation: string;
}): string {
  return `${input.serverId}::${input.cwd}::${input.operation}`;
}

interface GitLogMergeInput {
  serverId: string;
  cwd: string;
  operation: string;
  entries: GitOperationLogEntry[];
}

interface GitLogStore {
  entriesByKey: Record<string, GitOperationLogEntry[]>;
  // Single write path for both backfill and live appends: entries merge by
  // seq, so a backfill racing a live push can never duplicate or reorder.
  mergeEntries: (input: GitLogMergeInput) => void;
}

function mergeBySeq(
  current: GitOperationLogEntry[],
  incoming: GitOperationLogEntry[],
): GitOperationLogEntry[] {
  const bySeq = new Map(current.map((entry) => [entry.seq, entry]));
  for (const entry of incoming) {
    bySeq.set(entry.seq, entry);
  }
  const merged = [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  return merged.length > MAX_ENTRIES_PER_LOG ? merged.slice(-MAX_ENTRIES_PER_LOG) : merged;
}

export const useGitLogStore = create<GitLogStore>()((set) => ({
  entriesByKey: {},

  mergeEntries: (input) => {
    if (input.entries.length === 0) {
      return;
    }
    set((state) => {
      const key = buildGitLogKey(input);
      return {
        entriesByKey: {
          ...state.entriesByKey,
          [key]: mergeBySeq(state.entriesByKey[key] ?? [], input.entries),
        },
      };
    });
  },
}));
