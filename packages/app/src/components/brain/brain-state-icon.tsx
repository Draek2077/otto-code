import { useEffect, useId, useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop, SvgXml } from "react-native-svg";
import { BrainIconMask } from "@/components/brain/brain-icon-mask";
import {
  BRAIN_BADGE_CENTER_X,
  BRAIN_BADGE_CENTER_Y,
  BRAIN_BADGE_COMPONENTS,
  BRAIN_BADGE_SIZE,
  brainArtworkSvg,
  brainMaskSvg,
} from "@/components/brain/brain-icon-glyphs";
import {
  BRAIN_STATE_VISUALS,
  type BrainBadge,
  type BrainMotion,
  type BrainState,
  type BrainStateVisual,
} from "@/components/brain/brain-state";
import { brainGlyphExtent } from "@/components/icons/brain-glyph-scale";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import type { Theme } from "@/styles/theme";

/**
 * The travelling highlight's length, as a fraction of the icon. Shorter than the
 * glyph on purpose: a band as long as the icon never fully clears it, so the
 * sweep reads as a wash rather than as something moving across.
 */
const BAND_RATIO = 0.7;
/** How far past the icon the glow bleeds. */
const GLOW_RATIO = 1.7;
/**
 * On the compact form factor the rail and header are tight on space, and a
 * glow at full ratio crowds them. Trim the halo to 85% of its extent there.
 */
const COMPACT_GLOW_RATIO = 0.85;

const ABSOLUTE_FILL = { position: "absolute" } as const;

/**
 * The Brain rail button's glyph, showing what the local AI host is doing.
 *
 * Lifecycle states are a flat tint and hold still - a status light that moves
 * when nothing is happening trains you to ignore it. Busy states get a gradient
 * travelling across the glyph itself plus a glow behind it, with the direction
 * of travel carrying the meaning (see `brain-state.ts`).
 *
 * Everything here is driven off one repeating shared value. There is no timer,
 * no state, and no re-render per frame: the sweep is a transform on a single
 * `Animated.View` clipped to the glyph, which is the one masking rig in this app
 * that behaves the same on web and on device.
 */
export function BrainStateIcon({
  state,
  size,
  theme,
  style,
  compact = false,
}: {
  state: BrainState;
  size: number;
  theme: Theme;
  style?: StyleProp<ViewStyle>;
  /** Compact form factor: trims the glow so it fits the tighter rail. */
  compact?: boolean;
}) {
  const visual = BRAIN_STATE_VISUALS[state];
  const animationsEnabled = useAnimationsEnabled();
  const base = theme.colors[visual.tone];
  const artwork = useMemo(
    () => brainArtworkSvg(visual.glyph, visual.badge),
    [visual.glyph, visual.badge],
  );
  const maskSvg = useMemo(
    () => brainMaskSvg(visual.glyph, visual.badge),
    [visual.glyph, visual.badge],
  );
  // Appearance → Animations turns the motion off everywhere in the app, and this
  // is motion. The state still reads: the tint and the glyph are the animation's
  // own resting frame, so nothing is lost but the movement.
  const motion = animationsEnabled ? visual.motion : null;

  const progress = useSweepProgress(state, motion !== null, visual.durationMs);

  // Laid out at `size`, drawn at `glyph`. The container already centres its
  // children, so the overflow falls evenly on all four edges; `overflow` has to
  // be spelled out because react-native-web's View hides it by default.
  const glyph = brainGlyphExtent(size);
  const containerStyle = useMemo(
    () => [
      {
        width: size,
        height: size,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        overflow: "visible" as const,
      },
      style,
    ],
    [size, style],
  );

  return (
    <View pointerEvents="none" style={containerStyle}>
      {visual.glow > 0 ? (
        <BrainIconGlow
          box={size}
          size={glyph}
          color={visual.peak ?? base}
          strength={visual.glow}
          compact={compact}
        />
      ) : null}
      {motion === null || motion === "pulse" ? (
        <BrainIconBreathing progress={progress} active={motion === "pulse"}>
          <SvgXml xml={artwork} width={glyph} height={glyph} color={base} />
        </BrainIconBreathing>
      ) : (
        <BrainIconMask maskSvg={maskSvg} size={glyph}>
          <BrainIconFill
            size={glyph}
            base={base}
            peak={visual.peak ?? base}
            motion={motion}
            progress={progress}
          />
        </BrainIconMask>
      )}
      {visual.badge ? (
        <BrainIconBadge badge={visual.badge} size={size} glyph={glyph} color={base} />
      ) : null}
    </View>
  );
}

/**
 * The mark, sitting in the gap `brainArtworkSvg` bit out of the brain.
 *
 * Drawn over the animation rather than through it, and in the flat tint rather
 * than the sweep's peak: at rail size this is about 11px across, and anything
 * moving inside it reads as flicker rather than as motion.
 */
function BrainIconBadge({
  badge,
  size,
  glyph,
  color,
}: {
  badge: BrainBadge;
  size: number;
  glyph: number;
  color: string;
}) {
  const Badge = BRAIN_BADGE_COMPONENTS[badge];
  // The gap is a feature of the drawn brain, so the mark is placed against
  // `glyph`, then shifted by the overflow so it lands on the gap rather than
  // where the gap would be if the brain were still box-sized.
  const extent = glyph * BRAIN_BADGE_SIZE;
  const badgeStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: (size - glyph) / 2 + glyph * BRAIN_BADGE_CENTER_X - extent / 2,
      top: (size - glyph) / 2 + glyph * BRAIN_BADGE_CENTER_Y - extent / 2,
    }),
    [size, glyph, extent],
  );
  return (
    <View pointerEvents="none" style={badgeStyle}>
      <Badge size={extent} color={color} />
    </View>
  );
}

/**
 * One linear 0 → 1 ramp per cycle, restarted only when the state changes.
 *
 * Status snapshots arrive more often than the state they describe. Keeping the
 * BrainStateIcon mounted lets those same-state updates redraw the current frame
 * without cancelling its sweep and sending it back to the beginning.
 */
function useSweepProgress(
  state: BrainState,
  active: boolean,
  durationMs: number,
): SharedValue<number> {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!active || durationMs <= 0) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: durationMs,
        easing: Easing.linear,
        // The app's own Animations setting is the gate for this effect (see
        // BrainStateIcon). The OS-level reduce-motion flag is declined here for
        // the same reason blob-loader declines it: headless Chromium reports
        // `prefers-reduced-motion: reduce`, which snaps the value and freezes
        // the icon in every Playwright run.
        reduceMotion: ReduceMotion.Never,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [active, durationMs, progress, state]);
  return progress;
}

/**
 * The `pulse` motion, and the resting case. Queued work is not moving yet, so
 * nothing travels - the glyph breathes in place instead, which reads as "held"
 * rather than as "running".
 */
function BrainIconBreathing({
  progress,
  active,
  children,
}: {
  progress: SharedValue<number>;
  active: boolean;
  children: React.ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (!active) {
      return { opacity: 1 };
    }
    // Cosine rather than a triangle ramp: the ease at both ends is what makes it
    // a breath instead of a blink.
    return { opacity: 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(progress.value * 2 * Math.PI)) };
  }, [active]);
  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

/**
 * What shows through the glyph-shaped hole: a flat base in the state's tint,
 * with the bright peak travelling over it.
 */
function BrainIconFill({
  size,
  base,
  peak,
  motion,
  progress,
}: {
  size: number;
  base: string;
  peak: string;
  motion: Exclude<BrainMotion, "pulse">;
  progress: SharedValue<number>;
}) {
  const gradientId = useId();
  const band = size * BAND_RATIO;
  const travel = size + band;
  const vertical = motion === "bottom-to-top" || motion === "top-to-bottom";

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    switch (motion) {
      case "left-to-right":
        return { transform: [{ translateX: -band + p * travel }] };
      case "right-to-left":
        return { transform: [{ translateX: size - p * travel }] };
      case "top-to-bottom":
        return { transform: [{ translateY: -band + p * travel }] };
      case "bottom-to-top":
        return { transform: [{ translateY: size - p * travel }] };
      case "orbit":
        return { transform: [{ rotate: `${p * 360}deg` }] };
      default:
        return {};
    }
  }, [motion, band, travel, size]);

  const boxStyle = useMemo(() => ({ width: size, height: size }), [size]);

  return (
    <View style={boxStyle}>
      <Svg width={size} height={size} style={ABSOLUTE_FILL}>
        <Rect x={0} y={0} width={size} height={size} fill={base} />
      </Svg>
      <Animated.View
        style={[
          motion === "orbit"
            ? { position: "absolute", width: size, height: size }
            : {
                position: "absolute",
                width: vertical ? size : band,
                height: vertical ? band : size,
              },
          animatedStyle,
        ]}
      >
        {motion === "orbit" ? (
          // The orbit has no direction to express, so instead of a band there is
          // a hotspot parked off-centre; spinning the whole square walks it
          // around the glyph.
          <Svg width={size} height={size}>
            <Defs>
              <RadialGradient id={gradientId} cx="50%" cy="18%" r="55%">
                <Stop offset="0%" stopColor={peak} stopOpacity={1} />
                <Stop offset="100%" stopColor={peak} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={size} height={size} fill={`url(#${gradientId})`} />
          </Svg>
        ) : (
          <Svg width={vertical ? size : band} height={vertical ? band : size}>
            <Defs>
              <LinearGradient
                id={gradientId}
                x1="0%"
                y1="0%"
                x2={vertical ? "0%" : "100%"}
                y2={vertical ? "100%" : "0%"}
              >
                <Stop offset="0%" stopColor={peak} stopOpacity={0} />
                <Stop offset="50%" stopColor={peak} stopOpacity={1} />
                <Stop offset="100%" stopColor={peak} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect
              x={0}
              y={0}
              width={vertical ? size : band}
              height={vertical ? band : size}
              fill={`url(#${gradientId})`}
            />
          </Svg>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * The halo behind the glyph.
 *
 * A radial gradient rather than a shadow or a CSS blur: `filter` does not exist
 * on native and RN's shadow props do not produce a coloured bloom, whereas a
 * gradient fading to transparent is the same picture on every platform and
 * costs one static SVG.
 */
function BrainIconGlow({
  box,
  size,
  color,
  strength,
  compact,
}: {
  /** The laid-out box the halo centres on. */
  box: number;
  /** The drawn glyph the halo is sized against. */
  size: number;
  color: string;
  strength: number;
  /** Trim the halo to 85% on the compact form factor. */
  compact?: boolean;
}) {
  const gradientId = useId();
  const extent = size * GLOW_RATIO * (compact ? COMPACT_GLOW_RATIO : 1);
  const haloStyle = useMemo(
    () => ({ position: "absolute" as const, left: (box - extent) / 2, top: (box - extent) / 2 }),
    [box, extent],
  );
  return (
    <Svg width={extent} height={extent} style={haloStyle} pointerEvents="none">
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={strength * 0.55} />
          <Stop offset="55%" stopColor={color} stopOpacity={strength * 0.18} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={extent} height={extent} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

export type { BrainStateVisual };
