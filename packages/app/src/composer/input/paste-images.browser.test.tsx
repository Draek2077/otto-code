import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PASTED_IMAGE_PERSIST_TIMEOUT_MS, usePasteImagesEffect } from "./paste-images";
import type { ImageAttachment } from "@/composer/types";

const imageAttachmentHelpers = vi.hoisted(() => ({
  collect: vi.fn(),
  persist: vi.fn(),
}));

vi.mock("@/utils/image-attachments-from-files", () => ({
  collectImageFilesFromClipboardData: imageAttachmentHelpers.collect,
  filesToImageAttachments: imageAttachmentHelpers.persist,
}));

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

function dispatchImagePaste(textarea: HTMLTextAreaElement): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { items: [{}] } });
  textarea.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("usePasteImagesEffect", () => {
  it("keeps Send blocked until a Ctrl+V screenshot has become an attachment", async () => {
    const textarea = document.createElement("textarea");
    const persisting = deferred<ImageAttachment[]>();
    const onAddImages = vi.fn();
    const attachment = { id: "pasted-screenshot" } as ImageAttachment;
    imageAttachmentHelpers.collect.mockReturnValue([{ file: {}, mimeType: "image/png" }]);
    imageAttachmentHelpers.persist.mockReturnValue(persisting.promise);

    const { result } = renderHook(() =>
      usePasteImagesEffect({
        getWebTextArea: () => textarea as never,
        inputReplacementKey: "draft-0",
        isConnected: true,
        disabled: false,
        isDictating: false,
        isRealtimeVoiceForCurrentAgent: false,
        onAddImages,
      }),
    );

    let pasteEvent: Event;
    act(() => {
      pasteEvent = dispatchImagePaste(textarea);
    });

    expect(pasteEvent!.defaultPrevented).toBe(true);
    expect(result.current).toBe(true);

    await act(async () => {
      persisting.resolve([attachment]);
      await persisting.promise;
    });

    await waitFor(() => expect(result.current).toBe(false));
    expect(onAddImages).toHaveBeenCalledWith([attachment]);
  });

  it("releases Send and reports an error when pasted-image persistence never settles", async () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const persisting = deferred<ImageAttachment[]>();
    const onAddImages = vi.fn();
    const onPasteError = vi.fn();
    imageAttachmentHelpers.collect.mockReturnValue([{ file: {}, mimeType: "image/png" }]);
    imageAttachmentHelpers.persist.mockReturnValue(persisting.promise);

    const { result } = renderHook(() =>
      usePasteImagesEffect({
        getWebTextArea: () => textarea as never,
        inputReplacementKey: "draft-0",
        isConnected: true,
        disabled: false,
        isDictating: false,
        isRealtimeVoiceForCurrentAgent: false,
        onAddImages,
        onPasteError,
      }),
    );

    act(() => {
      dispatchImagePaste(textarea);
      vi.advanceTimersByTime(PASTED_IMAGE_PERSIST_TIMEOUT_MS);
    });

    expect(result.current).toBe(false);
    expect(onAddImages).not.toHaveBeenCalled();
    expect(onPasteError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Pasted image processing timed out." }),
    );

    await act(async () => {
      persisting.resolve([{ id: "late-screenshot" } as ImageAttachment]);
      await persisting.promise;
    });

    expect(onAddImages).not.toHaveBeenCalled();
  });
});
