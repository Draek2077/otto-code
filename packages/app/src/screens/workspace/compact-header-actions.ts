/**
 * Responsive fitting for the compact workspace header's action strip.
 *
 * The strip is `[menu toggle] [title / subtitle] [...] [Voice cues] [Visualizer]
 * [Play]` in the header's `left` container plus `[Explorer]` in `right`. The
 * "..." menu is the one non-negotiable control, and the project name / workspace
 * subtitle must always keep at least `MIN_TITLE_WIDTH` — so when the row can't
 * hold everything the optional buttons drop in the order Voice cues,
 * Visualizer, Explorer, Play.
 *
 * Voice cues drop first because they are the only one that is *not* a lost
 * capability: the same switch lives in Agents settings, so the header button is
 * pure convenience. Play is the last to go for the mirror-image reason — none of
 * the other three are duplicated in the "..." menu, and Play is the only one
 * with no other route at all: a Visualizer or Explorer view can be reopened as a
 * tab, but with no Play button there is no way to run a workspace script on a
 * narrow screen.
 */

/** Optional compact header buttons, listed in the order they drop. */
const DROP_ORDER = ["voiceCues", "visualizer", "explorer", "play"] as const;

type CompactHeaderAction = (typeof DROP_ORDER)[number];

/**
 * Floor for the title/subtitle group. The header truncates both lines, so this
 * is "enough to read a few characters and the ellipsis", not a full title.
 * Mirrored by `headerTitleTextGroup`'s compact `minWidth` so the measurement
 * here and the layout agree on what the title is owed.
 */
export const MIN_TITLE_WIDTH = 96;

// Compact chrome widths, derived from the styles the buttons actually use:
// every one is `headerIconSlotStyle.slot` (spacing[3] = 12px padding per side)
// wrapping a compact-scaled glyph. Approximations are fine — this decides
// whether a ~54px box fits, not where it lands.
const SLOT_PADDING = 12 * 2;
/** `MobileMenuIcon` is a fixed 16px rule doubled in compact. */
const SIDEBAR_TOGGLE_WIDTH = SLOT_PADDING + 32;
/** The "..." trigger scales its glyph at 1.5x `md` (16 -> 24). */
const MENU_TRIGGER_WIDTH = SLOT_PADDING + 24;
/** Play / Voice cues / Visualizer / Explorer all scale `lg` (20) at 1.5x. */
const ACTION_WIDTH = SLOT_PADDING + 30;
/** `ScreenHeader`'s row padding plus the `left` container's one gap. */
const ROW_CHROME_WIDTH = 8 * 2 + 8;

const FIXED_CHROME_WIDTH =
  ROW_CHROME_WIDTH + SIDEBAR_TOGGLE_WIDTH + MENU_TRIGGER_WIDTH + MIN_TITLE_WIDTH;

export interface CompactHeaderActionsInput {
  /** Compact form factor. Desktop never drops anything. */
  isCompact: boolean;
  /** Measured header row width; 0 until the first layout pass. */
  rowWidth: number;
  isDeveloperMode: boolean;
  visualizerEnabled: boolean;
  /** The host advertises both cue authoring and TTS, so cues can actually
   * speak. Not gated on developer mode: a mute for something audible belongs
   * wherever the noise reaches you. */
  voiceCuesAvailable: boolean;
  hasWorkspaceScripts: boolean;
  hasWorkspaceDirectory: boolean;
}

export interface CompactHeaderActionsFit {
  /** Developer-mode Play button, in the title cluster. */
  showPlay: boolean;
  /** Visualizer button, in the title cluster. */
  showVisualizer: boolean;
  /** Voice-cue mute, in the title cluster left of the Visualizer. */
  showVoiceCues: boolean;
  /** Developer-mode Explorer toggle, in the compact `headerRight`. */
  showCompactExplorer: boolean;
  /** User-mode Explorer toggle, which also renders on desktop. */
  showPlainExplorer: boolean;
}

/**
 * Resolves which optional header buttons render. Returns one flag per mount
 * site so each JSX gate stays a single boolean — the callers straddle two
 * containers and must spend the same width budget.
 *
 * A `rowWidth` of 0 means "not measured yet": everything renders, so the first
 * paint is complete and buttons drop once the real width lands rather than
 * popping in.
 */
export function resolveCompactHeaderActions(
  input: CompactHeaderActionsInput,
): CompactHeaderActionsFit {
  const requested = new Set<CompactHeaderAction>();
  if (input.isDeveloperMode && input.hasWorkspaceScripts) {
    requested.add("play");
  }
  if (input.isDeveloperMode && input.visualizerEnabled) {
    requested.add("visualizer");
  }
  if (input.voiceCuesAvailable) {
    requested.add("voiceCues");
  }
  if (input.isDeveloperMode || input.hasWorkspaceDirectory) {
    requested.add("explorer");
  }
  const fitted =
    input.isCompact && input.rowWidth > 0
      ? fitCompactHeaderActions({ rowWidth: input.rowWidth, requested })
      : requested;
  return {
    showPlay: fitted.has("play"),
    showVisualizer: fitted.has("visualizer"),
    showVoiceCues: fitted.has("voiceCues"),
    showCompactExplorer: input.isCompact && fitted.has("explorer"),
    showPlainExplorer: input.hasWorkspaceDirectory && fitted.has("explorer"),
  };
}

/** Grants slots to the requested buttons, last-to-drop first. */
function fitCompactHeaderActions(input: {
  rowWidth: number;
  requested: ReadonlySet<CompactHeaderAction>;
}): ReadonlySet<CompactHeaderAction> {
  const budget = input.rowWidth - FIXED_CHROME_WIDTH;
  const slots = Math.max(0, Math.floor(budget / ACTION_WIDTH));
  const visible = new Set<CompactHeaderAction>();
  for (let index = DROP_ORDER.length - 1; index >= 0 && visible.size < slots; index -= 1) {
    const action = DROP_ORDER[index]!;
    if (input.requested.has(action)) {
      visible.add(action);
    }
  }
  return visible;
}
