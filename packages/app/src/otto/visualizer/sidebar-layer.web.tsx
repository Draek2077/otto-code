import type { ReactElement, CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getOverlayRoot } from "@/lib/overlay-root";
// The ambient PIP is layer 1; transient sidebars are layer 2. Existing floating
// menus start at 10 and modals at 20, preserving their interaction ownership.
const style: CSSProperties = { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 2 };
export function visualizerSidebarLayer(children: ReactElement) {
  if (typeof document === "undefined") return children;
  return createPortal(<div style={style}>{children}</div>, getOverlayRoot());
}
