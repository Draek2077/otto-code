import { useEffect } from "react";
import type { ChatBackgroundPointerOptions } from "./use-chat-background-pointer";

const CONTENT =
  '[data-chat-visualizer-content], [data-chat-visualizer-controls], [data-testid="chat-visualizer-composer"], a, button, input, textarea, select, [role="button"], [role="menu"], [contenteditable="true"]';
const HOVER_DWELL_MS = 200;
const HOVER_CLEARANCE_PX = 10;
const HOVER_JITTER_PX = 6;
interface Point {
  x: number;
  y: number;
}

/** The scroller remains the input owner. Observe empty-space gestures at its
 * ancestor; never put an input-catching layer over a readable conversation. */
export function useChatBackgroundPointer({
  rootRef,
  foregroundRef,
  enabled,
  hidden,
  onPeek,
  onToggle,
  onRestore,
}: ChatBackgroundPointerOptions): void {
  useEffect(() => {
    const foreground = foregroundRef.current as unknown as HTMLElement | null;
    if (!foreground) return;
    foreground.inert = enabled && hidden;
    return () => {
      foreground.inert = false;
    };
  }, [enabled, hidden, foregroundRef]);

  useEffect(() => {
    const root = rootRef.current as unknown as HTMLElement | null;
    if (!root || !enabled) return;
    const background = root.querySelector<HTMLElement>(
      '[data-testid="chat-visualizer-background"]',
    );
    if (background) background.inert = true;
    let down: Point | null = null;
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let hoverOrigin: Point | null = null;
    let pointer: Point | null = null;
    let peeking = false;
    const selection = () => Boolean(root.ownerDocument.getSelection()?.toString());
    const emptyTarget = (target: EventTarget | null, x: number) => {
      if (!(target instanceof Element) || target.closest(CONTENT)) return false;
      // Status text and pinned task overlays are readable content too, even
      // when they do not belong to a message bubble or an interactive control.
      if (
        Array.from(target.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )
      )
        return false;
      const scroller = target.closest<HTMLElement>('[data-testid="agent-chat-scroll"]');
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        // Include the app's overlay scrollbar gutter, even when Chromium's
        // native scrollbar is zero-width.
        if (x >= rect.right - 14 || x < rect.left) return false;
      }
      return true;
    };
    const empty = (event: MouseEvent) => emptyTarget(event.target, event.clientX);
    const clearHoverTimer = () => {
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      hoverTimer = null;
      hoverOrigin = null;
    };
    const resetPeek = () => {
      clearHoverTimer();
      peeking = false;
      onPeek(false);
    };
    const wideEmptyArea = ({ x, y }: Point) => {
      const rect = root.getBoundingClientRect();
      if (
        x < rect.left ||
        x >= rect.right ||
        y - HOVER_CLEARANCE_PX < rect.top ||
        y + HOVER_CLEARANCE_PX >= rect.bottom
      )
        return false;
      // Only require vertical clearance: the side gutters must remain usable
      // even when messages sit immediately beside them.
      for (const dy of [-HOVER_CLEARANCE_PX, 0, HOVER_CLEARANCE_PX]) {
        const target = root.ownerDocument.elementFromPoint(x, y + dy);
        if (!target || !root.contains(target) || !emptyTarget(target, x)) return false;
      }
      return true;
    };
    const move = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down = null;
      pointer = { x: event.clientX, y: event.clientY };
      if (
        hidden ||
        event.pointerType !== "mouse" ||
        event.buttons !== 0 ||
        !empty(event) ||
        selection()
      ) {
        resetPeek();
        return;
      }
      if (peeking) {
        if (!wideEmptyArea(pointer)) resetPeek();
        return;
      }
      if (
        hoverOrigin &&
        Math.hypot(pointer.x - hoverOrigin.x, pointer.y - hoverOrigin.y) <= HOVER_JITTER_PX
      )
        return;
      clearHoverTimer();
      hoverOrigin = pointer;
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        hoverOrigin = null;
        // Recheck the live hit targets: streamed content may have filled the
        // space since the pointer stopped moving.
        if (!pointer || selection() || !wideEmptyArea(pointer)) return;
        peeking = true;
        onPeek(true);
      }, HOVER_DWELL_MS);
    };
    const leave = () => {
      down = null;
      pointer = null;
      resetPeek();
    };
    const start = (event: PointerEvent) => {
      resetPeek();
      down =
        event.button === 0 && empty(event) && !selection()
          ? { x: event.clientX, y: event.clientY }
          : null;
    };
    const click = (event: MouseEvent) => {
      const pressed = down;
      down = null;
      if (
        pressed &&
        empty(event) &&
        !selection() &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) <= 5
      ) {
        resetPeek();
        onToggle();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && hidden) onRestore();
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointerdown", start, true);
    root.addEventListener("pointercancel", leave);
    root.addEventListener("click", click);
    root.addEventListener("scroll", leave, true);
    root.ownerDocument.defaultView?.addEventListener("resize", leave);
    root.ownerDocument.addEventListener("keydown", key);
    return () => {
      clearHoverTimer();
      onPeek(false);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointerdown", start, true);
      root.removeEventListener("pointercancel", leave);
      root.removeEventListener("click", click);
      root.removeEventListener("scroll", leave, true);
      root.ownerDocument.defaultView?.removeEventListener("resize", leave);
      root.ownerDocument.removeEventListener("keydown", key);
    };
  }, [rootRef, enabled, hidden, onPeek, onToggle, onRestore]);
}
