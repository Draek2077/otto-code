import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimSidebarEdgePeek,
  registerSidebarEdgePeekSurface,
  useSidebarEdgePeekStore,
} from "@/stores/sidebar-edge-peek-store";
import { SIDEBAR_EDGE_DISMISS_DELAY_MS, SIDEBAR_EDGE_DWELL_MS } from "./sidebar-edge-reveal";
import { useSidebarEdgeReveal } from "./use-sidebar-edge-reveal.web";
import { publishSidebarEdgePointer } from "./sidebar-edge-pointer";

const MID_Y = 300;
const PANEL_WIDTH = 280;

function Controller({ enabled }: { enabled: boolean }) {
  useSidebarEdgeReveal(enabled);
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function moveTo(x: number, y = MID_Y, buttons = 0): void {
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, buttons, bubbles: true }),
  );
}

function peekSide() {
  return useSidebarEdgePeekStore.getState().peekSide;
}

describe("useSidebarEdgeReveal in the browser", () => {
  let root: Root;
  let container: HTMLDivElement;
  let panel: HTMLDivElement;
  let releaseLeft: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    // Stands in for the painted left peek panel the controller hit-tests.
    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      bottom: "0px",
      width: `${PANEL_WIDTH}px`,
    });
    document.body.append(container, panel);
    registerSidebarEdgePeekSurface("left", panel);
    releaseLeft = claimSidebarEdgePeek("left");
    root = createRoot(container);
    flushSync(() => root.render(<Controller enabled />));
  });

  afterEach(() => {
    root.unmount();
    releaseLeft();
    registerSidebarEdgePeekSurface("left", null);
    document.body.replaceChildren();
  });

  it("peeks after the pointer rests on the edge, not before", async () => {
    moveTo(0);
    expect(peekSide()).toBeNull();
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    expect(peekSide()).toBe("left");
  });

  it("uses edge movement forwarded from a resident browser guest", async () => {
    publishSidebarEdgePointer({ x: 0, y: MID_Y, buttons: 0 });
    expect(peekSide()).toBeNull();
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    expect(peekSide()).toBe("left");
  });

  it("does not peek when the pointer only passes over the edge", async () => {
    moveTo(0);
    moveTo(600);
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    expect(peekSide()).toBeNull();
  });

  it("does not peek a side nothing has claimed", async () => {
    moveTo(window.innerWidth - 1);
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    expect(peekSide()).toBeNull();
  });

  it("stays while the pointer is inside the panel and swoops away after it leaves", async () => {
    moveTo(0);
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    moveTo(PANEL_WIDTH - 20);
    await wait(SIDEBAR_EDGE_DISMISS_DELAY_MS + 50);
    expect(peekSide()).toBe("left");
    moveTo(PANEL_WIDTH + 200);
    expect(peekSide()).toBe("left");
    await wait(SIDEBAR_EDGE_DISMISS_DELAY_MS + 50);
    expect(peekSide()).toBeNull();
  });

  it("keeps the peek when the pointer comes back within the grace period", async () => {
    moveTo(0);
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    moveTo(PANEL_WIDTH + 10);
    await wait(SIDEBAR_EDGE_DISMISS_DELAY_MS / 3);
    moveTo(PANEL_WIDTH - 10);
    await wait(SIDEBAR_EDGE_DISMISS_DELAY_MS + 50);
    expect(peekSide()).toBe("left");
  });

  it("holds the peek through a drag that leaves the panel", async () => {
    moveTo(0);
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    moveTo(PANEL_WIDTH + 200, MID_Y, 1);
    await wait(SIDEBAR_EDGE_DISMISS_DELAY_MS + 50);
    expect(peekSide()).toBe("left");
  });

  it("ends the peek when the controller is disabled", async () => {
    moveTo(0);
    await wait(SIDEBAR_EDGE_DWELL_MS + 50);
    expect(peekSide()).toBe("left");
    flushSync(() => root.render(<Controller enabled={false} />));
    expect(peekSide()).toBeNull();
  });
});
