import { create } from "zustand";
// Deliberate graph-only state belongs to the workspace tab, not the agent's
// current turn. Sending a message or switching draft/agent identities keeps it.
export const useVisualizerBackgroundState = create<{
  hidden: Record<string, boolean>;
  setHidden(key: string, hidden: boolean): void;
  remove(key: string): void;
  prune(open: ReadonlySet<string>): void;
}>((set) => ({
  hidden: {},
  setHidden(key, hidden) {
    set((state) => ({ hidden: Object.assign({}, state.hidden, { [key]: hidden }) }));
  },
  remove(key) {
    set((state) => {
      const next = { ...state.hidden };
      delete next[key];
      return { hidden: next };
    });
  },
  prune(open) {
    set((state) => {
      const closed = Object.keys(state.hidden).filter((key) => !open.has(key));
      if (!closed.length) return state;
      const hidden = { ...state.hidden };
      for (const key of closed) delete hidden[key];
      return { hidden };
    });
  },
}));
