import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getOverlayRoot } from "@/lib/overlay-root";

// Above resident guests, ambient Visualizer and transient sidebars. Regular
// floating menus and modals still own their existing overlay layers.
const dragLayer: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 5,
  pointerEvents: "none",
};
const pointerShield: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "auto",
  cursor: "grabbing",
};
const dropAnchor: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
const dropLayer: CSSProperties = {
  position: "fixed",
  zIndex: 4,
  overflow: "hidden",
  pointerEvents: "none",
};

export function WorkspaceTabDragLayer({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return children;

  // Keep pointer move and release in the app document across iframes and
  // Electron guests. DndKit continues to resolve targets from their rectangles.
  return createPortal(
    <div style={dragLayer}>
      {active ? <div data-testid="workspace-tab-drag-layer" style={pointerShield} /> : null}
      {children}
    </div>,
    getOverlayRoot(),
  );
}

export function WorkspaceTabDropLayer({ children }: { children: ReactNode }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;

    const sync = () => {
      const { left, top, width, height } = anchor.getBoundingClientRect();
      layer.style.display = width > 0 && height > 0 ? "block" : "none";
      layer.style.left = `${left}px`;
      layer.style.top = `${top}px`;
      layer.style.width = `${width}px`;
      layer.style.height = `${height}px`;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(anchor);
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent);
      // A splitter can move a pane without changing its own size.
      for (const sibling of parent.children) observer.observe(sibling);
    }
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, []);

  if (typeof document === "undefined") return children;
  return (
    <>
      <div ref={anchorRef} style={dropAnchor} />
      {createPortal(
        <div data-testid="workspace-tab-drop-preview" ref={layerRef} style={dropLayer}>
          {children}
        </div>,
        getOverlayRoot(),
      )}
    </>
  );
}
