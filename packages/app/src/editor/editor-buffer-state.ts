import type { FileEol } from "@otto-code/protocol/messages";

// Pure state + transitions for one editor buffer. The zustand wrapper in
// editor-buffer-store.ts applies these; unit tests target this module.

export interface EditorBufferBaseline {
  /** LF-normalized text as last loaded from or acknowledged by the daemon. */
  content: string;
  modifiedAt: string;
  hash: string | null;
  eol: FileEol;
}

export interface EditorBufferConflict {
  modifiedAt: string;
  hash: string;
  /** LF-normalized current disk text; null when unavailable (e.g. binary). */
  content: string | null;
  eol: FileEol | null;
}

export type EditorBufferStatus = "loading" | "ready" | "error";

export type EditorDiskChange =
  /** `hash` is null for a file over the daemon's hashing limit. */
  { kind: "changed"; modifiedAt: string; hash: string | null } | { kind: "deleted" };

export interface EditorBufferState {
  status: EditorBufferStatus;
  error: string | null;
  /** Workspace root the daemon RPCs are scoped to. */
  cwd: string;
  baseline: EditorBufferBaseline | null;
  dirty: boolean;
  saving: boolean;
  conflict: EditorBufferConflict | null;
  /**
   * Debounced mirror of the live document, kept so host remounts and webview
   * crashes cannot lose edits. May lag the editor; saves always pull the
   * exact buffer through the controller instead.
   */
  draft: string | null;
  /** External change detected under a dirty buffer; drives the sync banner. */
  diskChange: EditorDiskChange | null;
  /** The file is gone from disk; the next save re-creates it. */
  missingOnDisk: boolean;
}

export function normalizeToLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function buildEditorBufferKey(input: {
  serverId: string;
  workspaceId: string;
  path: string;
}): string {
  return `${input.serverId}\0${input.workspaceId}\0${input.path}`;
}

export function createLoadingBuffer(cwd: string): EditorBufferState {
  return {
    status: "loading",
    error: null,
    cwd,
    baseline: null,
    dirty: false,
    saving: false,
    conflict: null,
    draft: null,
    diskChange: null,
    missingOnDisk: false,
  };
}

export function applyLoaded(
  state: EditorBufferState,
  baseline: EditorBufferBaseline,
): EditorBufferState {
  return {
    ...state,
    status: "ready",
    error: null,
    baseline,
    dirty: false,
    saving: false,
    conflict: null,
    draft: null,
    diskChange: null,
    missingOnDisk: false,
  };
}

export function applyLoadError(state: EditorBufferState, message: string): EditorBufferState {
  return {
    ...state,
    status: "error",
    error: message,
    baseline: null,
    dirty: false,
    saving: false,
    conflict: null,
  };
}

export function applyDirtyChanged(state: EditorBufferState, dirty: boolean): EditorBufferState {
  if (state.dirty === dirty) {
    return state;
  }
  return dirty ? { ...state, dirty } : { ...state, dirty, draft: null };
}

export function applyDraftChanged(state: EditorBufferState, draft: string): EditorBufferState {
  return { ...state, draft };
}

export function applyBeginSave(state: EditorBufferState): EditorBufferState {
  return { ...state, saving: true, conflict: null };
}

export function applySaveOk(
  state: EditorBufferState,
  baseline: EditorBufferBaseline,
): EditorBufferState {
  return {
    ...state,
    saving: false,
    dirty: false,
    baseline,
    conflict: null,
    draft: null,
    diskChange: null,
    missingOnDisk: false,
  };
}

export function applySaveConflict(
  state: EditorBufferState,
  conflict: EditorBufferConflict,
): EditorBufferState {
  // The conflict banner carries fresher disk identity than any pending
  // disk-change banner; showing both would be noise.
  return { ...state, saving: false, conflict, diskChange: null };
}

/**
 * "Keep my changes": adopt the disk state as the new baseline (so the next
 * save preconditions honestly and revert restores the disk version) while the
 * user's document stays as-is.
 */
export function applyRebaseline(
  state: EditorBufferState,
  baseline: EditorBufferBaseline,
): EditorBufferState {
  return { ...state, baseline, diskChange: null, missingOnDisk: false };
}

export function applyDiskChanged(
  state: EditorBufferState,
  change: { modifiedAt: string; hash: string | null },
): EditorBufferState {
  return { ...state, diskChange: { kind: "changed", ...change }, missingOnDisk: false };
}

export function applyDiskDeleted(state: EditorBufferState): EditorBufferState {
  return { ...state, diskChange: { kind: "deleted" }, missingOnDisk: true };
}

/** Hides the banner; a deleted file keeps re-creating on save. */
export function applyDiskChangeDismissed(state: EditorBufferState): EditorBufferState {
  if (!state.diskChange) {
    return state;
  }
  return { ...state, diskChange: null };
}

export function applySaveError(state: EditorBufferState): EditorBufferState {
  return { ...state, saving: false };
}

export function applyConflictDismissed(state: EditorBufferState): EditorBufferState {
  if (!state.conflict) {
    return state;
  }
  return { ...state, conflict: null };
}
