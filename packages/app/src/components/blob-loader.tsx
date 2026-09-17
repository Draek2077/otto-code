import { useEffect, useId, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { withUnistyles } from "react-native-unistyles";
import { withIconSizeToken } from "@/components/icons/icon-size";
import {
  BLOB_LOADER_DURATION_MS,
  blurPadUnits,
  GLOW_A_REVOLUTIONS,
  GLOW_B_REVOLUTIONS,
  GLOW_DEFAULT_A,
  GLOW_DEFAULT_B,
  GlowLayer,
  WOBBLE_AMPLITUDE,
  WOBBLE_CYCLES,
} from "./blob-loader-glow";

export { GLOW_DEFAULT_A, GLOW_DEFAULT_B };

// Native renderer. blob-loader.web.tsx replaces this on web, where the
// Reanimated clock is a JS requestAnimationFrame loop that keeps ticking inside
// display:none deck workspaces.
const BLOB_LOADER_EPOCH_MS = 0;

// Every BlobLoader on screen reads this one clock so instances animate in
// lockstep instead of drifting out of phase (same pattern as SyncedLoader).
const sharedBlobProgress = makeMutable(0);
let sharedBlobLoopStarted = false;
// The loop is `withRepeat(..., -1)`, which never ends on its own. Without a
// reference count it kept evaluating its worklet every frame for the rest of
// the process once the first instance mounted, even with nothing on screen.
let sharedBlobMountCount = 0;

/** Starts the shared clock for the first mounted instance; stops it after the last unmounts. */
function retainSharedBlobLoop(): () => void {
  sharedBlobMountCount += 1;
  ensureSharedBlobLoopStarted();
  return () => {
    sharedBlobMountCount = Math.max(0, sharedBlobMountCount - 1);
    if (sharedBlobMountCount > 0) {
      return;
    }
    cancelAnimation(sharedBlobProgress);
    // Cleared so the next mount re-syncs phase from the epoch rather than
    // resuming wherever the cancel left the value.
    sharedBlobLoopStarted = false;
  };
}

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
      // Reanimated runs this callback as a UI worklet on native. Keep the
      // module-scope loop bookkeeping on the JS thread in retainSharedBlobLoop;
      // referencing sharedBlobLoopStarted here crashes Hermes when cancellation
      // follows an unmount.
      if (!finished) {
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
function BlobLoaderBase({
  size = 20,
  glowA = GLOW_DEFAULT_A,
  glowB = GLOW_DEFAULT_B,
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
  // perfectly circular spin - e.g. the setup wizard's large brand halo - pass
  // false. The orbiting glow still spins; only the scaleX/scaleY pulse stops.
  wobble?: boolean;
}) {
  useEffect(() => retainSharedBlobLoop(), []);

  // Gradient/filter ids are rendered into the DOM on web, so they must be unique
  // per instance; useId output is sanitized for use inside url(#...).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const glowAId = `blob-glow-a-${uid}`;
  const glowBId = `blob-glow-b-${uid}`;
  const blurAId = `blob-blur-a-${uid}`;
  const blurBId = `blob-blur-b-${uid}`;

  const wobbleAmplitude = wobble ? WOBBLE_AMPLITUDE : 0;
  const wobbleStyle = useAnimatedStyle(() => {
    // Integer squash cycles per loop keep the repeat seamless. Amplitude 0
    // (wobble disabled) leaves scaleX/scaleY at 1 - a smooth circular spin.
    const squash = Math.sin(sharedBlobProgress.value * Math.PI * 2 * WOBBLE_CYCLES);
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
  // to `0.8 × size` on screen - so `size` means the same visible ring diameter
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

// A blob loader stands in for an icon while a model works, so it takes the same size
// tokens the icon it replaces would.
export const BlobLoader = withIconSizeToken(BlobLoaderBase, "BlobLoader");

// Theme-reactive wrapper: every theme defines a spinner glow pair (two
// distinct hues, always including the theme's namesake color). Only this
// leaf re-renders on theme changes, per docs/unistyles.md.
export const ThemedBlobLoader = withUnistyles(BlobLoader, (theme) => ({
  glowA: theme.colors.spinnerPrimary,
  glowB: theme.colors.spinnerSecondary,
}));
