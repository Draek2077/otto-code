import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  runOnJS,
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
  type BrainRailActivity,
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

const ABSOLUTE_FILL = { position: "absolute" } as const;

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
 * of travel carrying the meaning (see `brain-state.ts`).
 *
 * When the host reports exactly two actively working slots (`activity`), the
 * glyph splits into two independently animated halves, one per slot; with three
 * or more it becomes the spectrum. Everything else - callers that have not
 * learned about `activity`, hosts that predate the per-slot join, lifecycle and
 * long-running op states - draws today's single-state picture unchanged.
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
  theme,
  style,
  compact = false,
  activity,
  crossfadeDurationMs = STATE_CROSSFADE_DURATION_MS,
}: {
  state: BrainState;
  size: number;
  theme: Theme;
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
  const animationsEnabled = useAnimationsEnabled();

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
        theme={theme}
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
          color={left.peak ?? theme.colors[left.tone]}
          strength={(left.glow + right.glow) / 2}
          compact={compact}
        />
        <View pointerEvents="none" style={halfClipStyle(size, "left")}>
          <View pointerEvents="none" style={halfGlyphWrapperStyle(size, "left")}>
            <BrainStateGlyph
              visual={left}
              animationsEnabled={animationsEnabled}
              size={size}
              theme={theme}
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
              theme={theme}
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
        theme={theme}
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
 * The dissolve between state pictures.
 *
 * Every picture is drawn inside an absolute size-box layer with the container's
 * centring, so a frozen copy stacks pixel-for-pixel over a live one. When
 * `pictureKey` changes, the last-rendered picture is frozen as an outgoing
 * layer drawn on top of the incoming one and faded out - fade-out-over rather
 * than a paired fade-in/fade-out, because the two pictures share the same brain
 * silhouette, so dimming both mid-fade would read as the icon blinking.
 *
 * The frozen picture is the previous React subtree, still mounted: its own
 * sweep keeps running while it fades, and its props (theme, size) simply stop
 * updating for the fraction of a second it remains. A second key change
 * mid-fade replaces the outgoing layer outright; two generations of ghosts are
 * never stacked.
 */
function BrainStateCrossfade({
  pictureKey,
  size,
  style,
  durationMs,
  enabled,
  children,
}: {
  pictureKey: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  durationMs: number;
  /** Off (Appearance → Animations): pictures swap instantly, no ghost layer. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  const containerStyle = useContainerStyle(size, style);
  const layerStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: 0,
      left: 0,
      width: size,
      height: size,
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
    }),
    [size],
  );

  const [renderedKey, setRenderedKey] = useState(pictureKey);
  const [outgoing, setOutgoing] = useState<{ id: number; node: React.ReactNode } | null>(null);
  // The children as of the previous render: what gets frozen when the key
  // flips. A ref, not state, so tracking it costs nothing on the renders
  // where nothing changes.
  const lastPictureRef = useRef(children);
  const outgoingIdRef = useRef(0);

  if (renderedKey !== pictureKey) {
    // React's documented render-phase pattern for deriving state from a prop
    // change: set state during render and let React restart the render with it,
    // instead of committing the new picture for a frame and fading only after
    // an effect fires.
    setRenderedKey(pictureKey);
    if (enabled && durationMs > 0) {
      outgoingIdRef.current += 1;
      setOutgoing({ id: outgoingIdRef.current, node: lastPictureRef.current });
    } else if (outgoing !== null) {
      setOutgoing(null);
    }
  }
  lastPictureRef.current = children;

  // Only clear if the finished ghost is still the one on screen: a fade that
  // was superseded mid-flight must not remove its replacement.
  const handleFadedOut = useCallback((id: number) => {
    setOutgoing((current) => (current !== null && current.id === id ? null : current));
  }, []);

  return (
    <View pointerEvents="none" style={containerStyle}>
      <View pointerEvents="none" style={layerStyle}>
        {children}
      </View>
      {outgoing ? (
        <BrainCrossfadeOut
          key={outgoing.id}
          id={outgoing.id}
          style={layerStyle}
          durationMs={durationMs}
          onDone={handleFadedOut}
        >
          {outgoing.node}
        </BrainCrossfadeOut>
      ) : null}
    </View>
  );
}

/** One frozen outgoing picture, fading from opaque to gone over `durationMs`. */
function BrainCrossfadeOut({
  id,
  style,
  durationMs,
  onDone,
  children,
}: {
  id: number;
  style: StyleProp<ViewStyle>;
  durationMs: number;
  onDone: (id: number) => void;
  children: React.ReactNode;
}) {
  const opacity = useSharedValue(1);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const finish = () => onDoneRef.current(id);
    opacity.value = withTiming(
      0,
      {
        duration: durationMs,
        easing: Easing.linear,
        // Same story as the sweep below: the app's Animations setting is this
        // fade's gate, and an unset reduceMotion would let headless Chromium's
        // `prefers-reduced-motion: reduce` snap the ghost away instantly.
        reduceMotion: ReduceMotion.Never,
      },
      (finished) => {
        if (finished) {
          runOnJS(finish)();
        }
      },
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [durationMs, id, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[style, fadeStyle]}>
      {children}
    </Animated.View>
  );
}

function useContainerStyle(size: number, style?: StyleProp<ViewStyle>) {
  return useMemo(
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
  theme,
  compact = false,
  glow = true,
}: {
  visual: BrainStateVisual;
  animationsEnabled: boolean;
  size: number;
  theme: Theme;
  /** Compact form factor: trims the glow so it fits the tighter rail. */
  compact?: boolean;
  /**
   * False inside the split, where one shared halo is drawn behind both halves
   * and a per-half halo would double it and be cropped at the seam.
   */
  glow?: boolean;
}) {
  const base = theme.colors[visual.tone];
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
  theme,
  compact = false,
  animated,
}: {
  size: number;
  theme: Theme;
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
  const stops: React.ReactElement[] = SPECTRUM_HUES.map((hue, index) => (
    <Stop
      key={hue}
      offset={`${Math.round((index / SPECTRUM_HUES.length) * 100)}%`}
      stopColor={hue}
    />
  ));
  stops.push(<Stop key="wrap" offset="100%" stopColor={SPECTRUM_HUES[0]} />);
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
        color={theme.colors.foregroundMuted}
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
 * One linear 0 → 1 ramp per cycle, restarted only when the motion actually
 * changes - the glyph starts or stops moving (`active`), or the sweep speed
 * changes (`durationMs`).
 *
 * Deliberately NOT keyed on the state itself. The brain pushes a status
 * snapshot on every inference-phase change, so the derived state flaps between
 * prefill / thinking / generating throughout a single continuous generation.
 * If the state were a dependency here, each flap would run the cleanup
 * (`cancelAnimation`) and restart the sweep from zero, so instead of one smooth
 * loop for the life of the state you get the first traversal and then a yank
 * back to the beginning on every snapshot - it reads as "it plays once and
 * stops." Keying on `active`/`durationMs` alone keeps the loop running for the
 * whole busy period; `cancelAnimation` still stops it the instant the state
 * leaves the busy set, because `active` flips to false then.
 */
function useSweepProgress(active: boolean, durationMs: number): SharedValue<number> {
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
      // The reduceMotion option is a 5th argument on withRepeat (after the
      // callback). It MUST be set here, not just on the inner withTiming:
      // reanimated fills an unset reduceMotion in from the *system* setting
      // (util.js decorateAnimation), and a reduceMotion of `true` on the repeat
      // wrapper is the one path that ends a `withRepeat(-1)` loop - after
      // exactly one completed cycle it returns finished and stops. That is why
      // the icon ran a single sweep/rotation and then froze on hosts (or CI)
      // where reduced motion is on. Reanimated only propagates reduceMotion
      // parent -> child (repeat -> timing), never the other way around, so the
      // Never on the timing above does not protect the wrapper.
      undefined,
      ReduceMotion.Never,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [active, durationMs, progress]);
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
