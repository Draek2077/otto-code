import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PAGE_TRANSITION_DURATION_MS } from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useRouteTransitionKey } from "@/hooks/use-route-transition-key";

// `position: relative` makes this the containing block for the absolutely-
// positioned veil, so the veil covers only the routed content area (never the
// sidebar, which is a sibling outside this container).
const containerStyle = { flex: 1, position: "relative" } as const;

interface VeilState {
  opacity: number;
  durationMs: number;
}

const HIDDEN: VeilState = { opacity: 0, durationMs: 0 };

// Web/Electron page transition. Unlike native (route-fade-container.tsx), this
// does NOT animate on the JS thread: the heavy target screens (Settings, the
// Workspace deck) block the JS thread while they mount, which starves any
// rAF/Reanimated-driven fade and makes it choppy. Instead a surface0 veil is
// layered over the routed content and driven by a CSS `transition` on opacity —
// which the browser runs on the compositor, immune to JS-thread blocking. The
// veil SNAPS to opaque then REVEALS (the single fade back out), exposing the new
// screen — visually identical to fading the new screen in from the background.
// Gated by the Animations setting; the first mount is skipped so cold start does
// not flash.
//
// This runs in useLayoutEffect ON PURPOSE: it fires *before* the browser
// paints, so the veil is already opaque in the very first frame the new screen
// would appear. With a post-paint useEffect, a fast screen (History, Artifacts)
// mounts and paints instantly, is shown for one frame, and only *then* gets
// covered — which reads as the new screen flashing in before it fades. Covering
// pre-paint removes that flash.
export function RouteFadeContainer({ children }: { children: ReactNode }) {
  const animationsEnabled = useAnimationsEnabled();
  const transitionKey = useRouteTransitionKey();
  const [veil, setVeil] = useState<VeilState>(HIDDEN);
  const isFirstRouteRef = useRef(true);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (isFirstRouteRef.current) {
      isFirstRouteRef.current = false;
      return;
    }
    if (!animationsEnabled) {
      setVeil(HIDDEN);
      return;
    }
    // SNAP the veil to opaque (durationMs 0 = no transition), pre-paint, so the
    // incoming screen is masked from its first frame — no flash of it appearing
    // before the fade, and no *fading* cover that would read as a second fade.
    // Then reveal on the next macrotask: that runs after the opaque frame has
    // painted, so the CSS transition runs from a real opaque state rather than
    // being coalesced away. The effect cleanup clears any pending reveal from a
    // prior transition, so a burst of key changes (e.g. a new-workspace open
    // bumping the route then the store) collapses into one snap → reveal.
    setVeil({ opacity: 1, durationMs: 0 });
    revealTimerRef.current = setTimeout(() => {
      setVeil({ opacity: 0, durationMs: PAGE_TRANSITION_DURATION_MS });
      revealTimerRef.current = null;
    }, 0);

    return () => {
      if (revealTimerRef.current !== null) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, [transitionKey, animationsEnabled]);

  // RN-web maps these to CSS transition props (not in RN's ViewStyle types, hence
  // the cast — same pattern as the sidebars' `cursor`). Memoized so the veil View
  // isn't handed a fresh style object every parent render.
  const veilStyle = useMemo(
    () => [
      styles.veilFill,
      {
        opacity: veil.opacity,
        transitionProperty: "opacity",
        transitionDuration: `${veil.durationMs}ms`,
        transitionTimingFunction: "ease",
      } as object,
    ],
    [veil.opacity, veil.durationMs],
  );

  return (
    <View style={containerStyle}>
      {children}
      <View pointerEvents="none" style={veilStyle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  veilFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface0,
  },
}));
