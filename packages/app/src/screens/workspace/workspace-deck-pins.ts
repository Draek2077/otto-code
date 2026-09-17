import { useEffect } from "react";

// Workspaces whose mounted tree owns state that unmounting would destroy (an
// external editor's Vim session is killed on unmount). The deck's idle eviction
// skips a pinned workspace; the count cap still applies.
const pinCounts = new Map<string, number>();

export function isWorkspaceDeckEntryPinned(selectionKey: string): boolean {
  return (pinCounts.get(selectionKey) ?? 0) > 0;
}

export function useWorkspaceDeckPin(serverId: string, workspaceId: string): void {
  useEffect(() => {
    const key = `${serverId}:${workspaceId}`;
    pinCounts.set(key, (pinCounts.get(key) ?? 0) + 1);
    return () => {
      const next = (pinCounts.get(key) ?? 1) - 1;
      if (next > 0) {
        pinCounts.set(key, next);
      } else {
        pinCounts.delete(key);
      }
    };
  }, [serverId, workspaceId]);
}
