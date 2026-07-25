import type { CodeDiagnostic } from "@otto-code/protocol/messages";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/**
 * Problems the language servers have reported for open documents, keyed by host and
 * document.
 *
 * The daemon pushes each document's **whole** current set, never a delta, so this store
 * replaces per document. That is what makes it self-correcting: a fix the user just typed
 * arrives as a shorter list, and there is no accumulated state that could keep a retracted
 * squiggle alive.
 *
 * Keyed on a normalised path rather than the raw string because the same file reaches the
 * app spelled several ways — a tab's workspace-relative path, the daemon's absolute one,
 * `\` from Windows and `/` from the wire.
 */

interface LspDiagnosticsState {
  /** serverId → normalised document path → that document's problems. */
  byServer: Record<string, Record<string, CodeDiagnostic[]>>;
  setDocument: (input: { serverId: string; path: string; diagnostics: CodeDiagnostic[] }) => void;
  clearDocument: (serverId: string, path: string) => void;
  clearServer: (serverId: string) => void;
}

const EMPTY: CodeDiagnostic[] = [];

/**
 * Matches the daemon's `documentKey` closely enough to compare: forward slashes and an
 * upper-cased drive letter. The rest keeps its case, because POSIX paths are
 * case-sensitive and lower-casing would merge two genuinely different files.
 */
function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
}

export const useLspDiagnosticsStore = create<LspDiagnosticsState>((set) => ({
  byServer: {},
  setDocument: ({ serverId, path, diagnostics }) =>
    set((state) => ({
      byServer: {
        ...state.byServer,
        [serverId]: { ...state.byServer[serverId], [normalizePath(path)]: diagnostics },
      },
    })),
  clearDocument: (serverId, path) =>
    set((state) => {
      const documents = state.byServer[serverId];
      const key = normalizePath(path);
      if (documents === undefined || !(key in documents)) {
        return state;
      }
      const next = { ...documents };
      delete next[key];
      return { byServer: { ...state.byServer, [serverId]: next } };
    }),
  clearServer: (serverId) =>
    set((state) => {
      if (!(serverId in state.byServer)) {
        return state;
      }
      const next = { ...state.byServer };
      delete next[serverId];
      return { byServer: next };
    }),
}));

/**
 * One document's problems.
 *
 * The daemon addresses a push by the path it was synced with, which for a file tab is the
 * absolute path — so callers pass the same thing they sync. `useShallow` keeps a stable
 * array identity while the set is unchanged, which matters because the consumer pushes it
 * into CodeMirror: a fresh array every render would redraw every marker on every keystroke.
 */
export function useCodeDiagnostics(
  serverId: string,
  filePath: string | null,
): readonly CodeDiagnostic[] {
  return useLspDiagnosticsStore(
    useShallow((state) =>
      filePath === null ? EMPTY : (state.byServer[serverId]?.[normalizePath(filePath)] ?? EMPTY),
    ),
  );
}

/** Error and warning counts for one document, for a status-bar style summary. */
export interface DiagnosticCounts {
  errors: number;
  warnings: number;
}

export function countDiagnostics(diagnostics: readonly CodeDiagnostic[]): DiagnosticCounts {
  let errors = 0;
  let warnings = 0;
  for (const entry of diagnostics) {
    if (entry.severity === "error") {
      errors += 1;
    } else if (entry.severity === "warning") {
      warnings += 1;
    }
  }
  return { errors, warnings };
}
