import { useId, useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from "react-native-svg";
import { BrainIconMask } from "./mask";
import {
  BRAIN_BADGE_CENTER_X,
  BRAIN_BADGE_CENTER_Y,
  BRAIN_BADGE_SIZE,
  brainArtworkSvg,
  brainMaskSvg,
} from "./glyphs";
import {
  BRAIN_STATE_VISUALS,
  type BrainBadge,
  type BrainMotion,
  type BrainRailActivity,
  type BrainState,
  type BrainStateVisual,
} from "./state";
import { BRAIN_SYMBOL_SVGS } from "./artwork";
import { brainGlyphExtent } from "./geometry";
import type { BrainPalette } from "./input";
import { useBrainMotionEnabled } from "./lifecycle";
import { useSweepProgress } from "./use-sweep-progress";
import { BrainStateCrossfade } from "./crossfade";
import { BrainIconBreathing, BrainIconFill, BrainIconGlow } from "./effects";

/**
 * The spectrum's cadence. Slower than any token motion on purpose: this picture
 * means "several things at once", not alarm, and a frantic spin would read as
 * the wrong thing.
 */
const SPECTRUM_DURATION_MS = 3000;

/**
 * The spectrum's hues, one full walk of the wheel - eight stops at roughly 45
 * degree steps from red through orange, yellow, green, cyan, blue and violet out
 * to magenta, which loops cleanly back to red as the orbit comes round. Literal
 * peaks for the same reason the per-state peaks are: they must read identically
 * in every theme.
 *
 * The orbit draws this gradient twice - once in the halo behind the brain and
 * once through the brain-shaped mask itself - so the colour walk is visible both
 * around the glyph and inside its silhouette.
 */
const SPECTRUM_HUES = [
  "#f87171", // red
  "#fb923c", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#22d3ee", // cyan
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#f472b6", // magenta - closes the wheel back onto red
] as const;

/**
 * How long one state picture dissolves into the next. When the derived state
 * changes, the outgoing picture is frozen and fades out on top of the incoming
 * one, so a tint change reads as a shift rather than a snap. This constant is
 * the tuning knob; `crossfadeDurationMs` on `BrainStateIcon` overrides it
 * per-instance.
 */
const STATE_CROSSFADE_DURATION_MS = 300;

/**
 * The Brain rail button's glyph, showing what the local AI host is doing.
 *
 * Lifecycle states are a flat tint and hold still - a status light that moves
 * when nothing is happening trains you to ignore it. Busy states get a gradient
 * travelling across the glyph itself plus a glow behind it, with the direction
 * of travel carrying the meaning (see `state.ts`).
 *
 * When the host reports exactly two actively working slots (`activity`), the
 * glyph splits into two independently animated halves, one per slot; with three
 * or more it becomes the spectrum. Lifecycle and long-running operations retain the original single-state picture.
 *
 * Everything here is driven off repeating shared values. There is no timer and
 * no re-render per frame: each sweep is a transform on a single
 * `Animated.View` clipped to the glyph, which is the one masking rig in this app
 * that behaves the same on web and on device. The only React state is the
 * crossfade's frozen outgoing picture, touched once per state change, never per
 * frame.
 */
export function BrainStateIcon({
  state,
  size,
  palette,
  style,
  compact = false,
  activity,
  crossfadeDurationMs = STATE_CROSSFADE_DURATION_MS,
}: {
  state: BrainState;
  size: number;
  palette: BrainPalette;
  style?: StyleProp<ViewStyle>;
  /** Compact form factor: trims the glow so it fits the tighter rail. */
  compact?: boolean;
  /**
   * The per-slot picture, when more than one slot is actively working. Absent
   * or `single` falls back to `state` above.
   */
  activity?: BrainRailActivity;
  /** How long one state picture dissolves into the next. */
  crossfadeDurationMs?: number;
}) {
  // Appearance → Animations turns the motion off everywhere in the app, and this
  // is motion. The state still reads: the tint and the glyph are the animation's
  // own resting frame, so nothing is lost but the movement.
  const animationsEnabled = useBrainMotionEnabled();

  // One picture per derived state, plus a key naming which picture this is.
  // The key is what the crossfade watches: continuous prop changes (size,
  // theme, compact) flow into the current picture without a fade, while a key
  // change freezes the old picture and dissolves it into the new one.
  let pictureKey: string;
  let picture: React.ReactNode;
  if (activity?.kind === "spectrum") {
    pictureKey = "spectrum";
    picture = (
      <BrainSpectrumGlyph
        size={size}
        palette={palette}
        compact={compact}
        animated={animationsEnabled}
      />
    );
  } else if (activity?.kind === "split") {
    // The glow is drawn once, unclipped, behind both halves: each half's state
    // carries its own peak colour, so the halo blends the two. The glyphs then
    // sit in their own clips so the two fills never cross the seam.
    const left = BRAIN_STATE_VISUALS[activity.slots[0]];
    const right = BRAIN_STATE_VISUALS[activity.slots[1]];
    pictureKey = `split:${activity.slots[0]}:${activity.slots[1]}`;
    picture = (
      <>
        <BrainIconGlow
          box={size}
          size={brainGlyphExtent(size)}
          color={left.peak ?? palette[left.tone]}
          strength={(left.glow + right.glow) / 2}
          compact={compact}
        />
        <View pointerEvents="none" style={halfClipStyle(size, "left")}>
          <View pointerEvents="none" style={halfGlyphWrapperStyle(size, "left")}>
            <BrainStateGlyph
              visual={left}
              animationsEnabled={animationsEnabled}
              size={size}
              palette={palette}
              glow={false}
            />
          </View>
        </View>
        <View pointerEvents="none" style={halfClipStyle(size, "right")}>
          <View pointerEvents="none" style={halfGlyphWrapperStyle(size, "right")}>
            <BrainStateGlyph
              visual={right}
              animationsEnabled={animationsEnabled}
              size={size}
              palette={palette}
              glow={false}
            />
          </View>
        </View>
      </>
    );
  } else {
    const visualState = activity ? activity.state : state;
    pictureKey = `state:${visualState}`;
    picture = (
      <BrainStateGlyph
        visual={BRAIN_STATE_VISUALS[visualState]}
        animationsEnabled={animationsEnabled}
        size={size}
        palette={palette}
        compact={compact}
      />
    );
  }

  return (
    <BrainStateCrossfade
      pictureKey={pictureKey}
      size={size}
      style={style}
      durationMs={crossfadeDurationMs}
      enabled={animationsEnabled}
    >
      {picture}
    </BrainStateCrossfade>
  );
}

/**
 * The clip for one half of the split picture.
 *
 * Half-width clips, each showing its own side's slice of a full-size glyph layer
 * centred underneath. A hair past the midpoint (`51%`) so no column at the seam
 * belongs to neither half: exact halves can leave a translucent gap down the
 * middle of the brain on sub-pixel rounding.
 */
/**
 * How far past the icon box each half-clip reaches, as a fraction of the size.
 * Room for the drawn glyph's own overflow (`brainGlyphExtent`) without letting
 * a half's fill bleed into its neighbour's half.
 */
const HALF_CLIP_BLEED_RATIO = 0.1;

/**
 * Where the seam sits, measured from the icon's left edge: the icon's exact
 * midpoint. The glyph is centred in its box, so the equal split lands on the
 * brain's own centre line - no nudge needed.
 */
function halfSeamX(size: number): number {
  return Math.round(size / 2);
}

/**
 * The clips for one half of the split picture, plus the wrappers that pin a
 * full-size glyph layer to the icon's true centre inside each clip.
 *
 * The wrappers exist because an asymmetric clip cannot centre its child
 * correctly (a centred child lands on the *clip's* centre): each wrapper
 * positions its glyph explicitly instead, and the clip just decides what is
 * shown. Together the two clips tile the box edge to edge - left up to the
 * seam, right from it - sharing no column and skipping none.
 */
function halfClipStyle(size: number, side: "left" | "right"): ViewStyle {
  const bleed = Math.ceil(size * HALF_CLIP_BLEED_RATIO);
  const seamX = halfSeamX(size);
  if (side === "left") {
    return {
      position: "absolute",
      top: -bleed,
      bottom: -bleed,
      left: -bleed,
      width: seamX + bleed,
      overflow: "hidden",
    };
  }
  return {
    position: "absolute",
    top: -bleed,
    bottom: -bleed,
    left: seamX,
    width: size - seamX + bleed,
    overflow: "hidden",
  };
}

/** Where the icon-centred glyph wrapper sits inside its half-clip. */
function halfGlyphWrapperStyle(size: number, side: "left" | "right"): ViewStyle {
  const bleed = Math.ceil(size * HALF_CLIP_BLEED_RATIO);
  const seamX = halfSeamX(size);
  return {
    position: "absolute",
    // The clip's own origin minus where the icon sits inside it: the left clip
    // starts at `-bleed`, so the icon begins `bleed` in; the right clip starts
    // at `seamX`, so the icon begins `-seamX` in.
    left: side === "left" ? bleed : -seamX,
    top: bleed,
    width: size,
    height: size,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
}

/**
 * One complete state rendering: glow, then the glyph either breathing or with
 * its travelling fill masked to the shape, plus the badge where the state has
 * one. Extracted verbatim from the original single-state body so the split mode
 * can mount two of them and everything else keeps the exact picture it has
 * always drawn.
 */
function BrainStateGlyph({
  visual,
  animationsEnabled,
  size,
  palette,
  compact = false,
  glow = true,
}: {
  visual: BrainStateVisual;
  animationsEnabled: boolean;
  size: number;
  palette: BrainPalette;
  /** Compact form factor: trims the glow so it fits the tighter rail. */
  compact?: boolean;
  /**
   * False inside the split, where one shared halo is drawn behind both halves
   * and a per-half halo would double it and be cropped at the seam.
   */
  glow?: boolean;
}) {
  const base = palette[visual.tone];
  const artwork = useMemo(
    () => brainArtworkSvg(visual.glyph, visual.badge),
    [visual.glyph, visual.badge],
  );
  const maskSvg = useMemo(
    () => brainMaskSvg(visual.glyph, visual.badge),
    [visual.glyph, visual.badge],
  );
  const motion: BrainMotion | null = animationsEnabled ? visual.motion : null;

  const progress = useSweepProgress(motion !== null, visual.durationMs);

  // Laid out at `size`, drawn at `glyph`. Centred by the caller's container.
  const glyph = brainGlyphExtent(size);

  return (
    <>
      {glow && visual.glow > 0 ? (
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
    </>
  );
}

/**
 * The spectrum: three or more actively working slots, drawn as a rainbow light
 * spinning around and through the brain.
 *
 * Deliberately NOT an attribution of anything - past two busy slots no picture
 * at rail size can say who is doing what - so it claims only "a lot is
 * happening". What separates it from `thinking`'s single-accent orbit at a
 * glance is the hue walk: the rotating hotspot cycles the whole spectrum instead
 * of one accent colour.
 */
function BrainSpectrumGlyph({
  size,
  palette,
  compact = false,
  animated,
}: {
  size: number;
  palette: BrainPalette;
  /** Compact form factor: trims the glow so it fits the tighter rail. */
  compact?: boolean;
  animated: boolean;
}) {
  const progress = useSweepProgress(animated, SPECTRUM_DURATION_MS);
  const glyph = brainGlyphExtent(size);
  const gradientId = useId();
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 360}deg` }],
  }));

  // The gradient stops are static across renders; only the transform spins.
  // The final stop repeats the first hue so the wheel has no seam of its own:
  // as the sheet comes full circle the last colour hands off to the first.
  const stops = useMemo(() => {
    const colors: React.ReactElement[] = SPECTRUM_HUES.map((hue, index) => (
      <Stop
        key={hue}
        offset={`${Math.round((index / SPECTRUM_HUES.length) * 100)}%`}
        stopColor={hue}
      />
    ));
    colors.push(<Stop key="wrap" offset="100%" stopColor={SPECTRUM_HUES[0]} />);
    return colors;
  }, []);
  const ghostStyle = useMemo<ViewStyle>(() => ({ opacity: 0.25, position: "absolute" }), []);
  const maskWindowStyle = useMemo<ViewStyle>(
    () => ({ position: "absolute", width: glyph, height: glyph }),
    [glyph],
  );
  const spinBoxStyle = useMemo<ViewStyle>(
    () => ({ position: "absolute", width: glyph, height: glyph }),
    [glyph],
  );

  const rainbowSvg = useMemo(
    () => (
      <Svg width={glyph} height={glyph}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops}
          </LinearGradient>
        </Defs>
        {/* Parked off-centre like the thinking orbit's hotspot, so spinning the
            square walks it around the glyph. Larger than thinking's hotspot:
            this one has to carry six hues legibly at rail size. */}
        <Rect x={0} y={0} width={glyph} height={glyph} fill={`url(#${gradientId})`} />
      </Svg>
    ),
    [glyph, gradientId, stops],
  );

  return (
    <>
      {/* The halo picks up a spectrum hue so the glow breathes colour as the
          wheel turns rather than sitting on one fixed accent. */}
      <BrainIconGlow box={size} size={glyph} color="#818cf8" strength={0.7} compact={compact} />
      {/* The brain-shaped window stays perfectly still; only the rainbow sheet
          behind it spins. The gradient's own diagonal walk plus the rotation is
          what reads as colours circulating through the glyph - moving colour,
          not a moving icon. */}
      <View pointerEvents="none" style={maskWindowStyle}>
        <BrainIconMask maskSvg={brainMaskSvg("brain", null)} size={glyph}>
          <Animated.View style={[spinBoxStyle, spinStyle]}>{rainbowSvg}</Animated.View>
        </BrainIconMask>
      </View>
      {/* A faint flat silhouette under the spin, so the brain reads even at the
          point in the rotation where the hotspot faces away from the viewer. */}
      <SvgXml
        xml={brainArtworkSvg("brain", null)}
        width={glyph}
        height={glyph}
        color={palette.foregroundMuted}
        style={ghostStyle}
      />
    </>
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
  const artwork =
    badge === "calibrate" ? BRAIN_SYMBOL_SVGS.BrainCalibrate : BRAIN_SYMBOL_SVGS.BrainSweep;
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
      <SvgXml xml={artwork} width={extent} height={extent} color={color} />
    </View>
  );
}
