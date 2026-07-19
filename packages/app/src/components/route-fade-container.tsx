import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PAGE_TRANSITION_DURATION_MS, PAGE_TRANSITION_MAX_HOLD_MS } from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useRouteTransitionKey } from "@/hooks/use-route-transition-key";
import { useActiveWorkspaceContentReady } from "@/stores/workspace-content-readiness";

const flexStyle = { flex: 1 } as const;

// Native page transition. Reanimated runs on the UI thread here, so fading the
// routed content's opacity is not starved by JS-thread mount work the way it
// would be on web (which is why the web variant uses a compositor CSS veil
// instead — see route-fade-container.web.tsx). On each transition the content
// snaps transparent and fades back up through the themed surface0 backdrop.
// Gated by the Animations setting; the first mount is skipped so cold start does
// not fade in.
export function RouteFadeContainer({ children }: { children: ReactNode }) {
  const transitionKey = useRouteTransitionKey();
  // A workspace target holds the fade-up until its panes are actually mounted;
  // any non-workspace route (or an already-warm workspace) is ready immediately.
  const ready = useActiveWorkspaceContentReady();
  return (
    <KeyedFadeContainer transitionKey={transitionKey} ready={ready}>
      {children}
    </KeyedFadeContainer>
  );
}

// The fade mechanism behind RouteFadeContainer, with the transition key supplied
// by the caller so sub-page surfaces can run the same fade over just one pane
// (the settings content pane keys this on its view identity, keeping the
// settings sidebar outside the fade). `fadeOnMount` (initial value only) runs
// the fade on the first key too — for panes whose host screen remounts on
// internal navigation and can tell the two cases apart. `ready` (default true)
// gates the fade-up: while false the content stays hidden behind the surface0
// backdrop, so a target whose content paints a beat after its shell (a cold
// workspace deck) does not fade up on the bare shell.
export function KeyedFadeContainer({
  transitionKey,
  fadeOnMount = false,
  ready = true,
  children,
}: {
  transitionKey: string;
  fadeOnMount?: boolean;
  ready?: boolean;
  children: ReactNode;
}) {
  const animationsEnabled = useAnimationsEnabled();
  const opacity = useSharedValue(1);
  // Bumped on every cover; the reveal effect keys off it so a fresh cover
  // cancels and reschedules the pending fade-up (folding a burst of key changes
  // into one), and a mid-hold `ready` flip re-evaluates against the current
  // cover.
  const [coverToken, setCoverToken] = useState(0);
  const revealedTokenRef = useRef(0);
  // The fade must be driven by *key changes*, not by the effect merely
  // re-running — `animationsEnabled` is also a dependency, and flipping the
  // setting must never play a phantom fade over a screen that didn't navigate.
  // Seeding with the first key makes the initial run a no-change (no cold-start
  // fade); `null` under `fadeOnMount` makes the first key count as a change.
  const prevKeyRef = useRef<string | null>(fadeOnMount ? null : transitionKey);

  useEffect(() => {
    const keyChanged = prevKeyRef.current !== transitionKey;
    prevKeyRef.current = transitionKey;
    if (!animationsEnabled) {
      opacity.value = 1;
      return;
    }
    if (!keyChanged) {
      return;
    }
    // Snap the content transparent (backdrop shows); the fade-up is handled by
    // the effect below once the target is ready.
    opacity.value = 0;
    setCoverToken((token) => token + 1);
  }, [transitionKey, animationsEnabled, opacity]);

  useEffect(() => {
    if (coverToken === revealedTokenRef.current) {
      return;
    }
    const startFadeUp = () => {
      opacity.value = withTiming(1, { duration: PAGE_TRANSITION_DURATION_MS });
      revealedTokenRef.current = coverToken;
    };
    // Fade up as soon as the target is ready. While it is NOT (a cold workspace
    // whose panes have not mounted), hold the content hidden and fall back to
    // fading up after PAGE_TRANSITION_MAX_HOLD_MS so the content can never get
    // stuck hidden behind the backdrop.
    if (ready) {
      startFadeUp();
      return;
    }
    const timer = setTimeout(startFadeUp, PAGE_TRANSITION_MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [coverToken, ready, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const containerStyle = useMemo(() => [flexStyle, animatedStyle], [animatedStyle]);
  return <Animated.View style={containerStyle}>{children}</Animated.View>;
}
