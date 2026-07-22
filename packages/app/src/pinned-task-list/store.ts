import { create } from "zustand";

interface PinnedTaskListStore {
  // Keyed by `${serverId}:${agentId}` → the todo_list ids the user has closed.
  // Per-agent so dismissing one chat's checklist never hides another's, and so a
  // brand-new checklist (new id) re-appears even in a chat where an earlier one
  // was dismissed. Session-scoped; not persisted.
  dismissedByAgent: Record<string, readonly string[]>;
  dismiss: (agentKey: string, todoListId: string) => void;
}

export const usePinnedTaskListStore = create<PinnedTaskListStore>((set) => ({
  dismissedByAgent: {},
  dismiss: (agentKey, todoListId) =>
    set((state) => {
      const current = state.dismissedByAgent[agentKey] ?? [];
      if (current.includes(todoListId)) {
        return state;
      }
      return {
        dismissedByAgent: {
          ...state.dismissedByAgent,
          [agentKey]: [...current, todoListId],
        },
      };
    }),
}));
