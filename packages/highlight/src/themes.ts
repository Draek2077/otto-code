import { darkHighlightColors, lightHighlightColors } from "./colors.js";
import type { DiffBackgroundColors, HighlightStyle } from "./types.js";

// Syntax-highlighting themes are chosen independently of the app's light/dark
// theme. The ONLY coupling is the light/dark axis: a theme that ships both
// variants uses its light palette on a light app and its dark palette on a dark
// app (resolveSyntaxColors receives the active theme's colorScheme). Every
// theme ships both variants -- none may assume a dark (or light) surface, so
// none may rely on a bare white/black "base" text color that would vanish on
// the other surface. The code frame — gutter, line numbers, background —
// follows the app theme, not the palette.
export type SyntaxThemeId =
  | "default"
  | "github"
  | "vscode"
  | "jetbrains"
  | "monokai"
  | "nightshade"
  | "neotokyo";

export const SYNTAX_THEME_IDS: readonly SyntaxThemeId[] = [
  "default",
  "github",
  "vscode",
  "jetbrains",
  "monokai",
  "nightshade",
  "neotokyo",
];

export interface SyntaxThemeOption {
  id: SyntaxThemeId;
  label: string;
}

export const SYNTAX_THEME_OPTIONS: readonly SyntaxThemeOption[] = [
  { id: "default", label: "Default" },
  { id: "github", label: "GitHub" },
  { id: "vscode", label: "VS Code" },
  { id: "jetbrains", label: "JetBrains" },
  { id: "monokai", label: "Monokai" },
  { id: "nightshade", label: "Nightshade" },
  { id: "neotokyo", label: "Neotokyo" },
];

export type SyntaxColors = Record<HighlightStyle, string> & DiffBackgroundColors;

// A compact per-theme role palette. `expandRolePalette` maps these roles onto
// all 20 HighlightStyle tokens plus the diff row background pair, so every
// theme stays complete and internally consistent. GitHub keeps its own
// hand-tuned maps (colors.ts) for exactness and byte-for-byte back-compat with
// the previous default.
interface RolePalette {
  base: string; // plain text: variables, punctuation
  keyword: string;
  comment: string; // comments, meta
  string: string; // strings, regexp, links
  number: string; // numbers, literals, escapes
  function: string; // functions, definitions, headings
  type: string; // types, classes
  tag: string;
  attribute: string; // attributes, properties
  operator: string;
  diffAdded: string; // added diff row background (semi-transparent green)
  diffRemoved: string; // removed diff row background (semi-transparent red)
}

// Re-derives an rgba() string at a different alpha. Boosts each theme's diff
// row tints into their intraline emphasis pair without every theme authoring
// a second color for the same hue.
function withAlpha(rgbaColor: string, alpha: number): string {
  const match = rgbaColor.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),/);
  if (!match) return rgbaColor;
  const [, r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function expandRolePalette(r: RolePalette): SyntaxColors {
  return {
    keyword: r.keyword,
    comment: r.comment,
    string: r.string,
    number: r.number,
    literal: r.number,
    function: r.function,
    definition: r.function,
    class: r.type,
    type: r.type,
    tag: r.tag,
    attribute: r.attribute,
    property: r.attribute,
    variable: r.base,
    operator: r.operator,
    punctuation: r.base,
    regexp: r.string,
    escape: r.number,
    meta: r.comment,
    heading: r.function,
    link: r.string,
    diffAdded: r.diffAdded,
    diffRemoved: r.diffRemoved,
    diffAddedEmphasis: withAlpha(r.diffAdded, 0.4),
    diffRemovedEmphasis: withAlpha(r.diffRemoved, 0.35),
  };
}

// --- Default (high-contrast primary hues — the CGA-basic baseline) -------
const defaultLight: RolePalette = {
  base: "#000000",
  keyword: "#0000aa",
  comment: "#666666",
  string: "#aa0000",
  number: "#aa00aa",
  function: "#aa5500",
  type: "#00aaaa",
  tag: "#0000aa",
  attribute: "#00aa00",
  operator: "#000000",
  diffAdded: "rgba(0, 128, 0, 0.12)",
  diffRemoved: "rgba(170, 0, 0, 0.12)",
};
const defaultDark: RolePalette = {
  base: "#ffffff",
  keyword: "#5555ff",
  comment: "#999999",
  string: "#55ff55",
  number: "#55ffff",
  function: "#ffff55",
  type: "#ff55ff",
  tag: "#5555ff",
  attribute: "#55ffff",
  operator: "#ffffff",
  diffAdded: "rgba(85, 255, 85, 0.18)",
  diffRemoved: "rgba(255, 85, 85, 0.18)",
};

// --- VS Code (Light+ / Dark+) ---------------------------------------------
const vscodeLight: RolePalette = {
  base: "#000000",
  keyword: "#0000ff",
  comment: "#008000",
  string: "#a31515",
  number: "#098658",
  function: "#795e26",
  type: "#267f99",
  tag: "#800000",
  attribute: "#e50000",
  operator: "#000000",
  diffAdded: "rgba(46, 125, 50, 0.14)",
  diffRemoved: "rgba(198, 40, 40, 0.14)",
};
const vscodeDark: RolePalette = {
  base: "#d4d4d4",
  keyword: "#569cd6",
  comment: "#6a9955",
  string: "#ce9178",
  number: "#b5cea8",
  function: "#dcdcaa",
  type: "#4ec9b0",
  tag: "#569cd6",
  attribute: "#9cdcfe",
  operator: "#d4d4d4",
  diffAdded: "rgba(75, 139, 31, 0.22)",
  diffRemoved: "rgba(190, 17, 0, 0.22)",
};

// --- JetBrains (IntelliJ Light / Darcula) ---------------------------------
const jetbrainsLight: RolePalette = {
  base: "#000000",
  keyword: "#0033b3",
  comment: "#8c8c8c",
  string: "#067d17",
  number: "#1750eb",
  function: "#00627a",
  type: "#20999d",
  tag: "#3f7f7f",
  attribute: "#660000",
  operator: "#000000",
  diffAdded: "rgba(56, 142, 60, 0.15)",
  diffRemoved: "rgba(198, 40, 40, 0.15)",
};
const jetbrainsDark: RolePalette = {
  base: "#a9b7c6",
  keyword: "#cc7832",
  comment: "#808080",
  string: "#6a8759",
  number: "#6897bb",
  function: "#ffc66d",
  type: "#b3ae60",
  tag: "#e8bf6a",
  attribute: "#a9b7c6",
  operator: "#a9b7c6",
  diffAdded: "rgba(46, 107, 62, 0.3)",
  diffRemoved: "rgba(107, 46, 46, 0.3)",
};

// --- Monokai (Light / Dark) ------------------------------------------------
const monokaiLight: RolePalette = {
  base: "#272822",
  keyword: "#c4133b",
  comment: "#75715e",
  string: "#a68a0d",
  number: "#7c3fb5",
  function: "#4b8b1f",
  type: "#0f83a3",
  tag: "#c4133b",
  attribute: "#4b8b1f",
  operator: "#c4133b",
  diffAdded: "rgba(75, 139, 31, 0.14)",
  diffRemoved: "rgba(179, 37, 31, 0.14)",
};
const monokaiDark: RolePalette = {
  base: "#f8f8f2",
  keyword: "#f92672",
  comment: "#75715e",
  string: "#e6db74",
  number: "#ae81ff",
  function: "#a6e22e",
  type: "#66d9ef",
  tag: "#f92672",
  attribute: "#a6e22e",
  operator: "#f92672",
  diffAdded: "rgba(166, 226, 46, 0.18)",
  diffRemoved: "rgba(248, 53, 53, 0.18)",
};

// --- Nightshade (Light / Dark — gothic pink/purple/cyan, formerly "Dracula";
// renamed once it grew a light variant the original theme never had) --------
const nightshadeLight: RolePalette = {
  base: "#282a36",
  keyword: "#bd2f7a",
  comment: "#6272a4",
  string: "#8a7a1f",
  number: "#7c4fd1",
  function: "#1f9c4a",
  type: "#0e93a8",
  tag: "#bd2f7a",
  attribute: "#1f9c4a",
  operator: "#bd2f7a",
  diffAdded: "rgba(31, 156, 74, 0.14)",
  diffRemoved: "rgba(179, 54, 54, 0.14)",
};
const nightshadeDark: RolePalette = {
  base: "#f8f8f2",
  keyword: "#ff79c6",
  comment: "#6272a4",
  string: "#f1fa8c",
  number: "#bd93f9",
  function: "#50fa7b",
  type: "#8be9fd",
  tag: "#ff79c6",
  attribute: "#50fa7b",
  operator: "#ff79c6",
  diffAdded: "rgba(80, 250, 123, 0.18)",
  diffRemoved: "rgba(255, 85, 85, 0.18)",
};

// --- Neotokyo (Light / Dark — cyber yellow, hot pink, neon cyan) ----------
const neotokyoLight: RolePalette = {
  base: "#1a1025",
  keyword: "#c2188f",
  comment: "#7a7a9c",
  string: "#8a7600",
  number: "#0089a3",
  function: "#a3157a",
  type: "#7b2fd4",
  tag: "#c2188f",
  attribute: "#0089a3",
  operator: "#0089a3",
  diffAdded: "rgba(31, 156, 26, 0.14)",
  diffRemoved: "rgba(194, 31, 61, 0.14)",
};
const neotokyoDark: RolePalette = {
  base: "#e4e4f4",
  keyword: "#ff2ec4",
  comment: "#6f6f94",
  string: "#fcee0a",
  number: "#0ff0fc",
  function: "#ff6ec7",
  type: "#b967ff",
  tag: "#ff2ec4",
  attribute: "#0ff0fc",
  operator: "#0ff0fc",
  diffAdded: "rgba(57, 255, 20, 0.18)",
  diffRemoved: "rgba(255, 43, 78, 0.18)",
};

export function isSyntaxThemeId(value: string): value is SyntaxThemeId {
  return (SYNTAX_THEME_IDS as readonly string[]).includes(value);
}

// Resolve a theme id + the app's color scheme to a full token palette. Only the
// light/dark axis is coupled to the app; the theme brand is the user's choice.
export function resolveSyntaxColors(
  id: SyntaxThemeId,
  colorScheme: "light" | "dark",
): SyntaxColors {
  const dark = colorScheme === "dark";
  switch (id) {
    case "default":
      return expandRolePalette(dark ? defaultDark : defaultLight);
    case "github":
      return dark ? darkHighlightColors : lightHighlightColors;
    case "vscode":
      return expandRolePalette(dark ? vscodeDark : vscodeLight);
    case "jetbrains":
      return expandRolePalette(dark ? jetbrainsDark : jetbrainsLight);
    case "monokai":
      return expandRolePalette(dark ? monokaiDark : monokaiLight);
    case "nightshade":
      return expandRolePalette(dark ? nightshadeDark : nightshadeLight);
    case "neotokyo":
      return expandRolePalette(dark ? neotokyoDark : neotokyoLight);
  }
}
