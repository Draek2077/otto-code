import { Platform } from "react-native";
import Svg, {
  Circle,
  Defs,
  FeGaussianBlur,
  Filter,
  G,
  RadialGradient,
  Stop,
} from "react-native-svg";

// Shared by blob-loader.tsx (Reanimated clock, native) and blob-loader.web.tsx
// (CSS keyframes, web): the glow artwork and the loop geometry both drive.

// One full loop. Glow A makes 2 revolutions per loop and glow B 3 (same
// direction), so they lap each other exactly once per loop - merging into a
// single blended glow, then splitting to opposite sides - while both land
// back at their start for a seamless repeat.
export const BLOB_LOADER_DURATION_MS = 5600;
export const GLOW_A_REVOLUTIONS = 2;
export const GLOW_B_REVOLUTIONS = 3;
// Integer squash cycles per loop keep the repeat seamless.
export const WOBBLE_CYCLES = 4;
export const WOBBLE_AMPLITUDE = 0.045;

const GLOW_CYAN = "#4ec4ff";
const GLOW_MAGENTA = "#e14fe8";

// Shared fallback glow pair, reused by the static gradient provider icon so a
// personality with no custom colors looks the same whether shown as a spinner
// or a gradient-filled glyph.
export const GLOW_DEFAULT_A = GLOW_CYAN;
export const GLOW_DEFAULT_B = GLOW_MAGENTA;

// Extra viewBox margin (in 0..100 units, per side) a blurred ring needs so its
// glow fits inside the SVG viewport instead of being clipped. The outer halo
// stroke already reaches r≈53 (coordinate 103, past the 0..100 box) and the
// gaussian bloom spreads a further ~3σ. Zero when unblurred. GlowLayer uses it
// to size the viewBox + filter region; BlobLoader uses it to over-scan the SVG
// so the visible ring stays `0.8 × size` regardless of blur (see there).
export function blurPadUnits(blur: number): number {
  return blur > 0 ? Math.ceil(6 + blur * 3) : 0;
}

/**
 * One color of orbiting light: a bright ring plus soft halo strokes, all
 * stroked with a radial gradient anchored off-center so rotating the layer
 * orbits the hot spot. Everything fades to transparent - there is no opaque
 * body, so the loader glows over both black and white backgrounds.
 */
export function GlowLayer({
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
  // blur) on Hermes/Android - see software-mansion/react-native-svg#2636.
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
            gaussian bloom - wider, lower-opacity halos read as a soft glow. */}
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
