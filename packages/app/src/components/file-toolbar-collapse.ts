import { useCallback, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import type { FileViewModeBarProps } from "@/components/file-view-mode-bar";
import { useToolbarIconButtonWidth } from "@/components/ui/toolbar-icon-button";
import { SPACING } from "@/styles/theme";

// The file toolbar in a narrow pane.
//
// The bar grew past what a split pane can hold: at some widths the mode bar was
// pushed off the right edge, which is the one control the user needs to get
// back to a wider view. So the bar sheds buttons instead of overflowing.
//
// Shed, not folded into a "..." menu: these are the buttons people reach for
// least, and a menu that appears only when the pane is narrow is a second place
// to look for a control that was somewhere else a moment ago. Every collapsed
// action keeps its other way in - the file explorer's context menu, the Changes
// tab, the keyboard - and widening the pane brings the button back.

/**
 * Least important first: the order in which the toolbar gives buttons up.
 *
 * Read it as a ranking of what a narrow pane can do without. Refine and the
 * exports are whole-document errands you start once and walk away from; Find in
 * Files and View Changes hand off to another tab that has its own way in;
 * Outline and Word wrap go last because they act on what you are reading right
 * now.
 */
export const FILE_TOOLBAR_COLLAPSE_ORDER = [
  "refine",
  "exportHtml",
  "exportPdf",
  "findInFiles",
  "viewChanges",
  "outline",
  "wordWrap",
] as const;

export type CollapsibleFileToolbarAction = (typeof FILE_TOOLBAR_COLLAPSE_ORDER)[number];

/** Which collapsible buttons this bar would show if the pane were wide enough. */
export type FileToolbarActionAvailability = Record<CollapsibleFileToolbarAction, boolean>;

/**
 * The rest of the bar: what it holds that never collapses but still takes room.
 *
 * Only used to notice that the bar's contents changed, which is when the
 * remembered full width stops describing it. Every field but the mode bar is
 * read for its truthiness alone, so a caller hands over the handler or label it
 * already has rather than restating the condition the button renders on.
 */
export interface FileToolbarChrome {
  history: unknown;
  addToChat: unknown;
  leadingSlot: unknown;
  externalEditor: unknown;
  find: unknown;
  modeBar: FileViewModeBarProps | null;
}

/** The gap between toolbar children, and the one both toolbars style with. */
export const TOOLBAR_ROW_GAP = SPACING[2];
/** The toolbar's own horizontal inset, subtracted from the measured row. */
export const TOOLBAR_ROW_PADDING = SPACING[2];

const NOTHING_COLLAPSED: ReadonlySet<CollapsibleFileToolbarAction> = new Set();

/**
 * Which actions have to go for the bar to fit.
 *
 * `naturalWidth` is what the row would measure with every button shown, so the
 * answer depends only on the pane's width - collapsing a button never changes
 * the input that decided to collapse it. Without that the bar oscillates: drop
 * a button, the row now fits, put it back, the row overflows again.
 *
 * A zero width means "not measured yet"; nothing collapses until the first
 * layout has landed.
 */
export function resolveCollapsedFileToolbarActions({
  naturalWidth,
  availableWidth,
  itemWidth,
  present,
}: {
  naturalWidth: number;
  availableWidth: number;
  /** What one collapsed button gives back, including the gap beside it. */
  itemWidth: number;
  present: readonly CollapsibleFileToolbarAction[];
}): ReadonlySet<CollapsibleFileToolbarAction> {
  if (naturalWidth <= 0 || availableWidth <= 0 || naturalWidth <= availableWidth) {
    return NOTHING_COLLAPSED;
  }
  const collapsed = new Set<CollapsibleFileToolbarAction>();
  let width = naturalWidth;
  for (const action of FILE_TOOLBAR_COLLAPSE_ORDER) {
    if (width <= availableWidth) {
      break;
    }
    if (!present.includes(action)) {
      continue;
    }
    collapsed.add(action);
    width -= itemWidth;
  }
  return collapsed;
}

/** The present actions, in collapse order, as the resolver wants them. */
export function listPresentFileToolbarActions(
  actions: FileToolbarActionAvailability,
): CollapsibleFileToolbarAction[] {
  return FILE_TOOLBAR_COLLAPSE_ORDER.filter((action) => actions[action]);
}

/**
 * A string that changes whenever the bar's contents do, and only then. It is
 * the key the remembered full width is stored under.
 */
export function describeFileToolbarChrome(chrome: FileToolbarChrome): string {
  const modeBar = chrome.modeBar;
  return [
    chrome.history ? "history" : "",
    chrome.addToChat ? "chat" : "",
    chrome.leadingSlot ? "slot" : "",
    chrome.externalEditor ? "external" : "",
    chrome.find ? "find" : "",
    modeBar ? "mode" : "",
    modeBar?.showSplit ? "split" : "",
    modeBar?.formatted ? "formatted" : "",
  ].join("|");
}

export interface FileToolbarCollapse {
  /**
   * `value` while the button still fits, `null` once the pane made it give up
   * its place. A call rather than a ternary at every button, so wiring seven
   * of them into a toolbar does not spend the component's whole
   * cyclomatic-complexity budget on the same conditional written seven times.
   */
  keep: <T>(action: CollapsibleFileToolbarAction, value: T) => T | null;
  /** Goes on the toolbar row itself: how much width there is to spend. */
  onToolbarLayout: (event: LayoutChangeEvent) => void;
  /** Goes on the group left of the spacer, and the group right of it. */
  onLeadingGroupLayout: (event: LayoutChangeEvent) => void;
  onTrailingGroupLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Measures the toolbar and decides what it can still afford to show.
 *
 * The two groups either side of the spacer are measured rather than estimated:
 * the mode bar and a host's leading slot are arbitrary content, and a width
 * table for them would be wrong the first time either changed. Only the
 * collapsed buttons are added back arithmetically, and those are icon buttons
 * of one known width.
 *
 * The full width is remembered per `chrome` description. Within one
 * description it only ever grows, because a bar measured while buttons are
 * collapsed can also be missing a separator - counting that as a narrower bar
 * would put a button back that immediately has to go again.
 */
export function useFileToolbarCollapse({
  actions,
  chrome,
}: {
  actions: FileToolbarActionAvailability;
  chrome: FileToolbarChrome;
}): FileToolbarCollapse {
  const itemWidth = useToolbarIconButtonWidth() + TOOLBAR_ROW_GAP;
  const [availableWidth, setAvailableWidth] = useState(0);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const groupWidths = useRef({ leading: 0, trailing: 0 });
  const natural = useRef({ key: "", width: 0 });

  const presentKey = listPresentFileToolbarActions(actions).join(",");
  const present = useMemo(
    () => (presentKey ? (presentKey.split(",") as CollapsibleFileToolbarAction[]) : []),
    [presentKey],
  );
  const collapsed = useMemo(
    () => resolveCollapsedFileToolbarActions({ naturalWidth, availableWidth, itemWidth, present }),
    [availableWidth, itemWidth, naturalWidth, present],
  );
  // Read by the layout handlers, which run outside the render that produced it.
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const key = `${describeFileToolbarChrome(chrome)}|${presentKey}|${itemWidth}`;
  const remeasure = useCallback(() => {
    const measured = groupWidths.current.leading + groupWidths.current.trailing;
    const candidate = measured + collapsedRef.current.size * itemWidth;
    const previous = natural.current;
    const width = previous.key === key ? Math.max(previous.width, candidate) : candidate;
    natural.current = { key, width };
    setNaturalWidth(width);
  }, [itemWidth, key]);

  const onLeadingGroupLayout = useCallback(
    (event: LayoutChangeEvent) => {
      groupWidths.current.leading = event.nativeEvent.layout.width;
      remeasure();
    },
    [remeasure],
  );
  const onTrailingGroupLayout = useCallback(
    (event: LayoutChangeEvent) => {
      groupWidths.current.trailing = event.nativeEvent.layout.width;
      remeasure();
    },
    [remeasure],
  );
  // The row pays for its own padding and for the gaps around the spacer before
  // any of it reaches a button.
  const onToolbarLayout = useCallback((event: LayoutChangeEvent) => {
    setAvailableWidth(
      event.nativeEvent.layout.width - TOOLBAR_ROW_PADDING * 2 - TOOLBAR_ROW_GAP * 2,
    );
  }, []);

  const keep = useCallback(
    <T>(action: CollapsibleFileToolbarAction, value: T): T | null =>
      collapsed.has(action) ? null : value,
    [collapsed],
  );

  return { keep, onToolbarLayout, onLeadingGroupLayout, onTrailingGroupLayout };
}
