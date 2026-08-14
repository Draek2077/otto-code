import { describe, expect, it } from "vitest";
import {
  createControlGeometry,
  getControlInteractionPhase,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

const theme = {
  borderRadius: {
    md: 6,
    lg: 8,
    xl: 12,
    full: 9999,
  },
  borderWidth: {
    1: 1,
  },
  colors: {
    accent: "#20744A",
    borderAccent: "#2F3534",
  },
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
  },
  opacity: {
    50: 0.5,
  },
  spacing: {
    0: 0,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
  },
} as unknown as Theme;

describe("control geometry", () => {
  it("keeps resting control borders transparent while preserving border geometry", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlRest).toMatchObject({
      borderWidth: 1,
      borderColor: "transparent",
      outlineColor: "transparent",
      outlineWidth: 0,
    });
  });

  it("uses the shared hover border and active focus ring values", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlHover).toEqual({
      borderColor: "#2F3534",
    });
    expect(geometry.controlActive).toEqual({
      borderColor: "#20744A",
    });
  });

  it("resolves disabled, focus, open, pressed, and hover into one interaction phase", () => {
    expect(getControlInteractionPhase({ disabled: true, focused: true })).toBe("rest");
    expect(getControlInteractionPhase({ focused: true })).toBe("active");
    expect(getControlInteractionPhase({ open: true })).toBe("active");
    expect(getControlInteractionPhase({ pressed: true })).toBe("active");
    expect(getControlInteractionPhase({ hovered: true })).toBe("hover");
    expect(getControlInteractionPhase({})).toBe("rest");
  });

  it("keeps field text sizing tied to control size", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldTextSm.fontSize).toBe(14);
    expect(geometry.fieldTextSm.lineHeight).toBe(20);
    expect(geometry.fieldTextMd.fontSize).toBe(16);
    expect(geometry.fieldTextMd.lineHeight).toBe(22);
    expect(geometry.formTextInputSm.fontSize).toBe(14);
    expect(geometry.formTextInputSm.lineHeight).toBe(20);
    expect(geometry.formTextInputMd.fontSize).toBe(16);
    expect(geometry.formTextInputMd.lineHeight).toBe(22);
  });

  it("derives field padding from line height without changing the control height", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldControlSm.minHeight).toBe(32);
    expect(geometry.fieldControlSm.paddingVertical).toBe(6);
    expect(geometry.fieldTextSm.lineHeight + geometry.fieldControlSm.paddingVertical * 2).toBe(
      geometry.fieldControlSm.minHeight,
    );

    expect(geometry.fieldControlMd.minHeight).toBe(44);
    expect(geometry.fieldControlMd.paddingVertical).toBe(11);
    expect(geometry.fieldTextMd.lineHeight + geometry.fieldControlMd.paddingVertical * 2).toBe(
      geometry.fieldControlMd.minHeight,
    );

    expect(geometry.formTextInputSm.paddingVertical).toBe(6);
    expect(geometry.formTextInputMd.paddingVertical).toBe(11);
  });

  // Otto's segmented control is a boxed track with an inset thumb, not
  // upstream's bare pill row. Both halves of that contract live here because
  // the v0.2.5 merge took upstream's geometry while keeping Otto's component,
  // which left a square surface2 block behind fully-round segments.
  it("insets segmented thumbs inside a track whose corners stay outside theirs", () => {
    const geometry = createControlGeometry(theme);

    // Every thumb keeps a real curve; a nested radius must never reach 0.
    expect(geometry.segmentedSegmentXs.borderRadius).toBeGreaterThan(0);
    expect(geometry.segmentedSegmentSm.borderRadius).toBeGreaterThan(0);
    expect(geometry.segmentedSegmentMd.borderRadius).toBeGreaterThan(0);

    expect(geometry.segmentedContainerXs.padding).toBe(2);
    expect(geometry.segmentedContainerSm.padding).toBe(2);
    expect(geometry.segmentedContainerMd.padding).toBe(3);

    // The track owns a radius, and each thumb's is tighter by exactly the inset.
    expect(geometry.segmentedSegmentXs.borderRadius).toBe(
      geometry.segmentedContainerXs.borderRadius - geometry.segmentedContainerXs.padding,
    );
    expect(geometry.segmentedSegmentSm.borderRadius).toBe(
      geometry.segmentedContainerSm.borderRadius - geometry.segmentedContainerSm.padding,
    );
    expect(geometry.segmentedSegmentMd.borderRadius).toBe(
      geometry.segmentedContainerMd.borderRadius - geometry.segmentedContainerMd.padding,
    );

    expect(geometry.segmentedContainerXs.minHeight).toBe(geometry.buttonXs.minHeight);
    expect(geometry.segmentedContainerSm.minHeight).toBe(geometry.buttonSm.minHeight);
    expect(geometry.segmentedContainerMd.minHeight).toBe(geometry.buttonMd.minHeight);
    expect(geometry.segmentedSegmentXs.minHeight).toBe(24);
    expect(geometry.segmentedSegmentSm.minHeight).toBe(28);
    expect(geometry.segmentedSegmentMd.minHeight).toBe(38);
  });

  it("keeps one size contract across buttons and segmented controls", () => {
    const geometry = createControlGeometry(theme);

    // xs is a genuinely smaller tier, not sm with a different font.
    expect(geometry.buttonXs.minHeight).toBe(28);
    expect(geometry.buttonSm.minHeight).toBe(32);
    expect(geometry.buttonMd.minHeight).toBe(44);

    // xs and sm share their label size with the matching button tier. md does
    // not: a segmented md is a 44px track heading a panel, and it takes the
    // base reading size rather than a button's sm label.
    expect(geometry.segmentedLabelXs.fontSize).toBe(12);
    expect(geometry.segmentedLabelXs.fontSize).toBe(geometry.buttonTextXs.fontSize);
    expect(geometry.segmentedLabelSm.fontSize).toBe(14);
    expect(geometry.segmentedLabelSm.fontSize).toBe(geometry.buttonText.fontSize);
    expect(geometry.segmentedLabelMd.fontSize).toBe(16);

    // Segmented tabs stay compact at every height so labels keep their room in
    // narrow panes. The 8px inset is deliberately independent of button size.
    expect(geometry.segmentedSegmentXs.paddingHorizontal).toBe(8);
    expect(geometry.segmentedSegmentSm.paddingHorizontal).toBe(8);
    expect(geometry.segmentedSegmentMd.paddingHorizontal).toBe(8);
  });
});
