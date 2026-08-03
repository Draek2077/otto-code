import { useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import Animated, {
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
} from "react-native-reanimated";
import {
  COMPOSER_TRACK_FLY_IN_DURATION_MS,
  COMPOSER_TRACK_FLY_OUT_DURATION_MS,
} from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";

export { COMPOSER_TRACK_LAYERS } from "@/composer/track-layers";

// NATIVE enter/exit motion for the detail cards stacked above the message box —
// the subagents track, the background-tasks track, and the rate-limit /
// context-health flyout bands. Web and Electron use track-transition.web.tsx,
// which does not go through Reanimated at all; see that file for why.
//
// The cards read as drawers pulled out of the composer: each tucks its bottom
// edge behind the message box (negative marginBottom, no bottom border, top-only
// radii) and the whole stack is painted back-to-front so the composer covers
// them. This gives that geometry its matching motion — a card FLIES UP from
// behind the message box when it appears, and sinks back DOWN behind it when
// dismissed.
//
// The travel distance is the card's own height, so it starts and ends fully
// tucked behind the composer rather than sliding in from the screen edge (which
// is what Reanimated's SlideInDown/SlideOutDown presets do — they translate by
// the whole window height, far too far for this).

/**
 * Rise into place from behind the message box. `targetHeight` is the height the
 * card is about to occupy, so starting one full height lower puts it exactly
 * behind the composer.
 */
function flyUpFromBehindComposer(values: EntryAnimationsValues): LayoutAnimation {
  "worklet";
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: values.targetHeight }],
    },
    animations: {
      opacity: withTiming(1, { duration: COMPOSER_TRACK_FLY_IN_DURATION_MS }),
      transform: [{ translateY: withTiming(0, { duration: COMPOSER_TRACK_FLY_IN_DURATION_MS }) }],
    },
  };
}

/** Sink back down behind the message box on dismiss. */
function flyDownBehindComposer(values: ExitAnimationsValues): LayoutAnimation {
  "worklet";
  return {
    initialValues: {
      opacity: 1,
      transform: [{ translateY: 0 }],
    },
    animations: {
      opacity: withTiming(0, { duration: COMPOSER_TRACK_FLY_OUT_DURATION_MS }),
      transform: [
        {
          translateY: withTiming(values.currentHeight, {
            duration: COMPOSER_TRACK_FLY_OUT_DURATION_MS,
          }),
        },
      ],
    },
  };
}

// Entering/exiting layout animations are disabled on Android, matching the
// existing carve-out on the chat scroll indicator (agent-stream/view.tsx).
const supportsEntryExitAnimations = Platform.OS !== "android";

export interface ComposerTrackTransitionProps {
  /**
   * The card to show, or null/undefined when the track has nothing to say. An
   * empty render is the DISMISS signal rather than the caller returning null
   * itself, so the wrapper stays mounted long enough to animate the card away.
   */
  children?: ReactNode;
  /**
   * Paint layer for this card, from COMPOSER_TRACK_LAYERS. Keeps a card that is
   * mid-motion beneath the composer instead of over the input.
   */
  layer: number;
}

/**
 * Wraps a composer detail card so it flies up from behind the message box and
 * sinks back down when it goes away. Honors the Appearance → Animations switch:
 * with motion off the card mounts and unmounts instantly.
 *
 * Deliberately carries no styles of its own beyond the plain numeric layer — it
 * is a layout-neutral wrapper around each track's existing outer View. That
 * keeps themed Unistyles styles off this Animated.View, which is a hard
 * requirement (applying a `StyleSheet.create((theme) => …)` style to a
 * Reanimated view crashes on theme change — see docs/unistyles.md).
 */
export function ComposerTrackTransition({ children, layer }: ComposerTrackTransitionProps) {
  const animationsEnabled = useAnimationsEnabled();
  const animate = animationsEnabled && supportsEntryExitAnimations;
  const entering = animate ? flyUpFromBehindComposer : undefined;
  const exiting = animate ? flyDownBehindComposer : undefined;
  // Plain numeric style only — never a themed StyleSheet on a Reanimated view
  // (crashes on theme change, see docs/unistyles.md).
  const layerStyle = useMemo(() => ({ zIndex: layer }), [layer]);
  if (children == null) {
    return null;
  }
  return (
    <Animated.View entering={entering} exiting={exiting} style={layerStyle}>
      {children}
    </Animated.View>
  );
}
