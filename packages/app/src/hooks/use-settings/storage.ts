import { isSyntaxThemeId, type SyntaxThemeId } from "@otto-code/highlight";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import type { QueryClient } from "@tanstack/react-query";
import {
  WORKSPACE_TABS_RAIL_MAX_WIDTH,
  WORKSPACE_TABS_RAIL_MIN_WIDTH,
  type ChatWidth,
} from "@/constants/layout";
import { FEATURE_IDS, type FeatureId } from "@/features/feature-catalog";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { parseAppLanguage, type AppLanguage } from "@/i18n/locales";
import {
  DEFAULT_TEXT_EFFECT_THEME,
  isTextEffectThemeId,
  type TextEffectThemeId,
} from "@/styles/text-effects";
import type { LightThemeName, DarkThemeName } from "@/styles/theme";

export const APP_SETTINGS_KEY = "@otto:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_SETTINGS_KEY = "@otto:settings";

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
// Where app-initiated link opens land: a normal Otto browser tab ("in-app") or
// the system browser ("external", default — today's behavior). One global
// setting for every outbound http(s) link (PR links, chat markdown links, docs
// links). Surfaces without the browser pane (native mobile, plain web, no
// workspace mounted) always fall back to the system browser. See
// utils/open-link.ts.
export type LinkOpenBehavior = "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type PreviewServerCloseBehavior = "keep-running" | "stop-on-close";
export type WorkspaceToolsPlacement = "header" | "workspaceList";
// Where the Active Team switcher lives: the sidebar menu above "New workspace"
// (default) or the workspace title bar ahead of the other tools.
export type TeamSwitcherPlacement = "sidebar" | "titlebar";
// Default rendering mode for a pane's tab strip: the horizontal row at the top
// (default) or a vertical rail on the left edge. Per-pane `tabOrientation` on
// `SplitPane` overrides this for panes that explicitly set it.
export type TabOrientation = "horizontal" | "vertical";
export type ColorSchemeMode = "light" | "dark" | "system";
export type ChatTimestampDisplay = "absolute" | "relative";
// Device-local display depth chosen in the setup wizard's first step. Presentation
// only — never synced to the daemon. See projects/first-time-wizard/interface-modes.md.
export type InterfaceMode = "user" | "developer";
// What screen the app opens to. "workspaces" (default) restores the last
// remembered workspace, matching today's behavior. "home" always opens the
// project/workspace list. "dashboard" always opens the activity-stats screen.
// Device-local presentation only — never synced to the daemon.
export type AppStartScreen = "dashboard" | "home" | "workspaces";
// The action pre-selected as the primary of a suggested-task card's split button
// (the caret still offers the rest). Mirrors the daemon's TasksSuggestedStartMode
// wire enum. Device-local presentation only — never synced to the daemon.
export type SuggestedTasksDefaultMode = TasksSuggestedStartMode;

const LIGHT_THEME_NAMES: readonly LightThemeName[] = [
  "daylight",
  "meadow",
  "terracotta",
  "horizon",
  "powder",
  "pastel",
];
const DARK_THEME_NAMES: readonly DarkThemeName[] = [
  "dark",
  "evergreen",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "cyberpunk",
];
const VALID_LIGHT_THEMES = new Set<string>(LIGHT_THEME_NAMES);
const VALID_DARK_THEMES = new Set<string>(DARK_THEME_NAMES);
const VALID_COLOR_SCHEME_MODES = new Set<ColorSchemeMode>(["light", "dark", "system"]);
const VALID_SERVICE_URL_BEHAVIORS = new Set<ServiceUrlBehavior>(["ask", "in-app", "external"]);
const VALID_LINK_OPEN_BEHAVIORS = new Set<LinkOpenBehavior>(["in-app", "external"]);
const VALID_WORKSPACE_TITLE_SOURCES = new Set<WorkspaceTitleSource>(["title", "branch"]);
const VALID_WORKSPACE_TOOLS_PLACEMENTS = new Set<WorkspaceToolsPlacement>([
  "header",
  "workspaceList",
]);
const VALID_TEAM_SWITCHER_PLACEMENTS = new Set<TeamSwitcherPlacement>(["sidebar", "titlebar"]);
const VALID_TAB_ORIENTATIONS = new Set<TabOrientation>(["horizontal", "vertical"]);
const VALID_CHAT_WIDTHS = new Set<ChatWidth>(["default", "wide", "full"]);
const VALID_CHAT_TIMESTAMP_DISPLAYS = new Set<ChatTimestampDisplay>(["absolute", "relative"]);
const VALID_INTERFACE_MODES = new Set<InterfaceMode>(["user", "developer"]);
const VALID_APP_START_SCREENS = new Set<AppStartScreen>(["dashboard", "home", "workspaces"]);
const VALID_SUGGESTED_TASKS_DEFAULT_MODES = new Set<SuggestedTasksDefaultMode>([
  "new_chat",
  "subagent",
  "worktree",
  "in_session",
]);
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_UI_FONT_SIZE = 16; // == FONT_SIZE.base
export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 22;
export const DEFAULT_CODE_FONT_SIZE = 12; // == FONT_SIZE.code
export const MIN_CODE_FONT_SIZE = 12;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const MAX_FONT_FAMILY_LENGTH = 200;
export const DEFAULT_RULER_COLUMN = 80; // the classic terminal width
export const MIN_RULER_COLUMN = 80;
export const MAX_RULER_COLUMN = 240;

export interface AppSettings {
  colorSchemeMode: ColorSchemeMode;
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
  language: AppLanguage;
  sendBehavior: SendBehavior;
  // Show AI-predicted next-prompt suggestions as composer ghost-text watermark
  // (Tab to accept). Native Claude prompt suggestions; gated on the host's
  // promptSuggestions capability. Device-local presentation only. Default on.
  promptSuggestionsEnabled: boolean;
  // Show provider-reported plan rate-limit warnings (e.g. Claude claude.ai
  // plan windows) as a strip above the composer. Device-local presentation
  // only — the daemon keeps emitting events either way. Default on.
  rateLimitWarningsEnabled: boolean;
  // Show the fixed-context warning above the composer when this workspace's
  // context takes a large share of the model's window. Device-local
  // presentation only — the daemon keeps scanning either way, and the Context
  // Management tab stays reachable. Default on.
  contextWarningsEnabled: boolean;
  // Last context window the user evaluated against in the Context tab, so the
  // picker reopens where they left it. Device-local: it is a viewing
  // preference, not a property of the project.
  contextWindowTokens: number;
  serviceUrlBehavior: ServiceUrlBehavior;
  // See LinkOpenBehavior. Device-local presentation only.
  linkOpenBehavior: LinkOpenBehavior;
  terminalScrollbackLines: number;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiFontSize: number; // clamped px, default 16
  codeFontSize: number; // clamped px, default 12
  syntaxTheme: SyntaxThemeId; // default "default"
  // Vertical line-length marker painted behind the code editor's text, the way
  // an IDE marks the 80/120-column limit. Device-local presentation only.
  // Default on.
  rulerEnabled: boolean;
  rulerColumn: number; // clamped character column, default 80
  workspaceTitleSource: WorkspaceTitleSource;
  autoExpandReasoning: boolean;
  // Repeating cue tone while voice mode waits for the agent's reply.
  // Device-local: gates playback on this device only.
  voiceThinkingTone: boolean;
  // Whether agents speak short personality "voice cues" — a spoken line in the
  // agent's own personality voice when it starts, first thinks, waits on its
  // sub-agents, and completes. An AGENT notification channel, not a Visualizer
  // feature: playback is app-global and does not care whether any Visualizer
  // surface is open, or whether the Visualizer is enabled at all. Only the main
  // (root) agent speaks, only for personality-backed agents, and only when the
  // host advertises the visualizerVoiceCues + ttsPreview capabilities. On by
  // default. See docs/agent-personalities.md "Voice cues".
  agentVoiceCues: boolean;
  // Loudness of those cues as a 0-100 percent — a SEPARATE audio channel from
  // the Visualizer's sound effects (visualizerSoundVolume / visualizerSoundMuted),
  // which no longer touch cues at all. Two channels, because they are two
  // unrelated things: one is ambience for a graph you are watching, the other is
  // a notification that fires while you are somewhere else entirely, and a level
  // that suits one rarely suits the other. 0 is silence; the toggle above is the
  // real off-switch. Device-local.
  agentVoiceCuesVolume: number;
  // Quick silence for cues, flipped by the workspace header's speech button —
  // NOT the same thing as `agentVoiceCues` above. Enable is "do I want this
  // feature at all" and lives in settings; mute is "not right now", one click
  // away from wherever you are working, the way the Visualizer's speaker button
  // silences its effects without disabling the graph. Muting therefore leaves
  // the feature configured and the header button present; disabling removes the
  // button entirely, because there is nothing left to mute. Device-local.
  agentVoiceCuesMuted: boolean;
  previewServerCloseBehavior: PreviewServerCloseBehavior;
  previewAutoStartOnRestore: boolean;
  compactSidebarTopSpacing: boolean;
  workspaceToolsPlacement: WorkspaceToolsPlacement;
  // Where the Agent Teams "Active Team" switcher renders. Device-local
  // presentation only; the active team itself is host-scoped daemon config.
  teamSwitcherPlacement: TeamSwitcherPlacement;
  // Default tab-strip orientation for new panes (horizontal row vs. vertical
  // rail). Per-pane `SplitPane.tabOrientation` overrides this individually.
  defaultTabOrientation: TabOrientation;
  // Width, in px, the user dragged the vertical tab rail's splitter to. One
  // width for EVERY rail on the device, not per-pane: a rail's width is a
  // reading preference (how much of a tab label you want to see), not a
  // property of the pane it sits in. `null` — the default — means no user width
  // yet, so the rail keeps sizing itself to its widest current label. A saved
  // number is an outright override of that content-driven width, never a
  // second clamp on top of it: a splitter that sometimes refuses to move is
  // worse than one that always does. Clamped to [WORKSPACE_TABS_RAIL_MIN_WIDTH,
  // WORKSPACE_TABS_RAIL_MAX_WIDTH]. Device-local presentation only.
  verticalTabRailWidth: number | null;
  chatWidth: ChatWidth;
  // Chat tabs + chat pane use a pure black background with dark-theme colors
  // in both light and dark modes (see the `black` scoped theme key).
  blackTabBackground: boolean;
  // Fold runs of 3+ consecutive actions in agent chat into one collapsed,
  // expandable group; the most recent action of a run stays outside it.
  groupConsecutiveActions: boolean;
  // Keep the pinned tab-bar and diff-toolbar options hidden until the pointer
  // is over their toolbar area (web only — hover). When false (default), pinned
  // options are always visible.
  hidePinnedToolbarOptions: boolean;
  // Drop the "Merge into <base>" action from the source-control menu (and stop
  // promoting it to the primary CTA) for people who only ever merge via a pull
  // request and don't want a one-click local merge sitting in the menu.
  hideMergeIntoBaseAction: boolean;
  // Keep chat message operational details (timestamp, duration, copy/fork/
  // rewind actions) hidden until the pointer is over the message. Hover-only:
  // native and compact layouts always show details, and the running-turn
  // indicator is never hidden.
  hideChatMessageDetails: boolean;
  // Chat message timestamps render as exact clock time or relative "5m ago".
  chatTimestampDisplay: ChatTimestampDisplay;
  // Master switch for the app's chrome motion: page-transition cross-fades and
  // the desktop sidebar open/close slide. Device-local presentation only.
  // Default on; off restores the instant, no-animation behavior (which is what
  // shipped before this setting). See constants/animation.ts and
  // hooks/use-animations-enabled.ts.
  animationsEnabled: boolean;
  // Diagonal sheen/gradient painted into the top corner of every chat message
  // bubble (see components/bubble-corner-sheen.tsx). Device-local presentation
  // only. Default on; off renders flat bubbles with no corner gradient.
  chatBubbleGradient: boolean;
  // Animation theme for the "working" text sweep on activity labels (tool
  // calls, reasoning, action groups). Device-local presentation only. See
  // styles/text-effects.ts and projects/text-effects/text-effects.md.
  textEffectTheme: TextEffectThemeId;
  // Soft-wrap long lines in chat code/tool output (shell commands, tool result
  // bodies, diffs) instead of scrolling horizontally. Device-local presentation
  // only. Default on; off restores the horizontal-scroll behavior.
  wrapCodeLines: boolean;
  // Auto-archive completed sub-agents out of a chat's sub-agents track once they
  // settle, instead of leaving them in the collapsed "Completed" group for a
  // manual "Clear all completed". Purely visual decluttering — the cleared rows'
  // token totals are rolled into the track header first so no metrics are lost
  // (see subagents/cleared-subagent-tokens-store.ts). Device-local presentation
  // only. Default off. See docs/agent-lifecycle.md (the sub-agents track).
  autoClearCompletedSubagents: boolean;
  // One-time onboarding tour. `false` on a genuinely fresh install (the tour
  // runs once); backfilled to `true` for any device that already has persisted
  // settings, so upgraders never suddenly see the tour. See migrateTutorialFlag.
  hasCompletedTutorial: boolean;
  // Device-local interface mode (display depth). `null` = not yet chosen, which
  // drives the first-run wizard's Mode step; the useInterfaceMode() hook resolves
  // `null` → "developer" so undecided/legacy devices behave exactly like today.
  // Presentation only: never synced to the daemon, never per-workspace.
  interfaceMode: InterfaceMode | null;
  // One-time first-run setup wizard (Mode → Providers → Agents → Teams → Done).
  // `false` on a genuinely fresh install (the wizard runs once on first host
  // connection); backfilled to `true` for any device that already has persisted
  // settings, so upgraders never land in the wizard. Distinct from the in-app
  // spotlight tour (hasCompletedTutorial), which the wizard's final step launches.
  // See migrateSetupWizardFlag.
  hasCompletedSetupWizard: boolean;
  // What screen the app opens to. See AppStartScreen.
  appStartScreen: AppStartScreen;
  // Show suggested-task cards when an agent proposes follow-up work. Off fully
  // suppresses the card on this device (the tool still runs; tasks just aren't
  // surfaced). Device-local presentation only. Default on.
  suggestedTasksEnabled: boolean;
  // Default primary action of a suggested-task card. See SuggestedTasksDefaultMode.
  suggestedTasksDefaultMode: SuggestedTasksDefaultMode;
  // "Don't show this again" on the heads-up shown when a user opens a browser
  // tab while the host's Browser tools master is off — agents can't see or drive
  // that tab. Purely informational, so it is suppressible; the Preview warning
  // deliberately is NOT, because preview without browser tools is broken rather
  // than merely limited. Device-local, defaults to showing the warning.
  suppressBrowserToolsWarning: boolean;
  // Which Visualizer page panels start visible when a Visualizer tab attaches
  // (seeded via the bridge `config.panels` message — see
  // packages/app/src/panels/visualizer-panel.tsx and
  // vendor/agent-flow/OTTO-PATCHES.md). Defaults mirror the vendored page's
  // own defaults (web/components/agent-visualizer/index.tsx useState calls).
  // Device-local, not per-workspace.
  visualizerPanelTimeline: boolean;
  visualizerPanelFileAttention: boolean;
  visualizerPanelCostOverlay: boolean;
  // Whether the per-node stats readout overlay is drawn on the canvas (sent to
  // the page as config.panels.stats — see vendor/agent-flow/OTTO-PATCHES.md).
  // Off by default, mirroring the vendored page's showStats default. Toggled
  // from the visualizer toolbar's "Toggle Stats" button. Device-local.
  visualizerPanelStats: boolean;
  // Visualizer canvas render controls (bridge `config.render` + the shell's
  // devicePixelRatio cap — see docs/visualizer.md "Risks / gotchas"). All
  // decorative layers default on to match upstream; quality defaults to the
  // fastest tier (a maximized 2x pane measured 14 FPS at native dpr).
  visualizerRenderBloom: boolean;
  // Per-node glow halo (sent to the page as config.render.nodeGlow — see
  // vendor/agent-flow/OTTO-PATCHES.md). Distinct from bloom: this is the soft
  // halo hugging each agent node, bloom is the whole-viewport blurred echo.
  // Defaults on to match the page's historical always-on glow. Device-local.
  visualizerRenderNodeGlow: boolean;
  visualizerRenderStars: boolean;
  visualizerRenderBackdrop: boolean;
  visualizerRenderQuality: VisualizerRenderQuality;
  // Whether the bottom-right on-screen FPS meter is shown (sent to the page as
  // config.render.showFps — see vendor/agent-flow/OTTO-PATCHES.md). A perf
  // diagnostic, off by default like the other debug overlays; opt in when
  // investigating render throughput. Device-local.
  visualizerShowFps: boolean;
  // Silhouette drawn for agent nodes on the canvas (sent to the page as
  // config.render.nodeShape — see vendor/agent-flow/OTTO-PATCHES.md). Defaults
  // to "circle" (the vendored page's own omitted-config fallback remains
  // "hexagon", its historical look). Device-local.
  visualizerNodeShape: VisualizerNodeShape;
  // How the main agent node reports context occupancy (sent to the page as
  // config.render.contextDisplay — see vendor/agent-flow/OTTO-PATCHES.md). The
  // page used to draw the ring AND the bar, which is the same number twice, so
  // this picks one: "ring" hugs the node and leaves only the token count where
  // the bar was; "bar" is the segmented bar. Sub-agents have no ring and keep
  // their bar either way. Device-local.
  visualizerContextDisplay: VisualizerContextDisplay;
  // Visualizer master audio volume as a 0-100 percent — the LEVEL used when the
  // page is unmuted (sent to the page as a 0..1 `config.soundVolume`, gated by
  // visualizerSoundMuted below — see vendor/agent-flow/OTTO-PATCHES.md). The
  // Settings "Sound" slider drives it; the in-page speaker button only toggles
  // mute, so this stays put and unmuting restores exactly this level.
  visualizerSoundVolume: number;
  // Whether the Visualizer's sound effects are muted. Toggled by the in-page
  // speaker button (reported back via the `sound-muted` page->host message) and
  // persisted here so the choice survives closing the tab and restarting the
  // app — the page's own localStorage is wiped every run on Otto's fresh
  // webview partition. Defaults unmuted so first-time users hear the feature
  // at the default 50% level; muting is one click away in the page.
  visualizerSoundMuted: boolean;
  // Whether the Visualizer's HUD chrome (top bar + bottom control bar) is
  // hidden, leaving just the canvas graph and its informational surfaces.
  // Toggled by the native toolbar's HUD-eye and persisted here so it applies to
  // every Visualizer tab at once and survives restarts (the page's own state
  // resets on Otto's fresh webview partition). Sent to the page as
  // `config.hudHidden` — see vendor/agent-flow/OTTO-PATCHES.md.
  visualizerHudHidden: boolean;
  // Picture-in-picture Visualizer: a small always-on-top viewport pinned to the
  // top-right of the workspace content, so the graph stays glanceable while you
  // work in the chat. Mutually exclusive with the Visualizer TAB by design —
  // one live guest at a time, so there is only ever one simulation and one star
  // field (see docs/visualizer.md "PIP mode"). Device-local.
  visualizerPipOpen: boolean;
  // Which surface the header's Visualizer button opens. Sticky: whichever
  // surface you last used is the one that comes back. Collapsing the tab to PIP
  // writes "pip"; expanding the PIP to a tab writes "tab". Closing either one
  // leaves it alone, so "close PIP, reopen" gives you the PIP again.
  visualizerSurface: VisualizerSurface;
  visualizerPipSize: VisualizerPipSize;
  // Where the user dragged it, stored as a 0..1 fraction of the free space
  // (container size minus the PIP's own size) rather than pixels. That is what
  // makes it survive a window resize sensibly: 1 stays pinned to the right/
  // bottom edge, 0 to the left/top, anything between keeps its proportion — and
  // it can never end up outside the workspace, whatever size the window becomes.
  // Defaults to the top-right corner.
  visualizerPipX: number;
  visualizerPipY: number;
  // Per-feature enable/disable flags for the gated-feature registry (see
  // features/feature-catalog.ts). A disabled feature is kept out of memory — its
  // panel sits behind a React.lazy boundary that never fires while off. Sparse
  // by design: a MISSING key resolves to the feature's own `defaultEnabled` (see
  // resolveFeatureEnabled), so new features default on and existing devices are
  // unaffected. Device-local presentation only. Keyed by FeatureId.
  featureEnabled: Partial<Record<FeatureId, boolean>>;
}

export type VisualizerRenderQuality = "performance" | "balanced" | "sharp" | "native";

const VISUALIZER_RENDER_QUALITIES: readonly VisualizerRenderQuality[] = [
  "performance",
  "balanced",
  "sharp",
  "native",
];

export type VisualizerNodeShape = "square" | "hexagon" | "octagon" | "circle";

/** Which single context-occupancy readout the main agent node draws. */
export type VisualizerContextDisplay = "ring" | "bar";

export const VISUALIZER_CONTEXT_DISPLAYS: readonly VisualizerContextDisplay[] = ["ring", "bar"];

/** PIP viewport sizes. Two, per the charter — small is a glance, medium is
 * watchable without giving up the chat underneath. */
export type VisualizerPipSize = "small" | "medium";

export const VISUALIZER_PIP_SIZES: readonly VisualizerPipSize[] = ["small", "medium"];

/** The two mutually-exclusive Visualizer surfaces. */
export type VisualizerSurface = "tab" | "pip";

export const VISUALIZER_SURFACES: readonly VisualizerSurface[] = ["tab", "pip"];

const VISUALIZER_NODE_SHAPES: readonly VisualizerNodeShape[] = [
  "square",
  "hexagon",
  "octagon",
  "circle",
];

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  colorSchemeMode: "system",
  lightTheme: "daylight",
  darkTheme: "dark",
  language: "system",
  sendBehavior: "interrupt",
  promptSuggestionsEnabled: true,
  rateLimitWarningsEnabled: true,
  contextWarningsEnabled: true,
  // Claude's standard window. Deliberately not the largest option: defaulting
  // to 1M would report "you're fine" to everyone.
  contextWindowTokens: 200_000,
  serviceUrlBehavior: "ask",
  linkOpenBehavior: "in-app",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  uiFontFamily: "",
  monoFontFamily: "",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "default",
  rulerEnabled: true,
  rulerColumn: DEFAULT_RULER_COLUMN,
  workspaceTitleSource: "title",
  autoExpandReasoning: false,
  voiceThinkingTone: true,
  agentVoiceCues: true,
  agentVoiceCuesVolume: 50,
  agentVoiceCuesMuted: false,
  previewServerCloseBehavior: "keep-running",
  previewAutoStartOnRestore: false,
  compactSidebarTopSpacing: false,
  workspaceToolsPlacement: "header",
  teamSwitcherPlacement: "sidebar",
  defaultTabOrientation: "horizontal",
  verticalTabRailWidth: null,
  chatWidth: "default",
  blackTabBackground: false,
  groupConsecutiveActions: true,
  hidePinnedToolbarOptions: false,
  hideMergeIntoBaseAction: false,
  hideChatMessageDetails: true,
  chatTimestampDisplay: "absolute",
  animationsEnabled: true,
  chatBubbleGradient: true,
  textEffectTheme: DEFAULT_TEXT_EFFECT_THEME,
  wrapCodeLines: true,
  autoClearCompletedSubagents: false,
  hasCompletedTutorial: false,
  interfaceMode: null,
  hasCompletedSetupWizard: false,
  appStartScreen: "workspaces",
  suggestedTasksEnabled: true,
  suggestedTasksDefaultMode: "new_chat",
  suppressBrowserToolsWarning: false,
  visualizerPanelTimeline: false,
  visualizerPanelFileAttention: false,
  visualizerPanelCostOverlay: false,
  visualizerPanelStats: false,
  visualizerRenderBloom: false,
  visualizerRenderNodeGlow: true,
  visualizerRenderStars: true,
  visualizerRenderBackdrop: true,
  visualizerRenderQuality: "sharp",
  visualizerShowFps: false,
  visualizerNodeShape: "circle",
  visualizerContextDisplay: "ring",
  visualizerSoundVolume: 50,
  visualizerSoundMuted: false,
  visualizerHudHidden: false,
  visualizerPipOpen: false,
  visualizerSurface: "tab",
  visualizerPipSize: "small",
  visualizerPipX: 1,
  visualizerPipY: 0,
  featureEnabled: {},
};
export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface DesktopSettingsBridge {
  isElectron(): boolean;
  loadDesktopSettings(): Promise<DesktopSettings>;
  migrateLegacyDesktopSettings(input: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  }): Promise<void>;
}

export interface SettingsDeps {
  storage: KeyValueStorage;
  desktop: DesktopSettingsBridge;
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps: SettingsDeps;
}): Promise<void> {
  const current =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const next = { ...current, ...input.updates };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await input.deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

// Parses a persisted settings blob, returning a plain object or `null` when the
// stored string is unreadable — corrupt JSON, or a non-object (array/primitive).
// Corruption is a real field condition: an interrupted write during a version
// upgrade can leave a truncated blob, which is exactly the 0.5.0→0.5.1 profile
// (a Settings crash that only "clearing data" resolved). Callers treat `null` as
// "no usable settings" and self-heal to defaults rather than throwing.
function parseSettingsRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to null
  }
  return null;
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await deps.storage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = parseSettingsRecord(stored);
      if (parsed) {
        return {
          ...DEFAULT_CLIENT_SETTINGS,
          ...migrateLegacyThemeField(parsed),
          ...migrateTutorialFlag(parsed),
          ...migrateSetupWizardFlag(parsed),
          ...pickAppSettings(parsed as Partial<AppSettings>),
        };
      }
      // Unreadable blob: reset to defaults and persist so we don't re-hit the bad
      // value on every launch. The previous code threw here, which left the
      // settings query permanently in error (recoverable only by clearing data).
      console.warn("[AppSettings] Unreadable settings blob; resetting to defaults");
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
      return DEFAULT_CLIENT_SETTINGS;
    }

    const legacyStored = await deps.storage.getItem(LEGACY_SETTINGS_KEY);
    const legacyParsed = legacyStored ? parseSettingsRecord(legacyStored) : null;
    if (legacyParsed) {
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...migrateTutorialFlag(legacyParsed),
        ...migrateSetupWizardFlag(legacyParsed),
        ...pickAppSettingsFromLegacy(legacyParsed),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  const legacyDesktopSettings = deps.desktop.isElectron()
    ? await loadLegacyDesktopSettingsFromStorage(deps.storage)
    : null;
  const appSettings = await loadAppSettingsFromStorage(deps);

  if (!deps.desktop.isElectron()) {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings,
    };
  }

  if (legacyDesktopSettings) {
    await deps.desktop.migrateLegacyDesktopSettings(legacyDesktopSettings);
  }

  const desktopSettings = await deps.desktop.loadDesktopSettings();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
    manageBuiltInDaemon: desktopSettings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.releaseChannel,
  };
}

// Migrates a stored `theme: ThemeName | "auto"` value (the schema this app used
// before the mode/variant split) into the new `colorSchemeMode`/`lightTheme`/
// `darkTheme` fields. Only runs when the new fields are entirely absent, so it
// never re-fires on already-migrated data. Operates on the raw untyped parse
// result (not `Partial<AppSettings>`) since `theme` isn't part of the current
// schema at all anymore.
function migrateLegacyThemeField(stored: Record<string, unknown>): Partial<AppSettings> {
  const legacyTheme = stored.theme;
  if (typeof legacyTheme !== "string" || stored.colorSchemeMode !== undefined) {
    return {};
  }
  if (legacyTheme === "auto") {
    return { colorSchemeMode: "system" };
  }
  if (legacyTheme === "light") {
    // The plain neutral "Light" theme was retired; Daylight absorbs it.
    return { colorSchemeMode: "light", lightTheme: "daylight" };
  }
  if (VALID_LIGHT_THEMES.has(legacyTheme)) {
    return { colorSchemeMode: "light", lightTheme: legacyTheme as LightThemeName };
  }
  if (VALID_DARK_THEMES.has(legacyTheme)) {
    return { colorSchemeMode: "dark", darkTheme: legacyTheme as DarkThemeName };
  }
  return {};
}

// Backfills the one-time tour flag for existing devices. When a settings blob
// already exists but predates the flag, the device is an upgrader (not a fresh
// install) and must be treated as having "completed" the tour so it never
// surfaces mid-session. Only fires when the field is entirely absent, so it
// never overrides an explicitly persisted value. The fresh-install seed path in
// loadAppSettingsFromStorage skips this and keeps the `false` default.
function migrateTutorialFlag(stored: Record<string, unknown>): Partial<AppSettings> {
  if (stored.hasCompletedTutorial === undefined) {
    return { hasCompletedTutorial: true };
  }
  return {};
}

// Backfills the one-time setup-wizard flag for existing devices, mirroring
// migrateTutorialFlag: a settings blob that predates the flag belongs to an
// upgrader, who must never be dropped into the first-run wizard. Only fires when
// the field is absent, so it never overrides an explicitly persisted value. The
// fresh-install seed path keeps the `false` default. `interfaceMode` needs no
// such migration — its absent → null → "developer" resolution already keeps
// legacy devices in today's full app (see useInterfaceMode).
function migrateSetupWizardFlag(stored: Record<string, unknown>): Partial<AppSettings> {
  if (stored.hasCompletedSetupWizard === undefined) {
    return { hasCompletedSetupWizard: true };
  }
  return {};
}

function pickThemeAndBehaviorSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    typeof stored.colorSchemeMode === "string" &&
    VALID_COLOR_SCHEME_MODES.has(stored.colorSchemeMode)
  ) {
    result.colorSchemeMode = stored.colorSchemeMode;
  }
  if (typeof stored.lightTheme === "string" && VALID_LIGHT_THEMES.has(stored.lightTheme)) {
    result.lightTheme = stored.lightTheme;
  }
  if (typeof stored.darkTheme === "string" && VALID_DARK_THEMES.has(stored.darkTheme)) {
    result.darkTheme = stored.darkTheme;
  }
  const language = parseAppLanguage(stored.language);
  if (language !== null) {
    result.language = language;
  }
  if (stored.sendBehavior === "interrupt" || stored.sendBehavior === "queue") {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    typeof stored.serviceUrlBehavior === "string" &&
    VALID_SERVICE_URL_BEHAVIORS.has(stored.serviceUrlBehavior)
  ) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  if (
    typeof stored.linkOpenBehavior === "string" &&
    VALID_LINK_OPEN_BEHAVIORS.has(stored.linkOpenBehavior)
  ) {
    result.linkOpenBehavior = stored.linkOpenBehavior;
  }
  return result;
}

function pickFontSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const uiFontFamily = sanitizeFontFamily(stored.uiFontFamily);
  if (uiFontFamily !== null) {
    result.uiFontFamily = uiFontFamily;
  }
  const monoFontFamily = sanitizeFontFamily(stored.monoFontFamily);
  if (monoFontFamily !== null) {
    result.monoFontFamily = monoFontFamily;
  }
  const uiFontSize = parseClampedFontSize(stored.uiFontSize, {
    min: MIN_UI_FONT_SIZE,
    max: MAX_UI_FONT_SIZE,
  });
  if (uiFontSize !== null) {
    result.uiFontSize = uiFontSize;
  }
  const codeFontSize = parseClampedFontSize(stored.codeFontSize, {
    min: MIN_CODE_FONT_SIZE,
    max: MAX_CODE_FONT_SIZE,
  });
  if (codeFontSize !== null) {
    result.codeFontSize = codeFontSize;
  }
  if (typeof stored.syntaxTheme === "string" && isSyntaxThemeId(stored.syntaxTheme)) {
    result.syntaxTheme = stored.syntaxTheme;
  }
  if (typeof stored.rulerEnabled === "boolean") {
    result.rulerEnabled = stored.rulerEnabled;
  }
  // Same clamp shape as the font sizes: an integer pinned into [min, max].
  const rulerColumn = parseClampedFontSize(stored.rulerColumn, {
    min: MIN_RULER_COLUMN,
    max: MAX_RULER_COLUMN,
  });
  if (rulerColumn !== null) {
    result.rulerColumn = rulerColumn;
  }
  return result;
}

// Plain boolean fields validate identically, so they're copied in a loop rather
// than as one `if (typeof … === "boolean")` per field — that repetition was what
// kept pushing this function past the complexity limit as settings were added.
const WORKSPACE_LAYOUT_BOOLEAN_KEYS = [
  "autoExpandReasoning",
  "voiceThinkingTone",
  "compactSidebarTopSpacing",
  "blackTabBackground",
  "groupConsecutiveActions",
  "hidePinnedToolbarOptions",
  "hideMergeIntoBaseAction",
  "hideChatMessageDetails",
  "hasCompletedTutorial",
] as const satisfies readonly (keyof AppSettings)[];

function copyStoredBooleans(
  stored: Partial<AppSettings>,
  result: Partial<AppSettings>,
  keys: readonly (keyof AppSettings)[],
): void {
  for (const key of keys) {
    const value = stored[key];
    if (typeof value === "boolean") {
      (result as Record<string, unknown>)[key] = value;
    }
  }
}

// Agent voice cues used to be a Visualizer sub-setting, so a device that already
// made a choice has it under the old key. The new key wins when both are
// present; otherwise the old choice is carried over rather than silently reset
// to the default (a user who turned cues OFF must not have them come back).
// COMPAT(agentVoiceCues): `visualizerVoiceCues` was the v0.6.3 name; drop this
// fallback after 2027-01-20.
function pickAgentVoiceCueSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.agentVoiceCues === "boolean") {
    result.agentVoiceCues = stored.agentVoiceCues;
  } else {
    const legacy = (stored as { visualizerVoiceCues?: unknown }).visualizerVoiceCues;
    if (typeof legacy === "boolean") {
      result.agentVoiceCues = legacy;
    }
  }
  if (typeof stored.agentVoiceCuesVolume === "number") {
    result.agentVoiceCuesVolume = Math.max(
      0,
      Math.min(100, Math.round(stored.agentVoiceCuesVolume)),
    );
  }
  if (typeof stored.agentVoiceCuesMuted === "boolean") {
    result.agentVoiceCuesMuted = stored.agentVoiceCuesMuted;
  }
  return result;
}

function pickWorkspaceLayoutSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  if (
    typeof stored.workspaceTitleSource === "string" &&
    VALID_WORKSPACE_TITLE_SOURCES.has(stored.workspaceTitleSource)
  ) {
    result.workspaceTitleSource = stored.workspaceTitleSource;
  }
  copyStoredBooleans(stored, result, WORKSPACE_LAYOUT_BOOLEAN_KEYS);
  if (
    typeof stored.workspaceToolsPlacement === "string" &&
    VALID_WORKSPACE_TOOLS_PLACEMENTS.has(stored.workspaceToolsPlacement as WorkspaceToolsPlacement)
  ) {
    result.workspaceToolsPlacement = stored.workspaceToolsPlacement as WorkspaceToolsPlacement;
  }
  if (
    typeof stored.teamSwitcherPlacement === "string" &&
    VALID_TEAM_SWITCHER_PLACEMENTS.has(stored.teamSwitcherPlacement as TeamSwitcherPlacement)
  ) {
    result.teamSwitcherPlacement = stored.teamSwitcherPlacement as TeamSwitcherPlacement;
  }
  if (
    typeof stored.chatWidth === "string" &&
    VALID_CHAT_WIDTHS.has(stored.chatWidth as ChatWidth)
  ) {
    result.chatWidth = stored.chatWidth as ChatWidth;
  }
  if (
    typeof stored.chatTimestampDisplay === "string" &&
    VALID_CHAT_TIMESTAMP_DISPLAYS.has(stored.chatTimestampDisplay as ChatTimestampDisplay)
  ) {
    result.chatTimestampDisplay = stored.chatTimestampDisplay as ChatTimestampDisplay;
  }
  return result;
}

// Onboarding + interface-depth fields, kept out of pickWorkspaceLayoutSettings to
// stay under the cyclomatic-complexity ceiling. See the setup-wizard charter.
function pickOnboardingSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    typeof stored.interfaceMode === "string" &&
    VALID_INTERFACE_MODES.has(stored.interfaceMode as InterfaceMode)
  ) {
    result.interfaceMode = stored.interfaceMode as InterfaceMode;
  }
  if (typeof stored.hasCompletedSetupWizard === "boolean") {
    result.hasCompletedSetupWizard = stored.hasCompletedSetupWizard;
  }
  if (
    typeof stored.appStartScreen === "string" &&
    VALID_APP_START_SCREENS.has(stored.appStartScreen as AppStartScreen)
  ) {
    result.appStartScreen = stored.appStartScreen as AppStartScreen;
  }
  if (typeof stored.suggestedTasksEnabled === "boolean") {
    result.suggestedTasksEnabled = stored.suggestedTasksEnabled;
  }
  if (typeof stored.suppressBrowserToolsWarning === "boolean") {
    result.suppressBrowserToolsWarning = stored.suppressBrowserToolsWarning;
  }
  if (
    typeof stored.suggestedTasksDefaultMode === "string" &&
    VALID_SUGGESTED_TASKS_DEFAULT_MODES.has(
      stored.suggestedTasksDefaultMode as SuggestedTasksDefaultMode,
    )
  ) {
    result.suggestedTasksDefaultMode =
      stored.suggestedTasksDefaultMode as SuggestedTasksDefaultMode;
  }
  return result;
}

// Kept out of pickWorkspaceLayoutSettings to stay under the cyclomatic-
// complexity ceiling, mirroring pickOnboardingSettings/pickPreviewSettings.
function pickTextEffectSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.textEffectTheme === "string" && isTextEffectThemeId(stored.textEffectTheme)) {
    result.textEffectTheme = stored.textEffectTheme;
  }
  return result;
}

// Kept out of pickWorkspaceLayoutSettings to stay under the cyclomatic-
// complexity ceiling, mirroring pickOnboardingSettings/pickTextEffectSettings.
function pickChatCodeSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.wrapCodeLines === "boolean") {
    result.wrapCodeLines = stored.wrapCodeLines;
  }
  if (typeof stored.autoClearCompletedSubagents === "boolean") {
    result.autoClearCompletedSubagents = stored.autoClearCompletedSubagents;
  }
  if (typeof stored.chatBubbleGradient === "boolean") {
    result.chatBubbleGradient = stored.chatBubbleGradient;
  }
  if (typeof stored.promptSuggestionsEnabled === "boolean") {
    result.promptSuggestionsEnabled = stored.promptSuggestionsEnabled;
  }
  if (typeof stored.rateLimitWarningsEnabled === "boolean") {
    result.rateLimitWarningsEnabled = stored.rateLimitWarningsEnabled;
  }
  if (typeof stored.contextWarningsEnabled === "boolean") {
    result.contextWarningsEnabled = stored.contextWarningsEnabled;
  }
  if (typeof stored.contextWindowTokens === "number" && stored.contextWindowTokens > 0) {
    result.contextWindowTokens = stored.contextWindowTokens;
  }
  if (typeof stored.animationsEnabled === "boolean") {
    result.animationsEnabled = stored.animationsEnabled;
  }
  return result;
}

// Kept out of pickWorkspaceLayoutSettings to stay under the cyclomatic-
// complexity ceiling, mirroring pickOnboardingSettings/pickPreviewSettings.
function pickTabLayoutSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    typeof stored.defaultTabOrientation === "string" &&
    VALID_TAB_ORIENTATIONS.has(stored.defaultTabOrientation as TabOrientation)
  ) {
    result.defaultTabOrientation = stored.defaultTabOrientation as TabOrientation;
  }
  // `null` is a real persisted value here ("no user width — size to content"),
  // so it has to survive the round trip rather than fall through to the default
  // by absence, which is why this is not just a number check.
  const verticalTabRailWidth = parseVerticalTabRailWidth(stored.verticalTabRailWidth);
  if (verticalTabRailWidth !== undefined) {
    result.verticalTabRailWidth = verticalTabRailWidth;
  }
  return result;
}

// Returns `undefined` for junk (keep the default), `null` for an explicit
// "content-driven" choice, or a width pinned into the rail's bounds. A stored
// width can fall outside those bounds when the bounds themselves change between
// versions, so it is clamped on read rather than trusted.
export function parseVerticalTabRailWidth(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(
    Math.min(WORKSPACE_TABS_RAIL_MAX_WIDTH, Math.max(WORKSPACE_TABS_RAIL_MIN_WIDTH, value)),
  );
}

function pickPreviewSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    stored.previewServerCloseBehavior === "keep-running" ||
    stored.previewServerCloseBehavior === "stop-on-close"
  ) {
    result.previewServerCloseBehavior = stored.previewServerCloseBehavior;
  }
  if (typeof stored.previewAutoStartOnRestore === "boolean") {
    result.previewAutoStartOnRestore = stored.previewAutoStartOnRestore;
  }
  return result;
}

// Kept out of pickWorkspaceLayoutSettings to stay under the cyclomatic-
// complexity ceiling, mirroring pickOnboardingSettings/pickTabLayoutSettings.
function pickVisualizerSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.visualizerPanelTimeline === "boolean") {
    result.visualizerPanelTimeline = stored.visualizerPanelTimeline;
  }
  if (typeof stored.visualizerPanelFileAttention === "boolean") {
    result.visualizerPanelFileAttention = stored.visualizerPanelFileAttention;
  }
  if (typeof stored.visualizerPanelCostOverlay === "boolean") {
    result.visualizerPanelCostOverlay = stored.visualizerPanelCostOverlay;
  }
  if (typeof stored.visualizerPanelStats === "boolean") {
    result.visualizerPanelStats = stored.visualizerPanelStats;
  }
  if (typeof stored.visualizerRenderBloom === "boolean") {
    result.visualizerRenderBloom = stored.visualizerRenderBloom;
  }
  if (typeof stored.visualizerRenderNodeGlow === "boolean") {
    result.visualizerRenderNodeGlow = stored.visualizerRenderNodeGlow;
  }
  if (typeof stored.visualizerRenderStars === "boolean") {
    result.visualizerRenderStars = stored.visualizerRenderStars;
  }
  if (typeof stored.visualizerRenderBackdrop === "boolean") {
    result.visualizerRenderBackdrop = stored.visualizerRenderBackdrop;
  }
  if (typeof stored.visualizerShowFps === "boolean") {
    result.visualizerShowFps = stored.visualizerShowFps;
  }
  if (
    typeof stored.visualizerRenderQuality === "string" &&
    (VISUALIZER_RENDER_QUALITIES as readonly string[]).includes(stored.visualizerRenderQuality)
  ) {
    result.visualizerRenderQuality = stored.visualizerRenderQuality;
  }
  if (
    typeof stored.visualizerNodeShape === "string" &&
    (VISUALIZER_NODE_SHAPES as readonly string[]).includes(stored.visualizerNodeShape)
  ) {
    result.visualizerNodeShape = stored.visualizerNodeShape;
  }
  if (
    typeof stored.visualizerContextDisplay === "string" &&
    (VISUALIZER_CONTEXT_DISPLAYS as readonly string[]).includes(stored.visualizerContextDisplay)
  ) {
    result.visualizerContextDisplay = stored.visualizerContextDisplay;
  }
  if (typeof stored.visualizerSoundVolume === "number") {
    result.visualizerSoundVolume = Math.max(
      0,
      Math.min(100, Math.round(stored.visualizerSoundVolume)),
    );
  }
  if (typeof stored.visualizerSoundMuted === "boolean") {
    result.visualizerSoundMuted = stored.visualizerSoundMuted;
  }
  if (typeof stored.visualizerHudHidden === "boolean") {
    result.visualizerHudHidden = stored.visualizerHudHidden;
  }
  return { ...result, ...pickVisualizerPipSettings(stored) };
}

// Split out of pickVisualizerSettings purely to keep that function inside the
// repo's complexity budget — the visualizer picker is one long flat chain of
// independent field guards, so where it's cut is arbitrary; PIP is the natural
// seam because it's the newest, self-contained group.
function pickVisualizerPipSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.visualizerPipOpen === "boolean") {
    result.visualizerPipOpen = stored.visualizerPipOpen;
  }
  if (
    typeof stored.visualizerSurface === "string" &&
    (VISUALIZER_SURFACES as readonly string[]).includes(stored.visualizerSurface)
  ) {
    result.visualizerSurface = stored.visualizerSurface;
  }
  if (
    typeof stored.visualizerPipSize === "string" &&
    (VISUALIZER_PIP_SIZES as readonly string[]).includes(stored.visualizerPipSize)
  ) {
    result.visualizerPipSize = stored.visualizerPipSize;
  }
  if (typeof stored.visualizerPipX === "number" && Number.isFinite(stored.visualizerPipX)) {
    result.visualizerPipX = clampUnit(stored.visualizerPipX);
  }
  if (typeof stored.visualizerPipY === "number" && Number.isFinite(stored.visualizerPipY)) {
    result.visualizerPipY = clampUnit(stored.visualizerPipY);
  }
  return result;
}

/** A stored 0..1 fraction, defended against a corrupt/out-of-range blob. */
function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Validates the sparse per-feature enable map: only known FeatureId keys with a
// boolean value survive, so a corrupt/legacy blob can't inject junk. Returns a
// partial only when at least one valid flag was found, matching the other
// pickers' "absent ⇒ keep the default" contract.
function pickFeatureFlagSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const raw: unknown = stored.featureEnabled;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const result: Partial<Record<FeatureId, boolean>> = {};
  for (const id of FEATURE_IDS) {
    const value = source[id];
    if (typeof value === "boolean") {
      result[id] = value;
    }
  }
  return Object.keys(result).length > 0 ? { featureEnabled: result } : {};
}

function pickAppSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  return {
    ...pickThemeAndBehaviorSettings(stored),
    ...pickFontSettings(stored),
    ...pickWorkspaceLayoutSettings(stored),
    ...pickTextEffectSettings(stored),
    ...pickChatCodeSettings(stored),
    ...pickTabLayoutSettings(stored),
    ...pickOnboardingSettings(stored),
    ...pickPreviewSettings(stored),
    ...pickVisualizerSettings(stored),
    ...pickAgentVoiceCueSettings(stored),
    ...pickFeatureFlagSettings(stored),
  };
}

function pickAppSettingsFromLegacy(legacy: Record<string, unknown>): Partial<AppSettings> {
  if (legacy.theme === "auto") {
    return { colorSchemeMode: "system" };
  }
  if (legacy.theme === "light") {
    return { colorSchemeMode: "light", lightTheme: "daylight" };
  }
  if (legacy.theme === "dark") {
    return { colorSchemeMode: "dark", darkTheme: "dark" };
  }
  return {};
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

export function parseClampedFontSize(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(numericValue)));
}

export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ""; // explicit empty = default
  }
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH) {
    return null;
  }
  if (/[;{}<>]/.test(trimmed)) {
    return null; // would break the web CSS font-family declaration
  }
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f)) {
    return null; // control chars would corrupt the font-family string
  }
  return trimmed; // quotes/commas are legit in stacks
}

async function loadLegacyDesktopSettingsFromStorage(storage: KeyValueStorage): Promise<{
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
} | null> {
  const stored = await loadRendererSettingsPayload(storage);
  if (!stored) {
    return null;
  }

  const result: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  } = {};

  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (stored.releaseChannel === "stable" || stored.releaseChannel === "beta") {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(
  storage: KeyValueStorage,
): Promise<Record<string, unknown> | null> {
  const current = await storage.getItem(APP_SETTINGS_KEY);
  if (current) {
    return parseSettingsRecord(current);
  }

  const legacy = await storage.getItem(LEGACY_SETTINGS_KEY);
  if (!legacy) {
    return null;
  }
  return parseSettingsRecord(legacy);
}
