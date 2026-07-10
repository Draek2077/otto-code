// Pure math for the editor/preview split view's scroll and click sync.
// The two panes render the same source in different shapes (wrapped lines,
// rendered markdown), so sync is deliberately proportional: equal fractions
// of scrollable range / content height are treated as "the same place".

export interface ScrollWindow {
  scrollTop: number;
  /** Total content height (preview) or scrollHeight (editor). */
  contentHeight: number;
  clientHeight: number;
}

/** 0..1 position within the scrollable range; 0 when nothing scrolls. */
export function scrollFraction(window: ScrollWindow): number {
  const max = window.contentHeight - window.clientHeight;
  if (max <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, window.scrollTop / max));
}

/** Map a 1-based line to a 0..1 fraction of the document's content. */
export function lineToContentFraction(line: number, lineCount: number): number {
  if (lineCount <= 1) {
    return 0;
  }
  const clamped = Math.min(Math.max(line, 1), lineCount);
  return (clamped - 1) / (lineCount - 1);
}

/** Map a 0..1 content fraction back to the nearest 1-based line. */
export function contentFractionToLine(fraction: number, lineCount: number): number {
  if (lineCount <= 1) {
    return 1;
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * (lineCount - 1)) + 1;
}

/** 0..1 position of a content Y within the content (not the scroll range). */
export function contentYFraction(contentY: number, contentHeight: number): number {
  if (contentHeight <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, contentY / contentHeight));
}

/**
 * Content Y in the target pane for a source line, so a click on line N lands
 * on the proportionally equivalent content on the other side.
 */
export function lineToTargetContentY(input: {
  line: number;
  lineCount: number;
  targetContentHeight: number;
}): number {
  return lineToContentFraction(input.line, input.lineCount) * input.targetContentHeight;
}

/**
 * One-owner echo suppression for a bidirectional sync: while one side is
 * being scrolled by the user, programmatic scrolls it causes on the other
 * side must not bounce back. The gate hands the "driver" role to whichever
 * side last produced a user event and ignores the follower for a short hold.
 */
export interface SplitSyncGate {
  /** Returns true when `side` may drive the other side right now. */
  claim(side: "editor" | "preview"): boolean;
}

export function createSplitSyncGate(options?: {
  holdMs?: number;
  now?: () => number;
}): SplitSyncGate {
  const holdMs = options?.holdMs ?? 150;
  const now = options?.now ?? (() => Date.now());
  let driver: "editor" | "preview" | null = null;
  let driverUntil = 0;
  return {
    claim(side) {
      const at = now();
      if (driver !== null && driver !== side && at < driverUntil) {
        return false;
      }
      driver = side;
      driverUntil = at + holdMs;
      return true;
    },
  };
}
