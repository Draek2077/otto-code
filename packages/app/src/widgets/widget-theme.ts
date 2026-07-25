import type { WidgetThemeInput } from "@otto-code/protocol/widgets/theme";
import type { Theme } from "@/styles/theme";

// The guest is a WebView/iframe, so it takes a CSS font stack even where the
// native theme token is a single family name. Appending generic fallbacks is
// free (a duplicate family in a stack is ignored) and stops a widget rendering
// in Times when a webfont has not loaded yet.
const SANS_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Map Otto's live theme onto the widget CSS variables.
 *
 * Concrete values, not `var(--colors-…)` references: the guest document has its
 * own `:root` and cannot see the host's cascade, and the tint math in
 * `protocol/widgets/theme.ts` needs real hex to composite against.
 *
 * Read through `withUnistyles` at the single leaf that renders a widget frame
 * (see widget-card.tsx) so a theme change re-skins mounted widgets without
 * re-rendering the transcript around them.
 */
export function buildWidgetTheme(theme: Theme): WidgetThemeInput {
  return {
    isDark: theme.colorScheme === "dark",
    surface0: theme.colors.surface0,
    surface1: theme.colors.surface1,
    surface2: theme.colors.surface2,
    surface3: theme.colors.surface3,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    border: theme.colors.border,
    accent: theme.colors.accent,
    danger: theme.colors.destructive,
    success: theme.colors.success,
    fontSans: `${theme.fontFamily.ui}, ${SANS_FALLBACK}`,
    fontMono: `${theme.fontFamily.mono}, ${MONO_FALLBACK}`,
  };
}
