import type { Theme } from "@/styles/theme";
import type { MermaidThemeConfig } from "./mermaid-contract";

/**
 * Otto theme → the flat value bag mermaid needs.
 *
 * Deliberately *not* `themeColorRef`: mermaid runs color math (khroma) over
 * every variable it is handed, so a `var(--colors-surface2)` string produces
 * `NaN` shades and an unstyled diagram. Concrete values are the only option,
 * which is also why a diagram inside the black chat scope on web follows the
 * app theme rather than the scope (same class of leak as icon `color` props -
 * see docs/unistyles.md).
 */
export function buildMermaidThemeConfig(theme: Theme): MermaidThemeConfig {
  return {
    dark: theme.colorScheme === "dark",
    background: theme.colors.surface2,
    surface: theme.colors.surface3,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    accent: theme.colors.accent,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
  };
}

/**
 * The `themeVariables` payload for mermaid's `base` theme.
 *
 * `base` is the only built-in theme that honours `themeVariables`; the others
 * hardcode their palette. Mermaid fills unspecified variables by deriving them
 * from `primaryColor`/`background`, so this list only has to cover the slots
 * where a derived value would be illegible on an Otto surface - plus the
 * per-diagram families (sequence, class/state, notes) that derive from their
 * own variables rather than the primaries.
 */
export function buildMermaidThemeVariables(
  config: MermaidThemeConfig,
): Record<string, string | number> {
  const { background, surface, border, foreground, foregroundMuted, accent, fontFamily, fontSize } =
    config;

  return {
    darkMode: config.dark ? "true" : "false",
    fontFamily,
    fontSize: `${fontSize}px`,

    // Primaries. Nodes sit on `surface` so they read as raised against the
    // fence background they share with code blocks.
    background,
    primaryColor: surface,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: background,
    secondaryTextColor: foreground,
    secondaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: border,

    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: foreground,
    textColor: foreground,
    titleColor: foreground,
    lineColor: foregroundMuted,
    arrowheadColor: foregroundMuted,
    edgeLabelBackground: background,

    clusterBkg: background,
    clusterBorder: border,

    // Sequence diagrams derive almost nothing from the primaries.
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: foreground,
    actorLineColor: foregroundMuted,
    signalColor: foreground,
    signalTextColor: foreground,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: foreground,
    loopTextColor: foreground,
    activationBkgColor: surface,
    activationBorderColor: border,
    sequenceNumberColor: background,

    // Notes are yellow-on-yellow by default in both schemes.
    noteBkgColor: surface,
    noteTextColor: foreground,
    noteBorderColor: accent,

    // Class / state / ER share these.
    classText: foreground,
    attributeBackgroundColorOdd: background,
    attributeBackgroundColorEven: surface,
    labelColor: foreground,

    // Error and "unknown diagram" chrome.
    errorBkgColor: background,
    errorTextColor: foreground,
  };
}
