import type { Theme } from "@/styles/theme";
import type { InteractiveViewColorScheme } from "@/architectural-views/view-bridge";

/**
 * The one Otto presentation for every Interactive View.
 *
 * Archify drives all of its colour through a closed set of CSS variables, so
 * the active Otto theme maps onto them directly and every Otto theme (and
 * syntax palette) produces a matching View. The remaining node-kind colours
 * come from the syntax palette, the same source the diff visuals use, so they
 * stay distinct and legible in light and dark.
 *
 * Typography follows the user's font choices: the content font is the
 * document baseline (root size and family), and diagram text is set in the
 * user's monospace font, which also carries into exports. Archify keeps every
 * relative size and all diagram geometry it computed; its node-text fitting
 * assumes a monospace advance, which the mono choice preserves.
 */

export interface InteractiveViewThemeInput {
  theme: Theme;
  /** `@font-face` rules that make bundled UI/mono fonts available offline. */
  fontFaces?: readonly (string | null)[];
}

export interface InteractiveViewThemePayload {
  scheme: InteractiveViewColorScheme;
  css: string;
}

// Opaque-enough tint for a node fill: readable text on top, clear kind colour.
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function cssFontFamily(stack: string): string {
  // Otto font stacks are already CSS font-family lists on web. Guard the one
  // character that could end the declaration early.
  return stack.replace(/[;{}<>]/g, "");
}

// Viewer chrome that Otto's toolbar and status bar replace. The panels these
// controls open (finder, lens, route probe, overview map, guide) stay.
const HIDDEN_VIEWER_CHROME = [".toolbar", ".header", ".diagram-nav"];

const ROUNDED_VIEWER_SURFACES = [
  ".card",
  ".diagram-container",
  ".guided-views",
  ".overview-map",
  ".semantic-lens",
  ".route-probe",
  ".focus-chip",
  ".diagram-guide",
  ".node-finder",
  ".archify-toast",
];

export function buildInteractiveViewTheme({
  theme,
  fontFaces,
}: InteractiveViewThemeInput): InteractiveViewThemePayload {
  const colors = theme.colors;
  const syntax = colors.syntax;
  const scheme: InteractiveViewColorScheme = theme.colorScheme === "light" ? "light" : "dark";
  const radius = `${theme.borderRadius.lg}px`;
  const kinds: Record<string, string> = {
    // Archify also uses the frontend stroke as its UI accent (focus rings,
    // guided-view labels, the finder), so it carries Otto's accent.
    frontend: colors.accent,
    backend: syntax.tag,
    database: syntax.function,
    cloud: syntax.class,
    security: syntax.keyword,
    messagebus: colors.statusWarning,
    external: colors.foregroundMuted,
  };
  const kindVariables = Object.entries(kinds)
    .map(
      ([kind, color]) =>
        `--${kind}-stroke: ${color}; --${kind}-fill: ${tint(color, scheme === "light" ? 14 : 20)};`,
    )
    .join("\n  ");

  // `html[data-otto-view][data-theme]` outranks both the viewer's
  // `[data-theme]` blocks and its `[data-preset][data-theme]` preset blocks.
  const faces = (fontFaces ?? []).filter((face): face is string => Boolean(face)).join("\n");
  const css = `${faces}
html[data-otto-view][data-theme] {
  color-scheme: ${scheme};
  --bg: ${colors.surface0};
  --grid: ${tint(colors.border, 70)};
  --text: ${colors.foreground};
  --text-muted: ${colors.foregroundMuted};
  --text-dim: ${colors.foregroundExtraMuted};
  --text-faint: ${colors.foregroundMuted};
  --panel: ${colors.surface1};
  --panel-border: ${colors.border};
  --lane-fill: ${tint(colors.surface1, 55)};
  --lane-stroke: ${colors.border};
  --arrow: ${colors.foregroundMuted};
  --arrow-emphasis: ${colors.accent};
  --mask: ${colors.surface0};
  ${kindVariables}
  --toolbar-bg: ${colors.surface1};
  --toolbar-border: ${colors.border};
  --toolbar-text: ${colors.foreground};
  --toolbar-hover: ${colors.surface2};
  --toolbar-menu-bg: ${colors.surface1};
  --lens-color: ${colors.accent};
  --guide-accent: ${colors.accent};
  --reach-color: ${colors.accent};
  --reach-fill: ${tint(colors.accent, 14)};
  --archify-nav-reserve: 0px;
  font-size: ${theme.fontSize.content}px;
}
html[data-otto-view] body {
  font-family: ${cssFontFamily(theme.fontFamily.ui)};
  background: var(--bg);
  background-image: none;
  transition: none;
}
html[data-otto-view] .diagram-container svg {
  font-family: ${cssFontFamily(theme.fontFamily.mono)};
}
html[data-otto-view] ::selection { background: ${tint(colors.accent, 30)}; }
html[data-otto-view] ::-webkit-scrollbar { width: 10px; height: 10px; }
html[data-otto-view] ::-webkit-scrollbar-track { background: transparent; }
html[data-otto-view] ::-webkit-scrollbar-thumb {
  background: ${colors.scrollbarHandle};
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: content-box;
}
html[data-otto-view] :focus-visible { outline-color: ${colors.accent}; }
${HIDDEN_VIEWER_CHROME.map((selector) => `html[data-otto-view] ${selector}`).join(",\n")} {
  display: none !important;
}
${ROUNDED_VIEWER_SURFACES.map((selector) => `html[data-otto-view] ${selector}`).join(",\n")} {
  border-radius: ${radius};
}
`;
  return { scheme, css };
}
