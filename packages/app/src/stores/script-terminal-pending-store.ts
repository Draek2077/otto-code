import { create } from "zustand";

/**
 * Script terminals that have been started but aren't in the terminals list yet.
 *
 * Starting a script is meant to open a focused terminal tab, but the workspace
 * layout prunes terminal tabs whose id isn't in the terminals query data
 * (`collapseStaleEntityTabs`), and the daemon's list lags the
 * `start_workspace_script_response` by a refetch. Holding the id here bridges
 * that gap so the tab survives long enough to be real.
 *
 * The set is shared rather than local to the workspace screen because scripts
 * start from three places — the workspace header, the mobile header, and the
 * sidebar tools cluster — and the sidebar renders outside the screen that owns
 * the terminals query. A call site that marked nothing used to open a tab the
 * next reconcile pass immediately closed again.
 *
 * Entries are keyed by (host, workspace) and carry the `dataUpdatedAt` of the
 * terminals query at the time they were marked: an entry is dropped once the
 * terminal shows up live, or once a *fresher* list has come back without it.
 */
const EMPTY_PENDING: ReadonlyMap<string, number> = new Map();

interface ScriptTerminalPendingState {
  pendingByWorkspace: Record<string, ReadonlyMap<string, number>>;
  markPending: (workspaceKey: string, terminalId: string, listedAt: number) => void;
  reconcile: (
    workspaceKey: string,
    input: { liveTerminalIds: readonly string[]; dataUpdatedAt: number },
  ) => void;
  clear: (workspaceKey: string) => void;
}

export function buildScriptTerminalWorkspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}::${workspaceId}`;
}

export const useScriptTerminalPendingStore = create<ScriptTerminalPendingState>((set) => ({
  pendingByWorkspace: {},
  markPending: (workspaceKey, terminalId, listedAt) =>
    set((state) => {
      const current = state.pendingByWorkspace[workspaceKey] ?? EMPTY_PENDING;
      if (current.get(terminalId) === listedAt) {
        return state;
      }
      const next = new Map(current);
      next.set(terminalId, listedAt);
      return {
        pendingByWorkspace: { ...state.pendingByWorkspace, [workspaceKey]: next },
      };
    }),
  reconcile: (workspaceKey, { liveTerminalIds, dataUpdatedAt }) =>
    set((state) => {
      const current = state.pendingByWorkspace[workspaceKey];
      if (!current || current.size === 0) {
        return state;
      }
      const liveIds = new Set(liveTerminalIds);
      const next = new Map<string, number>();
      for (const [terminalId, listedAt] of current) {
        if (liveIds.has(terminalId) || dataUpdatedAt > listedAt) {
          continue;
        }
        next.set(terminalId, listedAt);
      }
      if (next.size === current.size) {
        return state;
      }
      return {
        pendingByWorkspace: { ...state.pendingByWorkspace, [workspaceKey]: next },
      };
    }),
  clear: (workspaceKey) =>
    set((state) => {
      if (!state.pendingByWorkspace[workspaceKey]) {
        return state;
      }
      const { [workspaceKey]: _removed, ...rest } = state.pendingByWorkspace;
      return { pendingByWorkspace: rest };
    }),
}));

export function useScriptTerminalPendingIds(workspaceKey: string): ReadonlyMap<string, number> {
  return useScriptTerminalPendingStore(
    (state) => state.pendingByWorkspace[workspaceKey] ?? EMPTY_PENDING,
  );
}

/**
 * Marks a freshly started script terminal as pending for the workspace, so the
 * tab a caller opens next survives until the terminals list catches up. Every
 * "start script" call site must go through this before opening the tab.
 */
export function markScriptTerminalPending(input: {
  serverId: string;
  workspaceId: string;
  terminalId: string;
  listedAt: number;
}): void {
  useScriptTerminalPendingStore
    .getState()
    .markPending(
      buildScriptTerminalWorkspaceKey(input.serverId, input.workspaceId),
      input.terminalId,
      input.listedAt,
    );
}
