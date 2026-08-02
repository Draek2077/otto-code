// How many tabs a pane keeps mounted. The sibling of workspace-deck-retention:
// the deck decides how many workspace TREES stay resident, this decides how many
// TABS inside one pane do.
//
// A hidden tab is not free, but it is cheap on purpose: `RetainedPanel` parks it
// at `display: none` and every reader of the live stream buffers freezes on the
// reference it last saw (see docs/chat-lifecycle.md). What a retained tab really
// costs is memory. What evicting one costs is a full remount on the way back:
// render model, layout, markdown, and syntax highlighting for the entire
// transcript, all in one blocking render, plus a timeline refetch if the stream
// buffers were released while it was gone.
//
// That asymmetry is why the floor is 2. At 1 every switch is a cold mount and
// the retention path is unreachable, which is the same reasoning the deck's
// MIN_MOUNTED_WORKSPACE_LIMIT carries. The bounds themselves live in the
// settings layer, which clamps the stored value and cannot import from here.

import { MAX_MOUNTED_TAB_LIMIT, MIN_MOUNTED_TAB_LIMIT } from "@/hooks/use-settings/storage";

/**
 * The default for a desktop-class machine. Three was the original hard-coded
 * value and it evicted the tab the user was about to return to on any pane with
 * a normal number of tabs open, which is the expensive direction to be wrong in.
 */
export const AUTO_MOUNTED_TAB_LIMIT_DESKTOP = 6;

/**
 * The default on a compact form factor. Phones and small tablets have far less
 * memory to spend on resident transcripts, and they show one pane at a time, so
 * the working set of tabs a user cycles between is genuinely smaller.
 */
export const AUTO_MOUNTED_TAB_LIMIT_COMPACT = 3;

export interface ResolveMountedTabLimitInput {
  /**
   * The user's `mountedTabLimit` setting. `null` means they have not chosen one,
   * which is the default and resolves per device below.
   */
  setting: number | null;
  isCompact: boolean;
}

/**
 * The effective cap for a pane.
 *
 * An explicit user choice is absolute and is NOT narrowed on compact devices.
 * The device only decides the default: someone who deliberately raises this on a
 * tablet has told us what they want their memory spent on, and quietly halving
 * it would make the setting a suggestion. The clamp to [MIN, MAX] still applies,
 * because those are correctness bounds rather than taste.
 */
export function resolveMountedTabLimit({
  setting,
  isCompact,
}: ResolveMountedTabLimitInput): number {
  if (setting === null) {
    return isCompact ? AUTO_MOUNTED_TAB_LIMIT_COMPACT : AUTO_MOUNTED_TAB_LIMIT_DESKTOP;
  }
  return Math.min(MAX_MOUNTED_TAB_LIMIT, Math.max(MIN_MOUNTED_TAB_LIMIT, Math.floor(setting)));
}
