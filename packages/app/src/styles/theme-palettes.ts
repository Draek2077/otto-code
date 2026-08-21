/**
 * The theme palette layer: every color table and semantic-color builder the app's
 * themes are made from. Otto owns most of this (the light themes, black variants
 * and ink overrides are fork additions), so it lives beside Paseo's theme.ts,
 * which assembles these palettes into themes and stays the import surface.
 * This module never imports theme.ts back.
 */

export const baseColors = {
  // Base colors
  white: "#ffffff",
  black: "#000000",

  // Zinc scale (primary gray palette)
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1a1a1d",
    900: "#18181b",
    950: "#121214",
  },

  // Gray scale
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },

  // Slate scale
  slate: {
    200: "#e2e8f0",
  },

  // Blue scale
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },

  // Green scale
  green: {
    100: "#dcfce7",
    200: "#bbf7d0",
    400: "#4ade80",
    500: "#22c55e",
    600: "#16a34a",
    800: "#166534",
    900: "#14532d",
  },

  // Red scale
  red: {
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    500: "#ef4444",
    600: "#dc2626",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Teal scale
  teal: {
    200: "#99f6e4",
  },

  // Amber scale
  amber: {
    500: "#f59e0b",
    700: "#b45309",
  },

  // Yellow scale
  yellow: {
    400: "#fbbf24",
    800: "#854d0e",
    900: "#713f12",
  },

  // Purple scale
  purple: {
    500: "#a855f7",
    600: "#9333ea",
  },

  // Orange scale
  orange: {
    500: "#f97316",
    600: "#ea580c",
  },
} as const;

// Light spectrum: the neutral default (Daylight, first) plus tinted variants.
// The plain neutral "Light" theme was retired - Daylight is now the sole
// neutral light theme and the light half of the System pair.
export type LightThemeName =
  | "daylight"
  | "meadow"
  | "terracotta"
  | "horizon"
  | "powder"
  | "pastel"
  | "ivory";

// Dark spectrum: the neutral default (`dark`, displayed as "Twilight", first)
// plus tinted variants.
export type DarkThemeName =
  | "dark"
  | "evergreen"
  | "zinc"
  | "midnight"
  | "claude"
  | "ghostty"
  | "cyberpunk"
  | "obsidian";

// Any selectable theme variant, light or dark. Used for swatches and label
// lookups that operate across both spectrums.
export type ThemeVariantName = LightThemeName | DarkThemeName;

// Diff stat colors - light uses muted tones, dark uses the brighter palette values
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 - readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
};

// Status colors - semantic signals for success/danger/warning/info/merged.
// Used by check statuses, PR states, review decisions, and agent mode tiers.
// Kept a step darker than the raw palette so they read as signals, not neon.
const lightStatusColors = {
  statusSuccess: "#15803d", // green-700
  statusDanger: "#b91c1c", // red-700
  statusWarning: "#d97706", // amber-600
  // The amber emphasis pair, for text that must read as muted vs. emphasized
  // while staying amber - the counterpart of foregroundMuted → foreground.
  // On a LIGHT surface, emphasis means DARKER: amber is already pale, so going
  // lighter would drop the contrast off a cliff (amber-500 is ~2:1 on white).
  statusWarningMuted: "#d97706", // amber-600 - ~3:1 on white
  statusWarningStrong: "#b45309", // amber-700 - ~5:1 on white
  // Amber fills for hover/selected chrome. Alpha, not opaque hex, because these
  // sit on whichever surface the active tint provides (Daylight, Sherbet,
  // Meadow, …) and must tint it rather than replace it. Light surfaces need
  // less: a heavy orange wash on near-white shouts.
  statusWarningSurface: "rgba(217, 119, 6, 0.14)",
  statusWarningSurfaceStrong: "rgba(217, 119, 6, 0.24)",
  // Tinted chrome for every status tone, same recipe as the amber pair above:
  // one fill per tone, calibrated per theme. Light stays lighter - a heavy wash
  // on near-white shouts.
  statusDangerSurface: "rgba(185, 28, 28, 0.14)",
  statusSuccessSurface: "rgba(21, 128, 61, 0.14)",
  statusInfoSurface: "rgba(2, 132, 199, 0.14)",
  statusMergedSurface: "rgba(124, 58, 237, 0.14)",
  statusInfo: "#0284c7", // sky-600
  statusMerged: "#7c3aed", // purple-600
  // The "online" state: present and ready, but not working. Distinct from
  // `foregroundMuted` (which reads as "off / unavailable") — lighter and more
  // neutral so an idle brain still looks alive at a glance.
  statusOnline: "#71717a", // zinc-500 - clearly lighter than foregroundMuted (#55555e)
};

const darkStatusColors = {
  statusSuccess: "#16a34a", // green-600
  statusDanger: "#dc2626", // red-600
  statusWarning: "#f59e0b", // amber-500
  // Mirror of the light pair, pushed the other way: on a dark surface emphasis
  // means LIGHTER. Same muted shade as light - amber-600 is the mid-contrast
  // step against either background. Never express these as alpha: amber at 70%
  // over a dark surface composites to muddy brown and reads as black.
  statusWarningMuted: "#d97706", // amber-600
  statusWarningStrong: "#f59e0b", // amber-500
  // Fills carry more alpha here than on light: the same wash that shouts on
  // near-white barely registers against a dark surface.
  statusWarningSurface: "rgba(245, 158, 11, 0.20)",
  statusWarningSurfaceStrong: "rgba(245, 158, 11, 0.32)",
  // Tinted chrome for every status tone. Dark carries more alpha than light:
  // the same wash that shouts on near-white barely registers on near-black.
  statusDangerSurface: "rgba(220, 38, 38, 0.20)",
  statusSuccessSurface: "rgba(22, 163, 74, 0.20)",
  statusInfoSurface: "rgba(56, 189, 248, 0.20)",
  statusMergedSurface: "rgba(147, 51, 234, 0.20)",
  statusInfo: "#38bdf8", // sky-400 - light blue that holds on dark surfaces
  statusMerged: "#9333ea", // purple-600
  // The "online" state: present and ready, but not working. On a dark surface
  // "off" (foregroundMuted) is already a light gray, so idle sits one step
  // lighter than it - paler, clearly a resting-but-alive signal rather than
  // "unavailable". Calibrate against the rail after the theme ships.
  statusOnline: "#d4d4d8", // zinc-300 - lighter than foregroundMuted (#b6b6bf)
};

// Small status dots need a brighter, more chromatic ladder than status text.
// Keeping these as dedicated semantic tokens avoids coupling tiny indicators
// to the lower-chroma colors used for readable labels and filled surfaces.
const lightStatusDotColors = {
  statusDotSuccess: "#299f51",
  statusDotDanger: "#f12e2f",
  statusDotWarning: "#b37824",
  statusDotRunning: "#268ae0",
};

const darkStatusDotColors = {
  statusDotSuccess: "#35c264",
  statusDotDanger: "#f7796d",
  statusDotWarning: "#db932e",
  statusDotRunning: "#5caaf6",
};

// Usage-ledger figure tints - input tokens, output tokens, and cost in the
// Metrics log. Deliberately desaturated: these sit at 12px next to muted text,
// so they only need enough hue to separate the three columns at a glance. A
// full-saturation blue/yellow/green would read as a status signal instead of a
// number. Cached tokens stay `foregroundMuted` - they are the cheap half of the
// input figure and should not compete with the fresh (full-rate) send.
const lightUsageColors = {
  usageIn: "#3f6fa8", // muted blue, darkened to hold on white
  usageOut: "#8a6a15", // ochre - a legible yellow needs this much darkening on light
  usageCost: "#3d7a53", // muted green
};

const darkUsageColors = {
  usageIn: "#82abdd", // muted blue, lifted to hold on dark surfaces
  usageOut: "#d4b25e", // soft gold
  usageCost: "#6fbf8b", // muted green
};

// ---------------------------------------------------------------------------
// Light theme variant builder - mirrors the dark builder below so multiple
// light themes (Daylight, Sherbet, Meadow, Terracotta, Horizon, Powder) share
// one semantic-color shape.
// ---------------------------------------------------------------------------

interface LightThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  surfaceSidebarPanel?: string;
  surfaceControlTrack: string;
  foreground: string;
  foregroundMuted: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  destructive: string;
  spinnerPrimary: string;
  spinnerSecondary: string;
}

const lightTerminalAnsi = {
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#f59e0b",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
} as const;

// Mixes a #rrggbb color toward white by `amount` (0..1). For deriving tokens
// inside the theme builders only - stylesheets read theme colors as CSS vars
// on web, so color math there is impossible (see the surfaceUserBubble note).
function lightenHex(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Derive a deeper shade from an authored surface while preserving its hue. The
// amount is luminance-aware: near-black dark surfaces need a larger proportional
// move for the step to remain visible, while a near-white light surface needs a
// gentler move. Used by the code well and the sidebar-only base surface so both
// stay on each theme's authored spectrum. Builders only, same CSS-var rule as
// `lightenHex`.
function deepenHex(hex: string): string {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  // Relative luminance (0 = black, 1 = white), rough but enough to steer the amount.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Light (luminance ≈ 1): ~0.035 → a whisper darker. Dark (luminance ≈ 0):
  // ~0.25 → a clear step toward black, roughly the pre-lift surface values.
  const scale = 1 - (0.035 + (1 - luminance) * 0.215);
  const clamp = (channel: number) => Math.round(Math.max(0, Math.min(255, channel * scale)));
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, "0")}`;
}

// Blend two authored surfaces for chrome that sits between the workspace and
// the tab/sidebar rail. Keeping this derived in the builder preserves each
// theme's hue without making chrome another independently tuned elevation step.
function blendHex(first: string, second: string, amount: number): string {
  const firstValue = Number.parseInt(first.slice(1, 7), 16);
  const secondValue = Number.parseInt(second.slice(1, 7), 16);
  const mix = (shift: number) => {
    const a = (firstValue >> shift) & 0xff;
    const b = (secondValue >> shift) & 0xff;
    return Math.round(a + (b - a) * amount);
  };
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, "0")}`;
}

// Interaction state is a translucent wash of the theme accent, not another
// elevation step. That distinction is load-bearing: the same state layer can
// sit over a title bar, sidebar panel, tab, outlined control, or popup without
// turning every light theme into the same neutral-grey UI. Persistent selected
// state stays quieter than transient hover; press is the strongest moment.
function accentWash(accentHex: string, alpha: number): string {
  const value = Number.parseInt(accentHex.slice(1, 7), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Font contrast - the reading-ink strength control (Appearance → Fonts)
// ---------------------------------------------------------------------------

// The identity point of the slider: gain 1, every ink exactly as the theme
// authored it. Deliberately the MIDDLE of the range rather than an end, because
// the authored palettes are already tuned (dark primary is an off-white
// #ededee, not #ffffff) - the control exists to move in both directions from
// that tuning, not to walk down from a maximum nobody actually wants.
export const DEFAULT_FONT_CONTRAST = 0.5;

// Gain at the two ends. MAX sits just past the point where the brightest
// authored ink saturates (dark #ededee over #1e1e22 needs ~1.09 to reach
// #ffffff), so slider 1.0 really does mean pure-white / pure-black primary
// text. MIN stops well short of 0: this softens text, it never erases it -
// dark primary bottoms out near 6:1 against its surface, still readable.
const MAX_FONT_CONTRAST_GAIN = 1.1;

const MIN_FONT_CONTRAST_GAIN = 0.55;

/** Piecewise-linear map from the 0..1 setting to a multiplier around 1. */
function fontContrastGain(contrast: number): number {
  const value = Math.min(1, Math.max(0, contrast));
  if (value >= DEFAULT_FONT_CONTRAST) {
    const t = (value - DEFAULT_FONT_CONTRAST) / (1 - DEFAULT_FONT_CONTRAST);
    return 1 + t * (MAX_FONT_CONTRAST_GAIN - 1);
  }
  const t = (DEFAULT_FONT_CONTRAST - value) / DEFAULT_FONT_CONTRAST;
  return 1 - t * (1 - MIN_FONT_CONTRAST_GAIN);
}

/**
 * Pushes `hex` away from (gain > 1) or toward (gain < 1) `backdrop`, per
 * channel, clamped to the byte range. Expects normalized "#rrggbb" strings.
 */
function scaleFromBackdrop(backdrop: string, hex: string, gain: number): string {
  const bg = Number.parseInt(backdrop.slice(1, 7), 16);
  const fg = Number.parseInt(hex.slice(1, 7), 16);
  const channel = (shift: number) => {
    const b = (bg >> shift) & 0xff;
    const f = (fg >> shift) & 0xff;
    return Math.min(255, Math.max(0, Math.round(b + (f - b) * gain)));
  };
  const r = channel(16);
  const g = channel(8);
  const b = channel(0);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** The tokens `resolveInkOverrides` reads off a built palette. */
export interface InkSource {
  surface0: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  accentBright: string;
}

/**
 * Ink overrides for a resolved contrast, split into the flat color keys and the
 * nested `terminal` keys because they spread onto different objects.
 */
export interface InkOverrides {
  colors: {
    foreground: string;
    foregroundMuted: string;
    popoverForeground: string;
    primary: string;
    secondaryForeground: string;
    mutedForeground: string;
    accent: string;
    accentBright: string;
    success: string;
  };
  terminal: {
    foreground: string;
    cursor: string;
    selectionForeground: string;
  };
}

/**
 * Restate a palette's reading inks at the user's chosen contrast.
 *
 * Modelled as a GAIN on each ink's distance from the app background
 * (`ink' = bg + (ink - bg) * gain`), not as a mix toward white/black. That
 * choice is the whole design: a gain preserves the sign and the ORDER of every
 * ink relative to the backdrop, so primary text can never cross muted text at
 * either end of the slider - the type hierarchy survives the full range, which
 * mixing toward a shared extreme does not (both inks converge on it, and on the
 * soft end they actually invert).
 *
 * ACCENT IS READING INK TOO, and that is not obvious. The accent is not only a
 * brand fill: selected workspace and Explorer tab labels, toggled title-bar
 * icons, links, and the commit checkboxes all paint straight from `accent` /
 * `accentBright`, so a user who softens their text and watches those stay at
 * full strength is looking at a bug. That was invisible while every accent
 * carried a hue - a bright blue among softened greys still reads as "the accent
 * doing its job" - and became impossible to miss on the monochrome Obsidian /
 * Ivory pair, where the accent is literally #ffffff / #000000 and those
 * elements are the brightest things on screen at every slider position.
 *
 * Scaling the accent from the app background rather than mixing it toward
 * white/black is what keeps this safe on the tinted themes: the gain preserves
 * each channel's sign and order, so a softened accent stays recognisably the
 * same colour instead of collapsing to grey. `accentForeground` and
 * `accentFillInk` are deliberately NOT scaled - they are ink sitting on the
 * accent FILL, not on the app background, so `surface0` is the wrong backdrop
 * to pivot them on.
 *
 * Applied to a fully-BUILT palette, after the semantic builders have flattened
 * `foreground`/`foregroundMuted`/`accent` into their aliases - hence the
 * aliases are restated here rather than following automatically. Both builders
 * define them as those tokens verbatim (`success` IS `accent`); if that ever
 * stops being true, this list is the place it has to be reconciled.
 */
export function resolveInkOverrides(source: InkSource, contrast: number): InkOverrides {
  const gain = fontContrastGain(contrast);
  const foreground =
    gain === 1 ? source.foreground : scaleFromBackdrop(source.surface0, source.foreground, gain);
  const foregroundMuted =
    gain === 1
      ? source.foregroundMuted
      : scaleFromBackdrop(source.surface0, source.foregroundMuted, gain);
  const accent =
    gain === 1 ? source.accent : scaleFromBackdrop(source.surface0, source.accent, gain);
  const accentBright =
    gain === 1
      ? source.accentBright
      : scaleFromBackdrop(source.surface0, source.accentBright, gain);
  return {
    colors: {
      foreground,
      foregroundMuted,
      popoverForeground: foreground,
      primary: foreground,
      secondaryForeground: foreground,
      mutedForeground: foregroundMuted,
      accent,
      accentBright,
      // `success` is defined as `accent` verbatim in both builders; leaving it
      // unscaled would paint the same colour two different ways on one screen.
      success: accent,
    },
    // Terminal body text, caret, and selected text are reading ink too. The
    // ANSI slots (including `terminal.black`) are NOT - those are color
    // channels a program addresses by name, not the user's text brightness.
    terminal: {
      foreground,
      cursor: foreground,
      selectionForeground: foreground,
    },
  };
}

// Ink for text/glyphs sitting on a solid accent *fill* (e.g. the "Active" team
// pill). Deliberately NOT accentForeground: that token maximizes contrast, so
// on the light gold/blue accents it lands dark - legible, but the dark glyphs
// read heavy and "thick" on a bright chip. This instead prefers white and only
// flips to dark ink once the accent is pale enough (perceived luminance) that
// white would wash out - the Graphite/Powder near-white accents. Net effect:
// accent pills read as bright chips in most themes and invert on pale accents,
// matching how a chip "should" look at each end.
//
// Exported as the design system's single ink-on-fill formula - other colored
// fills (avatar badges via `readableTextColor`) delegate here so they never
// disagree with accent chips about black-vs-white ink on the same color.
// Expects a normalized "#rrggbb" string.
export function accentFillInk(accentHex: string): string {
  const value = Number.parseInt(accentHex.slice(1, 7), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const perceived = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return perceived >= 0.6 ? "#141417" : "#ffffff";
}

export function buildLightSemanticColors(tint: LightThemeConfig) {
  const sidebarPanel = tint.surfaceSidebarPanel ?? deepenHex(tint.surfaceSidebar);
  const interactiveHover = accentWash(tint.accent, 0.1);
  const interactiveSelected = accentWash(tint.accent, 0.06);
  const interactivePressed = accentWash(tint.accent, 0.16);
  const interactiveHoverBorder = accentWash(tint.accent, 0.45);

  return {
    // Surfaces (layers)
    surface0: tint.surface0, // App background
    surface1: tint.surface1, // Subtle hover
    surface2: tint.surface2, // Elevated: badges, inputs, sheets
    surface3: tint.surface3, // Highest elevation
    surface4: tint.surface4, // Extra emphasis
    surfaceDiffEmpty: tint.surfaceDiffEmpty, // Empty side of split diff rows
    // The existing rail shade remains shared by workspace tabs and chrome.
    // Primary sidebar trees use the deeper companion so the app reads as three
    // layers without recoloring tabs or the center workspace.
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarPanel: sidebarPanel,
    // Canonical interaction ladder. The older surface-specific names remain as
    // aliases while consumers converge, but they deliberately resolve to the
    // same state colors so component families cannot drift again.
    surfaceInteractiveHover: interactiveHover,
    surfaceInteractiveSelected: interactiveSelected,
    surfaceInteractivePressed: interactivePressed,
    borderInteractiveHover: interactiveHoverBorder,
    // Opaque composited equivalent for overlays that must occlude row content
    // without applying the translucent hover wash a second time.
    surfaceSidebarPanelInteractiveHoverOpaque: blendHex(sidebarPanel, tint.accent, 0.1),
    surfaceSidebarSelected: interactiveSelected,
    surfaceSidebarHover: interactiveHover,
    surfaceWorkspace: tint.surface1, // Workspace main background
    surfaceChrome: blendHex(tint.surface1, tint.surfaceSidebar, 0.5),
    // The recessed well behind a segmented control's thumbs. Derived per mode
    // rather than pinned to one surface step, because the two ramps are not
    // symmetric: light is compressed at the top (#ffffff / #fafafa / #f4f4f5 sit
    // within 4% of each other), so `surface2` - correct on dark - paints a track
    // indistinguishable from the page. Each light palette authors this recessed
    // track independently from interaction states.
    surfaceControlTrack: tint.surfaceControlTrack,
    surfaceToggleSelected: interactiveSelected,
    surfaceToggleHover: interactiveHover,
    surfaceHover: interactiveHover,
    // Chat speech bubbles: surface fills at partial alpha so the chat
    // background tints through. Derived here, not in components - web CSSVars
    // mode emits var(--...) for theme color reads inside stylesheets, so string
    // math there produces invalid CSS.
    //
    // The alpha is NOT shared across modes, and the two are tuned separately.
    // Light needs 75% (`bf`): its surfaces sit only a step off a bright canvas,
    // and any thinner the bubble stops reading as raised at all. Dark and the
    // black chat scope need 50% (`80`): against a near-black canvas the same
    // 75% reads as an opaque grey slab. Change one, re-check the other.
    //
    // The assistant fill is `surface2` DEEPENED, and alpha is not what fixes it.
    // On the neutral light theme raw `surface2` (#f4f4f5) sits 11 levels off a
    // #ffffff canvas - invisible even at full opacity, and any alpha only pulls
    // it further toward the canvas. `surface3` already carries a hand-deepened
    // value for this same reason (see the light tint below); `surface2` cannot
    // be deepened at the tint, because badges, inputs and sheets all read it and
    // they sit on elevated surfaces where it is already correct. So the step is
    // taken here, for this token only. It lands the assistant bubble between the
    // canvas and the user bubble, which is the elevation order the two sides are
    // supposed to read in.
    surfaceUserBubble: `${tint.surface3}bf`,
    surfaceAssistantBubble: deepenHex(tint.surface2),
    // In-place busy scrim (e.g. the workspace-archiving overlay): 80%-alpha
    // app background so the content underneath dims through. Same rule as the
    // bubbles above - derived here, never `${surface0}cc` in a stylesheet.
    surfaceScrim: `${tint.surface0}cc`,
    // The one background for every surface that shows code: the editor's code
    // well, markdown fences, and the tool-call code/terminal blocks. A code
    // block reads as the same material wherever it appears, and it never
    // collides with the elevated-card ramp (surface2/3) it used to borrow from.
    surfaceCode: deepenHex(tint.surface0),

    // Text
    foreground: tint.foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: blendHex(tint.foregroundMuted, tint.surface0, 0.35),

    // Controls
    scrollbarHandle: tint.scrollbarHandle,

    // Borders
    border: tint.border,
    borderAccent: tint.borderAccent, // Softer accent border for low-emphasis outlines
    // Active desktop-tab outline: half-alpha accent. Native paints it as a
    // solid border ring; web feeds it into the tab's gradient outline.
    borderTabActive: `${tint.accent}80`,
    // Inner highlight ring nested inside the active tab outline: the outline's
    // accent lightened a step, at 25% alpha. Alpha is baked into the token for
    // the same CSS-var reason as above.
    borderTabActiveInner: `${lightenHex(tint.accent, 0.25)}40`,

    // Brand
    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? "#ffffff",
    accentFillInk: accentFillInk(tint.accent),
    // ON-state switch knob. Distinct from accentForeground (glyph ink): light
    // accents are always mid-dark saturated colors (they must hold on white),
    // so a white knob always contrasts - even where glyphs use dark ink.
    switchThumbOn: "#ffffff",

    // Semantic
    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Working-indicator (BlobLoader) glow pair - two distinct hues per theme,
    // always including the theme's namesake color.
    spinnerPrimary: tint.spinnerPrimary,
    spinnerSecondary: tint.spinnerSecondary,

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface0,
    popoverForeground: tint.foreground,
    primary: tint.foreground,
    primaryForeground: tint.surface1,
    secondary: tint.surface2,
    secondaryForeground: tint.foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: tint.foreground,

    ...lightDiffColors,
    ...lightStatusColors,
    ...lightStatusDotColors,
    ...lightUsageColors,

    terminal: {
      background: tint.surface0,
      foreground: tint.foreground,
      cursor: tint.foreground,
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(0, 0, 0, 0.15)",
      selectionForeground: tint.foreground,
      black: tint.foreground,
      white: "#ffffff",
      brightBlack: "#3f3f46",
      brightWhite: tint.surface1,
      ...lightTerminalAnsi,
    },
  };
}

// Daylight - the neutral default light theme, crisp and high-contrast:
// deliberately non-flashy, this is the theme people who "just want light
// mode" get, and the light half of the System (auto) pair. Muted text and
// borders are a step darker than a plain white/zinc bg so secondary text
// clears WCAG AA (foregroundMuted #62626b on #ffffff ≈ 5.6:1) and panel edges
// read clearly. The accent is the one deliberate exception: matched to
// Twilight's blue for salience, it sits at the sRGB gamut edge for chroma and
// trades small-text AA for vibrancy (a 4.5:1 yellow is physically olive) -
// mirroring Twilight, which ships white-on-accent fills at ~2.5:1. Accent
// fills therefore carry a dark warm ink (accentForeground) instead of white.
export const daylightColors = buildLightSemanticColors({
  surface0: "#fffefc",
  surface1: "#faf8f4",
  surface2: "#f4f1ec",
  surface3: "#dcdce1", // was #e4e4e7 - deepened so elevated layers separate from the white base
  surface4: "#c3c3ca", // was #d4d4d8 - the bottom of the light ramp, pushed down for range
  surfaceDiffEmpty: "#f7f5f0",
  // Large surfaces stay neutral-light and carry only a quiet yellow-gold
  // undertone. Chroma belongs to the sun accent, not the sidebar canvas.
  surfaceSidebar: "#f2f1ec",
  surfaceSidebarPanel: "#e9e7df",
  surfaceControlTrack: "#eae6e1",
  foreground: "#26262b", // was #37373c - charcoal pushed back toward ink for range; still off pure black
  foregroundMuted: "#55555e", // was #62626b - stronger secondary text
  scrollbarHandle: "#2f2f36",
  border: "#d1d1d8", // was #dcdce0 - clearer panel separation
  // Outlined controls and their internal separators match the structural
  // divider lines instead of fading into Daylight's warm surfaces.
  borderAccent: "#d1d1d8",
  accent: "#c69700", // golden sun (hue ~46°, yellow not orange), chroma pushed a step past #b98d00; shared with spinnerPrimary
  accentBright: "#d1a000", // brighter step (links, selected-tab icons)
  accentForeground: "#181300", // deep warm ink on gold fills - ~6.1:1 (white on gold washes out)
  destructive: "#b04138", // dark warm red on white - calm but unambiguously red
  spinnerPrimary: "#c69700", // namesake gold - the daylight sun, held just dark enough for white
  spinnerSecondary: "#0d8ede", // clear azure - the daytime sky behind it
});

// Sherbet - soft pastel peach surfaces with a saturated raspberry accent and
// dark plum text. Deliberately NOT washed out: body text ≈13:1 on surface0,
// muted text ≈5:1 on the elevated surface, accent on white ≈5.5:1.
export const sherbetColors = buildLightSemanticColors({
  surface0: "#fdf7f2",
  surface1: "#f9efe8",
  surface2: "#f4e6dd",
  surface3: "#ddc2b3", // deepened from #e9d4c8 for range against the near-white base
  surface4: "#cba895", // deepened from #dbbfb0
  surfaceDiffEmpty: "#f6ebe2",
  surfaceSidebar: "#f7ebe2",
  surfaceControlTrack: "#f0e0d3",
  foreground: "#322740", // plum charcoal, pushed back down from #453a4d
  foregroundMuted: "#5e5162",
  scrollbarHandle: "#46394c",
  border: "#ddc8bb",
  borderAccent: "#e9d6c9",
  accent: "#d4187e", // raspberry, chroma pushed past the old #b83280 so it clears the peach surfaces
  accentBright: "#b30f66",
  destructive: "#b04138",
  spinnerPrimary: "#d02580", // namesake raspberry sherbet, deep and saturated
  spinnerSecondary: "#e87410", // tangerine scoop
});

// Meadow - sage-tinted light variant of the brand green, mirroring dark
// Evergreen: same accent hue as neutral Light, surfaces lifted with a soft
// green undertone instead of pure white/zinc.
export const meadowColors = buildLightSemanticColors({
  surface0: "#f6faf7",
  surface1: "#eef6f1",
  surface2: "#e3eee7",
  surface3: "#bcd2c4", // deepened from #cfe0d6 for range
  surface4: "#9fbcac", // deepened from #b7cdc0
  surfaceDiffEmpty: "#eef5f0",
  surfaceSidebar: "#eef6f1",
  surfaceControlTrack: "#e3eee7",
  foreground: "#1f3227", // green charcoal, pushed back down from #334339
  foregroundMuted: "#4e6357",
  scrollbarHandle: "#2f3d36",
  border: "#cadcd2",
  borderAccent: "#d8e7dd",
  accent: "#0b9354", // brand green with the chroma opened up - the old #20744A sank into the sage surfaces
  accentBright: "#0aa85f",
  destructive: "#b04138",
  spinnerPrimary: "#1a9155", // namesake meadow green, deep and saturated
  spinnerSecondary: "#ca8a04", // buttercup gold
});

// Terracotta - warm clay-tinted light variant, mirroring dark Ember. Cream
// surfaces with a burnt-orange accent darkened enough to read on white.
export const terracottaColors = buildLightSemanticColors({
  surface0: "#fdf8f5",
  surface1: "#f9f1ec",
  surface2: "#f3e6dd",
  surface3: "#dbc0ac", // deepened from #e6d0c1 for range
  surface4: "#c8a488", // deepened from #d6b8a4
  surfaceDiffEmpty: "#f7ede4",
  surfaceSidebar: "#f8efe8",
  surfaceControlTrack: "#f1e2d5",
  foreground: "#34291f", // warm clay charcoal, pushed back down from #473b31
  foregroundMuted: "#66564b",
  scrollbarHandle: "#4b3c31",
  border: "#e0cbb7",
  borderAccent: "#ead7c7",
  accent: "#d9541c", // burnt orange, chroma pushed past #b8552f so it reads against the cream surfaces
  accentBright: "#b84210",
  destructive: "#b04138",
  spinnerPrimary: "#c9511c", // namesake terracotta clay, deep and saturated
  spinnerSecondary: "#d97706", // warm amber gold
});

// Horizon - crisp blue-tinted light variant, mirroring dark Nightfall. Pale
// sky-blue surfaces with a saturated, high-contrast blue accent.
export const horizonColors = buildLightSemanticColors({
  surface0: "#f6f9fd",
  surface1: "#eef4fb",
  surface2: "#e1ebf7",
  surface3: "#b2cbe9", // deepened from #c6d9ef for range
  surface4: "#8fb2d9", // deepened from #a9c3e2
  surfaceDiffEmpty: "#eef3fa",
  surfaceSidebar: "#eef4fb",
  surfaceControlTrack: "#e1ebf7",
  foreground: "#212a3b", // blue charcoal, pushed back down from #343d4e
  foregroundMuted: "#4c5d78",
  scrollbarHandle: "#2f3d53",
  border: "#c7d9ee",
  borderAccent: "#d5e4f4",
  accent: "#0d5ce8", // azure taken to full chroma - #2159c9 was only a step off the sky-blue surfaces
  accentBright: "#0b4cc4",
  destructive: "#b04138",
  spinnerPrimary: "#2563eb", // namesake horizon blue, deep and saturated
  spinnerSecondary: "#ea580c", // sunrise orange on the horizon line
});

// Powder - muted blue-grey light variant, mirroring dark Slate. Foggier and
// greyer than Horizon: the *surfaces* stay desaturated, but the accent leans
// periwinkle at full chroma so it can't be mistaken for another grey step (and
// so it stays distinguishable from Horizon's pure azure).
export const powderColors = buildLightSemanticColors({
  surface0: "#f6f7f9",
  surface1: "#eef0f4",
  surface2: "#e3e7ee",
  surface3: "#b8c1d2", // deepened from #cbd2de for range
  surface4: "#99a4ba", // deepened from #b0b9ca
  surfaceDiffEmpty: "#eef1f5",
  surfaceSidebar: "#eef0f4",
  surfaceControlTrack: "#e3e7ee",
  foreground: "#272c38", // slate charcoal, pushed back down from #3a3f4a
  foregroundMuted: "#545d70",
  scrollbarHandle: "#353e4f",
  border: "#ced4e0",
  borderAccent: "#d8dde8",
  accent: "#4a5fd0", // periwinkle - the old #4a6fa5 was a saturated-grey, indistinguishable from the surfaces
  accentBright: "#3a4dba",
  destructive: "#b04138",
  spinnerPrimary: "#3e6db8", // namesake powder blue, deepened to hold on white
  spinnerSecondary: "#7b5fd0", // periwinkle violet
});

// Ivory - the monochrome light theme, and the light half of the black/white
// pair with Obsidian. There is exactly one hue budget here and it is spent on
// nothing: the accent is pure black, so every selected tab, focus ring, link,
// CTA and interaction wash is ink on paper.
//
// Backgrounds are the ONLY place Ivory keeps a ramp, and it is four steps of
// near-white about eight levels apart - just enough to read as depth without
// becoming grey: content (#ffffff / #fbfbfb), title bar (#f7f7f7, the derived
// surface1/rail blend), the tab-and-gutter rail (#f3f3f3), and the primary
// sidebar (#ebebeb, the deepest layer). The elevated steps (surface2/3/4) are
// the same axis continued for cards, inputs and bubbles.
//
// Everything else is the black/white axis: text is pure black, muted text and
// borders are that black held back rather than tinted. Diff, status, syntax
// and terminal ANSI colors stay colored on purpose - those are signals a user
// reads for meaning, not chrome, and a monochrome error state is a bug.
export const ivoryColors = buildLightSemanticColors({
  surface0: "#ffffff", // content canvas - paper
  surface1: "#fbfbfb", // workspace
  surface2: "#f2f2f2", // elevated: badges, inputs, sheets
  surface3: "#dcdcdc",
  surface4: "#c2c2c2",
  surfaceDiffEmpty: "#f8f8f8",
  surfaceSidebar: "#f3f3f3", // tab rail and gutters
  surfaceSidebarPanel: "#ebebeb", // primary sidebar - the deepest layer
  surfaceControlTrack: "#e9e9e9",
  foreground: "#000000", // pure ink; the font-contrast slider only softens from here
  foregroundMuted: "#5a5a5a",
  scrollbarHandle: "#2e2e2e",
  border: "#d2d2d2",
  // Outlined controls match the structural divider lines, as on Daylight.
  borderAccent: "#d2d2d2",
  accent: "#000000", // the whole point: the accent is ink
  accentBright: "#000000",
  accentForeground: "#ffffff", // white on a black fill
  destructive: "#b04138", // the one deliberate hue - danger must not read as chrome
  spinnerPrimary: "#000000", // namesake ink
  spinnerSecondary: "#777777", // its half-tone, so the glow still has two steps
});

// ---------------------------------------------------------------------------
// Dark theme variant builder
// ---------------------------------------------------------------------------

interface DarkThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  // Optional, same escape hatch the light builder already carries: the primary
  // sidebar surface is normally DERIVED from the rail (`deepenHex`), which
  // works while a theme has headroom below its rail. A near-black theme like
  // Obsidian does not - the derived step lands a hair off pure black instead of
  // on it - so it authors the panel directly.
  surfaceSidebarPanel?: string;
  // Optional override for the shared dark reading ink (`darkForeground`, an
  // off-white). Only a theme whose whole point is the ink itself - Obsidian's
  // pure-white-on-black - should set this; every other dark variant must keep
  // the shared value so all dark text moves together.
  foreground?: string;
  foregroundMuted: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  destructive: string;
  spinnerPrimary: string;
  spinnerSecondary: string;
  terminalBlack?: string;
  terminalBrightBlack?: string;
}

// Primary text ink for every dark variant. A neutral off-white rather than
// pure #fafafa - a couple of points darker so long reading sessions on dark
// surfaces don't glare, but zero saturation so it can't clash with any
// theme's tint (the earlier warm eggshell read yellow on cool themes).
// Shared across foreground, its legacy aliases, and the terminal so all
// dark "white" text moves together. Lifted from #e4e4e4 in the range refresh:
// the dark variants widen upward (elevated surfaces, muted text, borders all
// step lighter), so the ink at the top of the ramp moves with them.
const darkForeground = "#ededee";

const darkTerminalAnsi = {
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#b07ad0",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#c49ae0",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

export function buildDarkSemanticColors(tint: DarkThemeConfig) {
  const sidebarPanel = tint.surfaceSidebarPanel ?? deepenHex(tint.surfaceSidebar);
  const foreground = tint.foreground ?? darkForeground;
  const interactiveHover = accentWash(tint.accent, 0.14);
  const interactiveSelected = accentWash(tint.accent, 0.09);
  const interactivePressed = accentWash(tint.accent, 0.2);
  const interactiveHoverBorder = accentWash(tint.accent, 0.55);

  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarPanel: sidebarPanel,
    surfaceInteractiveHover: interactiveHover,
    surfaceInteractiveSelected: interactiveSelected,
    surfaceInteractivePressed: interactivePressed,
    borderInteractiveHover: interactiveHoverBorder,
    surfaceSidebarPanelInteractiveHoverOpaque: blendHex(sidebarPanel, tint.accent, 0.14),
    surfaceSidebarSelected: interactiveSelected,
    surfaceSidebarHover: interactiveHover,
    surfaceWorkspace: tint.surface1,
    surfaceChrome: blendHex(tint.surface1, tint.surfaceSidebar, 0.5),
    // Segmented-control well - see the light builder's note for why this is
    // derived per mode. Dark has room in its ramp, so the elevated step is the
    // recess: `surfaceSidebarHover` here would sit within a hair of the page.
    surfaceControlTrack: tint.surface2,
    surfaceToggleSelected: interactiveSelected,
    surfaceToggleHover: interactiveHover,
    surfaceHover: interactiveHover,
    // Chat speech bubbles - see the light builder's note; must stay derived
    // inside the theme builders, never via string math in stylesheets. Dark
    // runs 50% where light runs 75%; the alphas are tuned per mode, not shared.
    surfaceUserBubble: `${tint.surface3}80`,
    surfaceAssistantBubble: `${tint.surface2}80`,
    // In-place busy scrim - see the light builder's note.
    surfaceScrim: `${tint.surface0}cc`,
    // Code-showing surfaces - see the light builder's note.
    surfaceCode: deepenHex(tint.surface0),

    foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: blendHex(tint.foregroundMuted, tint.surface0, 0.35),

    scrollbarHandle: tint.scrollbarHandle,

    border: tint.border,
    borderAccent: tint.borderAccent,
    // Active desktop-tab outline - see the light builder's note.
    borderTabActive: `${tint.accent}80`,
    // Inner active-tab highlight ring - see the light builder's note.
    borderTabActiveInner: `${lightenHex(tint.accent, 0.25)}40`,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? "#ffffff",
    accentFillInk: accentFillInk(tint.accent),
    // ON-state switch knob. Follows accentForeground here because dark themes
    // only override it when the accent is near-white (Graphite, Midnight) -
    // exactly the case where a white knob would vanish into the track.
    switchThumbOn: tint.accentForeground ?? "#ffffff",

    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Working-indicator (BlobLoader) glow pair - two distinct hues per theme,
    // always including the theme's namesake color.
    spinnerPrimary: tint.spinnerPrimary,
    spinnerSecondary: tint.spinnerSecondary,

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: foreground,
    primary: foreground,
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: "#d4d4d8",

    ...darkDiffColors,
    ...darkStatusColors,
    ...darkStatusDotColors,
    ...darkUsageColors,

    terminal: {
      background: tint.surface0,
      foreground,
      cursor: foreground,
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: foreground,
      black: tint.terminalBlack ?? tint.surfaceSidebar,
      ...darkTerminalAnsi,
      brightBlack: tint.terminalBrightBlack ?? tint.surface3,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions
// ---------------------------------------------------------------------------

// Dark (displayed as "Twilight") - the neutral default dark theme. Untinted
// zinc surfaces with a pale blue kept only as the accent, deliberately
// non-flashy: this is the theme people who "just want dark mode" get, and the
// dark half of the System (auto) pair. Distinct from Graphite, which deepens
// the base and goes monochrome (near-white accent).
export const neutralDarkColors = buildDarkSemanticColors({
  // Twilight keeps its zinc character, with a barely perceptible blue cast
  // borrowed from the theme accent so its surface hierarchy does not collapse
  // into neutral grey.
  surface0: "#1e1e23", // was #18181b - all dark surfaces lifted +2.5 L pts
  surface1: "#25262c",
  surface2: "#32343b",
  surface3: "#52525c", // lifted from #45454d - the dark ramp widens upward, not downward
  surface4: "#6e6e7a", // lifted from #585862
  surfaceDiffEmpty: "#2e2e33",
  surfaceSidebar: "#191a1f",
  foregroundMuted: "#b6b6bf",
  scrollbarHandle: "#8b8b95",
  border: "#33333a",
  borderAccent: "#414149",
  accent: "#5aa0ee", // was #7ea6d9 - same azure, chroma opened up so it reads as a colour, not a grey-blue
  accentBright: "#a9d0ff",
  destructive: "#c44a4a", // neutral red, hue 0 - clearly red without screaming
  spinnerPrimary: "#79b3f2", // namesake twilight blue, lifted to glow on dark
  spinnerSecondary: "#f591b5", // Belt-of-Venus rose - the pink dusk band opposite the sunset
});

// Upstream Paseo's full-application pure-black palette. This is intentionally
// separate from Otto's `blackTheme`, which is a scoped chat-pane surface that
// is repainted from the active Otto variant at runtime.
export const pureBlackDarkColors = buildDarkSemanticColors({
  surface0: "#000000",
  surface1: "#0a0a0a",
  surface2: "#111111",
  surface3: "#202020",
  surface4: "#2d2d2d",
  surfaceDiffEmpty: "#0c0c0c",
  surfaceSidebar: "#000000",
  surfaceSidebarHover: "#161616",
  foregroundMuted: "#a1a1aa",
  scrollbarHandle: "#71717a",
  border: "#1c1c1c",
  borderAccent: "#242424",
  accent: "#20744A",
  accentBright: "#7ccba0",
  destructive: "#c44a4a",
  spinnerPrimary: "#7ccba0",
  spinnerSecondary: "#20744A",
  terminalBlack: "#595959",
  terminalBrightBlack: "#8a8a8a",
});

// Evergreen - Otto's teal-green identity. Muted text, borders, and the bright
// accent all lifted a step so panels separate and secondary text clears WCAG
// AA against the elevated surface.
export const evergreenDarkColors = buildDarkSemanticColors({
  surface0: "#1e2221", // was #181B1A - all dark surfaces lifted +2.5 L pts
  surface1: "#242826",
  surface2: "#333835",
  surface3: "#545b58", // lifted from #494d4b - widen the ramp upward
  surface4: "#737a77", // lifted from #5f6161
  surfaceDiffEmpty: "#2f3432",
  surfaceSidebar: "#1a1e1d",
  foregroundMuted: "#b6bebb", // was #aab0ae
  scrollbarHandle: "#8d9491",
  border: "#343d3a", // was #2c3331 - clearer panel separation
  borderAccent: "#454f4c",
  accent: "#149159", // was #20744A - the brand green was near-identical to the tinted surfaces; same hue, real chroma
  accentBright: "#6ef0b0", // was #8ce0af - brighter accent text on dark surfaces
  destructive: "#c64f43", // warm red, hue ~7 - reads as red (not pink) against the green tint
  spinnerPrimary: "#5ee8a4", // namesake evergreen, lifted to glow on dark
  spinnerSecondary: "#f5d06b", // warm gold - sunlight through the canopy
});

// Graphite - monochrome *surfaces*, one coloured accent. The near-white accent
// this shipped with was indistinguishable from the theme's own light tones -
// the CTA looked like any other bright text - so the accent is now an icy cyan:
// the only hue in the theme, which is exactly what an accent is for. Surfaces,
// text, and borders stay strictly grey, so nothing else competes with it.
export const graphiteDarkColors = buildDarkSemanticColors({
  surface0: "#1a1a1e", // was #141417 - all dark surfaces lifted +2.5 L pts
  surface1: "#222226",
  surface2: "#323236",
  surface3: "#525259", // lifted from #45454d - widen the ramp upward
  surface4: "#6e6e78", // lifted from #585862
  surfaceDiffEmpty: "#2b2b30",
  surfaceSidebar: "#151518",
  foregroundMuted: "#bcbcc4", // was #b0b0b8
  scrollbarHandle: "#93939d",
  border: "#37373d", // was #2e2e33 - no longer identical to surface2
  borderAccent: "#45454d",
  accent: "#35c8e0", // icy cyan - the graphite-steel hue, and the only colour in the theme
  accentBright: "#7fe4f5",
  accentForeground: "#0d1416", // bright cyan fill - needs dark text
  destructive: "#c44a4a", // neutral red, hue 0 - clearly red without screaming
  spinnerPrimary: "#f5f6fa", // namesake graphite silver - stays monochrome
  spinnerSecondary: "#4fd8ee", // the accent cyan, so the glow carries the theme's one hue
});

// Nightfall - deep blue night. Base surfaces deepened and the accent blue
// brightened so the blue tint reads as intentional, not haze.
export const nightfallDarkColors = buildDarkSemanticColors({
  surface0: "#171925", // was #12141d - all dark surfaces lifted +2.5 L pts
  surface1: "#1d202c",
  surface2: "#2f3340",
  surface3: "#4d5163", // lifted from #424453 - widen the ramp upward
  surface4: "#6a6e84", // lifted from #595b6b
  surfaceDiffEmpty: "#292d3a",
  surfaceSidebar: "#121522",
  foregroundMuted: "#b3b7cc", // was #a6aabf
  scrollbarHandle: "#888ca4",
  border: "#333648", // was #2a2c3f
  borderAccent: "#43465e",
  accent: "#2f7ff0", // was #3b6fcf - electric blue, so the accent clears the navy surfaces it sits on
  accentBright: "#a5c9ff", // was #92bcff
  destructive: "#c44a52", // red with a hint of cool lean against the blue tint
  spinnerPrimary: "#7fb3ff", // namesake nightfall blue, lifted to glow on dark
  spinnerSecondary: "#b79cff", // dusk violet
});

// Ember - warm charcoal with a saturated orange-red accent. Saturation and
// muted-text brightness boosted over the old washed-tan look.
export const emberDarkColors = buildDarkSemanticColors({
  surface0: "#232120", // was #1c1b1a - all dark surfaces lifted +2.5 L pts
  surface1: "#2b2826",
  surface2: "#3b3835",
  surface3: "#5c5754", // lifted from #514d4b - widen the ramp upward
  surface4: "#7b7572", // lifted from #676361
  surfaceDiffEmpty: "#353230",
  surfaceSidebar: "#1d1b1a",
  foregroundMuted: "#c4bfb9", // was #b8b3ae
  scrollbarHandle: "#948e88",
  border: "#3e3a36", // was #35322e
  borderAccent: "#4d4842",
  accent: "#f2662f", // was #d96b45 - the ember burns hotter, clear of the warm-charcoal surfaces
  accentBright: "#ffb495", // was #ffab88
  destructive: "#cf513e", // warm orange-red, hue ~10 - sits with the ember accent
  spinnerPrimary: "#ff9866", // namesake ember orange, lifted to glow on dark
  spinnerSecondary: "#ffd07e", // glowing coal gold
});

// Slate - blue-grey terminal look (Ghostty-default lineage). Sidebar
// deepened and borders lifted so the panes actually separate; the light blue
// accent gets dark text instead of unreadable white.
export const slateDarkColors = buildDarkSemanticColors({
  surface0: "#2e323b", // was #282c34 - all dark surfaces lifted +2.5 L pts
  surface1: "#353944",
  surface2: "#444956",
  surface3: "#5b6172", // lifted from #505565 - widen the ramp upward
  surface4: "#737a90", // lifted from #61677c
  surfaceDiffEmpty: "#3b4150",
  surfaceSidebar: "#232831", // was #1e222a
  foregroundMuted: "#d2d6e2",
  scrollbarHandle: "#aeb2c0",
  border: "#454c5c", // was #3d4352
  borderAccent: "#545b6e",
  accent: "#6ba6ff", // was #89b4fa - same lineage blue with the grey squeezed out, so it separates from the blue-grey surfaces
  accentBright: "#b3d0ff",
  accentForeground: "#0f1622", // light blue accent - needs dark text (white was ~2:1)
  destructive: "#c44a55", // red with slight cool lean against the slate-blue surfaces
  spinnerPrimary: "#6ba6ff", // namesake slate-blue accent
  spinnerSecondary: "#cba6f7", // soft mauve
});

// Neotokyo - deep violet surfaces with neon magenta accents. The base keeps a
// visible violet cast (lifted off the old near-black), borders are visibly
// violet, and the accent pair is a deep magenta (white text ≈5.5:1) with a
// neon bright.
export const neotokyoDarkColors = buildDarkSemanticColors({
  surface0: "#151522", // was #0b0b12 - lifted +5 L pts, off the near-black base
  surface1: "#1c1c2a",
  surface2: "#29293d",
  surface3: "#434360", // lifted from #38384f - widen the ramp upward
  surface4: "#5a5a7d", // lifted from #4a4a67
  surfaceDiffEmpty: "#252534",
  surfaceSidebar: "#10101c",
  foregroundMuted: "#b0b4d4",
  scrollbarHandle: "#8488b2",
  border: "#2b2b46",
  borderAccent: "#39395c",
  accent: "#c2188f", // left alone - this is the accent the rest of the set was retuned toward
  accentBright: "#ff5ad1",
  destructive: "#d94848", // clearly red so errors never blur into the magenta accent
  spinnerPrimary: "#ff5ad1", // namesake neon magenta
  spinnerSecondary: "#3ae8f5", // neon cyan counterlight
});

// Obsidian - the monochrome dark theme, and the dark half of the black/white
// pair with Ivory. Mirror image of Ivory: the accent is pure white, so every
// selected tab, focus ring, link, CTA and interaction wash is light on black.
//
// The four background layers are the mirror too, about eight levels apart:
// the primary sidebar bottoms out on true #000000, the tab-and-gutter rail
// sits at #070707, the title bar lands at #0f0f0f (the derived surface1/rail
// blend), and content runs #121212 / #161616. That inverts the usual dark
// convention - elsewhere the rail is DARKER than the content canvas, but a
// theme whose sidebar is literally black has nowhere below it to put the
// canvas, so the canvas rises instead.
//
// Reading ink is pure #ffffff rather than the shared off-white every other
// dark variant uses (`darkForeground`); that override is the theme. Diff,
// status, syntax and terminal ANSI colors stay colored - see Ivory's note.
export const obsidianDarkColors = buildDarkSemanticColors({
  surface0: "#121212", // content canvas
  surface1: "#161616", // workspace
  surface2: "#1c1c1c", // elevated: badges, inputs, sheets
  surface3: "#2b2b2b",
  surface4: "#3d3d3d",
  surfaceDiffEmpty: "#171717",
  surfaceSidebar: "#070707", // tab rail and gutters
  surfaceSidebarPanel: "#000000", // primary sidebar - true black, the deepest layer
  foreground: "#ffffff", // pure white; the font-contrast slider only softens from here
  foregroundMuted: "#a6a6a6",
  scrollbarHandle: "#7a7a7a",
  border: "#303030",
  borderAccent: "#3f3f3f",
  accent: "#ffffff", // the whole point: the accent is light
  accentBright: "#ffffff",
  accentForeground: "#000000", // black on a white fill
  destructive: "#c44a4a", // the one deliberate hue - danger must not read as chrome
  spinnerPrimary: "#ffffff", // namesake white
  spinnerSecondary: "#8a8a8a", // its half-tone, so the glow still has two steps
});

// Breakpoint-shaped value for a geometry style property (padding, minHeight, gap, ...)
// that should scale up (2x by default) on compact form factors (`xs`/`sm` breakpoints -
// see `useIsCompactFormFactor`). For use inside `StyleSheet.create` factories, where
// Unistyles resolves per-breakpoint object literals regardless of where the value
// came from. Not for `theme.iconSize`/`theme.fontSize` reads - those are patched
// globally at runtime by `applyAppearance` instead.
export function compactUp(
  value: number,
  factor = 2,
): Record<"xs" | "sm" | "md" | "lg" | "xl", number> {
  const scaled = value * factor;
  return { xs: scaled, sm: scaled, md: value, lg: value, xl: value };
}

// Breakpoint-shaped value for a `fontSize`/`lineHeight` that should read a couple
// of points larger on compact form factors. This bump is deliberately *on top of*
// the ambient size patch `applyAppearance` applies - the ambient patch keeps the
// whole app legible, this puts dense panel text (tables, gutters, metadata rows)
// back to a comfortable reading size on a phone. `sm` is omitted so it inherits
// `xs`, matching `useIsCompactFormFactor`'s xs+sm definition of "compact".
export function compactFont(size: number, bump = 2): Record<"xs" | "md", number> {
  return { xs: size + bump, md: size };
}

// The elevation scale. `md` is the popup step - tooltips, dropdown and context
// menus, comboboxes, autocompletes, hover cards and toasts all spread it, so
// these numbers are what separates a floating surface from the canvas.
//
// Two things make that separation load-bearing rather than decorative:
// `popover` resolves to `surface0` (see buildDarkSemanticColors), so a popup has
// *no* fill contrast against the app background and only the border plus this
// shadow tell the eye it is floating; and dark surfaces here start at #1e1e22
// rather than near-black, which is exactly why a black shadow reads on them.
//
// ALPHA MUST RIDE INSIDE `shadowColor`. Do not move it out to `shadowOpacity`;
// on web these render as fully opaque black.
//
// Unistyles hoists a *theme* `shadowColor` into a CSS variable so themes stay
// swappable at runtime, and composes only the geometry into the rule:
//
//   .unistyles_xxx { box-shadow: 0 3px 8px var(--shadow-md-shadow-color) }
//   :root.light    { --shadow-md-shadow-color: <this string> }
//
// The variable carries the colour and nothing else, so `shadowOpacity` is
// silently discarded and the shadow paints at full strength. Only the geometry
// responds to edits, which makes the failure very convincing: offset and blur
// change while opacity appears frozen. Styles built from literals rather than
// theme tokens do not go through the variable path and do compose
// `shadowOpacity` correctly, so a working example elsewhere proves nothing here.
//
// `shadowOpacity: 1` is kept for native. iOS multiplies it into the colour's
// own alpha (CALayer semantics), so 1 means "use the alpha in the string" there
// while staying inert on web. Android ignores both and uses `elevation`.
export const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.40)",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.50)",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

// Same steps as `darkShadow`, tuned down: light surfaces need less alpha to read,
// and going heavier here turns a clean popup into a smudge. The alpha rides in
// `shadowColor` for the reason spelled out above `darkShadow`.
//
// These alphas sit near the 0.02 / 0.04 / 0.08 they replaced, which were
// invisible on every display. What makes these read is the geometry, not the ink:
// the old steps spread the same alpha over a 16-24px blur, so nothing anywhere
// was dark enough to see. Concentrating it into a tighter blur buys the
// separation without darkening the popup's surroundings.
export const lightShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.05)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.12)",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.16)",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

// ---------------------------------------------------------------------------
// Black tab background - per-variant palettes on pure black
// ---------------------------------------------------------------------------

// Each dark variant gets its own hand-tuned palette for the "Black tab
// background" appearance setting. A variant's normal colors are tuned against
// its own base surface (~#18-ish), not against #000000 - reused verbatim on
// black, the elevated surfaces barely separate and muted text/borders sink
// into the void, so every theme collapses into the same generic look. These
// tints keep each theme's hue but re-step the neutrals for a pure-black
// canvas: surfaces lifted enough to read as cards, borders visible, muted
// text brightened a step so nothing blends into the dark.
interface BlackVariantTint {
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  border: string;
  borderAccent: string;
  foregroundMuted: string;
  scrollbarHandle: string;
}

// Expand a black-variant tint into the override object spread on top of the
// dark variant's colors when repainting the `black` theme key (see
// `apply-color-scheme.ts`). Covers the legacy aliases derived from the
// overridden tokens (popover/secondary/muted/input mirror surface2,
// mutedForeground mirrors foregroundMuted, accentBorder mirrors borderAccent)
// so no alias keeps pointing at the variant's un-lifted value.
function buildBlackVariantColors(tint: BlackVariantTint) {
  return {
    surface0: "#000000",
    surfaceWorkspace: "#000000",
    background: "#000000",
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    // Re-derived from this variant's lifted surface2, same as the dark builder.
    // Interaction states stay inherited because they are translucent accent
    // washes and therefore adapt to the black canvas without another ramp.
    surfaceControlTrack: tint.surface2,
    // Re-derive the bubble fills from this variant's lifted surfaces so the
    // black scope doesn't inherit the dark variant's tint through the merge.
    // Same 50% alpha as dark - the black canvas is the extreme case the dark
    // figure was picked for.
    surfaceUserBubble: `${tint.surface3}80`,
    surfaceAssistantBubble: `${tint.surface2}80`,
    // Scrim re-derived from the black canvas, matching the surface0 override.
    surfaceScrim: "#000000cc",
    // The code well inverts on black. Everywhere else it is surface0 scaled
    // toward black; against a #000000 canvas there is nothing deeper to scale
    // to, and a code block that renders pure black on pure black is invisible.
    // The variant's first lifted step is the same read - "not the canvas" -
    // taken in the only direction black leaves open.
    surfaceCode: tint.surface1,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    border: tint.border,
    borderAccent: tint.borderAccent,
    accentBorder: tint.borderAccent,
    foregroundMuted: tint.foregroundMuted,
    mutedForeground: tint.foregroundMuted,
    scrollbarHandle: tint.scrollbarHandle,
    popover: tint.surface2,
    secondary: tint.surface2,
    muted: tint.surface2,
    input: tint.surface2,
    primaryForeground: "#000000",
  } as const;
}

// The `black` theme key is only ever consumed through `ScopedTheme
// name="black"` around chat panes - adaptive mode never selects it. Each
// entry keys off the dark variant it accompanies; comments name the display
// label where it differs from the key.
export const BLACK_VARIANT_OVERRIDES: Record<
  DarkThemeName,
  ReturnType<typeof buildBlackVariantColors>
> = {
  // Twilight - neutral zinc, kept cool and untinted.
  dark: buildBlackVariantColors({
    surface1: "#161619",
    surface2: "#202024",
    surface3: "#38383f",
    surface4: "#4e4e57",
    surfaceDiffEmpty: "#121215",
    border: "#26262c",
    borderAccent: "#323239",
    foregroundMuted: "#b8b8c1",
    scrollbarHandle: "#8a8a93",
  }),
  // Evergreen - teal-green cast on the elevated steps.
  evergreen: buildBlackVariantColors({
    surface1: "#121715",
    surface2: "#1c211f",
    surface3: "#3a423f",
    surface4: "#525a56",
    surfaceDiffEmpty: "#0f1412",
    border: "#253029",
    borderAccent: "#33403a",
    foregroundMuted: "#b9c2bd",
    scrollbarHandle: "#8b938f",
  }),
  // Graphite - strictly monochrome; separation comes from the border lift.
  zinc: buildBlackVariantColors({
    surface1: "#151516",
    surface2: "#1f1f21",
    surface3: "#39393d",
    surface4: "#515156",
    surfaceDiffEmpty: "#111112",
    border: "#2a2a2e",
    borderAccent: "#37373c",
    foregroundMuted: "#c2c2c9",
    scrollbarHandle: "#929299",
  }),
  // Nightfall - deep blue night; the blue reads in the cards and borders.
  midnight: buildBlackVariantColors({
    surface1: "#10131e",
    surface2: "#1a1d2b",
    surface3: "#333850",
    surface4: "#4b526e",
    surfaceDiffEmpty: "#0c0f18",
    border: "#232840",
    borderAccent: "#303756",
    foregroundMuted: "#b5bad3",
    scrollbarHandle: "#878ca6",
  }),
  // Ember - warm charcoal; browns stay warm instead of going grey on black.
  claude: buildBlackVariantColors({
    surface1: "#171412",
    surface2: "#211e1b",
    surface3: "#3e3a36",
    surface4: "#57524d",
    surfaceDiffEmpty: "#131110",
    border: "#2f2a25",
    borderAccent: "#3d372f",
    foregroundMuted: "#c6c0b9",
    scrollbarHandle: "#958f88",
  }),
  // Slate - blue-grey; steps re-anchored from its lighter #2e323b base.
  ghostty: buildBlackVariantColors({
    surface1: "#14171e",
    surface2: "#20242d",
    surface3: "#3a404e",
    surface4: "#515868",
    surfaceDiffEmpty: "#10131a",
    border: "#2b3140",
    borderAccent: "#394050",
    foregroundMuted: "#d0d4e0",
    scrollbarHandle: "#a6aab8",
  }),
  // Neotokyo - violet near-black; borders stay visibly violet on true black.
  cyberpunk: buildBlackVariantColors({
    surface1: "#0f0f18",
    surface2: "#171722",
    surface3: "#2f2f45",
    surface4: "#44445f",
    surfaceDiffEmpty: "#0c0c13",
    border: "#26263f",
    borderAccent: "#333354",
    foregroundMuted: "#b2b6d6",
    scrollbarHandle: "#8185b0",
  }),
  // Obsidian - already black; the ramp only has to re-step off a true-black
  // canvas instead of Obsidian's own #121212 one. Ink stays pure white, which
  // it inherits from the variant (this override object never sets foreground).
  obsidian: buildBlackVariantColors({
    surface1: "#0d0d0d",
    surface2: "#191919",
    surface3: "#2a2a2a",
    surface4: "#3c3c3c",
    surfaceDiffEmpty: "#0a0a0a",
    border: "#2c2c2c",
    borderAccent: "#3b3b3b",
    foregroundMuted: "#adadad",
    scrollbarHandle: "#828282",
  }),
};

// When the app is in a LIGHT theme with Black tab background on, the chat
// pane can't reuse the light variant's colors (dark plum text on pure black
// is unreadable) and shouldn't fall back to the user's dark-variant pick
// either - Sherbet in light mode should get a "dark Sherbet" chat pane, not
// Twilight. Each light variant therefore gets a full dark counterpart built
// on pure black through `buildDarkSemanticColors`, so foreground, diff,
// status, and terminal tokens are all dark-scheme correct while the hues and
// accents stay the light theme's own.
function buildBlackFromLightColors(tint: DarkThemeConfig) {
  // The dark builder anchors surfaceWorkspace to surface1; black mode wants
  // the pane itself on true black.
  return { ...buildDarkSemanticColors(tint), surfaceWorkspace: "#000000" };
}

export const BLACK_LIGHT_VARIANT_COLORS: Record<
  LightThemeName,
  ReturnType<typeof buildBlackFromLightColors>
> = {
  // Daylight - neutral zinc counterpart; same steps as Twilight-on-black with
  // Daylight's vibrant gold and its sun/sky spinner pair lifted for dark.
  daylight: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#161619",
    surface2: "#202024",
    surface3: "#38383f",
    surface4: "#4e4e57",
    surfaceDiffEmpty: "#121215",
    surfaceSidebar: "#0a0a0b",
    foregroundMuted: "#b8b8c1",
    scrollbarHandle: "#8a8a93",
    border: "#26262c",
    borderAccent: "#323239",
    accent: "#c69700", // same golden sun as light Daylight
    accentBright: "#ffd54f", // sunny gold, ~14.9:1 on black
    accentForeground: "#181300", // match light Daylight's ink-on-gold fills
    destructive: "#c44a4a",
    spinnerPrimary: "#ffc933", // namesake gold sun, lifted to glow on black
    spinnerSecondary: "#5bb8f5", // daytime sky, lifted
  }),
  // Sherbet - warm plum-peach cast with the raspberry accent lifted to glow.
  pastel: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#191316",
    surface2: "#241c20",
    surface3: "#40343a",
    surface4: "#584a51",
    surfaceDiffEmpty: "#140f12",
    surfaceSidebar: "#0c090a",
    foregroundMuted: "#c9b9c4",
    scrollbarHandle: "#998894",
    border: "#322630",
    borderAccent: "#41323e",
    accent: "#e02a90", // light Sherbet's raspberry, lifted for black
    accentBright: "#ff85cd",
    destructive: "#cf4f46",
    spinnerPrimary: "#ff5aa8", // namesake raspberry, lifted for black
    spinnerSecondary: "#ffab5e", // tangerine scoop, lifted
  }),
  // Meadow - sage green cast; brand green accent, meadow/buttercup spinners.
  meadow: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#121714",
    surface2: "#1c221e",
    surface3: "#35403a",
    surface4: "#4c5a52",
    surfaceDiffEmpty: "#0f1411",
    surfaceSidebar: "#090c0a",
    foregroundMuted: "#b5c4ba",
    scrollbarHandle: "#87948c",
    border: "#25322a",
    borderAccent: "#32423a",
    accent: "#0b9354",
    accentBright: "#6ef0b0",
    destructive: "#c64f43",
    spinnerPrimary: "#4fd68a", // namesake meadow green, lifted
    spinnerSecondary: "#e8be55", // buttercup gold, lifted
  }),
  // Terracotta - warm clay cast; burnt orange brightened for black.
  terracotta: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#181310",
    surface2: "#231c17",
    surface3: "#403630",
    surface4: "#584c43",
    surfaceDiffEmpty: "#130f0c",
    surfaceSidebar: "#0c0908",
    foregroundMuted: "#c9bcb0",
    scrollbarHandle: "#988b7f",
    border: "#33291f",
    borderAccent: "#423528",
    accent: "#ef6a2f",
    accentBright: "#ff9d70",
    destructive: "#cf513e",
    spinnerPrimary: "#ff8a50", // namesake clay, lifted
    spinnerSecondary: "#ffc46e", // amber gold, lifted
  }),
  // Horizon - sky blue cast; the saturated blue accent lifted for black.
  horizon: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#101420",
    surface2: "#191f2e",
    surface3: "#313a52",
    surface4: "#475270",
    surfaceDiffEmpty: "#0c101a",
    surfaceSidebar: "#080a12",
    foregroundMuted: "#b4bdd4",
    scrollbarHandle: "#8590aa",
    border: "#222c44",
    borderAccent: "#2f3b5a",
    accent: "#2f7ff0",
    accentBright: "#a5c9ff",
    destructive: "#c44a52",
    spinnerPrimary: "#6ea3ff", // namesake horizon blue, lifted
    spinnerSecondary: "#ff8a4d", // sunrise orange, lifted
  }),
  // Powder - foggy slate-blue cast; the periwinkle accent goes light enough on
  // black that it needs dark text, like Slate's.
  powder: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#13161e",
    surface2: "#1e222c",
    surface3: "#383e4e",
    surface4: "#4f5668",
    surfaceDiffEmpty: "#0f1218",
    surfaceSidebar: "#090b10",
    foregroundMuted: "#bfc6d4",
    scrollbarHandle: "#8f96a8",
    border: "#293040",
    borderAccent: "#363e50",
    accent: "#8a94ee",
    accentBright: "#b9c0ff",
    accentForeground: "#10141c",
    destructive: "#c44a55",
    spinnerPrimary: "#7da3e8", // namesake powder blue, lifted
    spinnerSecondary: "#a98ee8", // periwinkle violet, lifted
  }),
  // Ivory - inverts wholesale into Obsidian: the black chat pane of the
  // monochrome light theme IS the monochrome dark theme, on true black.
  ivory: buildBlackFromLightColors({
    surface0: "#000000",
    surface1: "#0d0d0d",
    surface2: "#191919",
    surface3: "#2a2a2a",
    surface4: "#3c3c3c",
    surfaceDiffEmpty: "#0a0a0a",
    surfaceSidebar: "#050505",
    foreground: "#ffffff",
    foregroundMuted: "#adadad",
    scrollbarHandle: "#828282",
    border: "#2c2c2c",
    borderAccent: "#3b3b3b",
    accent: "#ffffff",
    accentBright: "#ffffff",
    accentForeground: "#000000",
    destructive: "#c44a4a",
    spinnerPrimary: "#ffffff",
    spinnerSecondary: "#8a8a8a",
  }),
};
