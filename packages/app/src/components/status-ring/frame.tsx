import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BlobLoader } from "@/components/blob-loader";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { STATUS_RING_FRAME_SIZE } from "@/components/status-ring/geometry";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";

export interface StatusRingProps {
  // The surface the ring is drawn on top of, named rather than resolved, because theme colours
  // are only legible inside `StyleSheet.create` — see docs/unistyles.md. The frame fills itself
  // with this so the ring reads as a hole punched in whatever it overlaps: the agent icon under a
  // tab dot, the project tile under a sidebar badge. Leave it out where the ring sits on flat
  // background and has nothing to knock out.
  backdrop?: SurfaceBackdrop | null;
  /** Recolors the normal running-blue centre without changing the ring's running semantics. */
  centerStyle?: ViewStyle;
}

/** The working ring is the app's live-model plasma spinner, fixed to status-info blue. */
export const ThemedStatusBlobLoader = withUnistyles(BlobLoader, (theme) => ({
  glowA: theme.colors.statusInfo,
  glowB: theme.colors.statusInfo,
}));

/**
 * The static half of the running indicator: the knockout and the centre dot. Platform entry
 * points supply the blue plasma ring, whose themed leaf stays reactive without re-rendering rows.
 */
export function StatusRingFrame({
  backdrop,
  centerStyle,
  children,
}: StatusRingProps & { children: ReactNode }) {
  return (
    <View style={[styles.frame, getBackdropStyle(backdrop)]}>
      <View pointerEvents="none" style={styles.ring}>
        {children}
      </View>
      <View style={[styles.centerDot, centerStyle]} />
    </View>
  );
}

function getBackdropStyle(backdrop: SurfaceBackdrop | null | undefined) {
  switch (backdrop) {
    case "surface0":
      return styles.backdropSurface0;
    case "surface1":
      return styles.backdropSurface1;
    case "surfaceSidebar":
      return styles.backdropSurfaceSidebar;
    case "surfaceSidebarHover":
      return styles.backdropSurfaceSidebarHover;
    case "surface2":
      return styles.backdropSurface2;
    default:
      return null;
  }
}

export const styles = StyleSheet.create((theme) => {
  return {
    frame: {
      width: STATUS_RING_FRAME_SIZE,
      height: STATUS_RING_FRAME_SIZE,
      borderRadius: theme.borderRadius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    ring: {
      position: "absolute",
      top: 0,
      left: 0,
      width: STATUS_RING_FRAME_SIZE,
      height: STATUS_RING_FRAME_SIZE,
      alignItems: "center",
      justifyContent: "center",
    },
    backdropSurface0: { backgroundColor: theme.colors.surface0 },
    backdropSurface1: { backgroundColor: theme.colors.surface1 },
    backdropSurfaceSidebar: { backgroundColor: theme.colors.surfaceSidebar },
    backdropSurfaceSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
    backdropSurface2: { backgroundColor: theme.colors.surface2 },

    centerDot: {
      width: STATUS_INDICATOR_FILLED_DOT_SIZE,
      height: STATUS_INDICATOR_FILLED_DOT_SIZE,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.statusInfo,
    },
  };
});
