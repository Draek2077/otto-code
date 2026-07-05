import { describe, expect, it } from "vitest";
import { shouldHideWindowOnClose } from "./tray.js";

describe("shouldHideWindowOnClose", () => {
  it("hides the last visible window on Windows when minimize-to-tray is enabled", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        minimizeOnCloseEnabled: true,
        isQuitting: false,
        otherVisibleWindowCount: 0,
      }),
    ).toBe(true);
  });

  it("hides the last visible window on Linux when minimize-to-tray is enabled", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "linux",
        minimizeOnCloseEnabled: true,
        isQuitting: false,
        otherVisibleWindowCount: 0,
      }),
    ).toBe(true);
  });

  it("never intercepts close on darwin, even with the setting enabled", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "darwin",
        minimizeOnCloseEnabled: true,
        isQuitting: false,
        otherVisibleWindowCount: 0,
      }),
    ).toBe(false);
  });

  it("respects the opt-out setting", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        minimizeOnCloseEnabled: false,
        isQuitting: false,
        otherVisibleWindowCount: 0,
      }),
    ).toBe(false);
  });

  it("never intercepts close during an in-flight app quit", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        minimizeOnCloseEnabled: true,
        isQuitting: true,
        otherVisibleWindowCount: 0,
      }),
    ).toBe(false);
  });

  it("lets a window close normally when another window is still visible", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        minimizeOnCloseEnabled: true,
        isQuitting: false,
        otherVisibleWindowCount: 1,
      }),
    ).toBe(false);
  });
});
