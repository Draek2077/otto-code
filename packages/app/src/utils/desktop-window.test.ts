import { describe, expect, it } from "vitest";
import {
  resolveOverlayInsets,
  resolveRawWindowControlsPadding,
  resolveWindowControlsPadding,
} from "@/utils/desktop-window";

const rawPadding = {
  left: 80,
  right: 48,
  top: 28,
};

describe("resolveWindowControlsPadding", () => {
  it("keeps mac traffic-light padding available when the app window is not fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({ isElectron: true, isMac: true, isFullscreen: false }),
    ).toEqual({
      left: 78,
      right: 0,
      top: 45,
    });
  });

  it("keeps Windows and Linux window-control padding available when the app window is not fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({ isElectron: true, isMac: false, isFullscreen: false }),
    ).toEqual({
      left: 0,
      right: 140,
      top: 48,
    });
  });

  it("does not reserve window-control padding when the app window is fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({ isElectron: true, isMac: true, isFullscreen: true }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("uses the measured overlay right inset instead of the constant on Windows and Linux", () => {
    expect(
      resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: false,
        isFullscreen: false,
        overlayInsets: { left: 0, right: 138 },
      }),
    ).toEqual({
      left: 0,
      right: 138,
      top: 48,
    });
  });

  it("ignores overlay insets on mac where the traffic-light constants are already exact", () => {
    expect(
      resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: true,
        isFullscreen: false,
        overlayInsets: { left: 72, right: 0 },
      }),
    ).toEqual({
      left: 78,
      right: 0,
      top: 45,
    });
  });

  it("ignores overlay insets in fullscreen", () => {
    expect(
      resolveRawWindowControlsPadding({
        isElectron: true,
        isMac: false,
        isFullscreen: true,
        overlayInsets: { left: 0, right: 138 },
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });
});

describe("resolveOverlayInsets", () => {
  it("computes the right inset from the titlebar area rect and window width", () => {
    expect(
      resolveOverlayInsets({ visible: true, rect: { x: 0, width: 1062 }, innerWidth: 1200 }),
    ).toEqual({
      left: 0,
      right: 138,
    });
  });

  it("computes a left inset when the controls sit on the left", () => {
    expect(
      resolveOverlayInsets({ visible: true, rect: { x: 72, width: 1128 }, innerWidth: 1200 }),
    ).toEqual({
      left: 72,
      right: 0,
    });
  });

  it("returns null when the overlay is not visible", () => {
    expect(
      resolveOverlayInsets({ visible: false, rect: { x: 0, width: 1062 }, innerWidth: 1200 }),
    ).toBeNull();
  });

  it("returns null when the rect could not be read", () => {
    expect(resolveOverlayInsets({ visible: true, rect: null, innerWidth: 1200 })).toBeNull();
  });

  it("returns null when the rect spans the full window (no drawn controls)", () => {
    expect(
      resolveOverlayInsets({ visible: true, rect: { x: 0, width: 1200 }, innerWidth: 1200 }),
    ).toBeNull();
  });

  it("pads the main header for window controls when the app sidebar is closed", () => {
    expect(
      resolveWindowControlsPadding({
        role: "header",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 80,
      right: 48,
      top: 0,
    });
  });

  it("does not add left padding to detail headers with their own sidebar", () => {
    expect(
      resolveWindowControlsPadding({
        role: "detailHeader",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 48,
      top: 0,
    });
  });

  it("pads a focus-mode tab row away from mac traffic lights even when the sidebar is logically open", () => {
    expect(
      resolveWindowControlsPadding({
        role: "tabRow",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: false,
        focusModeEnabled: true,
      }),
    ).toEqual({
      left: 80,
      right: 48,
      top: 0,
    });
  });

  it("pads a focus-mode tab row away from right-side window controls even when the explorer is logically open", () => {
    expect(
      resolveWindowControlsPadding({
        role: "tabRow",
        rawPadding: { left: 0, right: 140, top: 48 },
        sidebarClosed: true,
        explorerOpen: true,
        focusModeEnabled: true,
      }),
    ).toEqual({
      left: 0,
      right: 140,
      top: 0,
    });
  });
});
