// How much room the picture-in-picture Visualizer is taking on each side, so
// overlays inside the conversation can move out of its way.
//
// This is a real containment problem, not a z-index one. The PIP is mounted at
// the WORKSPACE level (a later sibling of the whole pane tree — see
// workspace-screen.tsx for why it can't live inside a pane), while the
// suggested-task card is mounted inside the chat pane. A descendant can never
// paint above an ancestor's later sibling, so no `zIndex` on the card can rescue
// it: if the two boxes overlap, the PIP wins and the card is buried. The only
// real fix is to not overlap — the charter's "render above the PIP, or
// left-aligned so they don't collide".
//
// Since the PIP is draggable, the inset has to follow it. Only a PIP near the
// TOP can collide with a top-anchored card at all, and which side it clears
// depends on which side the PIP is parked on. A PIP dragged low, or centred
// horizontally where a maxWidth-capped card doesn't reach, costs nothing.
import { useMemo } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import { PIP_DIMENSIONS } from "@/visualizer/visualizer-chrome-profile";

/** Extra breathing room between a shifted overlay and the PIP's edge. */
const PIP_CLEARANCE = 12;

/** Below this vertical fraction the PIP is "at the top" and can collide with a
 * top-anchored overlay. Above it, the card and the PIP simply miss each other. */
const PIP_TOP_BAND = 0.35;

/** Past this horizontal fraction the PIP counts as parked on that side. In the
 * middle it overlaps a centred card no matter which way the card shifts, so
 * shifting would only make things worse — leave it alone and let the card's own
 * maxWidth keep them apart. */
const PIP_SIDE_BAND = 0.35;

export interface VisualizerPipInset {
  left: number;
  right: number;
}

const NO_INSET: VisualizerPipInset = { left: 0, right: 0 };

/** Width to keep clear on each side, in px. Zeroes when no PIP is showing —
 * the common case, and free. */
export function useVisualizerPipInset(): VisualizerPipInset {
  const { settings } = useAppSettings();
  // The PIP does not exist on mobile (visualizer-pip-host.tsx), so nothing to
  // clear even if the stored open flag says otherwise.
  const isCompact = useIsCompactFormFactor();
  const open = settings.visualizerPipOpen && !isCompact;
  const size = settings.visualizerPipSize;
  const x = settings.visualizerPipX;
  const y = settings.visualizerPipY;

  return useMemo(() => {
    if (!open || y > PIP_TOP_BAND) {
      return NO_INSET;
    }
    const width = PIP_DIMENSIONS[size].width + PIP_CLEARANCE;
    if (x >= 1 - PIP_SIDE_BAND) {
      return { left: 0, right: width };
    }
    if (x <= PIP_SIDE_BAND) {
      return { left: width, right: 0 };
    }
    return NO_INSET;
  }, [open, size, x, y]);
}
