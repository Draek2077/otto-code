import { afterEach, describe, expect, it } from "vitest";
import { claimSidebarEdgePeek, useSidebarEdgePeekStore } from "@/stores/sidebar-edge-peek-store";
import {
  isPointerHoldingSidebarPeek,
  isSidebarEdgeRevealEligible,
  resolveSidebarEdgeSide,
  SIDEBAR_EDGE_TOP_EXCLUSION_PX,
} from "./sidebar-edge-reveal";

const BOTH = { left: true, right: true };
const VIEWPORT = 1920;
const MID_Y = 500;

describe("resolveSidebarEdgeSide", () => {
  it("arms the left side only while the pointer pins the left edge", () => {
    expect(
      resolveSidebarEdgeSide({
        point: { x: 0, y: MID_Y },
        viewportWidth: VIEWPORT,
        available: BOTH,
      }),
    ).toBe("left");
    expect(
      resolveSidebarEdgeSide({
        point: { x: 8, y: MID_Y },
        viewportWidth: VIEWPORT,
        available: BOTH,
      }),
    ).toBeNull();
  });

  it("arms the right side on the last pixel column", () => {
    expect(
      resolveSidebarEdgeSide({
        point: { x: VIEWPORT - 1, y: MID_Y },
        viewportWidth: VIEWPORT,
        available: BOTH,
      }),
    ).toBe("right");
  });

  it("ignores a side with nothing to peek", () => {
    expect(
      resolveSidebarEdgeSide({
        point: { x: VIEWPORT - 1, y: MID_Y },
        viewportWidth: VIEWPORT,
        available: { left: true, right: false },
      }),
    ).toBeNull();
  });

  it("leaves the title-bar strip to the window controls", () => {
    expect(
      resolveSidebarEdgeSide({
        point: { x: VIEWPORT - 1, y: SIDEBAR_EDGE_TOP_EXCLUSION_PX - 1 },
        viewportWidth: VIEWPORT,
        available: BOTH,
      }),
    ).toBeNull();
  });
});

describe("isPointerHoldingSidebarPeek", () => {
  const rect = { left: 0, right: 280, top: 0, bottom: 1080 };

  it("holds while the pointer is inside the peeked panel", () => {
    expect(
      isPointerHoldingSidebarPeek({
        side: "left",
        point: { x: 200, y: MID_Y },
        viewportWidth: VIEWPORT,
        surfaceRect: rect,
      }),
    ).toBe(true);
  });

  it("releases once the pointer leaves the panel", () => {
    expect(
      isPointerHoldingSidebarPeek({
        side: "left",
        point: { x: 400, y: MID_Y },
        viewportWidth: VIEWPORT,
        surfaceRect: rect,
      }),
    ).toBe(false);
  });

  it("holds on the edge strip before the panel has any width", () => {
    expect(
      isPointerHoldingSidebarPeek({
        side: "right",
        point: { x: VIEWPORT - 1, y: MID_Y },
        viewportWidth: VIEWPORT,
        surfaceRect: null,
      }),
    ).toBe(true);
  });
});

describe("isSidebarEdgeRevealEligible", () => {
  const base = {
    settingEnabled: true,
    isElectron: true,
    isCompact: false,
    isMaximized: false,
    isFullscreen: false,
  };

  it("requires a maximized or fullscreen desktop window", () => {
    expect(isSidebarEdgeRevealEligible(base)).toBe(false);
    expect(isSidebarEdgeRevealEligible({ ...base, isMaximized: true })).toBe(true);
    expect(isSidebarEdgeRevealEligible({ ...base, isFullscreen: true })).toBe(true);
  });

  it("is off when the setting is off", () => {
    expect(isSidebarEdgeRevealEligible({ ...base, isMaximized: true, settingEnabled: false })).toBe(
      false,
    );
  });
});

describe("sidebar edge peek availability", () => {
  afterEach(() => {
    useSidebarEdgePeekStore.setState({ peekSide: null });
  });

  it("keeps a side available while any surface still claims it", () => {
    const releaseFocused = claimSidebarEdgePeek("right");
    const releaseRetained = claimSidebarEdgePeek("right");
    releaseRetained();
    expect(useSidebarEdgePeekStore.getState().available.right).toBe(true);
    releaseFocused();
    expect(useSidebarEdgePeekStore.getState().available.right).toBe(false);
  });

  it("refuses to peek an unavailable side", () => {
    useSidebarEdgePeekStore.getState().setPeekSide("left");
    expect(useSidebarEdgePeekStore.getState().peekSide).toBeNull();
  });

  it("ends the peek when its side stops being available", () => {
    const release = claimSidebarEdgePeek("left");
    useSidebarEdgePeekStore.getState().setPeekSide("left");
    expect(useSidebarEdgePeekStore.getState().peekSide).toBe("left");
    release();
    expect(useSidebarEdgePeekStore.getState().peekSide).toBeNull();
  });
});
