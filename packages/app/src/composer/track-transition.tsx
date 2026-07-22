import { useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutDown,
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
import { isWeb } from "@/constants/platform";

// Enter/exit motion shared by every detail card stacked above the message box —
// the subagents track, the background-tasks track, and the rate-limit /
// context-health flyout bands.
//
// The cards already read as drawers pulled out of the composer: each tucks its
// bottom edge behind the message box (negative marginBottom, no bottom border,
// top-only radii) and the whole stack is painted back-to-front so the composer
// covers them. This gives that geometry its matching motion — a card FLIES UP
// from behind the message box when it appears, and sinks back DOWN behind it
// when dismissed.
//
// The travel distance is the card's own height, so it starts and ends fully
// tucked behind the composer rather than sliding in from the screen edge (which
// is what Reanimated's SlideInDown/SlideOutDown presets do — they translate by
// the whole window height, far too far for this).
//
// STACKING: statically the fan works purely by document order — every RN-Web
// view is `position:relative; z-index:0`, so the later sibling (the composer,
// last) paints over the tucked bottom edges of the cards above it. That order
// breaks on EXIT: Reanimated's web exit clones the leaving card into a dummy,
// appends it as the *last* child of the input area (now after the composer in
// the DOM) and sets it `position:absolute`. With everything at z-index 0 the
// clone then paints ON TOP of the composer — its underbelly flashes into view
// before it fades. So each card carries an explicit `layer` z-index and the
// composer sits above them all (COMPOSER_TRACK_LAYERS): the exiting clone keeps
// its own layer beneath the composer no matter where it lands in the DOM, and
// it sinks away in the exact plane it lived in.

/**
 * Paint layers for the fanned cards above the message box, back (lowest) to
 * front. The composer owns the top layer so an exiting card's absolutely-
 * positioned web clone can never rise above it. Ascending order matches the
 * existing document order, so the static look is unchanged — this only pins the
 * ordering through the exit animation.
 */
export const COMPOSER_TRACK_LAYERS = {
  contextHealth: 1,
  rateLimit: 2,
  subagents: 3,
  backgroundTasks: 4,
  composer: 5,
} as const;
//
// IMPORTANT: this worklet-function form of a custom layout animation only runs
// on NATIVE. On web (and Electron, which is the web platform) Reanimated has no
// handler for the function form — it has no `presetName`, so the web layout
// manager bails and the card just snaps in/out with no motion at all. So web
// uses the built-in FadeInDown/FadeOutDown presets below: a fade plus a short
// rise/sink that reads as the same "fly up / fly down" and, crucially, actually
// plays. Native keeps the richer full-height tuck behind the message box.

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

interface ComposerTrackTransitionProps {
  children: ReactNode;
  /**
   * Paint layer for this card, from COMPOSER_TRACK_LAYERS. Pins the card's
   * z-index so its exiting web clone stays beneath the composer and behind the
   * cards below it instead of flashing on top. See the STACKING note above.
   */
  layer: number;
}

/**
 * Wraps a composer detail card so it flies up from behind the message box and
 * sinks back down when it goes away. Honors the Appearance → Animations switch:
 * with motion off the card mounts and unmounts instantly, exactly as before.
 *
 * Deliberately carries no styles of its own — it is a layout-neutral wrapper
 * around each track's existing outer View. That keeps the themed Unistyles
 * styles off this Animated.View, which is a hard requirement (applying a
 * `StyleSheet.create((theme) => …)` style to a Reanimated view crashes on theme
 * change — see docs/unistyles.md).
 */
export function ComposerTrackTransition({ children, layer }: ComposerTrackTransitionProps) {
  const animationsEnabled = useAnimationsEnabled();
  const animate = animationsEnabled && supportsEntryExitAnimations;
  // Web/Electron: presets (the worklet form is a no-op there). Native (iOS):
  // the full-height tuck worklet. Android stays motionless via `animate`.
  const enterAnimation = isWeb
    ? FadeInDown.duration(COMPOSER_TRACK_FLY_IN_DURATION_MS)
    : flyUpFromBehindComposer;
  const exitAnimation = isWeb
    ? FadeOutDown.duration(COMPOSER_TRACK_FLY_OUT_DURATION_MS)
    : flyDownBehindComposer;
  const entering = animate ? enterAnimation : undefined;
  const exiting = animate ? exitAnimation : undefined;
  // Plain numeric style only — never a themed StyleSheet on a Reanimated view
  // (crashes on theme change, see docs/unistyles.md). zIndex carries onto the
  // web exit clone (cloneNode keeps the class) so it sinks in the right plane.
  const layerStyle = useMemo(() => ({ zIndex: layer }), [layer]);
  return (
    <Animated.View entering={entering} exiting={exiting} style={layerStyle}>
      {children}
    </Animated.View>
  );
}
