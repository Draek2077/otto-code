import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PAGE_TRANSITION_DURATION_MS, PAGE_TRANSITION_MAX_HOLD_MS } from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useRouteTransitionKey } from "@/hooks/use-route-transition-key";
import { useActiveWorkspaceContentReady } from "@/stores/workspace-content-readiness";

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
export function RouteFadeContainer({ children }: { children: ReactNode }) {
  const transitionKey = useRouteTransitionKey();
  // A workspace target holds the reveal until its panes are actually mounted; any
  // non-workspace route (or an already-warm workspace) is ready immediately, so
  // those reveal with no extra hold.
  const ready = useActiveWorkspaceContentReady();
  return (
    <KeyedFadeContainer transitionKey={transitionKey} ready={ready}>
      {children}
    </KeyedFadeContainer>
  );
}

// The veil mechanism behind RouteFadeContainer, with the transition key supplied
// by the caller so sub-page surfaces can run the same fade over just one pane
// (the settings content pane keys this on its view identity, keeping the
// settings sidebar outside the fade). `fadeOnMount` (initial value only) runs
// the fade on the first key too — for panes whose host screen remounts on
// internal navigation and can tell the two cases apart. `ready` (default true)
// gates the reveal: while false the veil stays opaque, so a target whose content
// paints a beat after its shell (a cold workspace deck) does not have the veil
// lift on the bare shell.
//
// The cover runs in useLayoutEffect ON PURPOSE: it fires *before* the browser
// paints, so the veil is already opaque in the very first frame the new screen
// would appear. With a post-paint useEffect, a fast screen (History, Artifacts)
// mounts and paints instantly, is shown for one frame, and only *then* gets
// covered — which reads as the new screen flashing in before it fades. Covering
// pre-paint removes that flash.
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
  const [veil, setVeil] = useState<VeilState>(HIDDEN);
  // Bumped on every cover; the reveal effect keys off it so a fresh cover cancels
  // and reschedules the pending reveal (folding a burst of key changes into one),
  // and a mid-hold `ready` flip re-evaluates against the *current* cover.
  const [coverToken, setCoverToken] = useState(0);
  const revealedTokenRef = useRef(0);
  // The veil must be driven by *key changes*, not by the effect merely
  // re-running — `animationsEnabled` is also a dependency, and flipping the
  // setting must never flash the veil over a screen that didn't navigate.
  // Seeding with the first key makes the initial run a no-change (no cold-start
  // flash); `null` under `fadeOnMount` makes the first key count as a change.
  const prevKeyRef = useRef<string | null>(fadeOnMount ? null : transitionKey);

  useLayoutEffect(() => {
    const keyChanged = prevKeyRef.current !== transitionKey;
    prevKeyRef.current = transitionKey;
    if (!animationsEnabled) {
      // Any reveal still pending just re-sets the veil to opacity 0 (already
      // HIDDEN here) — a no-op — so there is nothing to cancel.
      setVeil(HIDDEN);
      return;
    }
    if (!keyChanged) {
      return;
    }
    // SNAP the veil to opaque (durationMs 0 = no transition), pre-paint, so the
    // incoming screen is masked from its first frame — no flash of it appearing
    // before the fade, and no *fading* cover that would read as a second fade.
    // The actual reveal is handled by the effect below once the target is ready.
    setVeil({ opacity: 1, durationMs: 0 });
    setCoverToken((token) => token + 1);
  }, [transitionKey, animationsEnabled]);

  useEffect(() => {
    if (coverToken === revealedTokenRef.current) {
      return;
    }
    // Reveal on the next macrotask once the target is ready: setTimeout runs
    // after the opaque frame has painted, so the CSS transition runs from a real
    // opaque state rather than being coalesced away. While the target is NOT
    // ready (a cold workspace whose panes have not mounted), hold the veil opaque
    // and only fall back to revealing after PAGE_TRANSITION_MAX_HOLD_MS so it can
    // never get stuck covering the screen.
    const delayMs = ready ? 0 : PAGE_TRANSITION_MAX_HOLD_MS;
    const timer = setTimeout(() => {
      setVeil({ opacity: 0, durationMs: PAGE_TRANSITION_DURATION_MS });
      revealedTokenRef.current = coverToken;
    }, delayMs);
    return () => clearTimeout(timer);
  }, [coverToken, ready]);

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
      {/* testID: E2E-observable seam for the Animations setting — the veil's
          inline transition-duration is 0ms whenever animations are disabled and
          PAGE_TRANSITION_DURATION_MS after any animated transition (see
          e2e/appearance-theme-animations.spec.ts). */}
      <View pointerEvents="none" style={veilStyle} testID="route-fade-veil" />
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
