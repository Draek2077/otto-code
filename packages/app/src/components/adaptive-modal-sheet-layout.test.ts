import { describe, expect, it } from "vitest";
import {
  getBottomSheetVisibleContentHeight,
  getCompactSheetScrollFlex,
  getCompactSheetSafeAreaPadding,
} from "@/components/adaptive-modal-sheet-layout";

describe("getCompactSheetSafeAreaPadding", () => {
  it("assigns safe clearance to the footer independently of decorative padding", () => {
    expect(
      getCompactSheetSafeAreaPadding({
        isCompact: true,
        isKeyboardVisible: false,
        hasFooter: true,
        safeAreaBottom: 34,
      }),
    ).toEqual({ footerPaddingBottom: 34 });
  });

  it("assigns safe clearance to the body only without a footer", () => {
    expect(
      getCompactSheetSafeAreaPadding({
        isCompact: true,
        isKeyboardVisible: false,
        hasFooter: false,
        safeAreaBottom: 34,
      }),
    ).toEqual({ contentPaddingBottom: 34 });
  });

  it("does not add a safe-area band above the compact keyboard", () => {
    expect(
      getCompactSheetSafeAreaPadding({
        isCompact: true,
        isKeyboardVisible: true,
        hasFooter: false,
        safeAreaBottom: 34,
      }),
    ).toEqual({});
  });

  it("does not inset desktop sheets", () => {
    expect(
      getCompactSheetSafeAreaPadding({
        isCompact: false,
        isKeyboardVisible: false,
        hasFooter: false,
        safeAreaBottom: 34,
      }),
    ).toEqual({});
  });
});

describe("getBottomSheetVisibleContentHeight", () => {
  it("stops subtracting the retained keyboard height after the keyboard hides", () => {
    const layout = {
      containerHeight: 874,
      contentPosition: 88,
      handleHeight: 24,
      keyboardHeight: 344,
    };

    expect(getBottomSheetVisibleContentHeight({ ...layout, isKeyboardVisible: true })).toBe(418);
    expect(getBottomSheetVisibleContentHeight({ ...layout, isKeyboardVisible: false })).toBe(762);
  });
  it("never returns negative space while the keyboard overtakes a small detent", () => {
    expect(
      getBottomSheetVisibleContentHeight({
        containerHeight: 600,
        contentPosition: 450,
        handleHeight: 24,
        keyboardHeight: 300,
        isKeyboardVisible: true,
      }),
    ).toBe(0);
  });
});

describe("getCompactSheetScrollFlex", () => {
  it("fills the resting detent when the sheet sizes to its current snap point", () => {
    expect(getCompactSheetScrollFlex(true)).toEqual({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });
  });

  it("hugs its content when the sheet does not size to its current snap point", () => {
    expect(getCompactSheetScrollFlex(false)).toEqual({
      flexGrow: 0,
      flexShrink: 1,
      flexBasis: "auto",
      minHeight: 0,
    });
  });

  // The sheet body once rendered empty with the footer stranded at the bottom of
  // the detent, because the fill intent arrived as `flex: 1` composed over the
  // seam-fade wrapper's `flexGrow: 0`. Yoga keeps the explicit grow and takes
  // only the zero basis from the shorthand, so the region collapsed.
  it("states its flex intent in longhands so it survives being composed", () => {
    for (const sizeToSnapPoint of [true, false]) {
      const flex = getCompactSheetScrollFlex(sizeToSnapPoint);
      expect(Object.keys(flex).sort()).toEqual([
        "flexBasis",
        "flexGrow",
        "flexShrink",
        "minHeight",
      ]);
    }
  });
});
