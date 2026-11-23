import { useId, useMemo } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import type { BrainMotion } from "./state";

const BAND_RATIO = 0.7;
const GLOW_RATIO = 1.7;
const COMPACT_GLOW_RATIO = 0.85;
const ABSOLUTE_FILL = { position: "absolute" } as const;

/**
 * The `pulse` motion, and the resting case. Queued work is not moving yet, so
 * nothing travels - the glyph breathes in place instead, which reads as "held"
 * rather than as "running".
 */
export function BrainIconBreathing({
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
export function BrainIconFill({
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
export function BrainIconGlow({
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
