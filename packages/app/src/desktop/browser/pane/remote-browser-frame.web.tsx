import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { RemoteBrowserFrameHandle, RemoteBrowserWheel } from "./remote-browser-frame";

interface Props {
  width: number;
  height: number;
  onWheel?: (event: RemoteBrowserWheel) => void;
  onKeyInput?: (value: string, kind: "text" | "key") => void;
  onPasteText?: (text: string) => void;
  readClipboardText?: () => Promise<string>;
  onContextMenu?: (point: { x: number; y: number }) => void;
}

/**
 * Ctrl+V, or Cmd+V. The chord belongs to the viewer's clipboard, not to the
 * host's, so it is never forwarded as a key: the page would paste whatever the
 * daemon's own Chromium happens to hold.
 */
function isPasteChord(event: React.KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v";
}

// The streamed page supplies the visual focus cue for both keyboard targets.
const canvasStyle = {
  display: "block",
  width: "100%",
  height: "100%",
  outline: "none",
  touchAction: "none",
} as const;

const keyboardInputStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  padding: 0,
  border: 0,
  opacity: 0,
  outline: "none",
  pointerEvents: "none",
} as const;

export const RemoteBrowserFrame = forwardRef<RemoteBrowserFrameHandle, Props>(
  function RemoteBrowserFrame(
    { width, height, onWheel, onKeyInput, onPasteText, readClipboardText, onContextMenu },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const keyboardInputRef = useRef<HTMLTextAreaElement>(null);
    const pointerType = useRef("mouse");
    const imageRef = useRef<HTMLImageElement | null>(null);
    const pasteAttempt = useRef<{ delivered: boolean } | null>(null);

    const scheduleClipboardFallback = useCallback(
      (attempt: { delivered: boolean }, text: string) => {
        setTimeout(() => {
          if (pasteAttempt.current !== attempt || attempt.delivered || !text) return;
          attempt.delivered = true;
          onPasteText?.(text);
        }, 0);
      },
      [onPasteText],
    );

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      if (!canvas || !image || width <= 0 || height <= 0) return;
      const density = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * density));
      canvas.height = Math.max(1, Math.round(height * density));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser canvas is unavailable.");
      context.scale(density, density);
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(
        image,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    }, [width, height]);

    useLayoutEffect(draw, [draw]);
    useImperativeHandle(
      ref,
      () => ({
        async present(picture) {
          const image = new window.Image();
          if (typeof picture === "string") {
            image.src = `data:image/jpeg;base64,${picture}`;
            await image.decode();
          } else {
            const url = URL.createObjectURL(new Blob([picture.slice()], { type: "image/jpeg" }));
            image.src = url;
            try {
              await image.decode();
            } finally {
              URL.revokeObjectURL(url);
            }
          }
          imageRef.current = image;
          draw();
        },
      }),
      [draw],
    );

    const handleWheel = useCallback(
      (event: React.WheelEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onWheel?.({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        });
      },
      [onWheel],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLElement>) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        // The regular paste event is preferred. Clipboard reads cover clients
        // that do not dispatch paste to the focused browser view.
        if (isPasteChord(event)) {
          const attempt = { delivered: false };
          pasteAttempt.current = attempt;
          if (readClipboardText) {
            void readClipboardText()
              .then((text) => {
                scheduleClipboardFallback(attempt, text);
                return undefined;
              })
              .catch(() => undefined);
          }
          return;
        }
        event.preventDefault();
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          onKeyInput?.(event.key, "text");
          return;
        }
        const modifiers = [
          event.ctrlKey ? "Control" : "",
          event.altKey ? "Alt" : "",
          event.metaKey ? "Meta" : "",
          event.shiftKey && event.key.length > 1 ? "Shift" : "",
        ].filter(Boolean);
        onKeyInput?.([...modifiers, event.key].join("+"), "key");
      },
      [onKeyInput, readClipboardText, scheduleClipboardFallback],
    );

    // The clipboard's text goes into whatever the page has focused, which is
    // the field the viewer last clicked, exactly as the send bar below does.
    const handlePaste = useCallback(
      (event: React.ClipboardEvent<HTMLElement>) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (text && pasteAttempt.current) pasteAttempt.current.delivered = true;
        if (text) onPasteText?.(text);
      },
      [onPasteText],
    );

    const focusPageInput = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
      // Native paste is reliable on an editable target. Touch keeps the canvas
      // focused so a page tap does not summon the device keyboard.
      pointerType.current = event.pointerType;
      if (event.pointerType === "touch") canvasRef.current?.focus({ preventScroll: true });
    }, []);

    const focusAfterClick = useCallback(() => {
      // The browser's mousedown default refocuses the canvas after pointerdown.
      if (pointerType.current !== "touch") keyboardInputRef.current?.focus({ preventScroll: true });
    }, []);

    const handleContextMenu = useCallback(
      (event: React.MouseEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onContextMenu?.({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      },
      [onContextMenu],
    );

    return (
      <>
        <canvas
          ref={canvasRef}
          style={canvasStyle}
          tabIndex={0}
          onPointerDown={focusPageInput}
          onClick={focusAfterClick}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onContextMenu={handleContextMenu}
        />
        <textarea
          ref={keyboardInputRef}
          aria-label="Hosted browser page input"
          tabIndex={-1}
          style={keyboardInputStyle}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </>
    );
  },
);
