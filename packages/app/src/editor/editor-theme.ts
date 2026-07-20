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

// Theme border tokens are authored as hex, but a user-supplied or future token
// could be anything — an unparseable color renders at full strength rather than
// disappearing.
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) {
    return color;
  }
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// `rulerColumn` is left null here — it comes from device-local app settings,
// not the theme, so the host merges it into the spec (see file-tab-pane).
export function buildEditorThemeSpec(theme: Theme): EditorThemeSpec {
  return {
    background: theme.colors.surface0,
    foreground: theme.colors.foreground,
    gutterForeground: theme.colors.foregroundMuted,
    gutterActiveForeground: theme.colors.foreground,
    gutterBorder: theme.colors.border,
    rulerColumn: null,
    rulerColor: withAlpha(theme.colors.border, RULER_ALPHA),
    selectionBackground: theme.colors.terminal.selectionBackground,
    cursor: theme.colors.foreground,
    activeLineBackground: theme.colors.surface1,
    searchMatchBackground: theme.colors.terminal.selectionBackground,
    activeSearchMatchBackground: theme.colors.borderAccent,
    fontFamily: toMonoCssStack(theme.fontFamily.mono),
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    syntax: theme.colors.syntax,
  };
}
