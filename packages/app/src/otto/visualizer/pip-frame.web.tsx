import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { getOverlayRoot } from "@/lib/overlay-root";
import {
  resolveVisualizerAnchor,
  visualizerAnchor,
  visualizerPipSize,
  type VisualizerAnchor,
} from "./geometry";
import type { VisualizerPipFrameProps } from "./pip-types";
const currentWindow = () => ({ width: window.innerWidth, height: window.innerHeight });
export function VisualizerPipFrame({
  preferences,
  save,
  children,
  shown,
}: VisualizerPipFrameProps) {
  const [viewport, setViewport] = useState(currentWindow);
  const size = visualizerPipSize(preferences.visualizerPipSize, viewport);
  const initial = useRef<VisualizerAnchor | null>(null);
  initial.current ??= visualizerAnchor(
    {
      x: preferences.visualizerPipX * Math.max(0, viewport.width - size.width),
      y: preferences.visualizerPipY * Math.max(0, viewport.height - size.height),
    },
    viewport,
    size,
  );
  const [anchor, setAnchor] = useState(initial.current);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const placed = position ?? resolveVisualizerAnchor(anchor, viewport, size);
  useEffect(() => {
    const resize = () => {
      drag.current = null;
      setPosition(null);
      setViewport(currentWindow());
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      drag.current = null;
    };
  }, []);
  const down = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: placed.x,
        top: placed.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [placed],
  );
  const move = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      const next = visualizerAnchor(
        { x: active.left + event.clientX - active.x, y: active.top + event.clientY - active.y },
        viewport,
        size,
      );
      setPosition(resolveVisualizerAnchor(next, viewport, size));
    },
    [viewport, size],
  );
  const up = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || drag.current.id !== event.pointerId) return;
      drag.current = null;
      const next = visualizerAnchor(placed, viewport, size);
      setAnchor(next);
      setPosition(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      save({
        visualizerPipX: placed.x / Math.max(1, viewport.width - size.width),
        visualizerPipY: placed.y / Math.max(1, viewport.height - size.height),
      });
    },
    [placed, viewport, size, save],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      left: placed.x,
      top: placed.y,
      width: size.width,
      height: size.height,
      display: shown ? "flex" : "none",
      flexDirection: "column",
      pointerEvents: "auto",
      zIndex: 1,
      borderRadius: 8,
      overflow: "hidden",
      boxShadow: "0 6px 24px #0005",
    }),
    [placed.x, placed.y, size.width, size.height, shown],
  );
  return createPortal(
    <div style={style} data-testid="visualizer-window-pip">
      <style>{pipHoverStyles}</style>
      <div
        role="separator"
        aria-label="Move Visualizer"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        style={dragStyle}
      />
      <div style={contentStyle}>{children}</div>
    </div>,
    getOverlayRoot(),
  );
}
const dragStyle: CSSProperties = {
  height: 8,
  flexShrink: 0,
  cursor: "move",
  touchAction: "none",
  background: "#80808050",
};
const pipHoverStyles = `[data-testid="visualizer-window-pip"] [data-testid="visualizer-toolbar"]{opacity:0;pointer-events:none}[data-testid="visualizer-window-pip"]:hover [data-testid="visualizer-toolbar"],[data-testid="visualizer-window-pip"]:focus-within [data-testid="visualizer-toolbar"]{opacity:1;pointer-events:auto}@media(hover:none){[data-testid="visualizer-window-pip"] [data-testid="visualizer-toolbar"]{opacity:1;pointer-events:auto}}`;
const contentStyle: CSSProperties = { flex: 1, display: "flex", minHeight: 0 };
