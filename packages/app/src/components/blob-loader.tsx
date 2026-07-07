import { useEffect, useId, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";

// One full loop. Glow A makes 2 revolutions per loop and glow B 3 (same
// direction), so they lap each other exactly once per loop — merging into a
// single blended glow, then splitting to opposite sides — while both land
// back at their start for a seamless repeat.
const BLOB_LOADER_DURATION_MS = 5600;
const BLOB_LOADER_EPOCH_MS = 0;
const GLOW_A_REVOLUTIONS = 2;
const GLOW_B_REVOLUTIONS = 3;

const GLOW_CYAN = "#4ec4ff";
const GLOW_MAGENTA = "#e14fe8";

// Every BlobLoader on screen reads this one clock so instances animate in
// lockstep instead of drifting out of phase (same pattern as SyncedLoader).
const sharedBlobProgress = makeMutable(0);
let sharedBlobLoopStarted = false;

function ensureSharedBlobLoopStarted(): void {
  if (sharedBlobLoopStarted) {
    return;
  }

  sharedBlobLoopStarted = true;
  const elapsedMs = (Date.now() - BLOB_LOADER_EPOCH_MS) % BLOB_LOADER_DURATION_MS;
  sharedBlobProgress.value = elapsedMs / BLOB_LOADER_DURATION_MS;
  sharedBlobProgress.value = withTiming(
    1,
    {
      duration: Math.max(1, Math.round(BLOB_LOADER_DURATION_MS - elapsedMs)),
      easing: Easing.linear,
      // Never gate the working indicator on the OS reduce-motion setting.
      // Reanimated defaults to ReduceMotion.System; on a desktop/browser that
      // reports `prefers-reduced-motion: reduce` that snaps the shared value
      // straight to the end and the loop freezes on a single frame.
      reduceMotion: ReduceMotion.Never,
    },
    (finished) => {
      if (!finished) {
        sharedBlobLoopStarted = false;
        return;
      }
      sharedBlobProgress.value = 0;
      sharedBlobProgress.value = withRepeat(
        withTiming(1, {
          duration: BLOB_LOADER_DURATION_MS,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        false,
        undefined,
        ReduceMotion.Never,
      );
    },
  );
}

const GLOW_LAYER_STYLE = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

/**
 * One color of orbiting light: a bright ring plus soft halo strokes, all
 * stroked with a radial gradient anchored off-center so rotating the layer
 * orbits the hot spot. Everything fades to transparent — there is no opaque
 * body, so the loader glows over both black and white backgrounds.
 */
function GlowLayer({ color, gradientId }: { color: string; gradientId: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gradientId} cx="76%" cy="20%" r="75%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <Stop offset="45%" stopColor={color} stopOpacity={0.35} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {/* Feathered halo: stacked strokes fade the glow outward and inward. */}
      <Circle
        cx={50}
        cy={50}
        r={40}
        stroke={`url(#${gradientId})`}
        strokeWidth={26}
        fill="none"
        opacity={0.16}
      />
      <Circle
        cx={50}
        cy={50}
        r={40}
        stroke={`url(#${gradientId})`}
        strokeWidth={16}
        fill="none"
        opacity={0.3}
      />
      {/* Bright core ring. */}
      <Circle
        cx={50}
        cy={50}
        r={40}
        stroke={`url(#${gradientId})`}
        strokeWidth={9}
        fill="none"
        opacity={0.95}
      />
      {/* Whisper of inner bloom so the transparent center doesn't read as a
          hollow outline at small sizes. */}
      <Circle cx={50} cy={50} r={33} fill={`url(#${gradientId})`} opacity={0.14} />
    </Svg>
  );
}

/**
 * A tiny "plasma ring" working indicator: two glowing lights orbiting at
 * different speeds, merging and separating as they lap each other while the
 * ring squashes organically. The center is fully transparent and every edge
 * feathers to transparent via gradient falloff, so it glows equally over
 * black and white backgrounds.
 *
 * Glow colors default to the neutral cyan/magenta pair; themed callers should
 * use `ThemedBlobLoader`, which reads the per-theme `spinnerPrimary` /
 * `spinnerSecondary` tokens.
 */
export function BlobLoader({
  size = 20,
  glowA = GLOW_CYAN,
  glowB = GLOW_MAGENTA,
}: {
  size?: number;
  glowA?: string;
  glowB?: string;
}) {
  useEffect(() => {
    ensureSharedBlobLoopStarted();
  }, []);

  // Gradient ids are rendered into the DOM on web, so they must be unique
  // per instance; useId output is sanitized for use inside url(#...).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const glowAId = `blob-glow-a-${uid}`;
  const glowBId = `blob-glow-b-${uid}`;

  const wobbleStyle = useAnimatedStyle(() => {
    // Integer squash cycles per loop keep the repeat seamless.
    const wobble = Math.sin(sharedBlobProgress.value * Math.PI * 8);
    return {
      transform: [{ scaleX: 1 + 0.045 * wobble }, { scaleY: 1 - 0.045 * wobble }],
    };
  });

  const glowASpinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sharedBlobProgress.value * 360 * GLOW_A_REVOLUTIONS}deg` }],
  }));

  const glowBSpinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sharedBlobProgress.value * 360 * GLOW_B_REVOLUTIONS}deg` }],
  }));

  const containerStyle = useMemo(
    () =>
      ({
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }) as const,
    [size],
  );

  const blobStyle = useMemo(
    () => [wobbleStyle, { width: size, height: size }],
    [wobbleStyle, size],
  );

  const glowALayerStyle = useMemo(() => [glowASpinStyle, GLOW_LAYER_STYLE], [glowASpinStyle]);
  const glowBLayerStyle = useMemo(() => [glowBSpinStyle, GLOW_LAYER_STYLE], [glowBSpinStyle]);

  return (
    <View style={containerStyle}>
      <Animated.View style={blobStyle}>
        {/* Orbiting lights, each on its own rotation of the shared clock. */}
        <Animated.View style={glowALayerStyle}>
          <GlowLayer color={glowA} gradientId={glowAId} />
        </Animated.View>
        <Animated.View style={glowBLayerStyle}>
          <GlowLayer color={glowB} gradientId={glowBId} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// Theme-reactive wrapper: every theme defines a spinner glow pair (two
// distinct hues, always including the theme's namesake color). Only this
// leaf re-renders on theme changes, per docs/unistyles.md.
export const ThemedBlobLoader = withUnistyles(BlobLoader, (theme) => ({
  glowA: theme.colors.spinnerPrimary,
  glowB: theme.colors.spinnerSecondary,
}));
