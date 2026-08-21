import {
  buildExplorerCheckoutKey,
  isExplorerTab,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "../explorer-tab-memory";
import { type ExplorerCheckoutContext } from "../explorer-checkout-context";
import { z } from "zod";

export type MobilePanelView = "agent" | "agent-list" | "file-explorer";

export interface MobilePanelSelection {
  target: MobilePanelView;
  revision: number;
}

export interface DesktopSidebarState {
  agentListOpen: boolean;
  fileExplorerOpen: boolean;
  focusModeEnabled: boolean;
}

export type SortOption = "name" | "modified" | "size";

/**
 * The Files tab's two lenses: the filesystem as it lays itself out, or the tree as the build
 * system sees it.
 *
 * **"Solution", never "Project"** - Project is already an Otto noun (a grouping of workspaces
 * sharing a git remote), and a .NET project is a completely different thing that appears on
 * screen at the same time. See docs/glossary.md.
 */
export type ExplorerViewMode = "files" | "solution";

export function isExplorerViewMode(value: unknown): value is ExplorerViewMode {
  return value === "files" || value === "solution";
}

/**
 * Per-checkout, like the explorer tab itself: which lens makes sense is a fact about *this*
 * repository, not a global preference. A user with one .NET repo and five TypeScript ones should
 * not have the .NET choice follow them everywhere.
 */
export function resolveExplorerViewMode(input: {
  serverId: string;
  cwd: string;
  hasSolutions: boolean;
  explorerViewModeByCheckout: Record<string, ExplorerViewMode>;
}): ExplorerViewMode {
  // No solutions means no switcher, so any remembered choice is unreachable and must not strand
  // the tab on an empty lens - the same coercion `resolveExplorerTabForCheckout` does for `isGit`.
  if (!input.hasSolutions) {
    return "files";
  }
  const key = buildExplorerCheckoutKey(input.serverId, input.cwd);
  const remembered = key === null ? undefined : input.explorerViewModeByCheckout[key];
  return isExplorerViewMode(remembered) ? remembered : "files";
}

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 225;
export const MAX_SIDEBAR_WIDTH = 600;

export const DEFAULT_EXPLORER_SIDEBAR_WIDTH = 400;
export const MIN_EXPLORER_SIDEBAR_WIDTH = 280;
// Upper bound is intentionally generous; desktop resizing enforces a min-chat-width constraint.
export const MAX_EXPLORER_SIDEBAR_WIDTH = 2000;

// Context Management's left column (summary + tree). Persisted app-wide rather
// than per-workspace: it's a reading preference about this tool, not a fact
// about any one project.
export const DEFAULT_CONTEXT_SIDEBAR_WIDTH = 320;
export const MIN_CONTEXT_SIDEBAR_WIDTH = 240;
export const MAX_CONTEXT_SIDEBAR_WIDTH = 720;

// Manage knowledge's left column. Persisted app-wide as a reading preference.
export const DEFAULT_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH = 340;
export const MIN_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH = 260;
export const MAX_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH = 520;

export const DEFAULT_EXPLORER_FILES_SPLIT_RATIO = 0.38;
export const MIN_EXPLORER_FILES_SPLIT_RATIO = 0.2;
export const MAX_EXPLORER_FILES_SPLIT_RATIO = 0.8;

export interface PanelVisibilityState {
  isAgentListOpen: boolean;
  isFileExplorerOpen: boolean;
}

export interface PanelLayoutInput {
  isCompact: boolean;
}

export interface ExplorerPanelIntent extends PanelLayoutInput {
  checkout: ExplorerCheckoutContext;
}

export interface PanelCoreState {
  mobilePanel: MobilePanelSelection;
  desktop: DesktopSidebarState;
  explorerTab: ExplorerTab;
  explorerTabByCheckout: Record<string, ExplorerTab>;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function clampSidebarWidth(width: number): number {
  return clampNumber(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function clampExplorerWidth(width: number): number {
  return clampNumber(width, MIN_EXPLORER_SIDEBAR_WIDTH, MAX_EXPLORER_SIDEBAR_WIDTH);
}

export function clampContextSidebarWidth(width: number): number {
  return clampNumber(width, MIN_CONTEXT_SIDEBAR_WIDTH, MAX_CONTEXT_SIDEBAR_WIDTH);
}

export function clampExplorerFilesSplitRatio(ratio: number): number {
  return clampNumber(ratio, MIN_EXPLORER_FILES_SPLIT_RATIO, MAX_EXPLORER_FILES_SPLIT_RATIO);
}

export function selectPanelVisibility(
  state: PanelCoreState,
  input: PanelLayoutInput,
): PanelVisibilityState {
  if (input.isCompact) {
    return {
      isAgentListOpen: state.mobilePanel.target === "agent-list",
      isFileExplorerOpen: state.mobilePanel.target === "file-explorer",
    };
  }
  return {
    isAgentListOpen: state.desktop.agentListOpen,
    isFileExplorerOpen: state.desktop.fileExplorerOpen,
  };
}

export function selectIsAgentListOpen(state: PanelCoreState, input: PanelLayoutInput): boolean {
  return selectPanelVisibility(state, input).isAgentListOpen;
}

export function selectIsFileExplorerOpen(state: PanelCoreState, input: PanelLayoutInput): boolean {
  return selectPanelVisibility(state, input).isFileExplorerOpen;
}

export function setMobilePanelTarget(
  selection: MobilePanelSelection,
  target: MobilePanelView,
): MobilePanelSelection {
  if (selection.target === target) {
    return selection;
  }
  return { target, revision: selection.revision + 1 };
}

function resolveExplorerTabFromCheckout(
  state: PanelCoreState,
  checkout: ExplorerCheckoutContext,
): ExplorerTab {
  return resolveExplorerTabForCheckout({
    serverId: checkout.serverId,
    cwd: checkout.cwd,
    isGit: checkout.isGit,
    explorerTabByCheckout: state.explorerTabByCheckout,
  });
}

export interface OpenFileExplorerPatch {
  mobilePanel?: MobilePanelSelection;
  desktop?: DesktopSidebarState;
  explorerTab: ExplorerTab;
}

export function buildOpenFileExplorerPatch(
  state: PanelCoreState,
  input: ExplorerPanelIntent,
): OpenFileExplorerPatch {
  const resolvedTab = resolveExplorerTabFromCheckout(state, input.checkout);
  if (input.isCompact) {
    return {
      mobilePanel: setMobilePanelTarget(state.mobilePanel, "file-explorer"),
      explorerTab: resolvedTab,
    };
  }
  return {
    desktop: { ...state.desktop, fileExplorerOpen: true },
    explorerTab: resolvedTab,
  };
}

export type ToggleFileExplorerPatch =
  | OpenFileExplorerPatch
  | { mobilePanel: MobilePanelSelection }
  | { desktop: DesktopSidebarState };

export function buildToggleFileExplorerPatch(
  state: PanelCoreState,
  input: ExplorerPanelIntent,
): ToggleFileExplorerPatch {
  const isOpen = selectIsFileExplorerOpen(state, input);
  if (!isOpen) {
    return buildOpenFileExplorerPatch(state, input);
  }
  if (input.isCompact) {
    return { mobilePanel: setMobilePanelTarget(state.mobilePanel, "agent") };
  }
  return { desktop: { ...state.desktop, fileExplorerOpen: false } };
}

const ExplorerTabSchema = z.enum(["changes", "files", "search", "pr"]);
const ExplorerViewModeSchema = z.enum(["files", "solution"]);
const DesktopSidebarStorageSchema = z.strictObject({
  agentListOpen: z.boolean().optional(),
  fileExplorerOpen: z.boolean().optional(),
  focusModeEnabled: z.boolean().optional(),
  zoomed: z.boolean().optional(),
  focused: z.boolean().optional(),
});

export const PanelPersistedStateSchema = z.strictObject({
  mobileView: z.enum(["agent", "agent-list", "file-explorer"]).optional(),
  mobilePanel: z
    .strictObject({
      target: z.enum(["agent", "agent-list", "file-explorer"]),
      revision: z.number().int().nonnegative(),
    })
    .optional(),
  desktop: DesktopSidebarStorageSchema.optional(),
  explorerTab: ExplorerTabSchema.optional(),
  explorerTabByCheckout: z.record(z.string(), ExplorerTabSchema).optional(),
  explorerViewModeByCheckout: z.record(z.string(), ExplorerViewModeSchema).optional(),
  explorerSolutionByCheckout: z.record(z.string(), z.string()).optional(),
  expandedPathsByWorkspace: z.record(z.string(), z.array(z.string())).optional(),
  diffExpandedPathsByWorkspace: z.record(z.string(), z.array(z.string())).optional(),
  diffCollapsedFoldersByWorkspace: z.record(z.string(), z.array(z.string())).optional(),
  sidebarWidth: z.number().optional(),
  explorerWidth: z.number().optional(),
  contextSidebarWidth: z.number().optional(),
  projectKnowledgeSidebarWidth: z.number().optional(),
  explorerSortOption: z.enum(["name", "modified", "size"]).optional(),
  explorerShowHiddenFiles: z.boolean().optional(),
  explorerFilesSplitRatio: z.number().optional(),
});

type MigratablePanelState = z.infer<typeof PanelPersistedStateSchema>;

function migratePanelV2Explorer(state: MigratablePanelState, isWeb: boolean): void {
  if (isWeb && typeof state.explorerWidth === "number" && state.explorerWidth === 400) {
    state.explorerWidth = DEFAULT_EXPLORER_SIDEBAR_WIDTH;
  }
  if (typeof state.explorerFilesSplitRatio !== "number") {
    state.explorerFilesSplitRatio = DEFAULT_EXPLORER_FILES_SPLIT_RATIO;
  } else {
    state.explorerFilesSplitRatio = clampExplorerFilesSplitRatio(state.explorerFilesSplitRatio);
  }
}

function migratePanelV3Explorer(state: MigratablePanelState, isWeb: boolean): void {
  if (
    isWeb &&
    typeof state.explorerWidth === "number" &&
    (state.explorerWidth === 400 || state.explorerWidth === 520)
  ) {
    state.explorerWidth = DEFAULT_EXPLORER_SIDEBAR_WIDTH;
  }
}

function migratePanelExplorerTabByCheckout(state: MigratablePanelState, version: number): void {
  if (
    version < 4 ||
    typeof state.explorerTabByCheckout !== "object" ||
    !state.explorerTabByCheckout
  ) {
    state.explorerTabByCheckout = {};
    return;
  }
  const entries = Object.entries(state.explorerTabByCheckout);
  const next: Record<string, ExplorerTab> = {};
  for (const [key, value] of entries) {
    if (!isExplorerTab(value)) {
      continue;
    }
    next[key] = value;
  }
  state.explorerTabByCheckout = next;
}

/** Same shape as `explorerTabByCheckout`: drop anything that is not a known mode. */
function migrateExplorerViewModeByCheckout(state: MigratablePanelState): void {
  const stored = state.explorerViewModeByCheckout;
  if (typeof stored !== "object" || stored === null) {
    state.explorerViewModeByCheckout = {};
    return;
  }
  const next: Record<string, ExplorerViewMode> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (isExplorerViewMode(value)) {
      next[key] = value;
    }
  }
  state.explorerViewModeByCheckout = next;
}

function migratePanelDesktopFocusMode(state: MigratablePanelState): void {
  const desktop = state.desktop;
  if (!desktop) {
    return;
  }
  if ("zoomed" in desktop) {
    desktop.focusModeEnabled = desktop.zoomed;
    delete desktop.zoomed;
  }
  if ("focused" in desktop) {
    desktop.focusModeEnabled = desktop.focused;
    delete desktop.focused;
  }
  if (typeof desktop.focusModeEnabled !== "boolean") {
    desktop.focusModeEnabled = false;
  }
}

export function migratePanelState(
  persistedState: unknown,
  version: number,
  options: { isWeb: boolean },
): MigratablePanelState {
  const result = PanelPersistedStateSchema.safeParse(persistedState);
  const state: MigratablePanelState = result.success ? result.data : {};
  const { isWeb } = options;

  if (version < 2) {
    migratePanelV2Explorer(state, isWeb);
  }
  if (version < 3) {
    migratePanelV3Explorer(state, isWeb);
  }
  if (!isExplorerTab(state.explorerTab)) {
    state.explorerTab = "changes";
  }
  migratePanelExplorerTabByCheckout(state, version);
  if (version < 8) {
    migratePanelDesktopFocusMode(state);
  }
  if (version < 6 || typeof state.sidebarWidth !== "number") {
    state.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  }
  if (
    version < 9 ||
    typeof state.expandedPathsByWorkspace !== "object" ||
    !state.expandedPathsByWorkspace
  ) {
    state.expandedPathsByWorkspace = {};
  }
  if (
    version < 10 ||
    typeof state.diffExpandedPathsByWorkspace !== "object" ||
    !state.diffExpandedPathsByWorkspace
  ) {
    state.diffExpandedPathsByWorkspace = {};
  }
  if (
    version < 12 ||
    typeof state.diffCollapsedFoldersByWorkspace !== "object" ||
    !state.diffCollapsedFoldersByWorkspace
  ) {
    state.diffCollapsedFoldersByWorkspace = {};
  }
  if (typeof state.contextSidebarWidth !== "number") {
    state.contextSidebarWidth = DEFAULT_CONTEXT_SIDEBAR_WIDTH;
  } else {
    state.contextSidebarWidth = clampContextSidebarWidth(state.contextSidebarWidth);
  }
  state.projectKnowledgeSidebarWidth = normalizeProjectKnowledgeSidebarWidth(
    state.projectKnowledgeSidebarWidth,
  );
  if (typeof state.explorerShowHiddenFiles !== "boolean") {
    state.explorerShowHiddenFiles = true;
  }
  migrateExplorerViewModeByCheckout(state);
  if (version < 12) {
    // Compact panel position is transient UI state. Cold starts always begin
    // at content, regardless of what an older version persisted.
    delete state.mobileView;
    delete state.mobilePanel;
  }

  return state;
}

function normalizeProjectKnowledgeSidebarWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return DEFAULT_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH;
  }
  return Math.max(
    MIN_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH,
    Math.min(MAX_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH, width),
  );
}

export { buildExplorerCheckoutKey, resolveExplorerTabForCheckout };
export type { ExplorerTab, ExplorerCheckoutContext };
