import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View, type LayoutChangeEvent } from "react-native";
import {
  COMPOSER_TRACK_FLY_IN_DURATION_MS,
  COMPOSER_TRACK_FLY_OUT_DURATION_MS,
} from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";

export { COMPOSER_TRACK_LAYERS } from "@/composer/track-layers";

// WEB/ELECTRON enter/exit motion for the detail cards stacked above the message
// box. Native uses track-transition.tsx and Reanimated's layout animations; this
// file deliberately uses neither, and that is the whole point of it existing.
//
// WHY NOT REANIMATED HERE. Its web exit does not animate the leaving element: it
// shallow-clones the node, moves the children into the clone, appends the clone
// to the parent, and pins it with `position:absolute` at coordinates taken from a
// SNAPSHOT - and that snapshot is captured at the card's last React render
// (componentDidMount / componentDidUpdate), not at the moment the card leaves. So
// the ghost appears wherever the card was standing at its last render. Anything
// that moves the card afterwards without re-rendering it is baked in, and the
// composer fan is bottom-anchored, so a great deal moves it: resizing the window,
// dragging a pane splitter, toggling a sidebar. Measured against the real
// component, growing the window by 100px put the ghost 100px ABOVE the card it
// was replacing - it leapt up the screen, then faded and sank from there. The
// card's own entrance is the same trap in miniature: FadeInDown holds a 25px
// translate that getBoundingClientRect reports but the exit clone discards, so
// dismissing mid-entrance jumps by exactly that.
//
// There is no snapshot to go stale here. The card that leaves is the same
// element the user was looking at, so it can only ever animate from where it
// already is.
//
// THE MOTION. The fan is bottom-anchored above the message box, so a card's box
// collapsing to zero height slides the card DOWN into the composer all by
// itself - no transform needed, and the layout closes in step with the motion
// instead of snapping shut at one end of it. Growing back out of zero replays it
// in reverse. The content overflows its own box while this happens (RNW views do
// not clip), which is what makes the card read as passing behind the message box
// rather than being squashed; COMPOSER_TRACK_LAYERS is what keeps it behind.
//
// A CSS transition drives it rather than a JS-thread animation, for the reason
// route-fade-container.web.tsx gives: these cards mount alongside heavy work
// (a turn starting, subagent rows arriving) and a compositor-driven transition
// stays smooth while the JS thread is busy.

/**
 * `closed` also covers the frame before an entrance: the card is mounted at zero
 * height so the browser has a value to transition FROM. Going straight to the
 * open height in the first commit just snaps.
 */
type Phase = "closed" | "opening" | "open" | "closing";

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
 * Wraps a composer detail card so it grows up from behind the message box and
 * sinks back down behind it when it goes away. Honors the Appearance →
 * Animations switch: with motion off the card appears and disappears instantly,
 * with no held height and no transition.
 */
export function ComposerTrackTransition({ children, layer }: ComposerTrackTransitionProps) {
  const animationsEnabled = useAnimationsEnabled();
  const present = children != null;

  // The caller has already stopped rendering a dismissed card, but it still has
  // to be on screen while it sinks away - so the last non-empty content is held
  // until the exit finishes. Clearing it is what finally unmounts the card.
  const retained = useRef<ReactNode>(null);
  if (present) {
    retained.current = children;
  }
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
  const releaseRetained = useCallback(() => {
    retained.current = null;
    // Not derivable from `phase` - dropping the content has to repaint even when
    // the phase it lands on is the one already set.
    forceRender();
  }, []);

  const [phase, setPhase] = useState<Phase>("closed");
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentRef = useRef<View | null>(null);

  const applyHeight = useCallback((height: number) => {
    // A zero reading is a card that has not been laid out yet, not a card of no
    // height. Taking it would make the open box collapse.
    if (height > 0) {
      setContentHeight((current) => (current === height ? current : height));
    }
  }, []);

  // Measured before paint so the very first entrance already has a height to
  // grow into. `onLayout` below keeps it current afterwards - including for
  // reflows no React render caused, such as the band's text re-wrapping when the
  // window narrows.
  useLayoutEffect(() => {
    const node = contentRef.current as unknown as HTMLElement | null;
    if (node) {
      applyHeight(node.getBoundingClientRect().height);
    }
  });

  const handleContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      applyHeight(event.nativeEvent.layout.height);
    },
    [applyHeight],
  );

  useEffect(() => {
    if (!present && retained.current == null) {
      return;
    }
    if (!animationsEnabled) {
      setPhase(present ? "open" : "closed");
      if (!present) {
        releaseRetained();
      }
      return;
    }
    if (present) {
      setPhase("opening");
      const timer = setTimeout(() => setPhase("open"), COMPOSER_TRACK_FLY_IN_DURATION_MS);
      return () => clearTimeout(timer);
    }
    setPhase("closing");
    const timer = setTimeout(() => {
      setPhase("closed");
      releaseRetained();
    }, COMPOSER_TRACK_FLY_OUT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [present, animationsEnabled, releaseRetained]);

  const style = useMemo(() => {
    if (!animationsEnabled) {
      return { zIndex: layer };
    }
    const collapsed = phase === "closed" || phase === "closing";
    return {
      zIndex: layer,
      opacity: collapsed ? 0 : 1,
      // Only the two moving phases carry a transition, so a card that changes
      // size while it is simply open (a track expanding, text re-wrapping)
      // resizes instantly, exactly as it did before.
      ...(phase === "opening" || phase === "closing"
        ? {
            transitionProperty: "height, opacity",
            transitionDuration: `${
              phase === "closing"
                ? COMPOSER_TRACK_FLY_OUT_DURATION_MS
                : COMPOSER_TRACK_FLY_IN_DURATION_MS
            }ms`,
            transitionTimingFunction: "ease-out",
          }
        : null),
      // `undefined` leaves the box at its natural height. Only reachable before
      // the first measurement lands, and preferable to guessing at a number.
      height: collapsed ? 0 : (contentHeight ?? undefined),
    };
  }, [animationsEnabled, layer, phase, contentHeight]);

  if (retained.current == null) {
    return null;
  }
  return (
    <View style={style}>
      {/* Measured separately from the animated box: this one always sits at the
          card's natural height, so collapsing the box above it cannot feed a
          shrinking height back into the measurement. */}
      <View ref={contentRef} onLayout={handleContentLayout}>
        {retained.current}
      </View>
    </View>
  );
}
