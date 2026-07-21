// Dragging the picture-in-picture Visualizer around the workspace.
//
// ── Why the drag surface is an overlay, not the frame itself ────────────────
// The one real obstacle to dragging the PIP is that most of its area is a
// GUEST: an Electron `<webview>` (or a sandboxed `<iframe>` on web) rendering in
// its own process. Pointer events over that region belong to the guest document,
// not to us — the host never sees a `pointerdown` there, so a drag started over
// the graph would simply not fire. Nothing else stands in the way.
//
// The fix is the same one the panel's load cover already uses: a host-side
// element stacked ABOVE the guest. `visualizer-pip.tsx` puts a transparent
// full-frame layer over the canvas and hands its pointer events here. That layer
// also swallows clicks the guest would otherwise eat, which is what we want —
// PIP is a glanceable viewport with no interactive canvas.
//
// ── Follow components/resize-handle.tsx, not the DOM ────────────────────────
// The gesture mechanics deliberately mirror `ResizeHandle`, the repo's proven
// pointer-drag: RN's synthetic `PointerEvent`, `preventDefault` +
// `stopPropagation` on the SYNTHETIC event, `setPointerCapture`, and
// `touchAction: "none"` on the hit area. The first cut of this hook treated
// `event.nativeEvent` as a DOM PointerEvent and gated on `nativeEvent.button`,
// which is not reliably populated — the handler returned before doing anything
// and the PIP simply would not drag. Don't reintroduce a `button` check here.
//
// ── Why position is stored as a 0..1 fraction ──────────────────────────────
// Pixels don't survive a resize: a PIP dragged to the right edge of a wide
// window would be stranded mid-canvas (or off-screen) when the window narrows.
// Storing the position as a fraction of the FREE space (container minus the
// PIP's own size) makes 1 mean "pinned to the right edge" and 0 "pinned to the
// left", with everything between keeping its proportion. Clamping is then
// automatic and total: a fraction in [0,1] cannot produce an out-of-bounds
// pixel position at any container size, so the PIP always stays inside the
// workspace and follows the edges as the window changes.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as RNPointerEvent } from "react-native";
import { isWeb } from "@/constants/platform";

export interface PipRect {
  width: number;
  height: number;
}

export interface PipFraction {
  x: number;
  y: number;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Fraction → px. Free space can be 0 when the PIP is as wide as (or wider
 * than) its container; pinning to 0 keeps it fully visible from the top-left
 * rather than pushing it off the opposite edge. */
export function resolvePipOffset(input: {
  container: PipRect;
  pip: PipRect;
  fraction: PipFraction;
}): { left: number; top: number } {
  const freeX = Math.max(0, input.container.width - input.pip.width);
  const freeY = Math.max(0, input.container.height - input.pip.height);
  return {
    left: Math.round(freeX * clampUnit(input.fraction.x)),
    top: Math.round(freeY * clampUnit(input.fraction.y)),
  };
}

export interface UseVisualizerPipDragInput {
  container: PipRect;
  pip: PipRect;
  /** Persisted position. */
  fraction: PipFraction;
  /** Called once, on release — one settings write per drag, not per frame. */
  onCommit: (fraction: PipFraction) => void;
}

export interface VisualizerPipDragState {
  /** Live position while dragging, else the persisted one resolved to px. */
  offset: { left: number; top: number };
  dragging: boolean;
  /** Spread onto the drag overlay. Web-only; empty object elsewhere. */
  handlers: { onPointerDown?: (event: RNPointerEvent) => void };
}

export function useVisualizerPipDrag(input: UseVisualizerPipDragInput): VisualizerPipDragState {
  const { container, pip, fraction, onCommit } = input;
  const [dragFraction, setDragFraction] = useState<PipFraction | null>(null);

  // Read at pointermove time so the window listeners never need re-binding.
  const latest = useRef({ container, pip, fraction, onCommit });
  latest.current = { container, pip, fraction, onCommit };

  const activeFraction = dragFraction ?? fraction;
  const offset = resolvePipOffset({ container, pip, fraction: activeFraction });

  const handlePointerDown = useCallback((event: RNPointerEvent) => {
    const target = event.currentTarget as unknown as HTMLElement | null;
    const { container: startContainer, pip: startPip, fraction: startFraction } = latest.current;
    // Nothing to drag within: the PIP already fills its container.
    if (startContainer.width <= startPip.width && startContainer.height <= startPip.height) {
      return;
    }
    const pointerId = event.nativeEvent.pointerId;
    const start = resolvePipOffset({
      container: startContainer,
      pip: startPip,
      fraction: startFraction,
    });
    const originX = event.nativeEvent.clientX;
    const originY = event.nativeEvent.clientY;
    let moved: PipFraction = startFraction;

    event.preventDefault();
    event.stopPropagation();
    target?.setPointerCapture?.(pointerId);
    setDragFraction(startFraction);

    const toFraction = (clientX: number, clientY: number): PipFraction => {
      // Live, not captured: the window can be resized mid-drag.
      const { container: liveContainer, pip: livePip } = latest.current;
      const freeX = Math.max(1, liveContainer.width - livePip.width);
      const freeY = Math.max(1, liveContainer.height - livePip.height);
      return {
        x: clampUnit((start.left + (clientX - originX)) / freeX),
        y: clampUnit((start.top + (clientY - originY)) / freeY),
      };
    };

    function cleanup() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (target?.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      moveEvent.preventDefault();
      moved = toFraction(moveEvent.clientX, moveEvent.clientY);
      setDragFraction(moved);
    }

    function handlePointerUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      setDragFraction(null);
      latest.current.onCommit(moved);
    }

    // Listeners go on `window`, not the overlay: the pointer routinely leaves
    // the small frame mid-drag (that is the whole point of dragging it), and a
    // node-scoped listener would drop the gesture the moment it did.
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  // Safety net: if the component unmounts mid-drag the handlers above go with
  // it, but a stuck `dragFraction` would otherwise outlive a remount.
  useEffect(() => () => setDragFraction(null), []);

  return {
    offset,
    dragging: dragFraction !== null,
    handlers: isWeb ? { onPointerDown: handlePointerDown } : {},
  };
}
