import { describe, expect, it } from "vitest";
import { shouldRevealTabToolbarOptions } from "./workspace-tab-toolbar-options";

const desktopAtRest = {
  isCompact: false,
  isToolbarActive: false,
  isNative: false,
  rowHovered: false,
};

describe("shouldRevealTabToolbarOptions", () => {
  it("keeps tab toolbar options visible by default", () => {
    expect(shouldRevealTabToolbarOptions({ ...desktopAtRest, hideTabToolbarOptions: false })).toBe(
      true,
    );
  });

  it("hides tab toolbar options at rest only when enabled", () => {
    expect(shouldRevealTabToolbarOptions({ ...desktopAtRest, hideTabToolbarOptions: true })).toBe(
      false,
    );
  });

  it("reveals hidden options while the tab bar or an owned menu is active", () => {
    expect(
      shouldRevealTabToolbarOptions({
        ...desktopAtRest,
        hideTabToolbarOptions: true,
        rowHovered: true,
      }),
    ).toBe(true);
    expect(
      shouldRevealTabToolbarOptions({
        ...desktopAtRest,
        hideTabToolbarOptions: true,
        isToolbarActive: true,
      }),
    ).toBe(true);
  });
});
