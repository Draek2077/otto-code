import { create } from "zustand";

/**
 * Tracks which preview dev servers are actually running, independent of
 * whether their preview tab is open. Closing a preview tab with the
 * "keep-running" setting leaves the server alive but removes its browser
 * record from browser-store, so that store can't answer "is anything
 * running" on its own.
 *
 * Bucketed by (daemon session, cwd) because `preview.list_config` only
 * reconciles servers for one cwd at a time — replacing a session's whole set
 * on every fetch would wipe out servers known to be running under a
 * different cwd on the same session.
 */
interface PreviewRunningServersState {
  runningServerIdsBySessionAndCwd: Record<string, Record<string, Set<string>>>;
  markRunning: (sessionId: string, cwd: string, serverId: string) => void;
  markStopped: (sessionId: string, serverId: string) => void;
  replaceRunningForCwd: (sessionId: string, cwd: string, serverIds: string[]) => void;
}

export const usePreviewRunningServersStore = create<PreviewRunningServersState>((set) => ({
  runningServerIdsBySessionAndCwd: {},
  markRunning: (sessionId, cwd, serverId) =>
    set((state) => {
      const byCwd = state.runningServerIdsBySessionAndCwd[sessionId] ?? {};
      const next = new Set(byCwd[cwd]);
      next.add(serverId);
      return {
        runningServerIdsBySessionAndCwd: {
          ...state.runningServerIdsBySessionAndCwd,
          [sessionId]: { ...byCwd, [cwd]: next },
        },
      };
    }),
  markStopped: (sessionId, serverId) =>
    set((state) => {
      const byCwd = state.runningServerIdsBySessionAndCwd[sessionId];
      if (!byCwd) {
        return state;
      }
      let changed = false;
      const nextByCwd: Record<string, Set<string>> = {};
      for (const [cwd, serverIds] of Object.entries(byCwd)) {
        if (serverIds.has(serverId)) {
          const next = new Set(serverIds);
          next.delete(serverId);
          nextByCwd[cwd] = next;
          changed = true;
        } else {
          nextByCwd[cwd] = serverIds;
        }
      }
      if (!changed) {
        return state;
      }
      return {
        runningServerIdsBySessionAndCwd: {
          ...state.runningServerIdsBySessionAndCwd,
          [sessionId]: nextByCwd,
        },
      };
    }),
  replaceRunningForCwd: (sessionId, cwd, serverIds) =>
    set((state) => {
      const byCwd = state.runningServerIdsBySessionAndCwd[sessionId] ?? {};
      return {
        runningServerIdsBySessionAndCwd: {
          ...state.runningServerIdsBySessionAndCwd,
          [sessionId]: { ...byCwd, [cwd]: new Set(serverIds) },
        },
      };
    }),
}));

export function useHasRunningPreviewServer(sessionId: string): boolean {
  return usePreviewRunningServersStore((state) => {
    const byCwd = state.runningServerIdsBySessionAndCwd[sessionId];
    if (!byCwd) {
      return false;
    }
    return Object.values(byCwd).some((serverIds) => serverIds.size > 0);
  });
}
