import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PaneOverlay, WindowOverlay } from "../../../app/src/components/ui/pane-overlay.web";
import { getOverlayRoot, OVERLAY_Z, WEB_SURFACE_PLANE } from "../../../app/src/lib/overlay-root";

const paneStyle = { position: "absolute", inset: 0, background: "rgb(0,200,0)" } as const;
const dragStyle = {
  position: "fixed",
  left: 130,
  top: 150,
  width: 60,
  height: 40,
  background: "rgb(240,200,0)",
} as const;
const menuStyle = {
  position: "fixed",
  left: 180,
  top: 120,
  width: 80,
  height: 60,
  background: "rgb(0,0,200)",
  pointerEvents: "auto",
  border: 0,
} as const;
const anchorStyle = {
  position: "fixed",
  left: 100,
  top: 100,
  width: 240,
  height: 180,
  zIndex: 0,
} as const;
const root = createRoot(document.getElementById("root")!);
// Create foreground first: layering must survive a browser appended after it.
getOverlayRoot();
function onMenuClick() {
  document.body.dataset.menuClicked = "yes";
}

export { WEB_SURFACE_PLANE };
export function render(foreground: boolean) {
  flushSync(() =>
    root.render(
      <>
        <div style={anchorStyle}>
          {foreground ? (
            <PaneOverlay pointerEvents="none" clip>
              <div style={paneStyle} />
            </PaneOverlay>
          ) : (
            <div style={paneStyle} />
          )}
        </div>
        {foreground && (
          <>
            <WindowOverlay layer={OVERLAY_Z.drag}>
              <div style={dragStyle} />
            </WindowOverlay>
            <WindowOverlay layer={OVERLAY_Z.floating}>
              <button type="button" id="menu" style={menuStyle} onClick={onMenuClick} />
            </WindowOverlay>
          </>
        )}
      </>,
    ),
  );
}
