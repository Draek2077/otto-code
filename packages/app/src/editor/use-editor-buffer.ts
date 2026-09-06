import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { FileWatchEventPayload } from "@otto-code/client/internal/daemon-client";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { EditorController } from "./editor-contract";
import { buildEditorBufferKey, useEditorBufferStore } from "./editor-buffer-store";
import { normalizeToLf, type EditorBufferState } from "./editor-buffer-state";

function registerCheckedDiskIdentity(
  key: string,
  state: EditorBufferState,
  file: { hash: string | null; modifiedAt: string },
) {
  const store = useEditorBufferStore.getState();
  if (file.hash && file.hash === state.baseline?.hash) {
    store.rebaseline(key, { ...state.baseline, modifiedAt: file.modifiedAt });
  } else if (file.hash) {
    store.registerDiskChanged(key, { modifiedAt: file.modifiedAt, hash: file.hash });
  }
}

export interface UseEditorBufferInput {
  serverId: string;
  workspaceId: string;
  /** Workspace root the daemon RPCs are scoped to. */
  workspaceRoot: string;
  path: string;
  controllerRef: RefObject<EditorController | null>;
}

export interface UseEditorBufferResult {
  buffer: EditorBufferState | null;
  onDirtyChanged: (dirty: boolean) => void;
  onDocSync: (doc: string) => void;
  save: () => Promise<void>;
  revert: () => Promise<void>;
  reloadFromConflict: () => Promise<void>;
  overwriteFromConflict: () => Promise<void>;
  overwriteFromDiskChange: () => Promise<void>;
  dismissConflict: () => void;
  reloadFromDisk: () => Promise<void>;
  diskCheckFailed: boolean;
  diskCheckPending: boolean;
  retryDiskCheck: () => Promise<void>;
  keepMyChanges: () => Promise<void>;
  dismissDiskChange: () => void;
}

/**
 * Owns one editor buffer's lifecycle: load, dirty tracking, conditional save,
 * and conflict resolution. The buffer state lives in the editor-buffer store
 * (so tab-close guards can read it imperatively); the document itself lives in
 * the editor and is pulled through the controller only when saving.
 */
export function useEditorBuffer(input: UseEditorBufferInput): UseEditorBufferResult {
  const { serverId, workspaceId, workspaceRoot, path, controllerRef } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const key = buildEditorBufferKey({ serverId, workspaceId, path });
  const buffer = useEditorBufferStore((state) => state.buffers[key] ?? null);

  // Guards a slow read landing after the tab was closed and reopened.
  const loadTokenRef = useRef(0);
  const diskReadTokenRef = useRef(0);
  const editRevisionRef = useRef(0);
  const [diskCheckFailed, setDiskCheckFailed] = useState(false);
  const [diskCheckPending, setDiskCheckPending] = useState(false);

  useEffect(() => {
    setDiskCheckFailed(false);
    setDiskCheckPending(false);
    return () => {
      loadTokenRef.current += 1;
      diskReadTokenRef.current += 1;
    };
  }, [client, key]);

  useEffect(() => {
    if (!client) {
      return;
    }
    const existing = useEditorBufferStore.getState().buffers[key];
    if (existing?.status === "ready" && existing.dirty && existing.draft != null) {
      // A host remount (layout change, webview crash) with unsaved edits -
      // the pane restores from the draft; don't clobber it with a fresh read.
      return;
    }
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    const store = useEditorBufferStore.getState();
    store.beginLoad(key, workspaceRoot);
    const load = async () => {
      try {
        const file = await client.readTextFile(workspaceRoot, path);
        if (loadTokenRef.current !== token) {
          return;
        }
        useEditorBufferStore.getState().finishLoad(key, {
          content: normalizeToLf(file.content),
          modifiedAt: file.modifiedAt,
          hash: file.hash,
          eol: file.eol,
        });
      } catch (error) {
        if (loadTokenRef.current !== token) {
          return;
        }
        useEditorBufferStore.getState().failLoad(key, getErrorMessage(error));
      }
    };
    void load();
  }, [client, key, path, workspaceRoot]);

  const onDirtyChanged = useCallback(
    (dirty: boolean) => {
      editRevisionRef.current += 1;
      useEditorBufferStore.getState().setDirty(key, dirty);
    },
    [key],
  );

  const onDocSync = useCallback(
    (doc: string) => {
      editRevisionRef.current += 1;
      useEditorBufferStore.getState().setDraft(key, doc);
    },
    [key],
  );

  const runConditionalWrite = useCallback(
    async (expected: { modifiedAt: string; hash: string | null }) => {
      const controller = controllerRef.current;
      const state = useEditorBufferStore.getState().buffers[key];
      if (!controller || !client || !state || state.saving) {
        return;
      }
      let doc: string;
      try {
        doc = await controller.getDoc();
      } catch (error) {
        toast.error(getErrorMessage(error));
        return;
      }
      const store = useEditorBufferStore.getState();
      diskReadTokenRef.current += 1;
      setDiskCheckPending(false);
      store.beginSave(key);
      try {
        const result = await client.writeFile({
          cwd: state.cwd,
          path,
          content: doc,
          expectedModifiedAt: expected.modifiedAt,
          expectedHash: expected.hash ?? undefined,
          // The deleted-file flow: save re-creates, carrying the baseline EOL
          // since there is no on-disk EOL left to detect.
          allowCreate: state.missingOnDisk ? true : undefined,
          eol: state.missingOnDisk ? state.baseline?.eol : undefined,
        });
        if (result.status === "ok") {
          setDiskCheckFailed(false);
          // No "you are clean now" call to the editor: the new baseline reaches
          // it as the `cleanDoc` prop, which also keeps it honest when the user
          // typed while the write was in flight.
          useEditorBufferStore.getState().finishSave(key, {
            content: normalizeToLf(doc),
            modifiedAt: result.modifiedAt,
            hash: result.hash,
            eol: result.eol,
          });
          return;
        }
        if (result.status === "conflict") {
          useEditorBufferStore.getState().registerConflict(key, {
            modifiedAt: result.modifiedAt,
            hash: result.hash,
            content: result.content != null ? normalizeToLf(result.content) : null,
            eol: result.eol ?? null,
          });
          return;
        }
        useEditorBufferStore.getState().failSave(key);
        toast.error(result.message);
      } catch (error) {
        useEditorBufferStore.getState().failSave(key);
        toast.error(getErrorMessage(error));
      }
    },
    [client, controllerRef, key, path, toast],
  );

  const save = useCallback(async () => {
    const state = useEditorBufferStore.getState().buffers[key];
    if (!state?.baseline || !state.dirty || state.conflict) {
      return;
    }
    await runConditionalWrite({
      modifiedAt: state.baseline.modifiedAt,
      hash: state.baseline.hash,
    });
  }, [key, runConditionalWrite]);

  const revert = useCallback(async () => {
    const state = useEditorBufferStore.getState().buffers[key];
    if (!state?.baseline || !state.dirty) {
      return;
    }
    const confirmed = await confirmDialog({
      title: t("editor.revertDialog.title"),
      message: t("editor.revertDialog.message"),
      confirmLabel: t("editor.revertDialog.confirm"),
      cancelLabel: t("editor.cancel"),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    controllerRef.current?.setDoc(state.baseline.content);
    const store = useEditorBufferStore.getState();
    store.setDirty(key, false);
    store.dismissConflict(key);
  }, [controllerRef, key, t]);

  // Automatic checks preserve edits. An explicit Reload may replace existing
  // edits, but neither kind of read may erase typing or a save begun afterward.
  const readDisk = useCallback(
    async (replaceEdits: boolean, verifyDeletion = false) => {
      const state = useEditorBufferStore.getState().buffers[key];
      if (!state || !client || state.saving) {
        return;
      }
      const token = ++diskReadTokenRef.current;
      const editRevision = editRevisionRef.current;
      setDiskCheckPending(true);
      try {
        const file = await client.readTextFile(state.cwd, path);
        if (token !== diskReadTokenRef.current) return;
        const current = useEditorBufferStore.getState().buffers[key];
        if (!current || current.saving || current.baseline !== state.baseline) return;
        setDiskCheckFailed(false);
        const content = normalizeToLf(file.content);
        if (editRevisionRef.current !== editRevision || (!replaceEdits && current.dirty)) {
          registerCheckedDiskIdentity(key, current, file);
          return;
        }
        useEditorBufferStore.getState().finishLoad(key, {
          content,
          modifiedAt: file.modifiedAt,
          hash: file.hash,
          eol: file.eol,
        });
        controllerRef.current?.setDoc(content);
      } catch (error) {
        if (token !== diskReadTokenRef.current) return;
        // The watcher reports absence during atomic replacements too. Confirm
        // it with a read; other failures (including a directory at this path)
        // keep the buffer and expose Retry instead of claiming deletion.
        if (verifyDeletion && /\bENOENT\b/.test(getErrorMessage(error))) {
          useEditorBufferStore.getState().registerDiskDeleted(key);
          setDiskCheckFailed(false);
        } else {
          setDiskCheckFailed(true);
        }
      } finally {
        if (token === diskReadTokenRef.current) setDiskCheckPending(false);
      }
    },
    [client, controllerRef, key, path],
  );

  const reloadFromDisk = useCallback(() => readDisk(true), [readDisk]);
  const retryDiskCheck = useCallback(() => readDisk(false), [readDisk]);

  const reloadFromConflict = useCallback(async () => {
    const state = useEditorBufferStore.getState().buffers[key];
    const conflict = state?.conflict;
    if (!state || !conflict) {
      return;
    }
    if (conflict.content != null) {
      const eol = conflict.eol ?? state.baseline?.eol ?? "lf";
      useEditorBufferStore.getState().finishLoad(key, {
        content: conflict.content,
        modifiedAt: conflict.modifiedAt,
        hash: conflict.hash,
        eol,
      });
      controllerRef.current?.setDoc(conflict.content);
      return;
    }
    await reloadFromDisk();
  }, [controllerRef, key, reloadFromDisk]);

  /**
   * "Keep my changes": adopt the disk state as the new baseline while the
   * document stays as-is - the next save preconditions honestly against what
   * is actually on disk, and revert restores the disk version.
   */
  const keepMyChanges = useCallback(async () => {
    const state = useEditorBufferStore.getState().buffers[key];
    if (!state?.baseline || !client) {
      return;
    }
    if (state.diskChange?.kind !== "changed") {
      useEditorBufferStore.getState().dismissDiskChange(key);
      return;
    }
    try {
      const file = await client.readTextFile(state.cwd, path);
      useEditorBufferStore.getState().rebaseline(key, {
        content: normalizeToLf(file.content),
        modifiedAt: file.modifiedAt,
        hash: file.hash,
        eol: file.eol,
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [client, key, path, toast]);

  const dismissDiskChange = useCallback(() => {
    useEditorBufferStore.getState().dismissDiskChange(key);
  }, [key]);

  const handleWatchEvent = useCallback(
    (event: FileWatchEventPayload) => {
      const state = useEditorBufferStore.getState().buffers[key];
      if (!state || state.status !== "ready" || !state.baseline) {
        return;
      }
      if (event.change === "deleted") {
        void readDisk(false, true);
        return;
      }
      // A save is in flight; its result carries the fresh identity.
      if (state.saving) {
        return;
      }
      if (event.hash && event.hash === state.baseline.hash) {
        diskReadTokenRef.current += 1;
        setDiskCheckFailed(false);
        setDiskCheckPending(false);
        // Same content (our own save echoing back, or a touch/checkout of an
        // identical file) - refresh the identity silently.
        useEditorBufferStore.getState().rebaseline(key, {
          ...state.baseline,
          modifiedAt: event.modifiedAt ?? state.baseline.modifiedAt,
        });
        return;
      }
      if (!state.dirty) {
        // The agreed policy: an unedited buffer follows the disk silently.
        void retryDiskCheck();
        return;
      }
      if (event.modifiedAt && event.hash) {
        // A newer watcher identity supersedes any in-flight check. Preserve
        // the edited document and show the newly observed disk version.
        diskReadTokenRef.current += 1;
        setDiskCheckPending(false);
        setDiskCheckFailed(false);
        useEditorBufferStore.getState().registerDiskChanged(key, {
          modifiedAt: event.modifiedAt,
          hash: event.hash,
        });
      }
    },
    [key, readDisk, retryDiskCheck],
  );

  const handleWatchEventRef = useRef(handleWatchEvent);
  handleWatchEventRef.current = handleWatchEvent;

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.watchFile(workspaceRoot, path, (event) => {
      handleWatchEventRef.current(event);
    });
  }, [client, path, workspaceRoot]);

  const overwriteFromConflict = useCallback(async () => {
    const state = useEditorBufferStore.getState().buffers[key];
    const conflict = state?.conflict;
    if (!conflict) {
      return;
    }
    // Still a conditional write: it targets exactly the disk identity the user
    // was shown, so a third writer between the conflict and this click
    // surfaces as a fresh conflict instead of being clobbered.
    await runConditionalWrite({ modifiedAt: conflict.modifiedAt, hash: conflict.hash });
  }, [key, runConditionalWrite]);

  const overwriteFromDiskChange = useCallback(async () => {
    const change = useEditorBufferStore.getState().buffers[key]?.diskChange;
    if (change?.kind !== "changed") return;
    // Overwrite only the disk identity shown by the watcher. A later external
    // edit must still produce a conflict instead of being silently replaced.
    await runConditionalWrite({ modifiedAt: change.modifiedAt, hash: change.hash });
  }, [key, runConditionalWrite]);

  const dismissConflict = useCallback(() => {
    useEditorBufferStore.getState().dismissConflict(key);
  }, [key]);

  return {
    buffer,
    onDirtyChanged,
    onDocSync,
    save,
    revert,
    reloadFromConflict,
    overwriteFromConflict,
    overwriteFromDiskChange,
    dismissConflict,
    reloadFromDisk,
    diskCheckFailed,
    diskCheckPending,
    retryDiskCheck,
    keepMyChanges,
    dismissDiskChange,
  };
}
