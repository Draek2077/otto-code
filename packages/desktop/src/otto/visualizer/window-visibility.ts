import type { BrowserWindow } from "electron";

/** The owner window can be hidden even when Chromium continues reporting its page as visible. */
export function attachVisualizerWindowVisibility(win: BrowserWindow): void {
  const contents = win.webContents;
  const publish = () => {
    if (win.isDestroyed() || contents.isDestroyed()) return;
    contents.send("otto:visualizer:window-visible", win.isVisible() && !win.isMinimized());
  };
  win.on("show", publish);
  win.on("hide", publish);
  win.on("minimize", publish);
  win.on("restore", publish);
  // A new document has a fresh preload, even when the native window has not changed state.
  contents.on("dom-ready", publish);
}
