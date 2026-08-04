import { useEffect, useRef, useState } from "react";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";

// Otto's face as an inline glyph, for icon rails that sit next to running text.
//
// `OttoLogo` draws the same mark inside the 512×512 branding square, where the
// ink fills 88% of the width and only 42% of the height. Dropped into a 12px
// tool-call rail that renders as a smudge floating in a mostly-empty box. This
// variant crops the viewBox to the ink, so the element's box IS the glyph and
// the surrounding flex container centres it for free - no per-icon nudge.
//
// Consequence: the mark is 2.09:1, so `size` here is the WIDTH and the height
// follows from the aspect ratio. Pick the width that optically matches the
// square icons beside it, not the height you'd pass a lucide icon.
//
// Geometry must stay in sync with branding/otto-icon.svg and
// branding/otto-icon-wink.svg - see branding/README.md.

const INK_LEFT = 30.72778; // left eye centre − radius − half stroke
const INK_WIDTH = 450.54493; // out to the right eye's outer edge
const RESTING_TOP = 148; // brow line − half stroke
const RESTING_BOTTOM = 364; // the T stems' baseline
const RESTING_CENTRE_Y = (RESTING_TOP + RESTING_BOTTOM) / 2;

// The wink raises the left brow, whose stroke corner reaches y≈93 - well above
// the resting face. Cropping to the resting ink would shear the brow off, and
// growing the box only while winking would bounce the face inside its centred
// slot. So the box keeps a matching pad above AND below, centred on the resting
// face: the brow has headroom, the box never changes, and the resting face -
// which is what most rows show - still sits dead centre.
const BROW_RAISED_TOP = 93.33;
const BOX_HALF_HEIGHT = RESTING_CENTRE_Y - BROW_RAISED_TOP;
// Optical centring beats geometric: the mark's mass is in the eyes, which sit
// below its bounding-box centre, so a mathematically centred face reads high
// against the label's x-height. 18 units is 1px at the 18px width the chat rail
// uses. Sliding the window up moves the face down and only adds brow headroom.
const OPTICAL_DROP = 18;
const BOX_TOP = RESTING_CENTRE_Y - BOX_HALF_HEIGHT - OPTICAL_DROP;
const BOX_HEIGHT = BOX_HALF_HEIGHT * 2;
const VIEW_BOX = `${INK_LEFT} ${BOX_TOP} ${INK_WIDTH} ${BOX_HEIGHT}`;
const ASPECT = INK_WIDTH / BOX_HEIGHT;

const STROKE = 28;
const LEFT_EYE_X = 114.72778;
const RIGHT_EYE_X = 397.27271;
const EYE_Y = 280;

// The winking eye: a filled upper wedge over a stroked lower lid, drawn inside
// the open eye's own bounds so the right half of the face holds still.
const WINK_FILL_PATH = `M ${RIGHT_EYE_X - 84} ${EYE_Y} A 84 84 0 0 1 ${RIGHT_EYE_X + 84} ${EYE_Y} Z`;
const WINK_LID_PATH = `M ${RIGHT_EYE_X - 70} ${EYE_Y} A 70 70 0 0 0 ${RIGHT_EYE_X + 70} ${EYE_Y}`;

interface OttoFaceGlyphProps {
  /** Width of the mark in px. Height follows the 2.09:1 aspect ratio. */
  size?: number;
  color?: string;
  winking?: boolean;
}

export function OttoFaceGlyph({
  size = 18,
  color = "currentColor",
  winking = false,
}: OttoFaceGlyphProps) {
  return (
    <Svg width={size} height={size / ASPECT} viewBox={VIEW_BOX} fill="none">
      <Circle cx={LEFT_EYE_X} cy={EYE_Y} r={70} stroke={color} strokeWidth={STROKE} />
      <Circle cx={LEFT_EYE_X} cy={EYE_Y} r={22} fill={color} />
      {winking ? (
        // Raised brow: the first T bar tilts up and its stem grows to meet it.
        <>
          <Line
            x1={145.8506}
            y1={105.85059}
            x2={249.8506}
            y2={157.8506}
            stroke={color}
            strokeWidth={STROKE}
          />
          <Line x1={216} y1={146} x2={216} y2={364} stroke={color} strokeWidth={STROKE} />
        </>
      ) : (
        <>
          <Line
            x1={155.08434}
            y1={162}
            x2={251.08434}
            y2={162}
            stroke={color}
            strokeWidth={STROKE}
          />
          <Line x1={216} y1={162} x2={216} y2={364} stroke={color} strokeWidth={STROKE} />
        </>
      )}
      <Line x1={260.91559} y1={162} x2={356.91559} y2={162} stroke={color} strokeWidth={STROKE} />
      <Line x1={296} y1={162} x2={296} y2={364} stroke={color} strokeWidth={STROKE} />
      {winking ? (
        <>
          {/* Iris first: the lid wedge draws over its top half, so what shows is
              the iris peeking out from under a half-closed eye. */}
          <Circle cx={RIGHT_EYE_X} cy={EYE_Y} r={22} fill={color} />
          <Path d={WINK_FILL_PATH} fill={color} />
          <Path d={WINK_LID_PATH} stroke={color} strokeWidth={STROKE} fill="none" />
        </>
      ) : (
        <>
          <Circle cx={RIGHT_EYE_X} cy={EYE_Y} r={70} stroke={color} strokeWidth={STROKE} />
          <Circle cx={RIGHT_EYE_X} cy={EYE_Y} r={22} fill={color} />
        </>
      )}
    </Svg>
  );
}

// A wink is a beat, not a loop: hold it barely longer than a real blink, then
// wait an unpredictable stretch so two rows running side by side never fall
// into lockstep.
const WINK_HOLD_MS = 220;
const WINK_GAP_MIN_MS = 2400;
const WINK_GAP_JITTER_MS = 3600;

interface OttoFaceIconProps extends OttoFaceGlyphProps {
  /** While true the face winks periodically. Wire this to the running state. */
  isActive?: boolean;
}

export function OttoFaceIcon({ size, color, isActive = false }: OttoFaceIconProps) {
  const animationsEnabled = useAnimationsEnabled();
  const [isWinking, setIsWinking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldWink = isActive && animationsEnabled;

  useEffect(() => {
    if (!shouldWink) {
      setIsWinking(false);
      return;
    }
    const scheduleWink = () => {
      timerRef.current = setTimeout(
        () => {
          setIsWinking(true);
          timerRef.current = setTimeout(() => {
            setIsWinking(false);
            scheduleWink();
          }, WINK_HOLD_MS);
        },
        WINK_GAP_MIN_MS + Math.random() * WINK_GAP_JITTER_MS,
      );
    };
    scheduleWink();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsWinking(false);
    };
  }, [shouldWink]);

  return <OttoFaceGlyph size={size} color={color} winking={isWinking} />;
}
