// Tab-overflow model for the horizontal desktop tab strip. Tabs never shrink
// below a readable minimum width; once the strip can't fit them all at that
// minimum, the ones that don't fit collapse into an overflow menu. How many stay
// visible is a function of available space, not a fixed count. This is pure,
// store-adjacent logic (no React, no store handle) so both the row component and
// its tests can share one definition of the capacity math, the split, and the
// select-to-swap reorder.

/**
 * How many tabs fit in the strip before the rest collapse into the overflow
 * menu — derived from available space and a per-tab minimum width, never a fixed
 * count. Returns `totalTabs` (no overflow) whenever they all fit at the minimum,
 * otherwise reserves room for the overflow control and refits, always keeping at
 * least one tab visible. When the width isn't measured yet (0) everything stays
 * visible, so the strip never flashes an overflow control before its first
 * layout pass.
 */
export function computeVisibleTabCount(input: {
  totalTabs: number;
  /** Width available for the chips — already net of the toggle, tools strip, and row padding, but NOT the overflow control. */
  availableWidth: number;
  minTabWidth: number;
  overflowControlWidth: number;
}): number {
  const { totalTabs, availableWidth, minTabWidth, overflowControlWidth } = input;
  if (totalTabs <= 0) {
    return 0;
  }
  if (minTabWidth <= 0 || availableWidth <= 0) {
    return totalTabs;
  }
  // Everything fits at the minimum width — no overflow control, no menu.
  const fitAll = Math.floor(availableWidth / minTabWidth);
  if (fitAll >= totalTabs) {
    return totalTabs;
  }
  // Overflow is unavoidable: reserve the control's slot, then refit. At least
  // one tab always stays in the strip.
  const fitWithOverflow = Math.floor((availableWidth - overflowControlWidth) / minTabWidth);
  return Math.max(1, Math.min(totalTabs, fitWithOverflow));
}

export interface TabOverflowSplit<T> {
  /** Tabs rendered as chips in the strip, in display order. */
  visible: T[];
  /** Tabs collapsed into the overflow menu, in their original order. */
  hidden: T[];
}

/**
 * Splits an ordered tab list into the visible prefix and the hidden remainder.
 *
 * The visible set is normally the first `cap` tabs. The one exception is the
 * active tab: if it sits past the cap it is pulled into the last visible slot
 * so the focused tab is always shown in the strip (never stranded in the menu).
 * That pull-in is display-only — it does not mutate the persisted order — and it
 * displaces whatever tab was in the last visible slot into the hidden set,
 * preserving every other tab's relative order.
 */
export function splitTabsForOverflow<T>(input: {
  items: readonly T[];
  getId: (item: T) => string;
  activeId: string | null;
  cap: number;
}): TabOverflowSplit<T> {
  const { items, getId, activeId, cap } = input;
  if (cap <= 0 || items.length <= cap) {
    return { visible: [...items], hidden: [] };
  }

  const activeIndex = activeId ? items.findIndex((item) => getId(item) === activeId) : -1;
  // Active tab already inside the visible prefix (or no active tab at all): a
  // plain prefix/remainder split.
  if (activeIndex < cap) {
    return { visible: items.slice(0, cap), hidden: items.slice(cap) };
  }

  // Active tab is past the cap — surface it in the last visible slot and bump
  // the tab that would have occupied that slot into the hidden set. Every tab
  // except the displaced one keeps its position.
  const activeItem = items[activeIndex]!;
  const visible = [...items.slice(0, cap - 1), activeItem];
  const hidden = items.filter((_, index) => index >= cap - 1 && index !== activeIndex);
  return { visible, hidden };
}

/**
 * Produces the new full tab order after the user picks a hidden tab from the
 * overflow menu: the selected tab moves to the last visible slot (index
 * `cap - 1`), which bumps the tab currently there into the first hidden
 * position. All other tabs keep their relative order. Returns a fresh array;
 * the input is never mutated. A no-op (selection missing, or already at the
 * target slot) returns a copy of the input unchanged.
 */
export function reorderTabIntoVisible(input: {
  tabIds: readonly string[];
  selectedId: string;
  cap: number;
}): string[] {
  const { tabIds, selectedId, cap } = input;
  const currentIndex = tabIds.indexOf(selectedId);
  if (currentIndex < 0 || cap <= 0) {
    return [...tabIds];
  }
  const targetIndex = Math.min(cap - 1, tabIds.length - 1);
  if (currentIndex === targetIndex) {
    return [...tabIds];
  }
  const next = [...tabIds];
  next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, selectedId);
  return next;
}
