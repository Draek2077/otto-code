export type WorkspaceTabCloseButtonPolicy = "all";

// Shared tab-chip metrics — the single source of truth for both the
// horizontal row's shrink-to-fit math and the vertical rail's content-driven
// width, so the two never drift apart.
export const TAB_ICON_WIDTH = 14;
// Mirrors the chip's paddingHorizontal (theme.spacing[2] in styles.tab) —
// keep the two in sync or the width math over/under-estimates label room.
export const TAB_HORIZONTAL_PADDING = 8;
export const TAB_ESTIMATED_CHAR_WIDTH = 7;
export const TAB_CLOSE_BUTTON_WIDTH = 22;
export const TAB_MAX_WIDTH = 200;
// The rail trades horizontal room for label space (labels are all it shows),
// so its cap is deliberately wider than a horizontal tab's.
export const RAIL_TAB_MAX_WIDTH = TAB_MAX_WIDTH * 2.25;

export interface WorkspaceTabLayoutInput {
  viewportWidth: number;
  tabLabelLengths: number[];
  metrics: {
    rowHorizontalInset: number;
    actionsReservedWidth: number;
    rowPaddingHorizontal: number;
    tabGap: number;
    maxTabWidth: number;
    tabIconWidth: number;
    tabHorizontalPadding: number;
    estimatedCharWidth: number;
    closeButtonWidth: number;
  };
}

export interface WorkspaceTabLayoutItem {
  width: number;
  showLabel: boolean;
  labelCharCap: number;
}

export interface WorkspaceTabLayoutResult {
  items: WorkspaceTabLayoutItem[];
  closeButtonPolicy: WorkspaceTabCloseButtonPolicy;
  requiresHorizontalScrollFallback: boolean;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function computeWorkspaceTabLayout(
  input: WorkspaceTabLayoutInput,
): WorkspaceTabLayoutResult {
  const tabCount = input.tabLabelLengths.length;
  if (tabCount === 0) {
    return {
      items: [],
      closeButtonPolicy: "all",
      requiresHorizontalScrollFallback: false,
    };
  }

  const availableWidth = Math.max(
    0,
    input.viewportWidth - input.metrics.rowHorizontalInset * 2 - input.metrics.actionsReservedWidth,
  );
  const rowOverhead =
    input.metrics.rowPaddingHorizontal * 2 + Math.max(tabCount - 1, 0) * input.metrics.tabGap;
  const availableTabsWidth = Math.max(0, availableWidth - rowOverhead);
  const iconOnlyTabWidth =
    input.metrics.tabIconWidth +
    input.metrics.tabHorizontalPadding * 2 +
    input.metrics.closeButtonWidth;
  const iconOnlyTotalTabsWidth = iconOnlyTabWidth * tabCount;
  const requiresHorizontalScrollFallback = availableTabsWidth < iconOnlyTotalTabsWidth;
  const resolvedWidth = requiresHorizontalScrollFallback
    ? iconOnlyTabWidth
    : clamp(availableTabsWidth / tabCount, iconOnlyTabWidth, input.metrics.maxTabWidth);
  const resolvedWidths = Array.from({ length: tabCount }, () => resolvedWidth);

  const roundedWidths = resolvedWidths.map((width) =>
    Math.round(clamp(width, iconOnlyTabWidth, input.metrics.maxTabWidth)),
  );

  return {
    items: roundedWidths.map((width) => {
      const rawCharCap = Math.floor((width - iconOnlyTabWidth) / input.metrics.estimatedCharWidth);
      const labelCharCap = Math.max(0, rawCharCap);
      return {
        width,
        showLabel: labelCharCap > 0,
        labelCharCap,
      };
    }),
    closeButtonPolicy: "all",
    requiresHorizontalScrollFallback,
  };
}

export interface WorkspaceTabRailWidthInput {
  tabLabelLengths: number[];
  metrics: {
    tabIconWidth: number;
    tabHorizontalPadding: number;
    estimatedCharWidth: number;
    closeButtonWidth: number;
    maxTabWidth: number;
    minTabWidth: number;
  };
}

// The vertical rail's counterpart to computeWorkspaceTabLayout: instead of
// dividing a measured viewport width across every tab, it sizes to content —
// every tab in the rail shares one width, wide enough for the widest current
// label (so short labels don't waste rail space) but never past `maxTabWidth`
// (RAIL_TAB_MAX_WIDTH for the rail; longer labels beyond that just truncate
// via the chip's existing ellipsis).
export function computeWorkspaceTabRailWidth(input: WorkspaceTabRailWidthInput): number {
  const iconOnlyTabWidth =
    input.metrics.tabIconWidth +
    input.metrics.tabHorizontalPadding * 2 +
    input.metrics.closeButtonWidth;

  if (input.tabLabelLengths.length === 0) {
    return input.metrics.minTabWidth;
  }

  const widestLabelLength = Math.max(...input.tabLabelLengths);
  const naturalWidth = iconOnlyTabWidth + widestLabelLength * input.metrics.estimatedCharWidth;
  return Math.round(clamp(naturalWidth, input.metrics.minTabWidth, input.metrics.maxTabWidth));
}
