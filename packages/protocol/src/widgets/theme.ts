/**
 * The CSS custom properties a widget fragment is written against, and the
 * mapping from Otto's semantic theme tokens onto them.
 *
 * The HOST assembles the guest document, not the daemon — because only the
 * client knows which theme is live, and a theme switch has to re-skin an
 * already-rendered widget without a daemon round trip. The variable NAMES are
 * frozen here so the contract document, the fixtures, and every renderer agree.
 */

export interface WidgetThemeInput {
  /** True when the live Otto theme is a dark one. Drives the tint direction. */
  isDark: boolean;
  surface0: string;
  surface1: string;
  surface2: string;
  /** Highest-elevation surface; also the source of the stronger border steps. */
  surface3: string;
  foreground: string;
  foregroundMuted: string;
  border: string;
  accent: string;
  danger: string;
  success: string;
  /** Optional — themes without a warning token fall back to a fixed amber. */
  warning?: string;
  fontSans: string;
  fontMono: string;
  /** Serif "voice" face. Falls back to a generic serif stack. */
  fontSerif?: string;
}

const FALLBACK_WARNING = "#d97706";
const FALLBACK_SERIF = "Georgia, 'Times New Roman', serif";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#rgb` / `#rrggbb` / `#rrggbbaa`. Alpha is dropped: these tints are
 * composited against a known surface here, so carrying alpha through would
 * double-apply it. Returns null for anything else (named colors, rgb(), the
 * `rgba(0,0,0,0.06)` hover token) and callers pass such values through
 * untouched rather than guessing.
 */
function parseHex(value: string): Rgb | null {
  const hex = value.trim();
  if (!hex.startsWith("#")) {
    return null;
  }
  const body = hex.slice(1);
  if (body.length === 3) {
    const r = Number.parseInt(body[0] + body[0], 16);
    const g = Number.parseInt(body[1] + body[1], 16);
    const b = Number.parseInt(body[2] + body[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (body.length === 6 || body.length === 8) {
    const r = Number.parseInt(body.slice(0, 2), 16);
    const g = Number.parseInt(body.slice(2, 4), 16);
    const b = Number.parseInt(body.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Composite `color` over `base` at `amount` opacity, opaquely. */
function mix(color: string, base: string, amount: number): string {
  const from = parseHex(color);
  const to = parseHex(base);
  if (!from || !to) {
    return color;
  }
  return toHex({
    r: to.r + (from.r - to.r) * amount,
    g: to.g + (from.g - to.g) * amount,
    b: to.b + (from.b - to.b) * amount,
  });
}

/**
 * A role color legible as TEXT on the widget background. The raw accent/danger
 * tokens are tuned to sit on Otto's chrome, which is not always the same
 * contrast problem as body copy on `--surface-0`, so nudge toward the
 * foreground on dark themes and away from it on light ones.
 */
function roleText(color: string, input: WidgetThemeInput): string {
  return input.isDark ? mix(color, "#ffffff", 0.78) : mix(color, "#000000", 0.85);
}

/** A wash of a role color usable as a fill behind role text. */
function roleTint(color: string, input: WidgetThemeInput): string {
  return mix(color, input.surface0, input.isDark ? 0.22 : 0.12);
}

/** SVG palette. Fixed hues rather than theme tokens — a chart needs categorical
 * separation that survives every theme, and the two dark/light rows keep each
 * hue legible on whichever surface it lands on. */
const SVG_PALETTE_LIGHT: Record<string, string> = {
  blue: "#2563eb",
  teal: "#0d9488",
  amber: "#b45309",
  red: "#dc2626",
  green: "#16a34a",
  purple: "#7c3aed",
  pink: "#db2777",
  gray: "#52525b",
};

const SVG_PALETTE_DARK: Record<string, string> = {
  blue: "#60a5fa",
  teal: "#2dd4bf",
  amber: "#fbbf24",
  red: "#f87171",
  green: "#4ade80",
  purple: "#c084fc",
  pink: "#f472b6",
  gray: "#a1a1aa",
};

export function widgetPaletteFor(isDark: boolean): Record<string, string> {
  return isDark ? SVG_PALETTE_DARK : SVG_PALETTE_LIGHT;
}

/**
 * The `:root` custom-property block. Split out from the stylesheet so a theme
 * change can be reasoned about (and tested) without the 200 lines of rules.
 */
export function buildWidgetThemeVariables(input: WidgetThemeInput): string {
  const warning = input.warning ?? FALLBACK_WARNING;
  const serif = input.fontSerif ?? FALLBACK_SERIF;
  const palette = widgetPaletteFor(input.isDark);
  const paletteVars = Object.entries(palette)
    .map(([name, value]) => `  --c-${name}: ${value};`)
    .join("\n");

  return [
    ":root {",
    `  --surface-0: ${input.surface0};`,
    `  --surface-1: ${input.surface1};`,
    `  --surface-2: ${input.surface2};`,
    `  --text-primary: ${input.foreground};`,
    `  --text-secondary: ${mix(input.foreground, input.surface0, 0.75)};`,
    `  --text-muted: ${input.foregroundMuted};`,
    `  --text-accent: ${roleText(input.accent, input)};`,
    `  --text-danger: ${roleText(input.danger, input)};`,
    `  --text-success: ${roleText(input.success, input)};`,
    `  --text-warning: ${roleText(warning, input)};`,
    `  --bg-accent: ${roleTint(input.accent, input)};`,
    `  --bg-danger: ${roleTint(input.danger, input)};`,
    `  --bg-success: ${roleTint(input.success, input)};`,
    `  --bg-warning: ${roleTint(warning, input)};`,
    `  --border: ${input.border};`,
    `  --border-strong: ${mix(input.foreground, input.border, 0.25)};`,
    `  --border-stronger: ${mix(input.foreground, input.border, 0.5)};`,
    `  --border-accent: ${mix(input.accent, input.border, 0.6)};`,
    `  --border-danger: ${mix(input.danger, input.border, 0.6)};`,
    `  --border-success: ${mix(input.success, input.border, 0.6)};`,
    `  --border-warning: ${mix(warning, input.border, 0.6)};`,
    `  --font-sans: ${input.fontSans};`,
    `  --font-mono: ${input.fontMono};`,
    `  --font-voice: ${serif};`,
    "  --radius: 8px;",
    "  --radius-sm: 4px;",
    "  --pad-sm: 8px;",
    "  --pad-md: 12px;",
    "  --pad-lg: 16px;",
    "  --pad-xl: 24px;",
    "  --gap-xs: 4px;",
    "  --gap-sm: 8px;",
    "  --gap-md: 12px;",
    "  --gap-lg: 16px;",
    "  --gap-xl: 24px;",
    paletteVars,
    "}",
  ].join("\n");
}
