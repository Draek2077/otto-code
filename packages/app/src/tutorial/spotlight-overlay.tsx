import { useEffect, useMemo } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import Animated, {
  createAnimatedComponent,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Rect } from "./types";

export const SPOTLIGHT_HOLE_PADDING = 8;
export const SPOTLIGHT_HOLE_RADIUS = 14;
const CARD_GAP = 16;
const CARD_MAX_WIDTH = 420;
const CARD_SIDE_INSET = 20;
const GLIDE_DURATION = 320;

const AnimatedPressable = createAnimatedComponent(Pressable);

export interface SpotlightOverlayProps {
  // Target rect in window coordinates, or null for a centered card (no cutout).
  rect: Rect | null;
  // Identity of the current slide; changing it re-plays the card entrance.
  stepKey: string;
  title: string;
  body: string;
  // e.g. "2 / 5" — a small progress hint in the card.
  stepLabel?: string;
  // e.g. "Tap the highlighted button to continue" — action-slide affordance.
  hint?: string;
  exitLabel: string;
  // Informational slides advance when the dimmed area (or card) is tapped.
  // Action slides leave this off: advancement comes from real app state.
  advanceOnTap?: boolean;
  onAdvance?: () => void;
  onExit: () => void;
  padding?: number;
  radius?: number;
}

// Renders above all in-window app content as a high-zIndex absolute-fill sibling
// inside the app surface (the same mechanism as QuittingOverlay — NOT a Portal,
// whose gorhom root host sits behind the app chrome's zIndex stacking contexts,
// and NOT an RN Modal, a separate native window whose transparent hole cannot
// pass touches through to the real target beneath it). The dim is a four-rect
// "picture-frame" around the target so the hole itself has no capturing view and
// the real control receives the tap. The frame glides between slides to draw the
// eye. Theme-aware, safe on native + web.
export function SpotlightOverlay({
  rect,
  stepKey,
  title,
  body,
  stepLabel,
  hint,
  exitLabel,
  advanceOnTap,
  onAdvance,
  onExit,
  padding = SPOTLIGHT_HOLE_PADDING,
  radius = SPOTLIGHT_HOLE_RADIUS,
}: SpotlightOverlayProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const dimPress = advanceOnTap ? onAdvance : undefined;

  // Padded hole geometry, clamped to the window so the frame rects never go
  // negative when a target sits flush against an edge.
  const hole = useMemo(() => {
    if (!rect) {
      return null;
    }
    const x = Math.max(0, rect.x - padding);
    const y = Math.max(0, rect.y - padding);
    const w = Math.min(winW - x, rect.width + padding * 2);
    const h = Math.min(winH - y, rect.height + padding * 2);
    return { x, y, w, h };
  }, [rect, padding, winW, winH]);

  // Shared values the four frame rects + ring read from. First appearance snaps;
  // subsequent targets glide.
  const hx = useSharedValue(0);
  const hy = useSharedValue(0);
  const hw = useSharedValue(0);
  const hh = useSharedValue(0);
  const hadHole = useSharedValue(false);

  useEffect(() => {
    if (!hole) {
      hadHole.value = false;
      return;
    }
    if (hadHole.value) {
      const cfg = { duration: GLIDE_DURATION };
      hx.value = withTiming(hole.x, cfg);
      hy.value = withTiming(hole.y, cfg);
      hw.value = withTiming(hole.w, cfg);
      hh.value = withTiming(hole.h, cfg);
    } else {
      hx.value = hole.x;
      hy.value = hole.y;
      hw.value = hole.w;
      hh.value = hole.h;
    }
    hadHole.value = true;
  }, [hole, hx, hy, hw, hh, hadHole]);

  const topStyle = useAnimatedStyle(
    () => ({ left: 0, top: 0, width: winW, height: hy.value }),
    [winW],
  );
  const bottomStyle = useAnimatedStyle(
    () => ({
      left: 0,
      top: hy.value + hh.value,
      width: winW,
      height: Math.max(0, winH - (hy.value + hh.value)),
    }),
    [winW, winH],
  );
  const leftStyle = useAnimatedStyle(
    () => ({ left: 0, top: hy.value, width: hx.value, height: hh.value }),
    [],
  );
  const rightStyle = useAnimatedStyle(
    () => ({
      left: hx.value + hw.value,
      top: hy.value,
      width: Math.max(0, winW - (hx.value + hw.value)),
      height: hh.value,
    }),
    [winW],
  );
  const ringStyle = useAnimatedStyle(
    () => ({ left: hx.value, top: hy.value, width: hw.value, height: hh.value }),
    [],
  );

  // Four r×r dim fillers, one per hole corner, each with its hole-facing corner
  // rounded so the dimmed region curves inward to match the rounded ring. Without
  // them the square hole leaves undimmed app peeking past the ring's arcs. Only
  // left/top animate; size + corner radius are static (see cornerStyles below).
  const cornerTLPos = useAnimatedStyle(() => ({ left: hx.value, top: hy.value }), []);
  const cornerTRPos = useAnimatedStyle(
    () => ({ left: hx.value + hw.value - radius, top: hy.value }),
    [radius],
  );
  const cornerBLPos = useAnimatedStyle(
    () => ({ left: hx.value, top: hy.value + hh.value - radius }),
    [radius],
  );
  const cornerBRPos = useAnimatedStyle(
    () => ({ left: hx.value + hw.value - radius, top: hy.value + hh.value - radius }),
    [radius],
  );

  // Pre-combined style arrays (react-perf: no new arrays inline in JSX). The
  // animated styles are stable refs from useAnimatedStyle.
  const topDim = useMemo(() => [styles.dim, topStyle], [topStyle]);
  const bottomDim = useMemo(() => [styles.dim, bottomStyle], [bottomStyle]);
  const leftDim = useMemo(() => [styles.dim, leftStyle], [leftStyle]);
  const rightDim = useMemo(() => [styles.dim, rightStyle], [rightStyle]);
  const ringCombined = useMemo(
    () => [styles.ring, { borderRadius: radius }, ringStyle],
    [radius, ringStyle],
  );
  const cornerTL = useMemo(
    () => [
      styles.corner,
      { width: radius, height: radius, borderBottomRightRadius: radius },
      cornerTLPos,
    ],
    [radius, cornerTLPos],
  );
  const cornerTR = useMemo(
    () => [
      styles.corner,
      { width: radius, height: radius, borderBottomLeftRadius: radius },
      cornerTRPos,
    ],
    [radius, cornerTRPos],
  );
  const cornerBL = useMemo(
    () => [
      styles.corner,
      { width: radius, height: radius, borderTopRightRadius: radius },
      cornerBLPos,
    ],
    [radius, cornerBLPos],
  );
  const cornerBR = useMemo(
    () => [
      styles.corner,
      { width: radius, height: radius, borderTopLeftRadius: radius },
      cornerBRPos,
    ],
    [radius, cornerBRPos],
  );
  const dimFullStyle = useMemo(() => [styles.dim, styles.dimFull], []);
  const exitWrapStyle = useMemo(
    () => [styles.exitWrap, { bottom: insets.bottom + 20 }],
    [insets.bottom],
  );

  // Place the card opposite the hole: below when the target is in the top half,
  // above otherwise. Centered when there is no hole.
  const cardPlacement = useMemo<"below" | "above" | "center">(() => {
    if (!hole) {
      return "center";
    }
    return hole.y + hole.h / 2 < winH / 2 ? "below" : "above";
  }, [hole, winH]);

  const cardWrapStyle = useMemo(() => {
    if (!hole || cardPlacement === "center") {
      return [styles.cardWrap, styles.cardWrapCentered];
    }
    if (cardPlacement === "below") {
      return [styles.cardWrap, { top: hole.y + hole.h + CARD_GAP }];
    }
    return [styles.cardWrap, { bottom: winH - hole.y + CARD_GAP }];
  }, [hole, cardPlacement, winH]);

  const cardEntering = cardPlacement === "above" ? FadeInUp : FadeInDown;

  return (
    <Animated.View
      pointerEvents="box-none"
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      style={styles.root}
    >
      {hole ? (
        <>
          {/* Four dim rects framing the hole; the hole itself is uncovered so
                the real control beneath receives touches. */}
          <AnimatedPressable style={topDim} onPress={dimPress} />
          <AnimatedPressable style={bottomDim} onPress={dimPress} />
          <AnimatedPressable style={leftDim} onPress={dimPress} />
          <AnimatedPressable style={rightDim} onPress={dimPress} />
          {/* Corner fillers round off the square hole to match the ring. Purely
              visual — touch pass-through is owned by the four rects above. */}
          <Animated.View pointerEvents="none" style={cornerTL} />
          <Animated.View pointerEvents="none" style={cornerTR} />
          <Animated.View pointerEvents="none" style={cornerBL} />
          <Animated.View pointerEvents="none" style={cornerBR} />
          {/* Emphasis ring — never captures touches. */}
          <Animated.View pointerEvents="none" style={ringCombined} />
        </>
      ) : (
        <Pressable style={dimFullStyle} onPress={dimPress} />
      )}

      <View pointerEvents="box-none" style={cardWrapStyle}>
        <Animated.View key={stepKey} entering={cardEntering.duration(240)} style={styles.cardAnim}>
          <Pressable
            // Card sits on the dim. On info slides a tap here also advances; on
            // action slides it is inert (dimPress is undefined).
            onPress={dimPress}
            style={styles.card}
          >
            {stepLabel ? <Text style={styles.stepLabel}>{stepLabel}</Text> : null}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          </Pressable>
        </Animated.View>
      </View>

      {/* Topmost sibling: its press wins over the frame rects, so exit never
            double-fires an advance. */}
      <View pointerEvents="box-none" style={exitWrapStyle}>
        <Pressable
          onPress={onExit}
          style={styles.exitButton}
          accessibilityRole="button"
          testID="tutorial-exit"
        >
          <Text style={styles.exitLabel}>✕ {exitLabel}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Above the sidebar / workspace chrome, matching QuittingOverlay's ceiling.
    zIndex: 9999,
  },
  dim: {
    position: "absolute",
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  dimFull: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  corner: {
    position: "absolute",
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  cardWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: CARD_SIDE_INSET,
  },
  cardWrapCentered: {
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  cardAnim: {
    width: "100%",
    maxWidth: CARD_MAX_WIDTH,
  },
  card: {
    width: "100%",
    backgroundColor: theme.colors.popover,
    borderRadius: theme.borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
  },
  stepLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    letterSpacing: 0.5,
    color: theme.colors.accent,
    textTransform: "uppercase",
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.popoverForeground,
  },
  body: {
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
    color: theme.colors.popoverForeground,
  },
  hint: {
    marginTop: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    color: theme.colors.foregroundMuted,
  },
  exitWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  exitButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  exitLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
}));
