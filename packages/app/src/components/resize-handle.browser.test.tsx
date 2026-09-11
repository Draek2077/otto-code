import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ResizeHandle } from "./resize-handle";
import {
  clearResidentBrowserWebviewsForTests,
  presentBrowserWebview,
  setResidentBrowserSurfaceInputEnabled,
} from "@/desktop/browser/resident-webviews";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
const topStyle = { height: 149, position: "relative" as const };
const bottomStyle = { height: 150, position: "relative" as const };

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  clearResidentBrowserWebviewsForTests();
});

it.each(["pointerup", "pointercancel", "lostpointercapture", "blur"])(
  "keeps stacked browser panes draggable and releases input on %s",
  async (endEvent) => {
    container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:20px;top:20px;width:300px;height:300px;z-index:0;display:flex;flex-direction:column";
    document.body.appendChild(container);
    root = createRoot(container);
    const preview = vi.fn();
    const commit = vi.fn();
    act(() =>
      root.render(
        <>
          <div data-pane="top" style={topStyle} />
          <ResizeHandle
            direction="vertical"
            groupId="right"
            index={0}
            sizes={[0.5, 0.5]}
            containerSize={300}
            onPreviewResizeSplit={preview}
            onResizeSplit={commit}
          />
          <div data-pane="bottom" style={bottomStyle} />
        </>,
      ),
    );
    for (const id of ["top", "bottom"]) {
      const anchor = container.querySelector<HTMLElement>(`[data-pane="${id}"]`)!;
      presentBrowserWebview(id, document.createElement("div"), anchor, anchor, {
        mode: "responsive",
      });
    }
    const separator = document.querySelector<HTMLElement>('[role="separator"]')!;
    const rect = separator.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    expect(document.elementFromPoint(x, y)).toBe(separator);
    expect(document.elementFromPoint(x, y - 4)).toBe(separator);
    expect(document.elementFromPoint(x, y + 4)).toBe(separator);

    // Synthetic pointers have no native capture. Hit-testing and the production
    // drag handlers are real; Electron guest input is covered by the surface gate.
    vi.spyOn(separator, "setPointerCapture").mockImplementation(() => {});
    act(() =>
      separator.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: x,
          clientY: y,
        }),
      ),
    );
    const surfaces = [...document.querySelectorAll<HTMLElement>("[data-otto-browser-surface]")];
    expect(surfaces.map((surface) => surface.style.pointerEvents)).toEqual(["none", "none"]);
    // Another retained workspace updating its tab-drag gate cannot interrupt us.
    setResidentBrowserSurfaceInputEnabled(true);
    expect(surfaces.map((surface) => surface.style.pointerEvents)).toEqual(["none", "none"]);
    act(() =>
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: x,
          clientY: y + 60,
        }),
      ),
    );
    expect(preview).toHaveBeenLastCalledWith("right", [0.7, 0.30000000000000004]);
    act(() =>
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: x,
          clientY: y - 60,
        }),
      ),
    );
    expect(preview).toHaveBeenLastCalledWith("right", [0.3, 0.7]);
    expect(commit).not.toHaveBeenCalled();
    const endTarget = endEvent === "lostpointercapture" ? separator : window;
    act(() => endTarget.dispatchEvent(new PointerEvent(endEvent, { pointerId: 1 })));
    expect(commit).toHaveBeenCalledExactlyOnceWith("right", [0.3, 0.7]);
    expect(surfaces.map((surface) => surface.style.pointerEvents)).toEqual(["auto", "auto"]);

    // A nested group shifts when an earlier sibling grows, even when the
    // divider's own width and height do not change.
    const top = container.querySelector<HTMLElement>('[data-pane="top"]')!;
    const bottom = container.querySelector<HTMLElement>('[data-pane="bottom"]')!;
    top.style.height = "99px";
    bottom.style.height = "200px";
    await expect.poll(() => separator.getBoundingClientRect().top).toBe(rect.top - 50);

    container.style.display = "none";
    await expect.poll(() => separator.getBoundingClientRect().width).toBe(0);
    container.style.display = "flex";
    await expect.poll(() => separator.getBoundingClientRect().width).toBe(rect.width);

    act(() =>
      separator.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 2,
          clientX: x,
          clientY: y - 50,
        }),
      ),
    );
    act(() => root.unmount());
    expect(document.querySelector('[role="separator"]')).toBeNull();
    expect(surfaces.map((surface) => surface.style.pointerEvents)).toEqual(["auto", "auto"]);
    expect(document.body.style.cursor).toBe("");
  },
);
