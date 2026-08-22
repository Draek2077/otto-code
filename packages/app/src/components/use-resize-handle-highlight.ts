import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Delay before a hovered resize splitter lights up. Long enough that brushing
 * past the seam on the way to something else does not flash the highlight,
 * short enough that aiming for the splitter feels immediate.
 */
const HIGHLIGHT_DELAY_MS = 100;

export interface ResizeHandleHighlight {
  highlighted: boolean;
  handleHoverIn: () => void;
  handleHoverOut: () => void;
}

/**
 * Shared hover-highlight state for resize splitters (sidebar handles, the
 * workspace tabs rail's splitter). Hover is a fine-pointer concept - callers
 * gate on `useHasFinePointer()` and simply never wire the handlers elsewhere.
 */
export function useResizeHandleHighlight(): ResizeHandleHighlight {
  const [highlighted, setHighlighted] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHighlightTimer = useCallback(() => {
    if (highlightTimerRef.current === null) return;
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
  }, []);

  const handleHoverIn = useCallback(() => {
    cancelHighlightTimer();
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlighted(true);
    }, HIGHLIGHT_DELAY_MS);
  }, [cancelHighlightTimer]);

  const handleHoverOut = useCallback(() => {
    cancelHighlightTimer();
    setHighlighted(false);
  }, [cancelHighlightTimer]);

  useEffect(() => cancelHighlightTimer, [cancelHighlightTimer]);

  return { highlighted, handleHoverIn, handleHoverOut };
}
