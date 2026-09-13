import React, { useMemo } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useMenuWebEnteringAnimation } from "./use-menu-web-entering-animation";

// Isolate the app preference; animation, layout and hit testing use the real browser.
vi.mock("@/hooks/use-animations-enabled", () => ({ useAnimationsEnabled: () => true }));

it("keeps a measured menu positioned and clickable after animation and content growth", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const select = vi.fn();

  function Menu({ ready, rows }: { ready: boolean; rows: number }) {
    useMenuWebEnteringAnimation("menu-animation-test", ready);
    const frameStyle = useMemo(
      () => ({ position: "fixed" as const, left: ready ? 40 : -9999, top: ready ? 40 : -9999 }),
      [ready],
    );
    const contentStyle = useMemo(() => ({ height: rows * 28 }), [rows]);
    return (
      <div id="menu-animation-test" style={frameStyle}>
        <button type="button" onClick={select}>
          Select tag
        </button>
        <div style={contentStyle} />
      </div>
    );
  }

  try {
    flushSync(() => root.render(<Menu ready={false} rows={1} />));
    const surface = document.getElementById("menu-animation-test")!;
    expect(surface.getAnimations()).toHaveLength(0);
    flushSync(() => root.render(<Menu ready rows={1} />));
    const animation = surface.getAnimations()[0];
    expect(animation.playState).toBe("running");
    await animation.finished;
    const originalHeight = surface.getBoundingClientRect().height;
    flushSync(() => root.render(<Menu ready rows={5} />));

    // Cross the previous 750ms keyframe-cleanup deadline, which rewrote the measured box.
    await new Promise((resolve) => setTimeout(resolve, 800));
    const rect = surface.getBoundingClientRect();
    expect(rect.x).toBe(40);
    expect(rect.y).toBe(40);
    expect(rect.height - originalHeight).toBe(112);
    expect(surface.style.height).toBe("");
    const button = surface.querySelector("button")!;
    const target = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      target.x + target.width / 2,
      target.y + target.height / 2,
    );
    expect(hit).toBe(button);
    button.click();
    expect(select).toHaveBeenCalledOnce();
  } finally {
    root.unmount();
    container.remove();
  }
});
