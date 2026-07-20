// Text effect themes — the registry behind the "working" text sweep that plays
// across tool-call / activity labels while an agent is running (the shimmer in
// components/message.tsx). See projects/text-effects/text-effects.md.
//
// Everything here is static data: specs are module-level constants, so
// component memos keyed on a spec reference never churn, and neither platform
// pays any per-frame JS for a theme (web = CSS keyframes, native = reanimated
// UI-thread worklet — the theme only swaps gradient data and animation params).
//
// Colors are literal mid-saturation hues (like the original literal white)
// clipped onto the text glyphs, chosen to read over light, dark, and black
// backgrounds — no theme-token subscription needed. If a palette ever needs
// per-scheme variants, extend the spec with a light/dark stop pair; do not add
// a useUnistyles() call (banned, docs/unistyles.md).

export type TextEffectThemeId =
  | "professional"
  | "active"
  | "spectrum"
  | "vivid"
  | "nightRider"
  | "wave"
  | "flames";

export const TEXT_EFFECT_THEME_IDS: readonly TextEffectThemeId[] = [
  "professional",
  "active",
  "spectrum",
  "vivid",
  "nightRider",
  "wave",
  "flames",
];

export const DEFAULT_TEXT_EFFECT_THEME: TextEffectThemeId = "professional";

// What the label is doing, for themes (Vivid) that color per activity. Mapped
// from ActionGroupCategory by agent-stream/action-grouping.ts so new tools
// classify for free; "other" is the safe default.
export type TextEffectActivity =
  | "thinking"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "web"
  | "command"
  | "browser"
  | "agent"
  | "other";

export interface TextEffectGradientStop {
  /** 0..1 position along the sweeping peak. */
  offset: number;
  /** Opaque hex color; opacity is carried separately for both renderers. */
  color: string;
  opacity: number;
}

export interface TextEffectSpec {
  /** Full CSS gradient for the web sweep (background-clip: text peak). */
  webGradient: string;
  /** The same peak as SVG <Stop>s for the native MaskedView sweep. */
  nativeStops: readonly TextEffectGradientStop[];
  /** Back-and-forth scan (CSS `alternate` / reanimated reverse) vs one-way sweep. */
  bounce: boolean;
  easing: "linear" | "ease-in-out";
  /** Multiplier on the text-length-derived duration; 1 = today's speed. */
  durationScale: number;
  /** Multiplier on the measured peak width; 1 = today's width. */
  peakScale: number;
}

interface TextEffectThemeDefinition {
  default: TextEffectSpec;
  byActivity?: Partial<Record<TextEffectActivity, TextEffectSpec>>;
}

function hexToRgba(hex: string, opacity: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function buildWebGradient(stops: readonly TextEffectGradientStop[]): string {
  const parts = stops.map(
    (stop) => `${hexToRgba(stop.color, stop.opacity)} ${Math.round(stop.offset * 100)}%`,
  );
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

// The original sweep shape (soft edges, solid core) recolored to a single hue.
// Mirrors PROFESSIONAL's stop offsets exactly so Vivid is "the original sweep
// pattern" with saturated per-activity colors.
function makeSweepSpec(color: string, overrides?: Partial<TextEffectSpec>): TextEffectSpec {
  const webStops: TextEffectGradientStop[] = [
    { offset: 0, color, opacity: 0 },
    { offset: 0.24, color, opacity: 0.45 },
    { offset: 0.4, color, opacity: 1 },
    { offset: 0.6, color, opacity: 1 },
    { offset: 0.76, color, opacity: 0.45 },
    { offset: 1, color, opacity: 0 },
  ];
  return {
    webGradient: buildWebGradient(webStops),
    nativeStops: [
      { offset: 0, color, opacity: 0 },
      { offset: 0.5, color, opacity: 1 },
      { offset: 1, color, opacity: 0 },
    ],
    bounce: false,
    easing: "linear",
    durationScale: 1,
    peakScale: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Professional — the default; byte-identical to the pre-themes behavior.
// The web gradient string and native stops are today's exact per-platform
// values (they historically differed in shape; keep both verbatim).
// ---------------------------------------------------------------------------

const PROFESSIONAL: TextEffectSpec = {
  webGradient:
    "linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.45) 24%, #ffffff 40%, #ffffff 60%, rgba(255, 255, 255, 0.45) 76%, rgba(255, 255, 255, 0) 100%)",
  nativeStops: [
    { offset: 0, color: "#ffffff", opacity: 0 },
    { offset: 0.5, color: "#ffffff", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 0 },
  ],
  bounce: false,
  easing: "linear",
  durationScale: 1,
  peakScale: 1,
};

// ---------------------------------------------------------------------------
// Active — the original look with more punch: harder edges, a wider solid
// core, a wider peak, and a noticeably faster sweep.
// ---------------------------------------------------------------------------

const ACTIVE: TextEffectSpec = {
  webGradient: buildWebGradient([
    { offset: 0, color: "#ffffff", opacity: 0 },
    { offset: 0.18, color: "#ffffff", opacity: 0.65 },
    { offset: 0.35, color: "#ffffff", opacity: 1 },
    { offset: 0.65, color: "#ffffff", opacity: 1 },
    { offset: 0.82, color: "#ffffff", opacity: 0.65 },
    { offset: 1, color: "#ffffff", opacity: 0 },
  ]),
  nativeStops: [
    { offset: 0, color: "#ffffff", opacity: 0 },
    { offset: 0.3, color: "#ffffff", opacity: 1 },
    { offset: 0.7, color: "#ffffff", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 0 },
  ],
  bounce: false,
  easing: "linear",
  durationScale: 0.6,
  peakScale: 1.3,
};

// ---------------------------------------------------------------------------
// Spectrum — a wide rainbow band sweeping through the text. Slightly slower
// than the default so the hues actually read as they pass.
// ---------------------------------------------------------------------------

const SPECTRUM_STOPS: readonly TextEffectGradientStop[] = [
  { offset: 0, color: "#ff5f5f", opacity: 0 },
  { offset: 0.12, color: "#ff5f5f", opacity: 1 },
  { offset: 0.28, color: "#ffb44d", opacity: 1 },
  { offset: 0.44, color: "#ffd93d", opacity: 1 },
  { offset: 0.6, color: "#4ccf6e", opacity: 1 },
  { offset: 0.76, color: "#4fa8f0", opacity: 1 },
  { offset: 0.9, color: "#b184f5", opacity: 1 },
  { offset: 1, color: "#b184f5", opacity: 0 },
];

const SPECTRUM: TextEffectSpec = {
  webGradient: buildWebGradient(SPECTRUM_STOPS),
  nativeStops: SPECTRUM_STOPS,
  bounce: false,
  easing: "linear",
  durationScale: 1.15,
  peakScale: 1.9,
};

// ---------------------------------------------------------------------------
// Vivid — the original sweep, but a distinct saturated hue per activity.
// ---------------------------------------------------------------------------

const VIVID_ACTIVITY_COLORS: Record<TextEffectActivity, string> = {
  thinking: "#b184f5", // violet — reasoning
  read: "#4fa8f0", // blue
  edit: "#4ccf6e", // green
  write: "#2ec4b6", // teal
  search: "#f2b23e", // amber
  web: "#38c7dd", // cyan
  command: "#f28b4b", // orange
  browser: "#d96fd0", // magenta
  agent: "#ef6f9d", // pink
  other: "#ffffff", // fall back to the original white
};

function buildVividByActivity(): Partial<Record<TextEffectActivity, TextEffectSpec>> {
  const result: Partial<Record<TextEffectActivity, TextEffectSpec>> = {};
  for (const [activity, color] of Object.entries(VIVID_ACTIVITY_COLORS)) {
    result[activity as TextEffectActivity] = makeSweepSpec(color);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Night Rider — a red glow scanning back and forth, K.I.T.T.-style.
// ---------------------------------------------------------------------------

const NIGHT_RIDER_RED = "#ff4438";

const NIGHT_RIDER: TextEffectSpec = {
  webGradient: buildWebGradient([
    { offset: 0, color: NIGHT_RIDER_RED, opacity: 0 },
    { offset: 0.25, color: NIGHT_RIDER_RED, opacity: 0.55 },
    { offset: 0.45, color: NIGHT_RIDER_RED, opacity: 1 },
    { offset: 0.55, color: NIGHT_RIDER_RED, opacity: 1 },
    { offset: 0.75, color: NIGHT_RIDER_RED, opacity: 0.55 },
    { offset: 1, color: NIGHT_RIDER_RED, opacity: 0 },
  ]),
  nativeStops: [
    { offset: 0, color: NIGHT_RIDER_RED, opacity: 0 },
    { offset: 0.4, color: NIGHT_RIDER_RED, opacity: 1 },
    { offset: 0.6, color: NIGHT_RIDER_RED, opacity: 1 },
    { offset: 1, color: NIGHT_RIDER_RED, opacity: 0 },
  ],
  bounce: true,
  easing: "ease-in-out",
  durationScale: 0.8,
  peakScale: 0.9,
};

// ---------------------------------------------------------------------------
// Wave — a blue swell that alternates light/dark/light/dark as it travels, so
// the peak reads as a repeating wave rather than a single sliding highlight.
// Widened so several crests sit on the label at once.
// ---------------------------------------------------------------------------

const WAVE_LIGHT = "#7fd4ff";
const WAVE_DARK = "#1f5fa8";

const WAVE_STOPS: readonly TextEffectGradientStop[] = [
  { offset: 0, color: WAVE_LIGHT, opacity: 0 },
  { offset: 0.12, color: WAVE_LIGHT, opacity: 1 },
  { offset: 0.28, color: WAVE_DARK, opacity: 1 },
  { offset: 0.44, color: WAVE_LIGHT, opacity: 1 },
  { offset: 0.6, color: WAVE_DARK, opacity: 1 },
  { offset: 0.76, color: WAVE_LIGHT, opacity: 1 },
  { offset: 0.88, color: WAVE_DARK, opacity: 1 },
  { offset: 1, color: WAVE_DARK, opacity: 0 },
];

const WAVE: TextEffectSpec = {
  webGradient: buildWebGradient(WAVE_STOPS),
  nativeStops: WAVE_STOPS,
  bounce: false,
  easing: "linear",
  durationScale: 1.2,
  peakScale: 2,
};

// ---------------------------------------------------------------------------
// Flames — a fire front sweeping across the label. The gradient is
// deliberately asymmetric: a white-hot/yellow leading edge falls off through
// orange and red into a dim charred ember that fades out, so glyphs read as
// "burned" for a moment behind the front and then recover as it passes.
// ---------------------------------------------------------------------------

const FLAMES_STOPS: readonly TextEffectGradientStop[] = [
  // Trailing side: the char left behind, recovering back to nothing.
  { offset: 0, color: "#5c2708", opacity: 0 },
  { offset: 0.16, color: "#5c2708", opacity: 0.55 },
  { offset: 0.34, color: "#a3341a", opacity: 0.85 },
  // The front itself.
  { offset: 0.52, color: "#ef4a1c", opacity: 1 },
  { offset: 0.68, color: "#f9a53c", opacity: 1 },
  { offset: 0.82, color: "#ffe08a", opacity: 1 },
  // Leading edge: the flame tip, sharper than the trail.
  { offset: 1, color: "#fff6d8", opacity: 0 },
];

const FLAMES: TextEffectSpec = {
  webGradient: buildWebGradient(FLAMES_STOPS),
  nativeStops: FLAMES_STOPS,
  bounce: false,
  easing: "linear",
  durationScale: 0.75,
  peakScale: 1.6,
};

// ---------------------------------------------------------------------------
// Registry — adding a theme is: add the id above, add an entry here, and
// add a settings label (appearance-section.tsx + i18n).
// ---------------------------------------------------------------------------

const TEXT_EFFECT_THEMES: Record<TextEffectThemeId, TextEffectThemeDefinition> = {
  professional: { default: PROFESSIONAL },
  active: { default: ACTIVE },
  spectrum: { default: SPECTRUM },
  vivid: {
    default: makeSweepSpec(VIVID_ACTIVITY_COLORS.other),
    byActivity: buildVividByActivity(),
  },
  nightRider: { default: NIGHT_RIDER },
  wave: { default: WAVE },
  flames: { default: FLAMES },
};

export function getTextEffectSpec(
  themeId: TextEffectThemeId,
  activity: TextEffectActivity,
): TextEffectSpec {
  const definition = TEXT_EFFECT_THEMES[themeId] ?? TEXT_EFFECT_THEMES.professional;
  return definition.byActivity?.[activity] ?? definition.default;
}

export function isTextEffectThemeId(value: string): value is TextEffectThemeId {
  return (TEXT_EFFECT_THEME_IDS as readonly string[]).includes(value);
}
