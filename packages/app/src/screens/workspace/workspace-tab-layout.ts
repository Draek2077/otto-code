import { WORKSPACE_TABS_RAIL_MAX_WIDTH } from "@/constants/layout";

export type WorkspaceTabCloseButtonPolicy = "all";

// Shared tab-chip metrics - the single source of truth for both the
// horizontal row's shrink-to-fit math and the vertical rail's content-driven
// width, so the two never drift apart.
export const TAB_ICON_WIDTH = 14;
// Mirrors the chip's paddingHorizontal (theme.spacing[2] in styles.tab) -
// keep the two in sync or the width math over/under-estimates label room.
export const TAB_HORIZONTAL_PADDING = 8;
// The chip's icon-to-label gap (theme.spacing[1] in styles.tab). Part of the
// chrome width, so label room is over-estimated without it.
export const TAB_CONTENT_GAP = 4;
// Matches the `sm` tab label in workspace-desktop-tabs-row.tsx. Keep this
// estimate aligned with the rendered type so tabs do not reserve phantom width.
export const TAB_ESTIMATED_CHAR_WIDTH = 7;
export const TAB_CLOSE_BUTTON_WIDTH = 22;
export const TAB_MAX_WIDTH = 200;
// The narrowest a horizontal tab chip is allowed to get before the strip stops
// squeezing and starts overflowing tabs into the menu instead. Wide enough to
// keep the icon plus a few characters of label readable (icon + padding + close
// ≈ 52px, leaving ~48px of label room), so tabs never collapse to icon-only.
export const TAB_MIN_WIDTH = 100;
// The rail trades horizontal room for label space (labels are all it shows),
// so its cap is deliberately wider than a horizontal tab's - 2.25x TAB_MAX_WIDTH.
// It lives in constants/layout.ts because the settings layer clamps the saved
// user rail width to it and must not import from `screens/`; re-exported here so
// the tab metrics still read as one set.
export const RAIL_TAB_MAX_WIDTH = WORKSPACE_TABS_RAIL_MAX_WIDTH;

export interface WorkspaceTabLayoutMetrics {
  rowHorizontalInset: number;
  actionsReservedWidth: number;
  rowPaddingHorizontal: number;
  tabGap: number;
  minTabWidth: number;
  maxTabWidth: number;
  tabIconWidth: number;
  tabContentGap: number;
  tabHorizontalPadding: number;
  closeButtonWidth: number;
}

export interface WorkspaceTabLayoutInput {
  viewportWidth: number;
  tabLabelWidths: number[];
  metrics: WorkspaceTabLayoutMetrics;
}

export interface WorkspaceTabLayoutItem {
  width: number;
  showLabel: boolean;
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
  const tabCount = input.tabLabelWidths.length;
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
  const tabChromeWidth =
    input.metrics.tabIconWidth +
    input.metrics.tabContentGap +
    input.metrics.tabHorizontalPadding * 2 +
    input.metrics.closeButtonWidth;
  const naturalWidths = input.tabLabelWidths.map((labelWidth) =>
    clamp(tabChromeWidth + labelWidth, input.metrics.minTabWidth, input.metrics.maxTabWidth),
  );
  const naturalTotalWidth = naturalWidths.reduce((total, width) => total + width, 0);
  const minimumTotalWidth = input.metrics.minTabWidth * tabCount;
  const requiresHorizontalScrollFallback = availableTabsWidth < minimumTotalWidth;

  let resolvedWidths = naturalWidths;
  if (requiresHorizontalScrollFallback) {
    resolvedWidths = Array.from({ length: tabCount }, () => input.metrics.minTabWidth);
  } else if (naturalTotalWidth > availableTabsWidth) {
    const widthToRemove = naturalTotalWidth - availableTabsWidth;
    const shrinkCapacity = naturalTotalWidth - minimumTotalWidth;
    const shrinkRatio = widthToRemove / shrinkCapacity;
    resolvedWidths = naturalWidths.map(
      (width) => width - (width - input.metrics.minTabWidth) * shrinkRatio,
    );
  }

  const roundedWidths = resolvedWidths.map((width) =>
    Math.round(clamp(width, input.metrics.minTabWidth, input.metrics.maxTabWidth)),
  );

  return {
    items: roundedWidths.map((width) => ({
      width,
      showLabel: width > tabChromeWidth,
    })),
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
// dividing a measured viewport width across every tab, it sizes to content -
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

export function retainWorkspaceTabMeasuredWidth(
  currentWidth: number,
  measuredWidth: number,
): number {
  if (measuredWidth <= 0 || Math.abs(currentWidth - measuredWidth) <= 1) {
    return currentWidth;
  }
  return measuredWidth;
}
