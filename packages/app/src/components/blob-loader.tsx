import { useEffect, useId, useMemo } from "react";
import { Platform, View } from "react-native";
import Animated, {
  Easing,
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  FeGaussianBlur,
  Filter,
  G,
  RadialGradient,
  Stop,
} from "react-native-svg";
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

// Shared fallback glow pair, reused by the static gradient provider icon so a
// personality with no custom colors looks the same whether shown as a spinner
// or a gradient-filled glyph.
export const GLOW_DEFAULT_A = GLOW_CYAN;
export const GLOW_DEFAULT_B = GLOW_MAGENTA;

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

// Extra viewBox margin (in 0..100 units, per side) a blurred ring needs so its
// glow fits inside the SVG viewport instead of being clipped. The outer halo
// stroke already reaches r≈53 (coordinate 103, past the 0..100 box) and the
// gaussian bloom spreads a further ~3σ. Zero when unblurred. GlowLayer uses it
// to size the viewBox + filter region; BlobLoader uses it to over-scan the SVG
// so the visible ring stays `0.8 × size` regardless of blur (see there).
function blurPadUnits(blur: number): number {
  return blur > 0 ? Math.ceil(6 + blur * 3) : 0;
}

/**
 * One color of orbiting light: a bright ring plus soft halo strokes, all
 * stroked with a radial gradient anchored off-center so rotating the layer
 * orbits the hot spot. Everything fades to transparent — there is no opaque
 * body, so the loader glows over both black and white backgrounds.
 */
function GlowLayer({
  color,
  gradientId,
  filterId,
  blur = 0,
}: {
  color: string;
  gradientId: string;
  filterId: string;
  blur?: number;
}) {
  // Opt-in gaussian bloom: blurs the ring into a soft plasma haze (the setup
  // wizard's brand bookends use this for a black-hole-like look). stdDeviation
  // is in the 0..100 viewBox space, so a single value is resolution-independent
  // and looks the same at any rendered size. Default 0 keeps every small
  // working-indicator instance crisp.
  //
  // Android: react-native-svg FeGaussianBlur renders incorrectly (barely any
  // blur) on Hermes/Android — see software-mansion/react-native-svg#2636.
  // Instead of a broken filter we widen the halo strokes proportionally to
  // simulate the bloom through opacity and radius falloff. The result is a
  // softer-than-crisp ring that reads as a glow, even if not a true gaussian.
  const isAndroid = Platform.OS === "android";
  const filtered = blur > 0 && !isAndroid;

  // An SVG clips to its viewBox (always on native; overflow:hidden by default
  // on web), which shaves a blurred ring's glow into a squared-off oval. Pad
  // the viewBox symmetrically so the whole glow fits inside the viewport, and
  // match the filter region to the padded box (userSpaceOnUse) so the filter
  // doesn't re-clip. BlobLoader over-scans the SVG by the same pad so the ring
  // still renders at its intended size. The unblurred path keeps the tight
  // 0..100 box, byte-for-byte unchanged. The pad is keyed to `blur` (not
  // `filtered`) because the Android fallback below also overflows the box: its
  // widened halo reaches r = 40 + 13×bloom ≈ 43 + 2.9×blur, which always fits
  // inside the gaussian pad's 53 + 3×blur envelope.
  const pad = blurPadUnits(blur);
  const min = -pad;
  const span = 100 + pad * 2;

  // Android fallback: when blur is requested but the SVG filter is unavailable,
  // simulate the bloom by widening the halo strokes while dimming them by the
  // same factor (constant total ink), so the gradient falloff reads as a soft
  // glow without any filter. 0.22 is a hand-tuned mapping of blur stdDeviation
  // → stroke multiplier that lands the halo extent near the gaussian's.
  const androidBloom = isAndroid && blur > 0 ? 1 + blur * 0.22 : 1;

  return (
    <Svg width="100%" height="100%" viewBox={`${min} ${min} ${span} ${span}`}>
      <Defs>
        <RadialGradient id={gradientId} cx="76%" cy="20%" r="75%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <Stop offset="45%" stopColor={color} stopOpacity={0.35} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
        {filtered ? (
          <Filter
            id={filterId}
            filterUnits="userSpaceOnUse"
            x={min}
            y={min}
            width={span}
            height={span}
          >
            <FeGaussianBlur stdDeviation={blur} />
          </Filter>
        ) : null}
      </Defs>
      <G filter={filtered ? `url(#${filterId})` : undefined}>
        {/* Feathered halo: stacked strokes fade the glow outward and inward.
            On Android the stroke widths are widened to simulate the missing
            gaussian bloom — wider, lower-opacity halos read as a soft glow. */}
        <Circle
          cx={50}
          cy={50}
          r={40}
          stroke={`url(#${gradientId})`}
          strokeWidth={26 * androidBloom}
          fill="none"
          opacity={0.16 / androidBloom}
        />
        <Circle
          cx={50}
          cy={50}
          r={40}
          stroke={`url(#${gradientId})`}
          strokeWidth={16 * androidBloom}
          fill="none"
          opacity={0.3 / androidBloom}
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
      </G>
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
  blur = 0,
  wobble = true,
}: {
  size?: number;
  glowA?: string;
  glowB?: string;
  // stdDeviation (0..100 viewBox units) of an opt-in gaussian bloom on both
  // orbiting layers. 0 (default) = today's crisp ring. See GlowLayer.
  blur?: number;
  // Whether the ring squashes organically as it spins (the plasma "wobble").
  // On (default) for the tiny working indicator; callers that want a smooth,
  // perfectly circular spin — e.g. the setup wizard's large brand halo — pass
  // false. The orbiting glow still spins; only the scaleX/scaleY pulse stops.
  wobble?: boolean;
}) {
  useEffect(() => {
    ensureSharedBlobLoopStarted();
  }, []);

  // Gradient/filter ids are rendered into the DOM on web, so they must be unique
  // per instance; useId output is sanitized for use inside url(#...).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const glowAId = `blob-glow-a-${uid}`;
  const glowBId = `blob-glow-b-${uid}`;
  const blurAId = `blob-blur-a-${uid}`;
  const blurBId = `blob-blur-b-${uid}`;

  const wobbleAmplitude = wobble ? 0.045 : 0;
  const wobbleStyle = useAnimatedStyle(() => {
    // Integer squash cycles per loop keep the repeat seamless. Amplitude 0
    // (wobble disabled) leaves scaleX/scaleY at 1 — a smooth circular spin.
    const squash = Math.sin(sharedBlobProgress.value * Math.PI * 8);
    return {
      transform: [
        { scaleX: 1 + wobbleAmplitude * squash },
        { scaleY: 1 - wobbleAmplitude * squash },
      ],
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

  // Over-scan each glow layer past the `size` box by the blur's viewBox pad
  // (converted to px: pad is per-side in 0..100 units, so `size * pad / 100`).
  // The SVG then renders at `size * span/100`, which pulls the padded ring back
  // to `0.8 × size` on screen — so `size` means the same visible ring diameter
  // whether or not there's a bloom, and the glow overflows the box instead of
  // clipping. Zero pad (unblurred) collapses this to a plain inset-0 fill.
  // GlowLayer pads its viewBox by the same units whether the bloom comes from
  // the gaussian filter or the Android stroke-widening fallback, so this
  // overscan stays in lockstep on every platform.
  const overscan = (size * blurPadUnits(blur)) / 100;
  const overscanStyle = useMemo(
    () =>
      ({
        position: "absolute",
        top: -overscan,
        left: -overscan,
        right: -overscan,
        bottom: -overscan,
      }) as const,
    [overscan],
  );

  const glowALayerStyle = useMemo(
    () => [glowASpinStyle, overscanStyle],
    [glowASpinStyle, overscanStyle],
  );
  const glowBLayerStyle = useMemo(
    () => [glowBSpinStyle, overscanStyle],
    [glowBSpinStyle, overscanStyle],
  );

  return (
    <View style={containerStyle}>
      <Animated.View style={blobStyle}>
        {/* Orbiting lights, each on its own rotation of the shared clock. */}
        <Animated.View style={glowALayerStyle}>
          <GlowLayer color={glowA} gradientId={glowAId} filterId={blurAId} blur={blur} />
        </Animated.View>
        <Animated.View style={glowBLayerStyle}>
          <GlowLayer color={glowB} gradientId={glowBId} filterId={blurBId} blur={blur} />
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
