// A self-contained HSV color wheel picker: a hue/saturation wheel plus a
// brightness slider. Built on react-native-svg + React Native's responder
// system so it runs identically on iOS, Android, and web (no gesture-handler
// worklets, no platform branches). Meant for "click a color and go" — the
// caller keeps a hex text field alongside for people who want to be precise.
//
// The wheel is a fan of thin hue wedges (angle = hue) with a white radial
// gradient washed over the center (radius = saturation) and a black disc
// dialed in by opacity for value. Because HSV RGB scales linearly with value,
// overlaying black at opacity (1 - value) over the full-value wheel reproduces
// the darker colors exactly.
import { useCallback, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";

interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

// Number of hue wedges. 120 (3° each) with a hair of overlap reads as a smooth
// ring without paying for a path-per-degree.
const HUE_SEGMENTS = 120;
// Responsive-mode bounds, used only when no explicit `size` is passed.
const MIN_WHEEL = 140;
const MAX_WHEEL = 260;

interface ColorWheelPickerProps {
  /** Current color as a `#rrggbb` (or `#rgb`) hex string. */
  value: string;
  /** Emits a normalized `#rrggbb` hex string on every drag/tap. */
  onChange: (hex: string) => void;
  /**
   * Fixed wheel diameter in px. When omitted the wheel fills its container
   * (clamped to a sane range) and re-measures on layout.
   */
  size?: number;
  testID?: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Inline HSV color wheel. Keeps its own HSV state so dragging stays smooth even
 * though the parent only round-trips a lossy hex string — we re-derive from the
 * incoming value only when it changes from something other than our own last
 * emission (e.g. the user typed a new hex).
 */
export function ColorWheelPicker({
  value,
  onChange,
  size,
  testID,
}: ColorWheelPickerProps): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  // Fixed size wins; otherwise track the measured container width.
  const [measured, setMeasured] = useState(220);
  const wheel = size ?? measured;

  // Internal HSV is the source of truth while interacting. `lastEmitted` lets us
  // tell our own onChange echo apart from an external edit to `value`.
  const lastEmitted = useRef<string | null>(null);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 1 });

  if (value !== lastEmitted.current) {
    const parsed = hexToHsv(value);
    if (parsed && !hsvEquals(parsed, hsv)) {
      // A saturation/value of 0 makes hue ambiguous; keep the dial's hue so the
      // marker doesn't jump to red when the color goes white/black.
      const next = parsed.s === 0 || parsed.v === 0 ? { ...parsed, h: hsv.h } : parsed;
      setHsv(next);
    }
    lastEmitted.current = value;
  }

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      lastEmitted.current = hex;
      onChange(hex);
    },
    [onChange],
  );

  const onWheelLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setMeasured(clamp(Math.floor(w), MIN_WHEEL, MAX_WHEEL));
  }, []);

  const radius = wheel / 2;
  // Slider and marker scale with the wheel so a small wheel stays proportional.
  const sliderHeight = clamp(Math.round(wheel * 0.12), 12, 22);
  const markerR = clamp(Math.round(wheel * 0.065), 5, 12);

  const handleWheel = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      const dx = locationX - radius;
      const dy = locationY - radius;
      let h = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (h < 0) h += 360;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const s = clamp(dist / radius, 0, 1);
      emit({ h, s, v: hsv.v });
    },
    [emit, hsv.v, radius],
  );

  const handleSlider = useCallback(
    (e: GestureResponderEvent) => {
      const v = clamp(e.nativeEvent.locationX / wheel, 0, 1);
      emit({ ...hsv, v });
    },
    [emit, hsv, wheel],
  );

  const markerX = radius + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * radius;
  const markerY = radius + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * radius;
  const markerColor = hsvToHex(hsv);
  const fullValueColor = hsvToHex({ h: hsv.h, s: hsv.s, v: 1 });
  const sliderX = hsv.v * wheel;
  const satGradId = `cw-sat-${uid}`;
  const valGradId = `cw-val-${uid}`;

  // Fixed-size mode pins the wrapper dimensions; responsive mode fills width.
  const wheelWrapperStyle = useMemo(
    () => (size ? [styles.wheelWrapper, { width: size, height: size }] : styles.wheelWrapperFluid),
    [size],
  );
  const sliderWrapperStyle = useMemo(
    () =>
      size
        ? { width: size, height: sliderHeight }
        : { width: "100%" as const, height: sliderHeight },
    [size, sliderHeight],
  );

  return (
    <View style={styles.container} testID={testID}>
      {/* Wheel: responder View sizes the surface; the Svg is inert so touch
          coordinates stay relative to the wrapper on every platform. */}
      <View
        style={wheelWrapperStyle}
        onLayout={size ? undefined : onWheelLayout}
        onStartShouldSetResponder={ALWAYS_TRUE}
        onMoveShouldSetResponder={ALWAYS_TRUE}
        onResponderGrant={handleWheel}
        onResponderMove={handleWheel}
        accessibilityRole="adjustable"
        accessibilityLabel="Color wheel"
      >
        <Svg width={wheel} height={wheel} pointerEvents="none" style={styles.svg}>
          <Defs>
            <RadialGradient id={satGradId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
              <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <G>
            {HUE_WEDGES.map((wedge) => (
              <Path
                key={wedge.hue}
                d={wedgePath(radius, wedge.a0, wedge.a1)}
                fill={hsvToHex({ h: wedge.hue, s: 1, v: 1 })}
              />
            ))}
          </G>
          {/* Saturation wash: white at the hub, transparent at the rim. */}
          <Circle cx={radius} cy={radius} r={radius} fill={`url(#${satGradId})`} />
          {/* Value: black disc whose opacity rises as brightness falls. */}
          <Circle cx={radius} cy={radius} r={radius} fill="#000000" opacity={1 - hsv.v} />
          {/* Selection marker — dark halo + white ring so it reads on any hue. */}
          <Circle
            cx={markerX}
            cy={markerY}
            r={markerR}
            fill="none"
            stroke="#000000"
            strokeOpacity={0.4}
            strokeWidth={3}
          />
          <Circle
            cx={markerX}
            cy={markerY}
            r={markerR}
            fill={markerColor}
            stroke="#ffffff"
            strokeWidth={2}
          />
        </Svg>
      </View>

      {/* Brightness slider: black -> the current hue/saturation at full value. */}
      <View
        style={sliderWrapperStyle}
        onStartShouldSetResponder={ALWAYS_TRUE}
        onMoveShouldSetResponder={ALWAYS_TRUE}
        onResponderGrant={handleSlider}
        onResponderMove={handleSlider}
        accessibilityRole="adjustable"
        accessibilityLabel="Brightness"
      >
        <Svg width="100%" height={sliderHeight} pointerEvents="none">
          <Defs>
            <LinearGradient id={valGradId} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#000000" />
              <Stop offset="100%" stopColor={fullValueColor} />
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width="100%"
            height={sliderHeight}
            rx={sliderHeight / 2}
            fill={`url(#${valGradId})`}
          />
          <Circle
            cx={sliderX}
            cy={sliderHeight / 2}
            r={sliderHeight / 2 - 2}
            fill={markerColor}
            stroke="#ffffff"
            strokeWidth={2}
          />
        </Svg>
      </View>
    </View>
  );
}

const ALWAYS_TRUE = (): boolean => true;

// Precomputed hue wedges (angles in radians, hue in degrees at the midpoint).
const HUE_WEDGES = Array.from({ length: HUE_SEGMENTS }, (_, i) => {
  const step = (Math.PI * 2) / HUE_SEGMENTS;
  const a0 = i * step;
  // Overlap the next wedge slightly so anti-aliased seams don't show.
  const a1 = a0 + step * 1.5;
  const hue = ((i + 0.5) * 360) / HUE_SEGMENTS;
  return { a0, a1, hue };
});

function wedgePath(radius: number, a0: number, a1: number): string {
  const x0 = radius + radius * Math.cos(a0);
  const y0 = radius + radius * Math.sin(a0);
  const x1 = radius + radius * Math.cos(a1);
  const y1 = radius + radius * Math.sin(a1);
  return `M ${radius} ${radius} L ${x0} ${y0} A ${radius} ${radius} 0 0 1 ${x1} ${y1} Z`;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

function hsvEquals(a: Hsv, b: Hsv): boolean {
  return a.h === b.h && a.s === b.s && a.v === b.v;
}

/** Parse `#rgb` / `#rrggbb` (with or without `#`) into HSV, or null if invalid. */
export function hexToHsv(hex: string): Hsv | null {
  const cleaned = hex.trim().replace(/^#/, "");
  let full = cleaned;
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    full = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }
  const int = parseInt(full, 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/** HSV (h 0..360, s/v 0..1) to a `#rrggbb` hex string. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    alignItems: "center",
  },
  wheelWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  wheelWrapperFluid: {
    width: "100%",
    maxWidth: MAX_WHEEL,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    alignSelf: "center",
  },
}));
