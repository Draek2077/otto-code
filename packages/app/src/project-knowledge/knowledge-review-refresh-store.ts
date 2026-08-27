import { create } from "zustand";

interface KnowledgeReviewRefreshState {
  revisions: Record<string, number>;
  notify: (serverId: string, workspaceId: string) => void;
}

function keyFor(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

export const useKnowledgeReviewRefreshStore = create<KnowledgeReviewRefreshState>((set) => ({
  revisions: {},
  notify: (serverId, workspaceId) =>
    set((state) => {
      const key = keyFor(serverId, workspaceId);
      return { revisions: { ...state.revisions, [key]: (state.revisions[key] ?? 0) + 1 } };
    }),
}));

export function useKnowledgeReviewRefreshRevision(serverId: string, workspaceId: string): number {
  return useKnowledgeReviewRefreshStore(
    (state) => state.revisions[keyFor(serverId, workspaceId)] ?? 0,
  );
}
