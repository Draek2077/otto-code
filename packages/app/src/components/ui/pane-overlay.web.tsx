import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getOverlayRoot, OVERLAY_Z, useCurrentOverlayLayer } from "@/lib/overlay-root";
import type { PaneOverlayProps, WindowOverlayProps } from "./pane-overlay";

const anchorStyle: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
/** Pane-local UI paints in the same foreground plane as window-wide UI. */
export function PaneOverlay({
  children,
  pointerEvents = "auto",
  clip = false,
  layer = OVERLAY_Z.pane,
}: PaneOverlayProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const parentLayer = useCurrentOverlayLayer();
  const surfaceStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      pointerEvents,
      overflow: clip ? "hidden" : "visible",
      zIndex: parentLayer + layer,
    }),
    [clip, layer, parentLayer, pointerEvents],
  );

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;

    const sync = () => {
      const rect = anchor.getBoundingClientRect();
      surface.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
      surface.style.left = `${rect.left}px`;
      surface.style.top = `${rect.top}px`;
      surface.style.width = `${rect.width}px`;
      surface.style.height = `${rect.height}px`;
    };
    sync();
    // A pane can move without changing size. Observe siblings along its
    // ancestry too: resizing the pane above/left moves the entire group.
    const observer = new ResizeObserver(sync);
    const observed = new Set<Element>();
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
      observed.add(parent);
      for (const child of parent.children) observed.add(child);
    }
    for (const element of observed) observer.observe(element);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, []);

  return (
    <>
      <div ref={anchorRef} style={anchorStyle} />
      {createPortal(
        <div ref={surfaceRef} style={surfaceStyle}>
          {children}
        </div>,
        getOverlayRoot(),
      )}
    </>
  );
}

export function WindowOverlay({ children, layer = 0 }: WindowOverlayProps) {
  const parentLayer = useCurrentOverlayLayer();
  const style = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      zIndex: parentLayer + layer,
    }),
    [layer, parentLayer],
  );
  return createPortal(<div style={style}>{children}</div>, getOverlayRoot());
}
