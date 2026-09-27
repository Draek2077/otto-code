import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { RemoteBrowserFrameHandle } from "./remote-browser-frame";

interface Props {
  width: number;
  height: number;
  onWheel?: (deltaX: number, deltaY: number) => void;
  onKeyInput?: (value: string, kind: "text" | "key") => void;
}

const canvasStyle = { display: "block", width: "100%", height: "100%" } as const;

export const RemoteBrowserFrame = forwardRef<RemoteBrowserFrameHandle, Props>(
  function RemoteBrowserFrame({ width, height, onWheel, onKeyInput }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

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
        onWheel?.(event.deltaX, event.deltaY);
      },
      [onWheel],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLCanvasElement>) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
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
      [onKeyInput],
    );

    const focusCanvas = useCallback(() => canvasRef.current?.focus(), []);

    return (
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        tabIndex={0}
        onPointerDown={focusCanvas}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      />
    );
  },
);
