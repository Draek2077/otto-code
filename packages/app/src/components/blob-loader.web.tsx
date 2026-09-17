// Web renderer for the plasma-ring working indicator. One set of keyframes is
// registered for the whole app and every instance rides it, so a running ring
// costs no JavaScript per frame: the compositor rotates each pre-rasterized
// glow layer, and a ring inside a display:none deck workspace stops animating
// entirely.
//
// The native renderer (blob-loader.tsx) drives the same geometry from a shared
// Reanimated clock. On web that clock is a JS requestAnimationFrame loop with
// three style writes per instance per frame, and it kept ticking for every
// running tab, sidebar row and composer track, hidden workspaces included.

import { useEffect, useId, useMemo } from "react";
import { View } from "react-native";
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

const KEYFRAME_STYLE_ID = "otto-blob-loader-keyframes";
const SPIN_A = "otto-blob-spin-a";
const SPIN_B = "otto-blob-spin-b";
const WOBBLE = "otto-blob-wobble";
const WOBBLE_DURATION_MS = BLOB_LOADER_DURATION_MS / WOBBLE_CYCLES;

const high = (1 + WOBBLE_AMPLITUDE).toFixed(3);
const low = (1 - WOBBLE_AMPLITUDE).toFixed(3);

// The wobble is one sine period per keyframe cycle; ease-in-out per segment
// keeps the squash rounded at its peaks like the native Math.sin curve.
const KEYFRAME_CSS = `
  @keyframes ${SPIN_A} { to { transform: rotate(${360 * GLOW_A_REVOLUTIONS}deg); } }
  @keyframes ${SPIN_B} { to { transform: rotate(${360 * GLOW_B_REVOLUTIONS}deg); } }
  @keyframes ${WOBBLE} {
    0%, 50%, 100% { transform: scale(1, 1); }
    25% { transform: scale(${high}, ${low}); }
    75% { transform: scale(${low}, ${high}); }
  }
`;

function ensureKeyframes() {
  if (typeof document === "undefined" || document.getElementById(KEYFRAME_STYLE_ID)) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = KEYFRAME_STYLE_ID;
  styleElement.textContent = KEYFRAME_CSS;
  document.head.appendChild(styleElement);
}

/**
 * Negative delay that places a newly mounted instance at the wall-clock phase,
 * so every ring on screen stays in lockstep no matter when it mounted.
 */
function phaseDelayMs(durationMs: number): number {
  return -(Date.now() % durationMs);
}

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
  // See blob-loader.tsx.
  blur?: number;
  wobble?: boolean;
}) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const glowAId = `blob-glow-a-${uid}`;
  const glowBId = `blob-glow-b-${uid}`;
  const blurAId = `blob-blur-a-${uid}`;
  const blurBId = `blob-blur-b-${uid}`;

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

  const overscan = (size * blurPadUnits(blur)) / 100;

  // Computed once per mount: the delay only aligns the starting phase.
  const { blobStyle, glowALayerStyle, glowBLayerStyle } = useMemo(() => {
    const spinDelay = phaseDelayMs(BLOB_LOADER_DURATION_MS);
    const overscanStyle = {
      position: "absolute",
      top: -overscan,
      left: -overscan,
      right: -overscan,
      bottom: -overscan,
      willChange: "transform",
    } as const;
    return {
      blobStyle: {
        width: size,
        height: size,
        ...(wobble
          ? {
              animation: `${WOBBLE} ${WOBBLE_DURATION_MS}ms ease-in-out ${phaseDelayMs(WOBBLE_DURATION_MS)}ms infinite`,
            }
          : null),
      } as object,
      glowALayerStyle: {
        ...overscanStyle,
        animation: `${SPIN_A} ${BLOB_LOADER_DURATION_MS}ms linear ${spinDelay}ms infinite`,
      } as object,
      glowBLayerStyle: {
        ...overscanStyle,
        animation: `${SPIN_B} ${BLOB_LOADER_DURATION_MS}ms linear ${spinDelay}ms infinite`,
      } as object,
    };
  }, [overscan, size, wobble]);

  return (
    <View style={containerStyle}>
      <View style={blobStyle}>
        <View style={glowALayerStyle}>
          <GlowLayer color={glowA} gradientId={glowAId} filterId={blurAId} blur={blur} />
        </View>
        <View style={glowBLayerStyle}>
          <GlowLayer color={glowB} gradientId={glowBId} filterId={blurBId} blur={blur} />
        </View>
      </View>
    </View>
  );
}

export const BlobLoader = withIconSizeToken(BlobLoaderBase, "BlobLoader");

export const ThemedBlobLoader = withUnistyles(BlobLoader, (theme) => ({
  glowA: theme.colors.spinnerPrimary,
  glowB: theme.colors.spinnerSecondary,
}));
