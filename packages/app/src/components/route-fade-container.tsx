import { useEffect, useMemo, useRef, type ReactNode } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PAGE_TRANSITION_DURATION_MS } from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useRouteTransitionKey } from "@/hooks/use-route-transition-key";

const flexStyle = { flex: 1 } as const;

// Native page transition. Reanimated runs on the UI thread here, so fading the
// routed content's opacity is not starved by JS-thread mount work the way it
// would be on web (which is why the web variant uses a compositor CSS veil
// instead — see route-fade-container.web.tsx). On each transition the content
// snaps transparent and fades back up through the themed surface0 backdrop.
// Gated by the Animations setting; the first mount is skipped so cold start does
// not fade in.
export function RouteFadeContainer({ children }: { children: ReactNode }) {
  const animationsEnabled = useAnimationsEnabled();
  const transitionKey = useRouteTransitionKey();
  const opacity = useSharedValue(1);
  // While a fade is running, later key changes fold into it instead of
  // restarting it — so a new-workspace open (route commit + store commit) is one
  // fade, not two.
  const fading = useSharedValue(0);
  const isFirstRouteRef = useRef(true);

  useEffect(() => {
    if (isFirstRouteRef.current) {
      isFirstRouteRef.current = false;
      return;
    }
    if (!animationsEnabled) {
      opacity.value = 1;
      fading.value = 0;
      return;
    }
    if (fading.value === 1) {
      return;
    }
    fading.value = 1;
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: PAGE_TRANSITION_DURATION_MS }, (finished) => {
      if (finished) {
        fading.value = 0;
      }
    });
  }, [transitionKey, animationsEnabled, opacity, fading]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const containerStyle = useMemo(() => [flexStyle, animatedStyle], [animatedStyle]);
  return <Animated.View style={containerStyle}>{children}</Animated.View>;
}
