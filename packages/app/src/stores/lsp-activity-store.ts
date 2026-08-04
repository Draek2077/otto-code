import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/**
 * Which workspaces currently have a language server starting up or indexing, keyed by
 * host. The daemon pushes the whole busy set on every change, so this store replaces
 * rather than merges - a snapshot cannot drift the way accumulated transitions would.
 *
 * It exists so a cold start is *visible*. On a large project the first lookup pays for
 * the server's project model, and silence there reads as the feature being broken; the
 * sidebar spinner says the work is live.
 */

interface LspActivityState {
  /** serverId → workspace roots with work in flight, normalised for comparison. */
  busyRootsByServer: Record<string, string[]>;
  setBusyRoots: (serverId: string, busyRoots: string[]) => void;
  clearServer: (serverId: string) => void;
}

/** Matches the daemon's `documentKey`: forward slashes, upper-cased drive letter. */
function normalizeRoot(rootPath: string): string {
  return rootPath
    .replace(/\\/g, "/")
    .replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
}

export const useLspActivityStore = create<LspActivityState>((set) => ({
  busyRootsByServer: {},
  setBusyRoots: (serverId, busyRoots) =>
    set((state) => ({
      busyRootsByServer: { ...state.busyRootsByServer, [serverId]: busyRoots.map(normalizeRoot) },
    })),
  clearServer: (serverId) =>
    set((state) => {
      if (!(serverId in state.busyRootsByServer)) {
        return state;
      }
      const next = { ...state.busyRootsByServer };
      delete next[serverId];
      return { busyRootsByServer: next };
    }),
}));

/**
 * Whether this specific workspace has language-server work in flight. Selects a
 * primitive so a row only re-renders when its own answer changes, not whenever any
 * workspace on the host starts or stops indexing.
 */
export function useIsLspBusy(serverId: string, workspaceDirectory: string | null): boolean {
  return useLspActivityStore((state) => {
    if (workspaceDirectory === null) {
      return false;
    }
    const roots = state.busyRootsByServer[serverId];
    if (roots === undefined || roots.length === 0) {
      return false;
    }
    return roots.includes(normalizeRoot(workspaceDirectory));
  });
}

/** Every busy root on a host, for surfaces that summarise rather than mark one row. */
export function useBusyLspRoots(serverId: string): string[] {
  return useLspActivityStore(useShallow((state) => state.busyRootsByServer[serverId] ?? []));
}
