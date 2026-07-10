import { create } from "zustand";
import {
  applyBeginSave,
  applyConflictDismissed,
  applyDirtyChanged,
  applyDiskChangeDismissed,
  applyDiskChanged,
  applyDiskDeleted,
  applyDraftChanged,
  applyLoaded,
  applyLoadError,
  applyRebaseline,
  applySaveConflict,
  applySaveError,
  applySaveOk,
  buildEditorBufferKey,
  createLoadingBuffer,
  type EditorBufferBaseline,
  type EditorBufferConflict,
  type EditorBufferState,
} from "./editor-buffer-state";

interface EditorBufferStoreState {
  buffers: Record<string, EditorBufferState>;
  beginLoad: (key: string, cwd: string) => void;
  finishLoad: (key: string, baseline: EditorBufferBaseline) => void;
  failLoad: (key: string, message: string) => void;
  setDirty: (key: string, dirty: boolean) => void;
  setDraft: (key: string, draft: string) => void;
  beginSave: (key: string) => void;
  finishSave: (key: string, baseline: EditorBufferBaseline) => void;
  registerConflict: (key: string, conflict: EditorBufferConflict) => void;
  failSave: (key: string) => void;
  dismissConflict: (key: string) => void;
  rebaseline: (key: string, baseline: EditorBufferBaseline) => void;
  registerDiskChanged: (key: string, change: { modifiedAt: string; hash: string }) => void;
  registerDiskDeleted: (key: string) => void;
  dismissDiskChange: (key: string) => void;
  removeBuffer: (key: string) => void;
}

function updateBuffer(
  buffers: Record<string, EditorBufferState>,
  key: string,
  update: (state: EditorBufferState) => EditorBufferState,
): Record<string, EditorBufferState> {
  const current = buffers[key];
  if (!current) {
    return buffers;
  }
  const next = update(current);
  if (next === current) {
    return buffers;
  }
  return { ...buffers, [key]: next };
}

export const useEditorBufferStore = create<EditorBufferStoreState>((set) => ({
  buffers: {},
  beginLoad: (key, cwd) =>
    set((state) => ({ buffers: { ...state.buffers, [key]: createLoadingBuffer(cwd) } })),
  finishLoad: (key, baseline) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applyLoaded(buffer, baseline)),
    })),
  failLoad: (key, message) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applyLoadError(buffer, message)),
    })),
  setDirty: (key, dirty) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applyDirtyChanged(buffer, dirty)),
    })),
  setDraft: (key, draft) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applyDraftChanged(buffer, draft)),
    })),
  beginSave: (key) =>
    set((state) => ({ buffers: updateBuffer(state.buffers, key, applyBeginSave) })),
  finishSave: (key, baseline) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applySaveOk(buffer, baseline)),
    })),
  registerConflict: (key, conflict) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applySaveConflict(buffer, conflict)),
    })),
  failSave: (key) =>
    set((state) => ({ buffers: updateBuffer(state.buffers, key, applySaveError) })),
  dismissConflict: (key) =>
    set((state) => ({ buffers: updateBuffer(state.buffers, key, applyConflictDismissed) })),
  rebaseline: (key, baseline) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applyRebaseline(buffer, baseline)),
    })),
  registerDiskChanged: (key, change) =>
    set((state) => ({
      buffers: updateBuffer(state.buffers, key, (buffer) => applyDiskChanged(buffer, change)),
    })),
  registerDiskDeleted: (key) =>
    set((state) => ({ buffers: updateBuffer(state.buffers, key, applyDiskDeleted) })),
  dismissDiskChange: (key) =>
    set((state) => ({ buffers: updateBuffer(state.buffers, key, applyDiskChangeDismissed) })),
  removeBuffer: (key) =>
    set((state) => {
      if (!(key in state.buffers)) {
        return state;
      }
      const { [key]: _removed, ...rest } = state.buffers;
      return { buffers: rest };
    }),
}));

/**
 * Imperative dirty check for tab-close guards (panel-registry confirmClose
 * runs outside React).
 */
export function isEditorBufferDirty(input: {
  serverId: string;
  workspaceId: string;
  path: string;
}): boolean {
  const key = buildEditorBufferKey(input);
  return useEditorBufferStore.getState().buffers[key]?.dirty ?? false;
}

export function removeEditorBuffer(input: {
  serverId: string;
  workspaceId: string;
  path: string;
}): void {
  useEditorBufferStore.getState().removeBuffer(buildEditorBufferKey(input));
}

export { buildEditorBufferKey };
