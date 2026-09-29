export interface CompactSheetSafeAreaPaddingInput {
  isCompact: boolean;
  isKeyboardVisible: boolean;
  hasFooter: boolean;
  safeAreaBottom: number;
}

export interface CompactSheetSafeAreaPadding {
  contentPaddingBottom?: number;
  footerPaddingBottom?: number;
}

interface BottomSheetVisibleContentHeightInput {
  containerHeight: number;
  contentPosition: number;
  handleHeight: number;
  keyboardHeight: number;
  isKeyboardVisible: boolean;
}

export function getBottomSheetVisibleContentHeight({
  containerHeight,
  contentPosition,
  handleHeight,
  keyboardHeight,
  isKeyboardVisible,
}: BottomSheetVisibleContentHeightInput): number {
  "worklet";
  return Math.max(
    0,
    containerHeight - contentPosition - handleHeight - (isKeyboardVisible ? keyboardHeight : 0),
  );
}

export function getCompactSheetSafeAreaPadding({
  isCompact,
  isKeyboardVisible,
  hasFooter,
  safeAreaBottom,
}: CompactSheetSafeAreaPaddingInput): CompactSheetSafeAreaPadding {
  if (!isCompact || isKeyboardVisible || safeAreaBottom <= 0) {
    return {};
  }

  if (hasFooter) {
    return { footerPaddingBottom: safeAreaBottom };
  }

  return { contentPaddingBottom: safeAreaBottom };
}

export interface CompactSheetScrollFlex {
  flexGrow: number;
  flexShrink: number;
  flexBasis: number | "auto";
  minHeight: number;
}

/**
 * Sizing for the compact sheet's scroll region, shared by the scroller and the
 * seam-fade wrapper around it so the two never disagree.
 *
 * Longhands only. The wrapper composes this over its own hugging defaults, and
 * Yoga resolves an explicit `flexGrow` ahead of the `flex` shorthand: written as
 * `flex: 1`, the fill intent loses the grow to the wrapper's `flexGrow: 0` and
 * keeps only the zero flex basis, so the sheet body collapses to no height while
 * the sheet still snaps to its measured content height.
 */
export function getCompactSheetScrollFlex(
  sizeContentToCurrentSnapPoint: boolean,
): CompactSheetScrollFlex {
  // Hugging overrides react-native-web's ScrollView default (flexGrow: 1) so the
  // footer sits directly under short content instead of being pinned to the
  // sheet bottom; flexShrink still lets it give way when the content overflows.
  if (!sizeContentToCurrentSnapPoint) {
    return { flexGrow: 0, flexShrink: 1, flexBasis: "auto", minHeight: 0 };
  }
  return { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 };
}
