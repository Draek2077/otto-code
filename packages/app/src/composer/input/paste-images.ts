import { useCallback, useEffect, useRef, useState } from "react";
import { isWeb } from "@/constants/platform";
import {
  collectImageFilesFromClipboardData,
  filesToImageAttachments,
} from "@/utils/image-attachments-from-files";
import type { ImageAttachment } from "@/composer/types";

export const PASTED_IMAGE_PERSIST_TIMEOUT_MS = 30_000;

export interface TextAreaHandle {
  scrollHeight?: number;
  clientHeight?: number;
  offsetHeight?: number;
  scrollTop?: number;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  style?: {
    height?: string;
    overflowY?: string;
  } & Record<string, unknown>;
}

interface PasteImagesEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  inputReplacementKey: string | undefined;
  isConnected: boolean;
  disabled: boolean;
  isDictating: boolean;
  isRealtimeVoiceForCurrentAgent: boolean;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  onPasteError?: (error: Error) => void;
}

/**
 * Persists Ctrl+V image data before it becomes a composer attachment.
 *
 * The paste event and Send can arrive in consecutive browser tasks. Keeping a
 * pending count here prevents Send from snapshotting the composer between
 * those two operations, which would otherwise create a text-only message and
 * leave the image behind in the draft.
 */
export function usePasteImagesEffect(args: PasteImagesEffectArgs): boolean {
  const {
    getWebTextArea,
    inputReplacementKey,
    isConnected,
    disabled,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
    onPasteError,
  } = args;
  const [pendingPasteCount, setPendingPasteCount] = useState(0);
  const pendingPasteCountRef = useRef(0);
  const pendingTimeoutsRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const isMountedRef = useRef(false);

  useEffect(() => {
    const pendingTimeouts = pendingTimeoutsRef.current;
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const timeout of pendingTimeouts) {
        clearTimeout(timeout);
      }
      pendingTimeouts.clear();
    };
  }, []);

  const updatePendingPasteCount = useCallback((change: 1 | -1) => {
    pendingPasteCountRef.current = Math.max(0, pendingPasteCountRef.current + change);
    if (isMountedRef.current) {
      setPendingPasteCount(pendingPasteCountRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isWeb || !onAddImages) return;

    const textarea = getWebTextArea() as
      | (TextAreaHandle & {
          addEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
          removeEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
        })
      | null;
    if (
      !textarea ||
      typeof textarea.addEventListener !== "function" ||
      typeof textarea.removeEventListener !== "function"
    ) {
      return;
    }

    let disposed = false;
    const handlePaste = (event: ClipboardEvent) => {
      if (!isConnected || disabled || isDictating || isRealtimeVoiceForCurrentAgent) return;

      const imageFiles = collectImageFilesFromClipboardData(event.clipboardData);
      if (imageFiles.length === 0) return;

      event.preventDefault();
      updatePendingPasteCount(1);

      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const finish = () => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeout);
        pendingTimeoutsRef.current.delete(timeout);
        updatePendingPasteCount(-1);
        return true;
      };
      const shouldReport = () => !disposed || getWebTextArea() === textarea;
      timeout = setTimeout(() => {
        if (!finish() || !shouldReport()) return;
        const error = new Error("Pasted image processing timed out.");
        console.error("[MessageInput] Failed to process pasted images:", error);
        onPasteError?.(error);
      }, PASTED_IMAGE_PERSIST_TIMEOUT_MS);
      pendingTimeoutsRef.current.add(timeout);

      void filesToImageAttachments(imageFiles)
        .then((pastedAttachments) => {
          // Effects may refresh because a callback identity changed while this
          // image is writing. Only discard it when its source textarea was
          // actually replaced (for example, a completed send remounted it).
          if (settled || !shouldReport() || pastedAttachments.length === 0) {
            finish();
            return undefined;
          }
          onAddImages(pastedAttachments);
          finish();
          return undefined;
        })
        .catch((error) => {
          if (!finish() || !shouldReport()) return;
          console.error("[MessageInput] Failed to process pasted images:", error);
          onPasteError?.(error instanceof Error ? error : new Error(String(error)));
        });
    };

    textarea.addEventListener("paste", handlePaste);
    return () => {
      disposed = true;
      textarea.removeEventListener?.("paste", handlePaste);
    };
  }, [
    disabled,
    getWebTextArea,
    inputReplacementKey,
    isConnected,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
    onPasteError,
    updatePendingPasteCount,
  ]);

  return pendingPasteCount > 0;
}
