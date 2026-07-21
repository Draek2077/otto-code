import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

export interface TabDropPreview {
  paneId: string;
  insertionIndex: number;
  indicatorIndex: number;
}

export type TabStripOrientation = "horizontal" | "vertical";

interface TabDropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ComputeTabDropPreviewInput {
  activePaneId: string;
  activeTabId: string;
  overPaneId: string;
  overTabId: string;
  targetTabs: WorkspaceTabDescriptor[];
  /**
   * Which axis the target pane's tab strip lays tabs out along. The horizontal
   * row compares X centers; the vertical rail must compare Y centers instead —
   * every chip in a rail shares the same left/width, so the X comparison is
   * degenerate there and the insertion index never follows the pointer.
   */
  orientation: TabStripOrientation;
  activeRect: TabDropRect;
  overRect: TabDropRect;
}

export function computeTabDropPreview(input: ComputeTabDropPreviewInput): TabDropPreview | null {
  const targetIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.overTabId);
  if (targetIndex < 0) {
    return null;
  }

  const isVertical = input.orientation === "vertical";
  const overExtent = isVertical ? input.overRect.height : input.overRect.width;
  if (overExtent <= 0) {
    return null;
  }

  const activeCenter = isVertical
    ? input.activeRect.top + input.activeRect.height / 2
    : input.activeRect.left + input.activeRect.width / 2;
  const overCenter = isVertical
    ? input.overRect.top + input.overRect.height / 2
    : input.overRect.left + input.overRect.width / 2;
  const insertAfterTarget = activeCenter >= overCenter;

  const indicatorIndex = targetIndex + (insertAfterTarget ? 1 : 0);
  let insertionIndex = indicatorIndex;
  if (input.activePaneId === input.overPaneId) {
    const sourceIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.activeTabId);
    if (sourceIndex < 0) {
      return null;
    }
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    insertionIndex = Math.max(0, Math.min(input.targetTabs.length - 1, insertionIndex));
  }

  return {
    paneId: input.overPaneId,
    insertionIndex,
    indicatorIndex,
  };
}
