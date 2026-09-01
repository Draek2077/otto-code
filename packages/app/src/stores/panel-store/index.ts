import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildExplorerCheckoutKey,
  coerceExplorerTabForCheckout,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "../explorer-tab-memory";
import { type ExplorerCheckoutContext } from "../explorer-checkout-context";
import {
  buildOpenFileExplorerPatch,
  buildToggleFileExplorerPatch,
  clampContextSidebarWidth,
  clampTreeRailWidth,
  clampSidebarWidth,
  DEFAULT_CONTEXT_SIDEBAR_WIDTH,
  DEFAULT_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH,
  DEFAULT_TREE_RAIL_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_CONTEXT_SIDEBAR_WIDTH,
  MAX_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH,
  MAX_TREE_RAIL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_CONTEXT_SIDEBAR_WIDTH,
  MIN_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH,
  MIN_TREE_RAIL_WIDTH,
  MIN_SIDEBAR_WIDTH,
  migratePanelState,
  PanelPersistedStateSchema,
  selectIsAgentListOpen,
  selectIsCompactFileExplorerOpen,
  setMobilePanelTarget,
  type DesktopSidebarState,
  type ExplorerViewMode,
  type MobilePanelView,
  type MobilePanelSelection,
  type PanelLayoutInput,
  type SortOption,
} from "./state";
import { isWeb } from "@/constants/platform";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
export type { ExplorerTab } from "../explorer-tab-memory";
export type { ExplorerCheckoutContext } from "../explorer-checkout-context";
export type {
  DesktopSidebarState,
  ExplorerViewMode,
  MobilePanelView,
  MobilePanelSelection,
  PanelLayoutInput,
  SortOption,
} from "./state";
export { buildExplorerCheckoutKey, resolveExplorerViewMode } from "./state";
export {
  DEFAULT_CONTEXT_SIDEBAR_WIDTH,
  DEFAULT_TREE_RAIL_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_CONTEXT_SIDEBAR_WIDTH,
  MAX_TREE_RAIL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_CONTEXT_SIDEBAR_WIDTH,
  MIN_TREE_RAIL_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampTreeRailWidth,
  selectIsAgentListOpen,
  selectIsCompactFileExplorerOpen,
};

export type ExpandedPathsUpdate = string[] | ((currentPaths: string[]) => string[]);

export interface PanelState {
  // Mobile: React's durable target plus the generation that owns it.
  mobilePanel: MobilePanelSelection;

  // Desktop: independent sidebar toggles
  desktop: DesktopSidebarState;

  // File explorer settings (shared between mobile/desktop)
  explorerTab: ExplorerTab;
  explorerTabByCheckout: Record<string, ExplorerTab>;
  /**
   * Files vs Solution, remembered per checkout the way `explorerTabByCheckout` is. Sparse: a
   * checkout with no entry gets `files`, which is also what a checkout with no solutions gets
   * regardless of what is stored. See `resolveExplorerViewMode`.
   */
  explorerViewModeByCheckout: Record<string, ExplorerViewMode>;
  /** Which solution the Solution lens is showing, per checkout. Phase 4 reads this for `--solution`. */
  explorerSolutionByCheckout: Record<string, string>;
  expandedPathsByWorkspace: Record<string, string[]>;
  // Changes-view folder tree. Inverted semantics vs the fields above:
  // this stores COLLAPSED directory paths (empty = all folders expanded), keyed
  // by full uncompressed dir path, so folders default to expanded and new
  // folders stay expanded as the diff changes.
  diffCollapsedFoldersByWorkspace: Record<string, string[]>;
  collapsedFilePathsByWorkspace: Record<string, string[]>;
  sidebarWidth: number;
  // Context Management's left column. App-wide rather than per-workspace: it's a
  // reading preference about this tool, not a fact about any one project.
  contextSidebarWidth: number;
  projectKnowledgeSidebarWidth: number;
  explorerSortOption: SortOption;
  explorerShowHiddenFiles: boolean;
  // Ephemeral (not persisted): bumped when a keyboard action wants the project
  // search input focused; the search pane consumes it back to 0.
  projectSearchFocusToken: number;
  // Ephemeral (not persisted): bumped when a keyboard action wants the Files
  // tab's filename finder open; the file explorer consumes it back to 0. Mod+F
  // outside an editor means "find a file" - the tab alone is only half of that.
  fileFinderOpenToken: number;
  // Ephemeral (not persisted): set when another pane (e.g. the Changes view)
  // wants a file revealed in the Files tree; the file explorer consumes it
  // back to null. The token disambiguates repeat reveals of the same path.
  filesRevealRequest: { path: string; token: number; kind?: "file" | "directory" } | null;
  // Ephemeral (not persisted): the mirror image of filesRevealRequest - set when
  // another surface (the Files tree's "View changes", the file tab's toolbar)
  // wants a file revealed in the Changes tab; the diff pane consumes it back to
  // null after expanding the file's diff and scrolling its header into view.
  changesRevealRequest: { path: string; token: number } | null;
  // Ephemeral (not persisted): true only while the workspace explorer sidebar is
  // actually painted under the window controls. The window-controls overlay
  // background follows this so it stays surface0 during the workspace load pause
  // (route + open flag are set, but the sidebar hasn't rendered yet) and flips to
  // the sidebar surface exactly when the sidebar appears. Owned by the workspace
  // screen; false everywhere else.
  explorerSidebarVisible: boolean;
  // Ephemeral (not persisted): true only while the workspace focus-mode tab strip
  // is the top strip painted under the window controls (focus mode on a
  // non-compact desktop layout). Like explorerSidebarVisible, the window-controls
  // overlay follows this so the native caption strip matches the tab-row gutter
  // (surfaceSidebar) instead of the default surface0. Owned by the workspace
  // screen; false everywhere else.
  focusModeTabStripVisible: boolean;
  treeRailWidth: number;
  // File panel's tree rail. The changes panel keeps its own flag in
  // `useChangesPreferences`; the two rails open and close independently.
  fileTreeVisible: boolean;

  // Actions
  toggleFocusMode: () => void;
  exitFocusMode: () => void;
  showMobileAgent: () => void;
  showMobileAgentList: () => void;
  toggleMobileAgentList: () => void;
  openDesktopAgentList: () => void;
  closeDesktopAgentList: () => void;
  toggleDesktopAgentList: () => void;
  openAgentListForLayout: (input: PanelLayoutInput) => void;
  closeAgentListForLayout: (input: PanelLayoutInput) => void;
  toggleAgentListForLayout: (input: PanelLayoutInput) => void;
  openCompactFileExplorer: (checkout: ExplorerCheckoutContext) => void;
  toggleCompactFileExplorer: (checkout: ExplorerCheckoutContext) => void;

  // File explorer settings actions
  setExplorerTab: (tab: ExplorerTab) => void;
  setExplorerTabForCheckout: (params: ExplorerCheckoutContext & { tab: ExplorerTab }) => void;
  setExplorerViewModeForCheckout: (params: {
    serverId: string;
    cwd: string;
    mode: ExplorerViewMode;
  }) => void;
  setExplorerSolutionForCheckout: (params: {
    serverId: string;
    cwd: string;
    solutionPath: string;
  }) => void;
  setExpandedPathsForWorkspace: (workspaceKey: string, paths: ExpandedPathsUpdate) => void;
  setDiffCollapsedFoldersForWorkspace: (workspaceKey: string, dirPaths: string[]) => void;
  setCollapsedFilePathsForWorkspace: (workspaceKey: string, paths: string[]) => void;
  activateExplorerTabForCheckout: (checkout: ExplorerCheckoutContext) => void;
  setSidebarWidth: (width: number) => void;
  setContextSidebarWidth: (width: number) => void;
  setProjectKnowledgeSidebarWidth: (width: number) => void;
  setExplorerSortOption: (option: SortOption) => void;
  toggleExplorerShowHiddenFiles: () => void;
  requestProjectSearchFocus: () => void;
  clearProjectSearchFocusRequest: () => void;
  requestFileFinderOpen: () => void;
  clearFileFinderOpenRequest: () => void;
  requestFilesReveal: (path: string, kind?: "file" | "directory") => void;
  clearFilesRevealRequest: () => void;
  requestChangesReveal: (path: string) => void;
  clearChangesRevealRequest: () => void;
  setExplorerSidebarVisible: (visible: boolean) => void;
  setFocusModeTabStripVisible: (visible: boolean) => void;
  setTreeRailWidth: (width: number) => void;
  toggleFileTreeVisible: () => void;
}

const DEFAULT_DESKTOP_OPEN = isWeb;

function setMobilePanelTargetPatch(
  state: PanelState,
  target: MobilePanelView,
): PanelState | Pick<PanelState, "mobilePanel"> {
  const mobilePanel = setMobilePanelTarget(state.mobilePanel, target);
  return mobilePanel === state.mobilePanel ? state : { mobilePanel };
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      // Mobile always starts at agent view
      mobilePanel: { target: "agent", revision: 0 },

      // Desktop defaults based on platform
      desktop: {
        agentListOpen: DEFAULT_DESKTOP_OPEN,
        focusModeEnabled: false,
      },

      // File explorer defaults
      explorerTab: "changes",
      explorerTabByCheckout: {},
      explorerViewModeByCheckout: {},
      explorerSolutionByCheckout: {},
      expandedPathsByWorkspace: {},
      diffCollapsedFoldersByWorkspace: {},
      collapsedFilePathsByWorkspace: {},
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      contextSidebarWidth: DEFAULT_CONTEXT_SIDEBAR_WIDTH,
      projectKnowledgeSidebarWidth: DEFAULT_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH,
      explorerSortOption: "name",
      explorerShowHiddenFiles: true,
      projectSearchFocusToken: 0,
      fileFinderOpenToken: 0,
      filesRevealRequest: null,
      changesRevealRequest: null,
      explorerSidebarVisible: false,
      focusModeTabStripVisible: false,
      treeRailWidth: DEFAULT_TREE_RAIL_WIDTH,
      fileTreeVisible: true,

      toggleFocusMode: () =>
        set((state) => ({
          desktop: { ...state.desktop, focusModeEnabled: !state.desktop.focusModeEnabled },
        })),

      exitFocusMode: () =>
        set((state) =>
          state.desktop.focusModeEnabled
            ? { desktop: { ...state.desktop, focusModeEnabled: false } }
            : state,
        ),

      showMobileAgent: () => set((state) => setMobilePanelTargetPatch(state, "agent")),

      showMobileAgentList: () => set((state) => setMobilePanelTargetPatch(state, "agent-list")),

      toggleMobileAgentList: () =>
        set((state) =>
          setMobilePanelTargetPatch(
            state,
            state.mobilePanel.target === "agent-list" ? "agent" : "agent-list",
          ),
        ),

      openDesktopAgentList: () =>
        set((state) => {
          if (state.desktop.agentListOpen) {
            return state;
          }
          return { desktop: { ...state.desktop, agentListOpen: true } };
        }),

      closeDesktopAgentList: () =>
        set((state) => {
          if (!state.desktop.agentListOpen) {
            return state;
          }
          return { desktop: { ...state.desktop, agentListOpen: false } };
        }),

      toggleDesktopAgentList: () =>
        set((state) => ({
          desktop: { ...state.desktop, agentListOpen: !state.desktop.agentListOpen },
        })),

      openAgentListForLayout: ({ isCompact }) =>
        set((state) => {
          if (isCompact) {
            return setMobilePanelTargetPatch(state, "agent-list");
          }
          return state.desktop.agentListOpen
            ? state
            : { desktop: { ...state.desktop, agentListOpen: true } };
        }),

      closeAgentListForLayout: ({ isCompact }) =>
        set((state) => {
          if (isCompact) {
            return setMobilePanelTargetPatch(state, "agent");
          }
          return state.desktop.agentListOpen
            ? { desktop: { ...state.desktop, agentListOpen: false } }
            : state;
        }),

      toggleAgentListForLayout: ({ isCompact }) =>
        set((state) => {
          if (isCompact) {
            return setMobilePanelTargetPatch(
              state,
              state.mobilePanel.target === "agent-list" ? "agent" : "agent-list",
            );
          }
          return {
            desktop: { ...state.desktop, agentListOpen: !state.desktop.agentListOpen },
          };
        }),

      openCompactFileExplorer: (checkout) =>
        set((state) => buildOpenFileExplorerPatch(state, checkout)),

      toggleCompactFileExplorer: (checkout) =>
        set((state) => buildToggleFileExplorerPatch(state, checkout)),

      setExplorerTab: (tab) => set({ explorerTab: tab }),
      setExplorerTabForCheckout: ({ serverId, cwd, isGit, tab }) =>
        set((state) => {
          const resolvedTab = coerceExplorerTabForCheckout(tab, isGit);
          const key = buildExplorerCheckoutKey(serverId, cwd);
          const nextState: Partial<PanelState> = { explorerTab: resolvedTab };
          if (key) {
            const current = state.explorerTabByCheckout[key];
            if (current !== resolvedTab) {
              nextState.explorerTabByCheckout = {
                ...state.explorerTabByCheckout,
                [key]: resolvedTab,
              };
            }
          }
          return nextState;
        }),
      setExplorerViewModeForCheckout: ({ serverId, cwd, mode }) =>
        set((state) => {
          const key = buildExplorerCheckoutKey(serverId, cwd);
          if (key === null || state.explorerViewModeByCheckout[key] === mode) {
            return state;
          }
          return {
            explorerViewModeByCheckout: { ...state.explorerViewModeByCheckout, [key]: mode },
          };
        }),
      setExplorerSolutionForCheckout: ({ serverId, cwd, solutionPath }) =>
        set((state) => {
          const key = buildExplorerCheckoutKey(serverId, cwd);
          if (key === null || state.explorerSolutionByCheckout[key] === solutionPath) {
            return state;
          }
          return {
            explorerSolutionByCheckout: {
              ...state.explorerSolutionByCheckout,
              [key]: solutionPath,
            },
          };
        }),
      setExpandedPathsForWorkspace: (workspaceKey, paths) =>
        set((state) => {
          const currentPaths = state.expandedPathsByWorkspace[workspaceKey] ?? ["."];
          const nextPaths = typeof paths === "function" ? paths(currentPaths) : paths;
          return {
            expandedPathsByWorkspace: {
              ...state.expandedPathsByWorkspace,
              [workspaceKey]: nextPaths,
            },
          };
        }),
      setDiffCollapsedFoldersForWorkspace: (workspaceKey, dirPaths) =>
        set((state) => ({
          diffCollapsedFoldersByWorkspace: {
            ...state.diffCollapsedFoldersByWorkspace,
            [workspaceKey]: dirPaths,
          },
        })),
      setCollapsedFilePathsForWorkspace: (workspaceKey, paths) =>
        set((state) => ({
          collapsedFilePathsByWorkspace: {
            ...state.collapsedFilePathsByWorkspace,
            [workspaceKey]: paths,
          },
        })),
      activateExplorerTabForCheckout: (checkout) =>
        set((state) => ({
          explorerTab: resolveExplorerTabForCheckout({
            serverId: checkout.serverId,
            cwd: checkout.cwd,
            isGit: checkout.isGit,
            explorerTabByCheckout: state.explorerTabByCheckout,
          }),
        })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setContextSidebarWidth: (width) =>
        set({ contextSidebarWidth: clampContextSidebarWidth(width) }),
      setProjectKnowledgeSidebarWidth: (width) =>
        set({
          projectKnowledgeSidebarWidth: Math.max(
            MIN_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH,
            Math.min(MAX_PROJECT_KNOWLEDGE_SIDEBAR_WIDTH, width),
          ),
        }),
      setExplorerSortOption: (option) => set({ explorerSortOption: option }),
      toggleExplorerShowHiddenFiles: () =>
        set((state) => ({ explorerShowHiddenFiles: !state.explorerShowHiddenFiles })),
      requestProjectSearchFocus: () =>
        set((state) => ({ projectSearchFocusToken: state.projectSearchFocusToken + 1 })),
      clearProjectSearchFocusRequest: () => set({ projectSearchFocusToken: 0 }),
      requestFileFinderOpen: () =>
        set((state) => ({ fileFinderOpenToken: state.fileFinderOpenToken + 1 })),
      clearFileFinderOpenRequest: () => set({ fileFinderOpenToken: 0 }),
      requestFilesReveal: (path, kind = "file") =>
        set((state) => ({
          filesRevealRequest: {
            path,
            kind,
            token: (state.filesRevealRequest?.token ?? 0) + 1,
          },
        })),
      clearFilesRevealRequest: () => set({ filesRevealRequest: null }),
      requestChangesReveal: (path) =>
        set((state) => ({
          changesRevealRequest: { path, token: (state.changesRevealRequest?.token ?? 0) + 1 },
        })),
      clearChangesRevealRequest: () => set({ changesRevealRequest: null }),
      setExplorerSidebarVisible: (visible) =>
        set((state) =>
          state.explorerSidebarVisible === visible ? state : { explorerSidebarVisible: visible },
        ),
      setFocusModeTabStripVisible: (visible) =>
        set((state) =>
          state.focusModeTabStripVisible === visible
            ? state
            : { focusModeTabStripVisible: visible },
        ),
      setTreeRailWidth: (width) => set({ treeRailWidth: clampTreeRailWidth(width) }),
      toggleFileTreeVisible: () => set((state) => ({ fileTreeVisible: !state.fileTreeVisible })),
    }),
    {
      name: "panel-state",
      version: 16,
      storage: createValidatedPersistStorage(AsyncStorage, PanelPersistedStateSchema),
      migrate: (persistedState, version) => migratePanelState(persistedState, version),
      partialize: (state) => ({
        desktop: state.desktop,
        explorerTab: state.explorerTab,
        explorerTabByCheckout: state.explorerTabByCheckout,
        explorerViewModeByCheckout: state.explorerViewModeByCheckout,
        explorerSolutionByCheckout: state.explorerSolutionByCheckout,
        expandedPathsByWorkspace: state.expandedPathsByWorkspace,
        diffCollapsedFoldersByWorkspace: state.diffCollapsedFoldersByWorkspace,
        collapsedFilePathsByWorkspace: state.collapsedFilePathsByWorkspace,
        sidebarWidth: state.sidebarWidth,
        contextSidebarWidth: state.contextSidebarWidth,
        projectKnowledgeSidebarWidth: state.projectKnowledgeSidebarWidth,
        explorerSortOption: state.explorerSortOption,
        explorerShowHiddenFiles: state.explorerShowHiddenFiles,
        treeRailWidth: state.treeRailWidth,
        fileTreeVisible: state.fileTreeVisible,
      }),
    },
  ),
);
