import type { Theme } from "@/styles/theme";
import type { EditorThemeSpec } from "./editor-contract";

// App-side only (imports the app theme type); the webview bundle never sees
// this module — hosts resolve the spec here and pass concrete values through
// props (web) or the bridge (native). Concrete values, not CSS variables:
// nested palettes like `colors.syntax` have no per-token CSS variable on web.

// The spec's fontFamily is CSS consumed by CM6 in a DOM — the app document on
// web, a standalone webview document on native. Native's `theme.fontFamily.mono`
// is the Expo-registered font name (e.g. JetBrainsMono_400Regular), which does
// not exist inside the webview document, so the stack must always end in real
// CSS mono fallbacks — otherwise the webview silently renders its default
// serif font. Same pattern as the terminal webview (terminal-emulator-runtime).
const MONO_CSS_FALLBACKS =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

function toMonoCssStack(family: string): string {
  const trimmed = family.trim();
  if (!trimmed) {
    return MONO_CSS_FALLBACKS;
  }
  return /\bmonospace\b/i.test(trimmed) ? trimmed : `${trimmed}, ${MONO_CSS_FALLBACKS}`;
}

// The ruler reads as a sibling of the gutter divider, just quieter: same color,
// half strength, so it marks a column without ever competing with the code in
// front of it.
const RULER_ALPHA = 0.5;

// CM6's default caret is a 1.2px border, which disappears into a wall of
// monospace glyph stems. Two solid pixels is the smallest width that reads as
// "the caret is here" without becoming a block cursor.
const CURSOR_WIDTH_PX = 2;

// Current-line wash. Deliberately far below the selection's alpha (0.15 light /
// 0.20 dark) so a selection on the current line still reads as selected rather
// than as a slightly darker current line.
const ACTIVE_LINE_ALPHA = 0.06;

// Theme border tokens are authored as hex, but a user-supplied or future token
// could be anything — an unparseable color renders at full strength rather than
// disappearing.
function parseHexRgb(color: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) {
    return null;
  }
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseHexRgb(color);
  if (!rgb) {
    return color;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function toHex2(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
}

// The editor deliberately sits in a well one step deeper than the surrounding
// chrome. There is no theme token below `surface0` (it is the base of the
// elevation scale, and going deeper means opposite directions in light vs dark),
// so the well is derived from `surface0` itself: scaled toward black, which
// preserves hue so a tinted palette stays on-tint. The amount is luminance-aware
// — near-black dark surfaces barely move under a small fraction, while a white
// light surface would over-darken, so dark themes deepen far more than light
// ones. The result is "the same surface, deeper" in every theme: a subtle grey
// on the white theme, a near-black on the dark ones.
function deepenEditorSurface(color: string): string {
  const rgb = parseHexRgb(color);
  if (!rgb) {
    return color;
  }
  // Relative luminance (0 = black, 1 = white), rough but enough to steer the amount.
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  // Light (luminance ≈ 1): ~0.035 → a whisper darker. Dark (luminance ≈ 0):
  // ~0.25 → a clear step toward black, roughly the pre-lift surface values.
  const fraction = 0.035 + (1 - luminance) * 0.215;
  const scale = 1 - fraction;
  return `#${toHex2(rgb.r * scale)}${toHex2(rgb.g * scale)}${toHex2(rgb.b * scale)}`;
}

// `rulerColumn` is left null here — it comes from device-local app settings,
// not the theme, so the host merges it into the spec (see file-tab-pane).
export function buildEditorThemeSpec(theme: Theme): EditorThemeSpec {
  return {
    // A well one step deeper than the surrounding chrome (which is surface0),
    // theme-derived so it stays on-tint in light and dark. Only the code area
    // deepens — the gutter (gutterBackground below) and the toolbar/status bar
    // keep surface0, and that contrast is what reads as a well.
    background: deepenEditorSurface(theme.colors.surface0),
    foreground: theme.colors.foreground,
    // The gutter deliberately stays at the surrounding chrome color (surface0),
    // not the deepened code background — the line numbers read as a margin.
    gutterBackground: theme.colors.surface0,
    gutterForeground: theme.colors.foregroundMuted,
    gutterActiveForeground: theme.colors.foreground,
    gutterBorder: theme.colors.border,
    rulerColumn: null,
    rulerColor: withAlpha(theme.colors.border, RULER_ALPHA),
    selectionBackground: theme.colors.terminal.selectionBackground,
    cursor: theme.colors.foreground,
    cursorWidth: CURSOR_WIDTH_PX,
    // MUST stay translucent. The stripe is a background on the `.cm-line`
    // element, and `drawSelection` paints behind the content — so an opaque
    // fill here hides the selection on the caret's line entirely. Derived from
    // the foreground so it darkens light themes and lightens dark ones, the
    // same trick `terminal.selectionBackground` uses, and kept well under the
    // selection's own alpha so an overlap still reads as "selected".
    activeLineBackground: withAlpha(theme.colors.foreground, ACTIVE_LINE_ALPHA),
    // Amber, not another neutral wash. Search matches used to reuse
    // `terminal.selectionBackground` — the *same* value as the selection — so a
    // hit was indistinguishable from selected text and all but invisible at
    // 0.15–0.2 alpha. The status-warning surfaces are already calibrated per
    // scheme (heavier alpha on dark), and the solid tone gives the outline that
    // survives a busy syntax color underneath it.
    searchMatchBackground: theme.colors.statusWarningSurface,
    searchMatchBorder: theme.colors.statusWarningMuted,
    activeSearchMatchBackground: theme.colors.statusWarningSurfaceStrong,
    activeSearchMatchBorder: theme.colors.statusWarningStrong,
    fontFamily: toMonoCssStack(theme.fontFamily.mono),
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    syntax: theme.colors.syntax,
  };
}
