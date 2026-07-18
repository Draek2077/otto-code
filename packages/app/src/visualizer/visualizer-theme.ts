import {
  DARK_VARIANT_THEMES,
  LIGHT_VARIANT_THEMES,
} from "@/screens/settings/appearance/apply-color-scheme";
import type { DarkThemeName, LightThemeName } from "@/styles/theme";

// Builds the Visualizer guest palette from the active theme variant: a full
// overlay for the vendor page's `COLORS` registry (vendor/agent-flow/web/lib/
// colors.ts — merged at module init from `window.__OTTO_THEME__`, see
// OTTO-PATCHES.md) plus CSS variables for the shell's glass-card/scrollbar
// overrides (emit-bundle.mjs). Design intent (docs/visualizer.md "Theme
// colors"):
//
// - The stage (`void`) is always DARKER than the app background — a step
//   below even the sidebar — so the graph reads as its own space. Light
//   variants stay light (slightly deepened paper) with dark glyphs; dark
//   variants go near-black.
// - The vendor's fixed holographic cyan becomes the variant's ACCENT: glow,
//   chrome, idle/thinking states, links. Every variant gets its own identity.
// - Semantic hues ride the theme's own semantic tokens (statusWarning for
//   tool activity, statusSuccess for completion/cost, statusDanger for
//   errors/live, statusMerged for thinking/reasoning/dispatch purple,
//   diffAddition/diffDeletion for diffs) so the page agrees with the rest of
//   the app about what amber/green/red/purple mean.
//
// FORMAT RULES (load-bearing): vendor draw/component code appends 2-digit hex
// alphas to "solid" tokens (`COLORS.holoBase + '80'`, `stateColor + '90'`,
// `alphaHex(...)`) — every solid token this builder emits MUST therefore be a
// 6-digit `#rrggbb`. Tokens the vendor authored as `rgba(...)`, partial
// `rgba(r, g, b,` bases (consumed via `withAlpha`), 8-digit hexes, gradients,
// or box-shadow strings must keep exactly that shape.

interface VisualizerPaletteInput {
  colorScheme: "light" | "dark";
  colors: {
    background: string;
    surface1: string;
    foreground: string;
    foregroundMuted: string;
    accent: string;
    statusSuccess: string;
    statusWarning: string;
    statusDanger: string;
    statusMerged: string;
    diffAddition: string;
    diffDeletion: string;
  };
}

export interface VisualizerPalette {
  /** Full-page/stage background — also sent as `colors.void`; separate so the
   * embed views can paint their host-side containers before the guest boots. */
  background: string;
  /** Overlay merged over the vendor page's COLORS registry. */
  colors: Record<string, string>;
  /** CSS custom properties applied on :root for the shell stylesheet. */
  css: Record<`--otto-vis-${string}`, string>;
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Mix `a` toward `b` by t (0..1); 6-digit hex in, 6-digit hex out. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${((m(ar, br) << 16) | (m(ag, bg) << 8) | m(ab, bb)).toString(16).padStart(6, "0")}`;
}

/** `rgba(r, g, b, a)` — the vendor's spaced rgba shape. */
function alpha(hex: string, a: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Partial `rgba(r, g, b,` base for the vendor's `withAlpha` helper. */
function partial(hex: string): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b},`;
}

/** 8-digit hex (`#rrggbbaa`) for tokens the vendor authored in that shape. */
function hex8(hex: string, aa: string): string {
  return hex.slice(0, 7) + aa;
}

/** Everything about the palette that depends on the color scheme, computed in
 * one branch-free-consumer shape so buildVisualizerPalette stays a flat token
 * map (and under the lint complexity ceiling). */
interface SchemeProfile {
  voidBg: string;
  cardBase: string;
  holoBright: string;
  holoHot: string;
  amberText: string;
  greenText: string;
  redText: string;
  purpleText: string;
  assistantText: string;
  thinkingText: string;
  userText: string;
  /** Body-ink base for faint transcript text (holo-bright on dark, plain
   * foreground on light). */
  ink: string;
  nodeInterior: string;
  glassBg: string;
  glassBorderA: number;
  /** Multiplier for the faint holo border/separator alphas — accent tints
   * need roughly double the alpha to register on a light stage. */
  borderBoost: number;
  panelBg: string;
  toggleActiveA: number;
  toggleBorderA: number;
  tabSelectedBgA: number;
  tabInactiveBgA: number;
  tabSelectedBorderA: number;
  tabInactiveBorderA: number;
  /** How far card fills mix toward danger for error cards. */
  errorMixT: number;
  cardBgDarkBase: string;
  costPillBg: string;
  bashResultBg: string;
  toolResultBgA: number;
  codeBlockBg: string;
  diffRemoved: string;
  diffAdded: string;
  scrollbarThumbA: number;
  scrollbarThumbHoverA: number;
  inputBgA: number;
  inputBorderA: number;
  inputColor: string;
  inputPlaceholderA: number;
  inputFocusBorderA: number;
}

// The stage (`voidBg`) is always darker than the app background (user-locked).
// Dark variants drop well below the app bg; light variants deepen just enough
// to sit under the sidebar/panels while staying unmistakably light. Status
// hues get "text-grade" lifts on dark so they read on the near-black stage;
// the light-scheme status tokens are already darkened for light surfaces
// (theme.ts) and pass through.

function darkProfile(c: VisualizerPaletteInput["colors"]): SchemeProfile {
  const holo = c.accent;
  const voidBg = mix(c.background, "#000000", 0.55);
  const cardBase = mix(c.background, "#000000", 0.3);
  const holoBright = mix(holo, "#ffffff", 0.4);
  return {
    voidBg,
    cardBase,
    holoBright,
    holoHot: "#ffffff",
    amberText: mix(c.statusWarning, "#ffffff", 0.15),
    greenText: mix(c.statusSuccess, "#ffffff", 0.25),
    redText: mix(c.statusDanger, "#ffffff", 0.2),
    purpleText: mix(c.statusMerged, "#ffffff", 0.3),
    assistantText: mix(holo, "#ffffff", 0.55),
    thinkingText: mix(c.statusMerged, "#ffffff", 0.45),
    userText: mix(c.statusWarning, "#ffffff", 0.3),
    ink: holoBright,
    nodeInterior: alpha(mix(voidBg, holo, 0.08), 0.5),
    glassBg: alpha(cardBase, 0.7),
    glassBorderA: 0.15,
    borderBoost: 1,
    panelBg: alpha(mix(c.background, "#000000", 0.4), 0.85),
    toggleActiveA: 0.15,
    toggleBorderA: 0.1,
    tabSelectedBgA: 0.15,
    tabInactiveBgA: 0.03,
    tabSelectedBorderA: 0.3,
    tabInactiveBorderA: 0.08,
    errorMixT: 0.25,
    cardBgDarkBase: mix(c.background, "#000000", 0.5),
    costPillBg: alpha(mix(c.background, "#000000", 0.35), 0.75),
    bashResultBg: "rgba(0,0,0,0.25)",
    toolResultBgA: 0.04,
    codeBlockBg: "rgba(0,0,0,0.3)",
    diffRemoved: mix(c.diffDeletion, "#ffffff", 0.15),
    diffAdded: mix(c.diffAddition, "#ffffff", 0.15),
    scrollbarThumbA: 0.15,
    scrollbarThumbHoverA: 0.25,
    inputBgA: 0.05,
    inputBorderA: 0.15,
    inputColor: holoBright,
    inputPlaceholderA: 0.3,
    inputFocusBorderA: 0.3,
  };
}

function lightProfile(c: VisualizerPaletteInput["colors"]): SchemeProfile {
  const holo = c.accent;
  const voidBg = mix(c.background, "#000000", 0.05);
  const cardBase = c.surface1;
  return {
    voidBg,
    cardBase,
    holoBright: mix(holo, c.foreground, 0.35),
    holoHot: mix(holo, c.foreground, 0.7),
    amberText: c.statusWarning,
    greenText: c.statusSuccess,
    redText: c.statusDanger,
    purpleText: c.statusMerged,
    assistantText: mix(holo, c.foreground, 0.55),
    thinkingText: mix(c.statusMerged, c.foreground, 0.3),
    userText: mix(c.statusWarning, c.foreground, 0.25),
    ink: c.foreground,
    nodeInterior: alpha(cardBase, 0.55),
    glassBg: alpha(cardBase, 0.78),
    glassBorderA: 0.3,
    borderBoost: 2,
    panelBg: alpha(cardBase, 0.9),
    toggleActiveA: 0.18,
    toggleBorderA: 0.25,
    tabSelectedBgA: 0.18,
    tabInactiveBgA: 0.06,
    tabSelectedBorderA: 0.45,
    tabInactiveBorderA: 0.16,
    errorMixT: 0.12,
    cardBgDarkBase: cardBase,
    costPillBg: alpha(cardBase, 0.85),
    bashResultBg: "rgba(0,0,0,0.04)",
    toolResultBgA: 0.06,
    codeBlockBg: "rgba(0,0,0,0.06)",
    diffRemoved: c.diffDeletion,
    diffAdded: c.diffAddition,
    scrollbarThumbA: 0.3,
    scrollbarThumbHoverA: 0.45,
    inputBgA: 0.07,
    inputBorderA: 0.3,
    inputColor: c.foreground,
    inputPlaceholderA: 0.5,
    inputFocusBorderA: 0.5,
  };
}

export function buildVisualizerPalette(theme: VisualizerPaletteInput): VisualizerPalette {
  const c = theme.colors;
  const p = theme.colorScheme === "dark" ? darkProfile(c) : lightProfile(c);

  const holo = c.accent;
  const {
    voidBg,
    cardBase,
    holoBright,
    holoHot,
    amberText,
    greenText,
    redText,
    purpleText,
    assistantText,
    thinkingText,
    userText,
  } = p;
  const purple = c.statusMerged;
  const amber = c.statusWarning;
  const green = c.statusSuccess;
  const red = c.statusDanger;

  const colors: Record<string, string> = {
    // Background
    void: voidBg,

    // Primary hologram
    holoBase: holo,
    holoBright,
    holoHot,

    // Agent states (solid 6-hex — vendor appends hex alphas)
    idle: holo,
    thinking: holo,
    tool_calling: amberText,
    complete: greenText,
    error: redText,
    paused: c.foregroundMuted,
    waiting_permission: amberText,

    // Edge/particle colors
    dispatch: purpleText,
    return: greenText,
    tool: amberText,
    message: holo,

    // Context breakdown
    contextSystem: c.foregroundMuted,
    contextUser: holo,
    contextToolResults: amberText,
    contextReasoning: purpleText,
    contextSubagent: greenText,

    // UI chrome
    nodeInterior: p.nodeInterior,
    textPrimary: c.foreground,
    textDim: hex8(c.foreground, "99"),
    textMuted: hex8(c.foreground, "66"),

    // Glass card
    glassBg: p.glassBg,
    glassBorder: alpha(holo, p.glassBorderA),
    glassHighlight: alpha(holo, 0.08),

    // Holo background/border opacities
    holoBg03: alpha(holo, 0.03),
    holoBg05: alpha(holo, 0.05),
    holoBg10: alpha(holo, 0.1),
    holoBorder06: alpha(holo, 0.06 * p.borderBoost),
    holoBorder08: alpha(holo, 0.08 * p.borderBoost),
    holoBorder10: alpha(holo, 0.1 * p.borderBoost),
    holoBorder12: alpha(holo, 0.12 * p.borderBoost),

    // Panel chrome
    panelBg: p.panelBg,
    panelSeparator: alpha(holo, 0.05 * p.borderBoost),

    // Toggle buttons
    toggleActive: alpha(holo, p.toggleActiveA),
    toggleInactive: alpha(holo, 0.05),
    toggleBorder: alpha(holo, p.toggleBorderA),

    // Live indicator
    liveDot: redText,
    liveText: redText,
    liveResumeBg: alpha(red, 0.15),
    liveResumeBorder: alpha(red, 0.35),

    // Discovery types
    discoveryFile: holo,
    discoveryPattern: purpleText,
    discoveryFinding: greenText,
    discoveryCode: amberText,

    // Session tabs
    tabSelectedBg: alpha(holo, p.tabSelectedBgA),
    tabInactiveBg: alpha(holo, p.tabInactiveBgA),
    tabSelectedBorder: alpha(holo, p.tabSelectedBorderA),
    tabInactiveBorder: alpha(holo, p.tabInactiveBorderA),
    tabClose: redText,

    // Role colors (message bubbles)
    roleAssistantBg: alpha(holo, 0.12),
    roleAssistantBgSelected: alpha(holo, 0.2),
    roleAssistantText: assistantText,
    roleThinkingBg: alpha(purple, 0.12),
    roleThinkingBgSelected: alpha(purple, 0.2),
    roleThinkingText: thinkingText,
    roleUserBg: alpha(amber, 0.12),
    roleUserBgSelected: alpha(amber, 0.2),
    roleUserText: userText,

    // Result/success
    resultBg: alpha(green, 0.05),
    resultBorder: alpha(green, 0.1),

    // Unread indicator
    unreadDot: redText,

    // Play button + scrubber
    playBtnBg: alpha(holo, 0.12),
    playBtnActiveBg: alpha(holo, 0.2),
    playBtnBorder: alpha(holo, 0.4),
    playBtnGlow: `0 0 12px ${alpha(holo, 0.15)}`,
    scrubberFill: `linear-gradient(90deg, ${alpha(holo, 0.3)}, ${alpha(holo, 0.6)})`,
    scrubberHeadGlow: `0 0 10px ${alpha(holo, 0.6)}, 0 0 20px ${alpha(holo, 0.2)}`,
    reviewBtnBorder: alpha(holo, 0.25),

    // Cost overlay
    costActiveBg: alpha(green, 0.15),

    // Canvas bubble bases (partial rgba, vendor appends alpha)
    bubbleThinkingBase: partial(purple),
    bubbleUserBase: partial(amber),
    bubbleAssistantBase: partial(holo),

    // Canvas tool-card bases (partial rgba)
    toolCardErrorBase: partial(mix(cardBase, red, p.errorMixT)),
    toolCardSelectedBase: partial(holo),
    toolCardBase: partial(cardBase),

    // Canvas agent/tool card backgrounds
    cardBgDark: alpha(p.cardBgDarkBase, 0.8),
    cardBg: alpha(cardBase, 0.6),
    cardBgSelected: alpha(cardBase, 0.8),
    cardBgError: alpha(mix(cardBase, red, p.errorMixT), 0.8),
    cardBgSelectedHolo: alpha(holo, 0.15),
    cardBgFaintOverlay: "rgba(0, 0, 0, 0.01)",

    // Active tool indicator
    toolIndicatorBg: alpha(amber, 0.1),
    toolIndicatorBorder: alpha(amber, 0.2),
    toolIndicatorText: amberText,

    // Cost labels
    costText: greenText,
    costTextDim: hex8(greenText, "80"),
    costPillBg: p.costPillBg,
    costPillStroke: alpha(green, 0.3),

    // Cost panel bar fills
    barFillMain: alpha(holo, 0.15),
    barFillSub: alpha(purple, 0.15),

    // Transcript / message feed — user
    userMsgBg: alpha(amber, 0.06),
    userMsgBorder: alpha(amber, 0.12),
    userLabel: hex8(userText, "90"),
    userText,

    // Assistant
    assistantLabel: hex8(assistantText, "80"),
    assistantText,

    // Thinking
    thinkingBgExpanded: alpha(purple, 0.06),
    thinkingBgCollapsed: alpha(purple, 0.03),
    thinkingBorder: alpha(purple, 0.08),
    thinkingLabel: hex8(thinkingText, "70"),
    thinkingArrow: hex8(thinkingText, "55"),
    thinkingPreview: thinkingText,
    thinkingTextExpanded: hex8(thinkingText, "80"),
    thinkingBorderLeft: alpha(purple, 0.15),

    // Tool call / result messages
    toolCallBg: alpha(amber, 0.05),
    toolCallBorder: alpha(amber, 0.1),
    bashResultBg: p.bashResultBg,
    toolResultBg: alpha(green, p.toolResultBgA),
    bashResultBorder: alpha(amber, 0.1),
    toolResultBorder: alpha(green, 0.08),
    bashResultText: hex8(p.ink, "80"),
    toolResultText: hex8(greenText, "80"),
    textFaint: hex8(p.ink, "60"),

    // Search highlight
    searchHighlightBg: alpha(amber, 0.3),

    // Diff / code blocks
    codeBlockBg: p.codeBlockBg,
    diffRemoved: p.diffRemoved,
    diffRemovedBg: alpha(c.diffDeletion, 0.08),
    diffAdded: p.diffAdded,
    diffAddedBg: alpha(c.diffAddition, 0.08),

    // Tool content
    filePathActive: holo,
    filePathInactive: hex8(holo, "90"),
    todoCompleted: greenText,
    todoCompletedText: hex8(greenText, "90"),
    todoPending: hex8(holo, "60"),
    contentDim: hex8(p.ink, "90"),
    searchIcon: hex8(holo, "60"),

    // Panel header / chrome text
    panelLabel: hex8(holo, "90"),
    panelLabelDim: hex8(holo, "65"),
    scrollBtnText: holo,
    scrollbarThumb: alpha(holo, p.scrollbarThumbA),
  };

  const css: VisualizerPalette["css"] = {
    "--otto-vis-glass-bg": colors.glassBg,
    "--otto-vis-glass-border": colors.glassBorder,
    "--otto-vis-input-bg": alpha(holo, p.inputBgA),
    "--otto-vis-input-border": alpha(holo, p.inputBorderA),
    "--otto-vis-input-color": p.inputColor,
    "--otto-vis-input-placeholder": alpha(holo, p.inputPlaceholderA),
    "--otto-vis-input-focus-border": alpha(holo, p.inputFocusBorderA),
    "--otto-vis-input-focus-shadow": `0 0 8px ${alpha(holo, 0.1)}`,
    "--otto-vis-scrollbar-thumb": alpha(holo, p.scrollbarThumbA),
    "--otto-vis-scrollbar-thumb-hover": alpha(holo, p.scrollbarThumbHoverA),
  };

  return { background: voidBg, colors, css };
}

export interface VisualizerThemeInput {
  colorSchemeMode: "light" | "dark" | "system";
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
  /** OS scheme (RN `useColorScheme()`); resolves "system" mode. Unknown → dark,
   * matching applyColorScheme. */
  systemColorScheme: "light" | "dark" | null | undefined;
}

export interface VisualizerTheme {
  /** JSON payload substituted into the shell's `__OTTO_THEME_JSON__`
   * placeholder (applyVisualizerTheme). Stable string — views key their html
   * memo (and therefore guest remounts) on it. */
  json: string;
  /** The palette's stage background, for the embed views' host-side containers. */
  background: string;
}

/** Resolve the active variant exactly like applyColorScheme, then build the
 * guest palette from that variant's source colors. */
export function resolveVisualizerTheme(input: VisualizerThemeInput): VisualizerTheme {
  const scheme =
    input.colorSchemeMode === "system"
      ? (input.systemColorScheme ?? "dark")
      : input.colorSchemeMode;
  const variant =
    scheme === "light"
      ? LIGHT_VARIANT_THEMES[input.lightTheme]
      : DARK_VARIANT_THEMES[input.darkTheme];
  const palette = buildVisualizerPalette({
    colorScheme: scheme,
    colors: variant.colors,
  });
  return { json: JSON.stringify(palette), background: palette.background };
}
