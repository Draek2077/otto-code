// PROVENANCE: Otto's theme set is authored locally in this fork and is NOT
// inherited from upstream Paseo. `light`/`dark` predate the fork, but the theme
// variants (`zinc`/`midnight`/`claude`/`ghostty`, added in 2f77674c5, plus
// `daylight`/`evergreen`/`cyberpunk`/`pastel`, plus
// `meadow`/`terracotta`/`horizon`/`powder`) were created in Otto. During
// upstream merges, resolve
// conflicts in this file in favor of the Otto side — do not pull theme changes
// from Paseo.
import { Platform } from "react-native";
import { darkHighlightColors, lightHighlightColors } from "@otto-code/highlight";

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
// The plain neutral "Light" theme was retired — Daylight is now the sole
// neutral light theme and the light half of the System pair.
export type LightThemeName = "daylight" | "meadow" | "terracotta" | "horizon" | "powder" | "pastel";

// Dark spectrum: the neutral default (`dark`, displayed as "Twilight", first)
// plus tinted variants.
export type DarkThemeName =
  | "dark"
  | "evergreen"
  | "zinc"
  | "midnight"
  | "claude"
  | "ghostty"
  | "cyberpunk";

// Any selectable theme variant, light or dark. Used for swatches and label
// lookups that operate across both spectrums.
export type ThemeVariantName = LightThemeName | DarkThemeName;

// Diff stat colors — light uses muted tones, dark uses the brighter palette values
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 — readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
};

// Status colors — semantic signals for success/danger/warning/merged. Used by
// check statuses, PR states, and review decisions. Kept a step darker than the
// raw palette so they read as signals, not neon.
const lightStatusColors = {
  statusSuccess: "#15803d", // green-700
  statusDanger: "#b91c1c", // red-700
  statusWarning: "#d97706", // amber-600
  statusMerged: "#7c3aed", // purple-600
};

const darkStatusColors = {
  statusSuccess: "#16a34a", // green-600
  statusDanger: "#dc2626", // red-600
  statusWarning: "#f59e0b", // amber-500
  statusMerged: "#9333ea", // purple-600
};

// ---------------------------------------------------------------------------
// Light theme variant builder — mirrors the dark builder below so multiple
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
  surfaceSidebarHover: string;
  foreground: string;
  foregroundMuted: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  destructive: string;
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

function buildLightSemanticColors(tint: LightThemeConfig) {
  return {
    // Surfaces (layers)
    surface0: tint.surface0, // App background
    surface1: tint.surface1, // Subtle hover
    surface2: tint.surface2, // Elevated: badges, inputs, sheets
    surface3: tint.surface3, // Highest elevation
    surface4: tint.surface4, // Extra emphasis
    surfaceDiffEmpty: tint.surfaceDiffEmpty, // Empty side of split diff rows
    surfaceSidebar: tint.surfaceSidebar, // Sidebar background (darker than main)
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surface0, // Workspace main background

    // Text
    foreground: tint.foreground,
    foregroundMuted: tint.foregroundMuted,

    // Controls
    scrollbarHandle: tint.scrollbarHandle,

    // Borders
    border: tint.border,
    borderAccent: tint.borderAccent, // Softer accent border for low-emphasis outlines

    // Brand
    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: "#ffffff",

    // Semantic
    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

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

// Daylight — the neutral default light theme, crisp and high-contrast:
// deliberately non-flashy, this is the theme people who "just want light
// mode" get, and the light half of the System (auto) pair. Muted text and
// borders are a step darker than a plain white/zinc bg so secondary text
// clears WCAG AA (foregroundMuted #62626b on #ffffff ≈ 5.6:1) and panel edges
// read clearly.
const daylightColors = buildLightSemanticColors({
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  surface3: "#e4e4e7",
  surface4: "#d4d4d8",
  surfaceDiffEmpty: "#f6f6f6",
  surfaceSidebar: "#f4f4f5",
  surfaceSidebarHover: "#e9e9ec",
  foreground: "#1a1a1e",
  foregroundMuted: "#62626b", // was #71717a — stronger secondary text
  scrollbarHandle: "#3f3f46",
  border: "#dcdce0", // was #e4e4e7 — clearer panel separation
  borderAccent: "#ececf1",
  accent: "#20744A",
  accentBright: "#1d8a4e", // darker than the old #239956 so accent text reads on white
  destructive: "#b04138", // dark warm red on white — calm but unambiguously red
});

// Sherbet — soft pastel peach surfaces with a saturated raspberry accent and
// dark plum text. Deliberately NOT washed out: body text ≈13:1 on surface0,
// muted text ≈5:1 on the elevated surface, accent on white ≈5.5:1.
const sherbetColors = buildLightSemanticColors({
  surface0: "#fdf7f2",
  surface1: "#f9efe8",
  surface2: "#f4e6dd",
  surface3: "#e9d4c8",
  surface4: "#dbbfb0",
  surfaceDiffEmpty: "#f6ebe2",
  surfaceSidebar: "#f7ebe2",
  surfaceSidebarHover: "#f0e0d3",
  foreground: "#2b2233",
  foregroundMuted: "#6b5f6e",
  scrollbarHandle: "#55495a",
  border: "#e8d5ca",
  borderAccent: "#f0e0d5",
  accent: "#b83280",
  accentBright: "#99286b",
  destructive: "#b04138",
});

// Meadow — sage-tinted light variant of the brand green, mirroring dark
// Evergreen: same accent hue as neutral Light, surfaces lifted with a soft
// green undertone instead of pure white/zinc.
const meadowColors = buildLightSemanticColors({
  surface0: "#f6faf7",
  surface1: "#eef6f1",
  surface2: "#e3eee7",
  surface3: "#cfe0d6",
  surface4: "#b7cdc0",
  surfaceDiffEmpty: "#eef5f0",
  surfaceSidebar: "#eef6f1",
  surfaceSidebarHover: "#e3eee7",
  foreground: "#16261d",
  foregroundMuted: "#5c6f64",
  scrollbarHandle: "#3f4a44",
  border: "#dbe8e0",
  borderAccent: "#e3eee7",
  accent: "#20744A",
  accentBright: "#1f8a52",
  destructive: "#b04138",
});

// Terracotta — warm clay-tinted light variant, mirroring dark Ember. Cream
// surfaces with a burnt-orange accent darkened enough to read on white.
const terracottaColors = buildLightSemanticColors({
  surface0: "#fdf8f5",
  surface1: "#f9f1ec",
  surface2: "#f3e6dd",
  surface3: "#e6d0c1",
  surface4: "#d6b8a4",
  surfaceDiffEmpty: "#f7ede4",
  surfaceSidebar: "#f8efe8",
  surfaceSidebarHover: "#f1e2d5",
  foreground: "#2e2019",
  foregroundMuted: "#75655a",
  scrollbarHandle: "#5c4c40",
  border: "#ecdccd",
  borderAccent: "#f1e2d5",
  accent: "#b8552f",
  accentBright: "#9c4526",
  destructive: "#b04138",
});

// Horizon — crisp blue-tinted light variant, mirroring dark Nightfall. Pale
// sky-blue surfaces with a saturated, high-contrast blue accent.
const horizonColors = buildLightSemanticColors({
  surface0: "#f6f9fd",
  surface1: "#eef4fb",
  surface2: "#e1ebf7",
  surface3: "#c6d9ef",
  surface4: "#a9c3e2",
  surfaceDiffEmpty: "#eef3fa",
  surfaceSidebar: "#eef4fb",
  surfaceSidebarHover: "#e1ebf7",
  foreground: "#161e2e",
  foregroundMuted: "#5a6b85",
  scrollbarHandle: "#3f4d63",
  border: "#d7e4f3",
  borderAccent: "#e1ebf7",
  accent: "#2159c9",
  accentBright: "#1a49a8",
  destructive: "#b04138",
});

// Powder — muted blue-grey light variant, mirroring dark Slate. Foggier and
// greyer than Horizon, with a desaturated slate-blue accent instead of a
// saturated one.
const powderColors = buildLightSemanticColors({
  surface0: "#f6f7f9",
  surface1: "#eef0f4",
  surface2: "#e3e7ee",
  surface3: "#cbd2de",
  surface4: "#b0b9ca",
  surfaceDiffEmpty: "#eef1f5",
  surfaceSidebar: "#eef0f4",
  surfaceSidebarHover: "#e3e7ee",
  foreground: "#1e222b",
  foregroundMuted: "#636c7d",
  scrollbarHandle: "#454e5f",
  border: "#dde1e9",
  borderAccent: "#e3e7ee",
  accent: "#4a6fa5",
  accentBright: "#3a5a8a",
  destructive: "#b04138",
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
  surfaceSidebarHover: string;
  foregroundMuted: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  destructive: string;
}

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

function buildDarkSemanticColors(tint: DarkThemeConfig) {
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surface1,

    foreground: "#fafafa",
    foregroundMuted: tint.foregroundMuted,

    scrollbarHandle: tint.scrollbarHandle,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? "#ffffff",

    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: "#fafafa",
    primary: "#fafafa",
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: "#fafafa",
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: "#d4d4d8",

    ...darkDiffColors,
    ...darkStatusColors,

    terminal: {
      background: tint.surface0,
      foreground: "#fafafa",
      cursor: "#fafafa",
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: "#fafafa",
      black: tint.surfaceSidebar,
      ...darkTerminalAnsi,
      brightBlack: tint.surface3,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions
// ---------------------------------------------------------------------------

// Dark (displayed as "Twilight") — the neutral default dark theme. Untinted
// zinc surfaces with Otto's green kept only as the accent, deliberately
// non-flashy: this is the theme people who "just want dark mode" get, and the
// dark half of the System (auto) pair. Distinct from Graphite, which deepens
// the base and goes monochrome (near-white accent).
const neutralDarkColors = buildDarkSemanticColors({
  surface0: "#18181b",
  surface1: "#1f1f22",
  surface2: "#27272a",
  surface3: "#3f3f46",
  surface4: "#52525b",
  surfaceDiffEmpty: "#242427",
  surfaceSidebar: "#131316",
  surfaceSidebarHover: "#1b1b1e",
  foregroundMuted: "#a9a9b2",
  scrollbarHandle: "#7b7b84",
  border: "#2b2b30",
  borderAccent: "#36363d",
  accent: "#20744A",
  accentBright: "#8ce0af",
  destructive: "#c44a4a", // neutral red, hue 0 — clearly red without screaming
});

// Evergreen — Otto's teal-green identity. Muted text, borders, and the bright
// accent all lifted a step so panels separate and secondary text clears WCAG
// AA against the elevated surface.
const evergreenDarkColors = buildDarkSemanticColors({
  surface0: "#181B1A",
  surface1: "#1E2120",
  surface2: "#272A29",
  surface3: "#434645",
  surface4: "#595B5B",
  surfaceDiffEmpty: "#252827",
  surfaceSidebar: "#141716",
  surfaceSidebarHover: "#1c1f1e",
  foregroundMuted: "#aab0ae", // was #A1A5A4
  scrollbarHandle: "#7d8280",
  border: "#2c3331", // was #252B2A — clearer panel separation
  borderAccent: "#3a4240",
  accent: "#20744A",
  accentBright: "#8ce0af", // was #7ccba0 — brighter accent text on dark surfaces
  destructive: "#c64f43", // warm red, hue ~7 — reads as red (not pink) against the green tint
});

// Graphite — monochrome. Surfaces deepened toward true black and borders
// lifted so the near-white accent lands on real contrast instead of gray soup.
const graphiteDarkColors = buildDarkSemanticColors({
  surface0: "#141417", // was #18181b — deeper base
  surface1: "#1c1c1f",
  surface2: "#27272a",
  surface3: "#3f3f46",
  surface4: "#52525b",
  surfaceDiffEmpty: "#212124",
  surfaceSidebar: "#0f0f11",
  surfaceSidebarHover: "#17171a",
  foregroundMuted: "#b0b0b8", // was #a1a1aa
  scrollbarHandle: "#83838d",
  border: "#2e2e33", // was #27272a — no longer identical to surface2
  borderAccent: "#3a3a41",
  accent: "#e4e4e7",
  accentBright: "#ffffff",
  accentForeground: "#141417", // monochrome accent is near-white — needs dark text
  destructive: "#c44a4a", // neutral red, hue 0 — clearly red without screaming
});

// Nightfall — deep blue night. Base surfaces deepened and the accent blue
// brightened so the blue tint reads as intentional, not haze.
const nightfallDarkColors = buildDarkSemanticColors({
  surface0: "#12141d", // was #161820 — deeper base
  surface1: "#181a24",
  surface2: "#252731",
  surface3: "#3c3e4c",
  surface4: "#535564",
  surfaceDiffEmpty: "#20222d",
  surfaceSidebar: "#0e101a",
  surfaceSidebarHover: "#161826",
  foregroundMuted: "#a6aabf", // was #9a9db0
  scrollbarHandle: "#787c94",
  border: "#2a2c3f", // was #242636
  borderAccent: "#383a50",
  accent: "#3b6fcf",
  accentBright: "#92bcff", // was #7eaaeb
  destructive: "#c44a52", // red with a hint of cool lean against the blue tint
});

// Ember — warm charcoal with a saturated orange-red accent. Saturation and
// muted-text brightness boosted over the old washed-tan look.
const emberDarkColors = buildDarkSemanticColors({
  surface0: "#1c1b1a", // was #1f1f1e
  surface1: "#242220",
  surface2: "#2f2d2b",
  surface3: "#4a4745",
  surface4: "#605d5b",
  surfaceDiffEmpty: "#2a2826",
  surfaceSidebar: "#161514",
  surfaceSidebarHover: "#1e1d1c",
  foregroundMuted: "#b8b3ae", // was #ada9a5
  scrollbarHandle: "#847f7a",
  border: "#35322e", // was #2c2a27
  borderAccent: "#423e39",
  accent: "#d96b45", // was #d97757 — more saturated ember
  accentBright: "#ffab88", // was #e89a7f
  destructive: "#cf513e", // warm orange-red, hue ~10 — sits with the ember accent
});

// Slate — blue-grey terminal look (Ghostty-default lineage). Sidebar
// deepened and borders lifted so the panes actually separate; the light blue
// accent gets dark text instead of unreadable white.
const slateDarkColors = buildDarkSemanticColors({
  surface0: "#282c34",
  surface1: "#2f333d",
  surface2: "#383c48",
  surface3: "#4a4f5e",
  surface4: "#5b6175",
  surfaceDiffEmpty: "#323643",
  surfaceSidebar: "#1e222a", // was #21252d
  surfaceSidebarHover: "#262a33",
  foregroundMuted: "#c8ccd8",
  scrollbarHandle: "#a0a4b2",
  border: "#3d4352", // was #353a47
  borderAccent: "#4a5062",
  accent: "#89b4fa",
  accentBright: "#c4dafd",
  accentForeground: "#14181f", // light blue accent — needs dark text (white was ~2:1)
  destructive: "#c44a55", // red with slight cool lean against the slate-blue surfaces
});

// Neotokyo — near-black surfaces with neon magenta accents. Built for maximum
// contrast: base sits close to black, borders are visibly violet, and the
// accent pair is a deep magenta (white text ≈5.5:1) with a neon bright.
const neotokyoDarkColors = buildDarkSemanticColors({
  surface0: "#0b0b12",
  surface1: "#12121b",
  surface2: "#1a1a26",
  surface3: "#2d2d40",
  surface4: "#3f3f58",
  surfaceDiffEmpty: "#16161f",
  surfaceSidebar: "#07070c",
  surfaceSidebarHover: "#10101a",
  foregroundMuted: "#a2a6c8",
  scrollbarHandle: "#7478a2",
  border: "#23233a",
  borderAccent: "#2f2f4e",
  accent: "#c2188f",
  accentBright: "#ff5ad1",
  destructive: "#d94848", // clearly red so errors never blur into the magenta accent
});

export const SPACING = {
  0: 0,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export const FONT_SIZE = {
  xs: 12,
  code: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
} as const;

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

export const FONT_WEIGHT = {
  normal: "normal" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "bold" as const,
} as const;

export const BORDER_RADIUS = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;

export const BORDER_WIDTH = {
  0: 0,
  1: 1,
  2: 2,
} as const;

export const OPACITY = {
  0: 0,
  50: 0.5,
  100: 1,
} as const;

// Default font stacks. Otto bundles Inter (ui) and JetBrains Mono (mono) — both
// OFL-licensed, free for commercial use — via @expo-google-fonts and loads them
// with `useFonts` in `app/_layout.tsx`, so the family name below is registered on
// every platform (native and web) before first render. Web keeps a CSS fallback
// chain in case the webfont fails to load; native fontFamily takes a single name,
// so it has none. These seed the dynamic `fontFamily` theme token and are the
// fallback an empty user-supplied family resolves to at apply time.
export const DEFAULT_UI_FONT_STACK: string = Platform.select({
  ios: "Inter_400Regular",
  default: "Inter_400Regular",
  web: "Inter_400Regular, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});

export const DEFAULT_MONO_FONT_STACK: string = Platform.select({
  ios: "JetBrainsMono_400Regular",
  default: "JetBrainsMono_400Regular",
  web: "JetBrainsMono_400Regular, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// `fontSize`, `fontFamily`, and `lineHeight` are deliberately widened to plain
// `number`/`string` (not narrowed by `as const`) so the appearance updater can patch
// them at runtime via `UnistylesRuntime.updateTheme`. The remaining tokens keep their
// literal types.
interface CommonTheme {
  spacing: typeof SPACING;
  fontSize: Record<keyof typeof FONT_SIZE, number>;
  fontFamily: { ui: string; mono: string };
  lineHeight: Record<keyof typeof LINE_HEIGHT, number>;
  iconSize: typeof ICON_SIZE;
  fontWeight: typeof FONT_WEIGHT;
  borderRadius: typeof BORDER_RADIUS;
  borderWidth: typeof BORDER_WIDTH;
  opacity: typeof OPACITY;
}

const commonTheme: CommonTheme = {
  spacing: SPACING,
  fontSize: FONT_SIZE,
  fontFamily: { ui: DEFAULT_UI_FONT_STACK, mono: DEFAULT_MONO_FONT_STACK },
  lineHeight: LINE_HEIGHT,
  iconSize: ICON_SIZE,
  fontWeight: FONT_WEIGHT,
  borderRadius: BORDER_RADIUS,
  borderWidth: BORDER_WIDTH,
  opacity: OPACITY,
};

const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.25)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.40)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: darkHighlightColors,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

const lightShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.02)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.04)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.08)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

function buildLightTheme(semanticColors: ReturnType<typeof buildLightSemanticColors>) {
  return {
    colorScheme: "light" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: lightHighlightColors,
    },
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(neutralDarkColors);
export const darkEvergreenTheme = buildDarkTheme(evergreenDarkColors);
export const darkZincTheme = buildDarkTheme(graphiteDarkColors);
export const darkMidnightTheme = buildDarkTheme(nightfallDarkColors);
export const darkClaudeTheme = buildDarkTheme(emberDarkColors);
export const darkGhosttyTheme = buildDarkTheme(slateDarkColors);
export const darkCyberpunkTheme = buildDarkTheme(neotokyoDarkColors);

export const daylightTheme = buildLightTheme(daylightColors);
export const pastelTheme = buildLightTheme(sherbetColors);
export const meadowTheme = buildLightTheme(meadowColors);
export const terracottaTheme = buildLightTheme(terracottaColors);
export const horizonTheme = buildLightTheme(horizonColors);
export const powderTheme = buildLightTheme(powderColors);

// Keep compatibility with existing code
export const theme = darkTheme;

// Export a union type that works for both themes
export type Theme = typeof darkTheme | typeof daylightTheme;

// Only two Unistyles theme keys are ever registered (`light`/`dark`, see
// `styles/unistyles.ts`) — Unistyles' adaptive-theme mechanism hardcodes
// switching between those two literal keys and cannot be pointed at an
// arbitrary named theme. Every variant below (including the neutral
// Daylight/Twilight pair) is exported here as plain data only; nothing but
// `screens/settings/appearance/apply-color-scheme.ts` reads these exports,
// which repaints the two registered `light`/`dark` mirror keys to match
// whichever variant is the user's current per-spectrum preference, for both
// explicit Light/Dark mode and System (adaptive) mode alike.
export const THEME_SWATCHES: Record<ThemeVariantName, string> = {
  daylight: "#f4f4f5",
  pastel: "#e8a3c8",
  meadow: "#2f8f5c",
  terracotta: "#c2663a",
  horizon: "#3b6fd1",
  powder: "#7d93b3",
  dark: "#3f3f46",
  evergreen: "#2D8B62",
  zinc: "#808080",
  midnight: "#4A6BA8",
  claude: "#D96B45",
  ghostty: "#8caaee",
  cyberpunk: "#ff5ad1",
};
