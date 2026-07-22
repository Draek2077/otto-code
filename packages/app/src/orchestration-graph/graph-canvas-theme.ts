import type { Theme } from "@/styles/theme";

// Concrete color values for the DOM node-editor skin — resolved app-side from
// the Otto theme (the CM6 editor-theme pattern: concrete values, not CSS
// variables, injected via withUnistyles so theme switches re-render).

export interface GraphCanvasTheme {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  /** The warm counter hue for input ports (output ports wear the accent). */
  warning: string;
  danger: string;
  fontFamilyUi: string;
  fontFamilyMono: string;
}

export function buildGraphCanvasTheme(theme: Theme): GraphCanvasTheme {
  return {
    background: theme.colors.background,
    surface: theme.colors.surface1,
    surfaceRaised: theme.colors.surface2,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    accent: theme.colors.accent,
    warning: theme.colors.statusWarning,
    danger: theme.colors.statusDanger,
    fontFamilyUi: theme.fontFamily.ui,
    fontFamilyMono: theme.fontFamily.mono,
  };
}
