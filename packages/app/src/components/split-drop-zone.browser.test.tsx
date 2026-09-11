import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { DndContext } from "@dnd-kit/core";
import { expect, it } from "vitest";
import { SplitDropZone } from "./split-drop-zone";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const preview = { paneId: "right", position: "bottom" as const };

it("paints a pane's drop preview in the foreground with the original pane bounds", () => {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:20px;top:40px;width:300px;height:200px;z-index:0";
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <DndContext>
          <SplitDropZone paneId="right" active preview={preview} />
        </DndContext>,
      ),
    );
    const portal = document.getElementById("overlay-root")!.lastElementChild!;
    const [wash, frame] = portal.children;
    expect(container.contains(wash)).toBe(false);
    for (const element of [wash, frame]) {
      const rect = element.getBoundingClientRect();
      expect([rect.left, rect.top, rect.width, rect.height]).toEqual([20, 140, 300, 100]);
    }
    expect(getComputedStyle(wash).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(wash).pointerEvents).toBe("none");
    act(() =>
      root.render(
        <DndContext>
          <SplitDropZone paneId="right" active={false} preview={preview} />
        </DndContext>,
      ),
    );
    expect(wash.isConnected).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
