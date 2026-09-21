import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { WindowOverlay } from "@/components/ui/pane-overlay";
import { SIDEBAR_SLIDE_DURATION_MS } from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { OVERLAY_Z } from "@/lib/overlay-root";
import {
  registerSidebarEdgePeekSurface,
  useSidebarEdgePeekStore,
  type SidebarEdgeSide,
} from "@/stores/sidebar-edge-peek-store";
import { WindowChromeRootRegion } from "@/utils/window-chrome";
import { suspendResidentBrowserSurfaceInput } from "@/desktop/browser/resident-webviews";

/**
 * Paints a peeked sidebar as a window overlay pinned to its screen edge, so
 * swooping it in never reflows the workspace underneath. The panel slides in
 * from off-screen while its side is peeked, slides back out when the peek
 * ends, and unmounts its children once it is gone: a hidden sidebar costs
 * nothing between peeks.
 */
export function SidebarEdgePeekPanel({
  side,
  width,
  children,
}: {
  side: SidebarEdgeSide;
  width: number;
  children: ReactNode;
}) {
  const active = useSidebarEdgePeekStore((state) => state.peekSide === side);
  const animationsEnabled = useAnimationsEnabled();
  const [mounted, setMounted] = useState(active);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (active) {
      setMounted(true);
      progress.value = animationsEnabled
        ? withTiming(1, { duration: SIDEBAR_SLIDE_DURATION_MS })
        : 1;
      return;
    }
    if (!animationsEnabled) {
      progress.value = 0;
      setMounted(false);
      return;
    }
    progress.value = withTiming(0, { duration: SIDEBAR_SLIDE_DURATION_MS }, (finished) => {
      // An interrupted exit (peeked again mid-slide) keeps the panel mounted.
      if (finished) runOnJS(setMounted)(false);
    });
  }, [active, animationsEnabled, progress]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    // A resident Electron guest can otherwise win hit-testing through the
    // window overlay. The guest keeps painting edge-to-edge; only its input is
    // suspended while the floating sidebar is on screen.
    return suspendResidentBrowserSurfaceInput();
  }, [mounted]);

  const offscreen = side === "left" ? -width : width;
  const slideStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: offscreen * (1 - progress.value) }] }),
    [offscreen],
  );
  const panelStyle = useMemo(
    () => [
      side === "left" ? staticStyles.panelLeft : staticStyles.panelRight,
      { width },
      slideStyle,
    ],
    [side, slideStyle, width],
  );

  const surfaceRef = useCallback(
    (node: View | null) => {
      registerSidebarEdgePeekSurface(side, node as unknown as HTMLElement | null);
    },
    [side],
  );

  if (!mounted) return null;

  return (
    <WindowOverlay layer={OVERLAY_Z.sidebarPeek}>
      <WindowChromeRootRegion corners={side === "left" ? "top-left" : "top-right"}>
        <Animated.View style={panelStyle}>
          <View ref={surfaceRef} style={styles.surface} testID={`sidebar-edge-peek-${side}`}>
            {children}
          </View>
        </Animated.View>
      </WindowChromeRootRegion>
    </WindowOverlay>
  );
}

// Animated.Views must not carry Unistyles theme styles; the themed shadow
// rides on the inner surface instead.
const staticStyles = {
  panelLeft: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    pointerEvents: "auto",
  },
  panelRight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    pointerEvents: "auto",
  },
} as const;

const styles = StyleSheet.create((theme) => ({
  surface: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors.surfaceSidebar,
    ...theme.shadow.lg,
  },
}));
