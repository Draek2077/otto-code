import { useMemo, type ReactElement } from "react";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useSettings } from "@/hooks/use-settings";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import {
  COMPOSER_TRACK_FLY_IN_DURATION_MS,
  COMPOSER_TRACK_FLY_OUT_DURATION_MS,
} from "@/constants/animation";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import { CompactSuggestedTasksCard } from "./compact-card";
import type { SuggestedTaskRow } from "./select";
import { ALL_MODES, BULK_MODES } from "./start-controls";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

export interface SuggestedTasksOverlayProps {
  rows: SuggestedTaskRow[];
  actions: SuggestedTaskActions;
}

// The card rises into place from below when it appears and sinks back down when
// dismissed - the same fly-up / fly-down idiom as the composer detail cards (see
// composer/track-transition.tsx), so every card that pops over the chat reads as
// one motion language. We use Reanimated's FadeInDown/FadeOutDown PRESETS (fade +
// short rise/sink) rather than a custom worklet on purpose: the worklet-function
// form of a layout animation is a no-op on web/Electron, and this overlay is
// most often seen on desktop. Presets play on every platform. Both fire the exit
// before unmount, so the card animates out even though it returns null when the
// queue empties.
const flyIn = FadeInDown.duration(COMPOSER_TRACK_FLY_IN_DURATION_MS);
const flyOut = FadeOutDown.duration(COMPOSER_TRACK_FLY_OUT_DURATION_MS);

// A floating, non-blocking card that pops over the TOP of the chat when an agent
// suggests one or more tasks. The user answers each asynchronously via a split
// button (primary = their default mode, caret = the other modes + Dismiss), or
// closes the whole card with the title-bar X. It never steals composer focus and
// persists until the queue is empty. Mounted inside the chat content container
// (not a Portal) so it stays within bounds - Android hit-testing needs the card
// inside its parent (see docs/floating-panels.md).
//
// The queue uses the same collapsible form on every device (see compact-card.tsx)
// so the user can keep it visible without letting it take over the transcript.
export function SuggestedTasksOverlay({
  rows,
  actions,
}: SuggestedTasksOverlayProps): ReactElement | null {
  const enabled = useSettings((settings) => settings.suggestedTasksEnabled);
  // Honors Appearance → Animations: with motion off the card mounts and unmounts
  // instantly (no enter/exit), exactly as the composer detail cards do.
  const animate = useAnimationsEnabled();
  const defaultMode = useSettings((settings) => settings.suggestedTasksDefaultMode);
  // Secondary options for a per-row split button: every mode except the default.
  const rowSecondaryModes = useMemo(
    () => ALL_MODES.filter((mode) => mode !== defaultMode),
    [defaultMode],
  );
  // "Start all" can't do in_session, so its primary falls back to new_chat when
  // the user's default is in_session; its caret lists the rest.
  const bulkPrimaryMode: TasksSuggestedStartMode =
    defaultMode === "in_session" ? "new_chat" : defaultMode;
  const bulkSecondaryModes = useMemo(
    () => BULK_MODES.filter((mode) => mode !== bulkPrimaryMode),
    [bulkPrimaryMode],
  );

  // Suppressed on this device, or nothing pending → render nothing.
  if (!enabled || rows.length === 0) {
    return null;
  }
  return (
    <Animated.View
      entering={animate ? flyIn : undefined}
      exiting={animate ? flyOut : undefined}
      style={styles.card}
      testID="suggested-tasks-overlay"
    >
      <CompactSuggestedTasksCard
        rows={rows}
        actions={actions}
        defaultMode={defaultMode}
        rowSecondaryModes={rowSecondaryModes}
        bulkPrimaryMode={bulkPrimaryMode}
        bulkSecondaryModes={bulkSecondaryModes}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Positioning, the PIP inset and the stacking slot all belong to the shared
  // column this card is rendered into (panels/chat-top-overlay-stack.tsx).
  card: {
    width: "100%",
    maxWidth: 460,
    // The card is an offer of work, not a log line, so it takes the info tone
    // from the status-tint family (docs/design.md §12) instead of the neutral
    // panel chrome used elsewhere: a sky ring around a sky-washed interior.
    // Deliberately NOT the theme accent - accent is the CTA colour and already
    // paints the start button below, so an accent card would read as more of
    // the same chrome; and on the monochrome variants accentBright is
    // near-white, which would leave this card with no hue at all. Blue also
    // stays put across all 13 variants, so "a suggestion" always looks like a
    // suggestion.
    //
    // surface2 is the opaque base under the children's alpha washes - the card
    // floats over the stream, so it cannot be washed directly or chat text
    // would show through.
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusInfo,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...theme.shadow.md,
  },
}));
