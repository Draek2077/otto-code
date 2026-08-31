import type { StyleProp, ViewStyle } from "react-native";
import type { IconSizeToken } from "@/components/icons/icon-size";
import type { Theme } from "@/styles/theme";

export type ButtonControlSize = "xs" | "sm" | "md" | "lg";
export type FieldControlSize = "sm" | "md";
export type SegmentedControlSize = "xs" | "sm" | "md";
export type ControlInteractionPhase = "rest" | "hover" | "active";

export interface ControlInteractionState {
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
  open?: boolean;
  active?: boolean;
  disabled?: boolean;
}

export interface ControlInteractionStyleMap {
  controlRest: StyleProp<ViewStyle>;
  controlHover: StyleProp<ViewStyle>;
  controlActive: StyleProp<ViewStyle>;
  controlDisabled?: StyleProp<ViewStyle>;
}

const TIGHT_CONTROL_HEIGHT = 28;
export const COMPACT_CONTROL_HEIGHT = 32;
const FIELD_CONTROL_HEIGHT = 44;
// Pin every pane toolbar's `minHeight` to this; don't let content drive it, or
// the bars drift apart when their tallest child differs (a 32px combobox vs a
// 30px mode-bar pill vs a 24px icon button).
export const PANE_TOOLBAR_HEIGHT = COMPACT_CONTROL_HEIGHT + 4;
const SEGMENTED_TIGHT_INSET = 2;
const SEGMENTED_COMPACT_INSET = 2;
const SEGMENTED_FIELD_INSET = 3;
const SWITCH_TRACK_WIDTH = 34;
const SWITCH_TRACK_HEIGHT = 20;
const SWITCH_THUMB_SIZE = 16;
const CONTROL_CENTER_JUSTIFY_CONTENT = "center";
const FIELD_TEXT_LINE_HEIGHT_RATIO = 1.4;

const controlHeights = {
  tight: TIGHT_CONTROL_HEIGHT,
  compact: COMPACT_CONTROL_HEIGHT,
  field: FIELD_CONTROL_HEIGHT,
};

// Tokens, not pixels. These two maps sit between a control's `size` and the glyph it
// draws, so a number here freezes every button and segment icon in the app at its
// desktop size - the control grows on a phone and the icon inside it does not. Naming
// the token instead lets `applyAppearance` resolve it per form factor, which is the one
// place icon scaling is allowed to happen.
export const buttonIconSize: Record<ButtonControlSize, IconSizeToken> = {
  xs: "xs",
  sm: "sm",
  md: "md",
  lg: "lg",
};

// Adopted from upstream, expressed in Otto's control heights rather than theirs.
// Upstream's components ask for a numeric button height by size token; Otto's
// ladder is the source of truth for what those numbers are, so their code sizes
// itself to Otto's geometry instead of importing a second scale.
export const buttonControlHeight: Record<ButtonControlSize, number> = {
  xs: TIGHT_CONTROL_HEIGHT,
  sm: COMPACT_CONTROL_HEIGHT,
  md: FIELD_CONTROL_HEIGHT,
  lg: FIELD_CONTROL_HEIGHT,
};

// Upstream's title-bar control height. Kept as its own constant because header
// chrome is deliberately tighter than the tight control ladder.
export const HEADER_CONTROL_HEIGHT = 26;

export const segmentedIconSize: Record<SegmentedControlSize, IconSizeToken> = {
  xs: "xs",
  sm: "sm",
  md: "md",
};

export const switchGeometry = {
  trackWidth: SWITCH_TRACK_WIDTH,
  trackHeight: SWITCH_TRACK_HEIGHT,
  thumbSize: SWITCH_THUMB_SIZE,
  thumbTravel: SWITCH_TRACK_WIDTH - SWITCH_THUMB_SIZE - (SWITCH_TRACK_HEIGHT - SWITCH_THUMB_SIZE),
};

// A segment sits INSIDE its track, so its corners have to be tighter than the
// track's by exactly the inset, or the two curves fight and the segment's
// corners poke past the container's.
function nestedRadius(containerRadius: number, inset: number): number {
  return Math.max(0, containerRadius - inset);
}

function fieldLineHeight(fontSize: number): number {
  return Math.round(fontSize * FIELD_TEXT_LINE_HEIGHT_RATIO);
}

function fieldVerticalPadding(controlHeight: number, lineHeight: number): number {
  return (controlHeight - lineHeight) / 2;
}

export function getControlInteractionPhase(
  state: ControlInteractionState,
): ControlInteractionPhase {
  if (state.disabled) {
    return "rest";
  }
  if (state.active || state.focused || state.open || state.pressed) {
    return "active";
  }
  if (state.hovered) {
    return "hover";
  }
  return "rest";
}

export function resolveControlInteractionStyles(
  styles: ControlInteractionStyleMap,
  state: ControlInteractionState,
): StyleProp<ViewStyle> {
  const phase = getControlInteractionPhase(state);
  return [
    styles.controlRest,
    phase === "hover" ? styles.controlHover : null,
    phase === "active" ? styles.controlActive : null,
    state.disabled ? styles.controlDisabled : null,
  ];
}

export function createControlGeometry(theme: Theme) {
  const fieldTextSmLineHeight = fieldLineHeight(theme.fontSize.sm);
  const fieldTextMdLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldControlSm = {
    minHeight: controlHeights.compact,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: fieldVerticalPadding(controlHeights.compact, fieldTextSmLineHeight),
    borderRadius: theme.borderRadius.md,
  };
  const fieldControlMd = {
    minHeight: controlHeights.field,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: fieldVerticalPadding(controlHeights.field, fieldTextMdLineHeight),
    borderRadius: theme.borderRadius.lg,
  };
  const fieldTextSm = {
    fontSize: theme.fontSize.sm,
    lineHeight: fieldTextSmLineHeight,
  };
  const fieldTextMd = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextMdLineHeight,
  };
  const switchControl = {
    minHeight: controlHeights.compact,
    justifyContent: CONTROL_CENTER_JUSTIFY_CONTENT,
  } satisfies { minHeight: number; justifyContent: "center" };
  // xs shares sm's track radius rather than stepping down to borderRadius.sm:
  // that is 2, and minus the 2px inset the thumb would come out square.
  const segmentedContainerXsRadius = theme.borderRadius.md;
  const segmentedContainerSmRadius = theme.borderRadius.md;
  const segmentedContainerMdRadius = theme.borderRadius.lg;

  return {
    buttonXs: {
      minHeight: controlHeights.tight,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    buttonSm: {
      minHeight: controlHeights.compact,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    buttonMd: {
      minHeight: controlHeights.field,
      paddingHorizontal: theme.spacing[4],
      borderRadius: theme.borderRadius.lg,
    },
    buttonLg: {
      minHeight: controlHeights.field,
      paddingHorizontal: theme.spacing[6],
      borderRadius: theme.borderRadius.xl,
    },
    buttonText: {
      fontSize: theme.fontSize.sm,
    },
    buttonTextXs: {
      fontSize: theme.fontSize.xs,
    },
    formTextInputSm: {
      ...fieldControlSm,
      ...fieldTextSm,
    },
    formTextInputMd: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    formTextInput: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    fieldControlSm,
    fieldControlMd,
    fieldTextSm,
    fieldTextMd,
    controlRest: {
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.borderAccent,
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    controlHover: {
      borderColor: theme.colors.borderInteractiveHover,
    },
    controlActive: {
      borderColor: theme.colors.accent,
    },
    controlFocusRingColor: {
      outlineColor: theme.colors.accent,
    },
    controlDisabled: {
      opacity: theme.opacity[50],
    },
    switchControl,
    // Otto's segmented control is a boxed track with an inset thumb, NOT
    // upstream's bare pill row. The track owns a fill and a radius, the segment
    // is inset by `padding` and takes the matching nested radius. Zeroing the
    // padding or dropping the container radius here does not just flatten the
    // control, it leaves segmented-control.tsx painting a square `surface2`
    // block behind fully-round segments. See docs/design.md.
    segmentedContainerXs: {
      minHeight: controlHeights.tight,
      padding: SEGMENTED_TIGHT_INSET,
      borderRadius: segmentedContainerXsRadius,
    },
    segmentedContainerSm: {
      minHeight: controlHeights.compact,
      padding: SEGMENTED_COMPACT_INSET,
      borderRadius: segmentedContainerSmRadius,
    },
    segmentedContainerMd: {
      minHeight: controlHeights.field,
      padding: SEGMENTED_FIELD_INSET,
      borderRadius: segmentedContainerMdRadius,
    },
    segmentedSegmentXs: {
      minHeight: controlHeights.tight - SEGMENTED_TIGHT_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: nestedRadius(segmentedContainerXsRadius, SEGMENTED_TIGHT_INSET),
    },
    segmentedSegmentSm: {
      minHeight: controlHeights.compact - SEGMENTED_COMPACT_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: nestedRadius(segmentedContainerSmRadius, SEGMENTED_COMPACT_INSET),
    },
    segmentedSegmentMd: {
      minHeight: controlHeights.field - SEGMENTED_FIELD_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: nestedRadius(segmentedContainerMdRadius, SEGMENTED_FIELD_INSET),
    },
    segmentedLabelXs: {
      fontSize: theme.fontSize.xs,
    },
    segmentedLabelSm: {
      fontSize: theme.fontSize.sm,
    },
    segmentedLabelMd: {
      fontSize: theme.fontSize.base,
    },
  };
}

/**
 * The three control heights every button, field, and segmented control is built from.
 * Exported so a row that hosts one of those controls can size itself from the same
 * numbers instead of guessing a height the control then outgrows.
 */
export const CONTROL_HEIGHTS = {
  tight: TIGHT_CONTROL_HEIGHT,
  compact: COMPACT_CONTROL_HEIGHT,
  field: FIELD_CONTROL_HEIGHT,
};
