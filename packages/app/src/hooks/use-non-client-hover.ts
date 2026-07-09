import { useEffect, useState } from "react";
import { getDesktopHost } from "@/desktop/host";
import { isWeb } from "@/constants/platform";

interface NonClientPoint {
  x: number;
  y: number;
}

function readPoint(payload: unknown): NonClientPoint | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const { x, y } = payload as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") {
    return null;
  }
  return { x, y };
}

function getElementRect(node: unknown): DOMRect | null {
  if (!node || typeof (node as HTMLElement).getBoundingClientRect !== "function") {
    return null;
  }
  return (node as HTMLElement).getBoundingClientRect();
}

/**
 * Hover tracking for pixels inside an Electron titlebar drag region, which
 * never deliver DOM pointer events (docs/hover.md, "Electron drag regions are
 * hover dead zones"). The Windows main process polls the global cursor while
 * the window is focused and forwards it as `nc-mouse-move` desktop events
 * carrying content-relative DIP coordinates (CSS pixels at zoom 1); this hook
 * hit-tests them against `ref`'s bounding rect. Because the poll covers every
 * pixel of the window — drag regions and normal client pixels alike — the
 * returned flag is a complete "cursor is over the element" signal on its own;
 * `nc-mouse-leave` clears it when the cursor exits the window or focus is
 * lost. Inert outside the Electron desktop app — browser web and native both
 * return a constant false.
 */
export function useNonClientHover(ref: { current: unknown }): boolean {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!isWeb) {
      return;
    }
    const events = getDesktopHost()?.events;
    if (!events?.on) {
      return;
    }

    let disposed = false;
    const disposers: Array<() => void> = [];

    const handleMove = (payload: unknown) => {
      const point = readPoint(payload);
      const rect = getElementRect(ref.current);
      if (!point || !rect) {
        setHovered(false);
        return;
      }
      setHovered(
        point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom,
      );
    };
    const handleLeave = () => setHovered(false);

    const subscribe = (event: string, handler: (payload: unknown) => void) => {
      void Promise.resolve(events.on!(event, handler)).then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          disposers.push(dispose);
        }
        return null;
      });
    };
    subscribe("nc-mouse-move", handleMove);
    subscribe("nc-mouse-leave", handleLeave);

    return () => {
      disposed = true;
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [ref]);

  return hovered;
}
