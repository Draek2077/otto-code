import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useIsFocused } from "@react-navigation/native";
import {
  ActivityIndicator,
  BackHandler,
  InteractionManager,
  Keyboard,
  Pressable,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  useWorkspaceRecovery,
  type WorkspaceRecoveryController,
} from "@/workspace-recovery/use-workspace-recovery";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import {
  AlarmClock,
  ArrowLeftToLine,
  ArrowRightToLine,
  BookOpen,
  CalendarClock,
  ChatBubble,
  ChatBubbleOff,
  CircleX,
  ContextualToken,
  ChevronDown,
  Copy,
  CopyX,
  Ellipsis,
  EllipsisVertical,
  Explore,
  FileText,
  FolderOpen,
  Globe,
  HeadsetMic,
  HeadsetOff,
  Import as ImportIcon,
  MarkChatUnread,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCw,
  Settings,
  Star,
  StarFilled,
  SquarePen,
  SquareTerminal,
  X,
} from "@/components/icons/material-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";
import invariant from "tiny-invariant";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { HeaderToggleButton, headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { HeaderActiveTeamSwitchers } from "@/components/active-team-switcher";
import {
  shouldShowHeaderBrainButton,
  WorkspaceBrainButton,
} from "@/components/brain/workspace-brain-button";
import { useTutorialAnchor } from "@/tutorial/use-tutorial-anchor";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TitlebarPopupSearchField } from "@/components/ui/titlebar-popup-search-field";
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { ExplorerSidebar } from "@/components/explorer-sidebar";
import { SplitContainer } from "@/components/split-container";
import { VisualizerPipHost } from "@/visualizer/visualizer-pip-host";
import { RetainedPanel } from "@/components/retained-panel";
import { WorkspaceActions } from "@/git/workspace-actions";
import { WorkspaceOpenInEditorButton } from "@/screens/workspace/workspace-open-in-editor-button";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import {
  WorkspaceVisualizerButton,
  WorkspaceVisualizerMenuItem,
} from "@/visualizer/workspace-visualizer-button";
import {
  useVoiceCuesAvailable,
  WorkspaceVoiceCuesButton,
  WorkspaceVoiceCuesMenuItem,
} from "@/voice/workspace-voice-cues-button";
import { WorkspaceWakeWordButton } from "@/voice/workspace-wake-word-button";
import { shouldShowWakeWordToolbarButton } from "@/voice/wake-word-control-state";
import { getWakeWordCapability } from "@/wake-word/wake-word-capability";
import { openContextManagementTab } from "@/context-management/open-context-management-tab";
import { openProjectKnowledgeTab } from "@/project-knowledge/open-project-knowledge-tab";
import { useCloseDisabledFeatureTabs } from "@/features/use-close-disabled-feature-tabs";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import {
  usePublishExplorerSidebarVisibility,
  usePublishFocusModeTabStripVisibility,
} from "@/screens/workspace/use-explorer-sidebar-visibility";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useToast } from "@/contexts/toast-context";
import {
  selectIsAgentListOpen,
  selectIsFileExplorerOpen,
  usePanelStore,
  type ExplorerTab,
} from "@/stores/panel-store";
import { type ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  getFocusedBrowserId,
  type WorkspaceLayout,
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useAppSettingValue, useSettings, type AppSettings } from "@/hooks/use-settings";
import {
  confirmBrowserToolsOffBeforeOpening,
  useBrowserToolsWarningCopy,
  useOpenBrowserToolsSettings,
} from "@/utils/browser-tools-warning";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { hideDeveloperTabs } from "@/screens/workspace/interface-mode-tabs";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { shouldShowWorkspaceSetup, useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useWorkspaceTerminalSessionRetention } from "@/terminal/hooks/use-workspace-terminal-session-retention";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { getPanelRegistration } from "@/panels/panel-registry";
import { alertDialog, confirmDialog } from "@/utils/confirm-dialog";
import { confirmCloseChat } from "@/components/archive-chat-warning";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useDeleteAgent } from "@/history/use-delete-agent";
import { isHistoryDeleteSupported } from "@/history/use-history-delete-feature";
import {
  resolveDeleteAgentDialog,
  resolveHistoryDeleteUnsupportedDialog,
} from "@/history/delete-dialogs";
import { useStableEvent } from "@/hooks/use-stable-event";
import { removeResidentBrowserWebview } from "@/components/browser-webview-resident";
import { createWorkspaceBrowser, useBrowserStore } from "@/stores/browser-store";
import { getDesktopHost } from "@/desktop/host";
import { supportsZoomRecorder } from "@/desktop/zoom-recorder-capability";
import { useZoomRecorderStatus } from "@/desktop/use-zoom-recorder-status";
import { MeetingTranscriptLibrary } from "@/meetings/meeting-transcript-library";
import {
  buildAgentWorkspaceAttachmentScopeKey,
  buildDraftWorkspaceAttachmentScopeKey,
  buildWorkspaceAttachmentScopeKey,
} from "@/attachments/workspace-attachments-store";
import { getZoomMeetingTitlebarState } from "@/screens/workspace/zoom-meetings-titlebar-state";
import { ZoomTeamChatConversationSheet } from "@/screens/workspace/zoom-team-chat-conversation-sheet";
import type {
  CommunicationConversationSummary,
  CommunicationHomeSection,
  CommunicationPresence,
  CommunicationPresenceStatus,
  CommunicationProviderConnectionState,
  CommunicationSearchResult,
} from "@otto-code/protocol/communications";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { openExternalUrl } from "@/utils/open-external-url";
import { buildProviderCommand } from "@/utils/provider-command-templates";
import { generateDraftId } from "@/stores/draft-keys";
import { resolveWorkspaceRouteId } from "@/utils/workspace-identity";
import { useWakeWordListening } from "@/hooks/use-wake-word-listening";
import { shouldStartWakeWordListening } from "@/voice/wake-word-control-state";
import { useWakeWordAutoStartStore } from "@/stores/wake-word-auto-start-store";
import {
  WorkspaceTabPresentationResolver,
  WorkspaceTabIcon,
  WorkspaceTabOptionRow,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import {
  useWorkspaceTabRename,
  WorkspaceTabRenameModal,
} from "@/screens/workspace/use-workspace-tab-rename";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import {
  buildWorkspaceTabMenuEntries,
  type WorkspaceTabMenuEntry,
  type WorkspaceTabMenuLabels,
} from "@/screens/workspace/workspace-tab-menu";
import { useMoveChatMenu } from "@/workspace/use-move-chat-menu";
import { MoveChatToWorkspaceHost } from "@/components/move-chat-to-workspace-host";
import { useDesktopBrowserNewTabRequests } from "@/browser/new-tab-requests";
import { registerInAppLinkOpener } from "@/utils/open-link";
import { ArtifactOpenMenu } from "@/components/artifacts/artifact-open-menu";
import { useHostFeature } from "@/runtime/host-features";
import { useGeneratingArtifactAgentIds } from "@/artifacts/use-artifacts";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  resolveWorkspaceHeaderRenderState,
  type WorkspaceHeaderCheckoutState,
} from "@/screens/workspace/workspace-header-source";
import {
  resolveWorkspaceRouteState,
  type WorkspaceRouteState,
} from "@/screens/workspace/workspace-route-state";
import { renderWorkspaceRouteGate } from "@/screens/workspace/workspace-route-state-views";
import {
  buildWorkspaceTabSnapshot,
  createWorkspaceAgentVisibilitySelector,
  workspaceAgentVisibilityEqual,
} from "@/workspace-tabs/agent-visibility";
import {
  deriveWorkspacePaneState,
  resolveSideFileOpenPlacement,
  resolveWorkspaceNewChatPlacement,
} from "@/screens/workspace/workspace-pane-state";
import { selectVisibleAgentIds } from "@/screens/workspace/visible-agent-ids";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
import { resolveMountedTabLimit } from "@/screens/workspace/mounted-tab-retention";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import { shouldSeedEmptyWorkspaceDraft } from "@/screens/workspace/workspace-empty-draft-seed";
import {
  buildBulkCloseConfirmationMessage,
  type BulkCloseConfirmationLabels,
  classifyBulkClosableTabs,
  closeBulkWorkspaceTabs,
} from "@/screens/workspace/workspace-bulk-close";
import { resolveCloseAgentTabPolicy } from "@/subagents";
import { findAdjacentPane } from "@/utils/split-navigation";
import { useIsCompactFormFactor, supportsDesktopPaneSplits } from "@/constants/layout";
import { getIsElectron, isNative, isWeb } from "@/constants/platform";
import { useContainerWidth } from "@/hooks/use-container-width";
import {
  MIN_TITLE_WIDTH,
  resolveCompactHeaderActions,
} from "@/screens/workspace/compact-header-actions";
import {
  buildHostRootRoute,
  buildSettingsHostRoute,
  buildSettingsHostSectionRoute,
} from "@/utils/host-routes";
import {
  useWorkspaceTerminals,
  type TerminalProfileInput,
} from "@/screens/workspace/terminals/use-workspace-terminals";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@otto-code/protocol/terminal-profiles";
import { getProviderIcon } from "@/components/provider-icons";
import { setFileViewModeFor } from "@/stores/file-view-store";
import { releaseCleanEditorBuffer } from "@/editor/editor-buffer-store";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  type WorkspaceFileLocation,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { useCrossProjectFileOpenGate } from "@/projects/use-cross-project-file-open";
import { RenderProfile } from "@/utils/render-profiler";
import { useWorkspaceCheckoutStatus } from "@/screens/workspace/use-workspace-checkout-status";
import {
  clearWorkspaceContentReady,
  getWorkspaceContentReadyKey,
  markWorkspaceContentReady,
} from "@/stores/workspace-content-readiness";

const WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS = 30_000;
const WORKSPACE_FLOATING_PANEL_PORTAL_HOST_PREFIX = "workspace-floating-panels";
const EMPTY_UI_TABS: WorkspaceTab[] = [];
const EMPTY_WORKSPACE_SCRIPTS: WorkspaceDescriptor["scripts"] = [];
const EMPTY_PINNED_AGENT_IDS = new Set<string>();
const EMPTY_SET = new Set<string>();

function getWorkspaceScripts(
  workspaceDescriptor: WorkspaceDescriptor | null | undefined,
): WorkspaceDescriptor["scripts"] {
  return workspaceDescriptor?.scripts ?? EMPTY_WORKSPACE_SCRIPTS;
}

function getWorkspaceProjectId(
  workspaceDescriptor: WorkspaceDescriptor | null | undefined,
): string | null {
  return workspaceDescriptor?.projectId || null;
}

interface WorkspaceFileLocationFields {
  path: string | null;
  lineStart?: number;
  lineEnd?: number;
}

function getWorkspaceFileLocationFields(
  tab: WorkspaceTabDescriptor | null,
): WorkspaceFileLocationFields {
  const target = tab?.target;
  if (target?.kind !== "file") {
    return { path: null };
  }
  return { path: target.path, lineStart: target.lineStart, lineEnd: target.lineEnd };
}

function buildWorkspaceFileLocation(
  fields: WorkspaceFileLocationFields,
): WorkspaceFileLocation | null {
  if (fields.path === null) {
    return null;
  }
  return { path: fields.path, lineStart: fields.lineStart, lineEnd: fields.lineEnd };
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedAlarmClock = withUnistyles(AlarmClock);
const ThemedCalendarClock = withUnistyles(CalendarClock);
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedEllipsisVertical = withUnistyles(EllipsisVertical);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedChatBubble = withUnistyles(ChatBubble);
const ThemedChatBubbleOff = withUnistyles(ChatBubbleOff);
const ThemedMarkChatUnread = withUnistyles(MarkChatUnread);
const ThemedCircleX = withUnistyles(CircleX);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedHeadsetMic = withUnistyles(HeadsetMic);
const ThemedHeadsetOff = withUnistyles(HeadsetOff);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedX = withUnistyles(X);
const ThemedFileText = withUnistyles(FileText);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedGlobe = withUnistyles(Globe);
const ThemedImport = withUnistyles(ImportIcon);
const ThemedSettings = withUnistyles(Settings);
const ThemedStar = withUnistyles(Star);
const ThemedStarFilled = withUnistyles(StarFilled);
const ThemedContextualToken = withUnistyles(ContextualToken);
const ThemedBookOpen = withUnistyles(BookOpen);
const ThemedExplore = withUnistyles(Explore);
const ThemedPlay = withUnistyles(Play);

interface DynamicProviderIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function DynamicProviderIcon({ iconKey, size, color = "" }: DynamicProviderIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedDynamicProviderIcon = withUnistyles(DynamicProviderIcon);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// Matches the selected-tab icon accent in the desktop tabs row (WorkspaceTabIcon).
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });
// Size-folding variants: `uniProps` mappings read the live theme, so folding
// `theme.iconSize.*` into the mapping keeps these icons reactive to the compact
// (mobile) icon-doubling patch - a plain `size={16}` prop is a frozen literal.
const mutedSmMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const foregroundMdMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.md,
});
const mutedMdMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
const accentMdMapping = (theme: Theme) => ({
  color: theme.colors.accentBright,
  size: theme.iconSize.md,
});

const MENU_NEW_AGENT_ICON = <ThemedSquarePen uniProps={mutedMdMapping} />;
const MENU_NEW_TERMINAL_ICON = <ThemedSquareTerminal uniProps={mutedMdMapping} />;
const MENU_NEW_BROWSER_ICON = <ThemedGlobe uniProps={mutedMdMapping} />;
const MENU_ADD_ARTIFACT_ICON = <ThemedFileText uniProps={mutedMdMapping} />;
const MENU_IMPORT_ICON = <ThemedImport uniProps={mutedMdMapping} />;
const MENU_COPY_ICON = <ThemedCopy uniProps={mutedMdMapping} />;
const MENU_SETTINGS_ICON = <ThemedSettings uniProps={mutedMdMapping} />;
// Matches the Context Management tab's own icon and the sidebar row's item -
// one thing, one glyph, wherever you meet it.
const MENU_CONTEXT_ICON = <ThemedContextualToken uniProps={mutedMdMapping} />;
const MENU_KNOWLEDGE_ICON = <ThemedBookOpen uniProps={mutedMdMapping} />;
// Leading icons for the compact-fit fallback items (see
// resolveCompactHeaderActions): same glyphs as the header buttons they replace.
const MENU_EXPLORER_ICON = <ThemedExplore uniProps={mutedMdMapping} />;
const MENU_PLAY_ICON = <ThemedPlay uniProps={mutedMdMapping} />;
const GATED_WORKSPACE_HEADER_LEFT = <SidebarMenuToggle />;

interface WorkspaceScreenProps {
  serverId: string;
  workspaceId: string;
  isRouteFocused?: boolean;
}

type WorkspaceScreenContentProps = WorkspaceScreenProps & {
  isRouteFocused: boolean;
};

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function useSyncWorkspaceActiveBrowser(input: {
  workspaceLayout: WorkspaceLayout | null;
  isRouteFocused: boolean;
  workspaceId: string;
}) {
  const focusedBrowserId = useMemo(
    () => getFocusedBrowserId(input.workspaceLayout),
    [input.workspaceLayout],
  );

  useEffect(() => {
    if (!getIsElectron()) {
      return;
    }
    void getDesktopHost()?.browser?.setWorkspaceActiveBrowser?.({
      workspaceId: input.workspaceId,
      browserId: focusedBrowserId,
    });
  }, [focusedBrowserId, input.workspaceId]);
}

function getFallbackTabOptionLabel(
  tab: WorkspaceTabDescriptor,
  labels: {
    newAgent: string;
    setup: string;
    terminal: string;
    browser: string;
    agent: string;
    visualizer: string;
    contextManagement: string;
  },
): string {
  if (tab.target.kind === "draft") {
    return labels.newAgent;
  }
  if (tab.target.kind === "setup") {
    return labels.setup;
  }
  if (tab.target.kind === "terminal") {
    return labels.terminal;
  }
  if (tab.target.kind === "browser") {
    return labels.browser;
  }
  if (tab.target.kind === "file") {
    return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
  }
  if (tab.target.kind === "artifact") {
    return tab.target.artifactId;
  }
  if (tab.target.kind === "gitLog") {
    return formatGitLogFallbackTitle(tab.target.operation);
  }
  if (tab.target.kind === "visualizer") {
    return labels.visualizer;
  }
  if (tab.target.kind === "contextManagement") {
    return labels.contextManagement;
  }
  return labels.agent;
}

// Fallback-only (the registry descriptor carries the localized title); matches
// the artifact fallback's raw-identity precedent.
function formatGitLogFallbackTitle(operation: string): string {
  const capitalized = operation.charAt(0).toUpperCase() + operation.slice(1);
  return `Git ${capitalized}`;
}

function getFallbackTabOptionDescription(
  tab: WorkspaceTabDescriptor,
  labels: {
    newAgent: string;
    workspaceSetup: string;
    agent: string;
    terminal: string;
    browser: string;
    visualizer: string;
    contextManagement: string;
  },
): string {
  if (tab.target.kind === "draft") {
    return labels.newAgent;
  }
  if (tab.target.kind === "setup") {
    return labels.workspaceSetup;
  }
  if (tab.target.kind === "agent") {
    return labels.agent;
  }
  if (tab.target.kind === "terminal") {
    return labels.terminal;
  }
  if (tab.target.kind === "browser") {
    return labels.browser;
  }
  if (tab.target.kind === "artifact") {
    return tab.target.artifactId;
  }
  if (tab.target.kind === "gitLog") {
    return formatGitLogFallbackTitle(tab.target.operation);
  }
  if (tab.target.kind === "visualizer") {
    return labels.visualizer;
  }
  if (tab.target.kind === "contextManagement") {
    return labels.contextManagement;
  }
  if (tab.target.kind === "orchestrationGraph") {
    return "Graph";
  }
  // A refine job is named for the document it is about. Its paths are absolute
  // (a working set can span the project and `~/.claude`), so this takes the file
  // name rather than printing a drive letter and an account name into the tab
  // switcher.
  if (tab.target.kind === "refine") {
    return fileNameOf(tab.target.paths[0] ?? "");
  }
  return tab.target.kind === "file" ? tab.target.path : "";
}

function fileNameOf(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

interface MobileWorkspaceTabSwitcherProps {
  tabs: WorkspaceTabDescriptor[];
  activeTabKey: string;
  activeTab: WorkspaceTabDescriptor | null;
  tabSwitcherOptions: ComboboxOption[];
  tabByKey: Map<string, WorkspaceTabDescriptor>;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onSelectSwitcherTab: (key: string) => void;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsAbove: (tabId: string) => Promise<void> | void;
  onCloseTabsBelow: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onArchiveAgent: (agentId: string) => Promise<void> | void;
  onDeleteAgent: (agentId: string) => Promise<void> | void;
}

function MobileActiveTabTrigger({
  activeTab,
  normalizedServerId,
  normalizedWorkspaceId,
}: {
  activeTab: WorkspaceTabDescriptor | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
}) {
  if (!activeTab) {
    return null;
  }

  return (
    <ResolvedMobileActiveTabTrigger
      activeTab={activeTab}
      normalizedServerId={normalizedServerId}
      normalizedWorkspaceId={normalizedWorkspaceId}
    />
  );
}

function ResolvedMobileActiveTabTrigger({
  activeTab,
  normalizedServerId,
  normalizedWorkspaceId,
}: {
  activeTab: WorkspaceTabDescriptor;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
}) {
  const { t } = useTranslation();
  return (
    <WorkspaceTabPresentationResolver
      tab={activeTab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {(presentation) => (
        <>
          <View style={styles.switcherTriggerIcon} testID="workspace-active-tab-icon">
            <WorkspaceTabIcon presentation={presentation} active />
          </View>

          <Text style={styles.switcherTriggerText} numberOfLines={1}>
            {presentation.titleState === "loading"
              ? t("workspace.tabs.loading")
              : presentation.label}
          </Text>
        </>
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function WorkspaceDocumentTitleEffect({
  label,
  titleState,
}: {
  label: string;
  titleState: "ready" | "loading";
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (isNative || typeof document === "undefined") {
      return;
    }
    const resolvedLabel = label.trim();
    document.title =
      titleState === "loading"
        ? t("workspace.tabs.loading")
        : resolvedLabel || t("workspace.tabs.fallback.workspace");
  }, [label, titleState, t]);

  return null;
}

function noop() {}

function mobileTabMenuTriggerStyle({ open, pressed }: { open?: boolean; pressed?: boolean }) {
  return [
    styles.mobileTabMenuTrigger,
    (Boolean(open) || Boolean(pressed)) && styles.mobileTabMenuTriggerActive,
  ];
}

function switcherTriggerStyle({ pressed }: { pressed?: boolean }) {
  return [styles.switcherTrigger, Boolean(pressed) && styles.switcherTriggerPressed];
}

function MobileTabTrailingAccessory({
  menuTestIDBase,
  presentationLabel,
  menuEntries,
}: {
  menuTestIDBase: string;
  presentationLabel: string;
  menuEntries: WorkspaceTabMenuEntry[];
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID={`${menuTestIDBase}-trigger`}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.menu.openFor", { label: presentationLabel })}
        hitSlop={8}
        style={mobileTabMenuTriggerStyle}
      >
        <ThemedEllipsis uniProps={mutedSmMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" width={220} testID={menuTestIDBase}>
        {menuEntries.map((entry) =>
          entry.kind === "separator" ? (
            <DropdownMenuSeparator key={entry.key} />
          ) : (
            <MobileTabDropdownMenuItem key={entry.key} entry={entry} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileTabDropdownMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    switch (entry.icon) {
      case "copy":
        return <ThemedCopy uniProps={mutedMdMapping} />;
      case "rotate-cw":
        return <ThemedRotateCw uniProps={mutedMdMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine uniProps={mutedMdMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine uniProps={mutedMdMapping} />;
      case "copy-x":
        return <ThemedCopyX uniProps={mutedMdMapping} />;
      case "pencil":
        return <ThemedPencil uniProps={mutedMdMapping} />;
      case "folder-open":
        return <ThemedFolderOpen uniProps={mutedMdMapping} />;
      case "x":
        return <ThemedX uniProps={mutedMdMapping} />;
      default:
        return undefined;
    }
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return (
    <DropdownMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </DropdownMenuItem>
  );
}

function MobileWorkspaceTabOption({
  tab,
  tabIndex,
  tabCount,
  normalizedServerId,
  normalizedWorkspaceId,
  selected,
  active,
  onPress,
  onCopyResumeCommand,
  onCopyTerminalId,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTab,
  onCloseTabsAbove,
  onCloseTabsBelow,
  onCloseOtherTabs,
  onArchiveAgent,
  onDeleteAgent,
}: {
  tab: WorkspaceTabDescriptor;
  tabIndex: number;
  tabCount: number;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsAbove: (tabId: string) => Promise<void> | void;
  onCloseTabsBelow: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onArchiveAgent: (agentId: string) => Promise<void> | void;
  onDeleteAgent: (agentId: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const isDeveloperMode = useIsDeveloperMode();
  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyTerminalId: t("workspace.tabs.menu.copyTerminalId"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      moveToWorkspace: t("workspace.tabs.menu.moveToWorkspace"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
  const { onMoveToWorkspace, canMove } = useMoveChatMenu(normalizedServerId);
  const menuTestIDBase = `workspace-tab-menu-${buildDeterministicWorkspaceTabId(tab.target)}`;
  const menuEntries = buildWorkspaceTabMenuEntries({
    surface: "mobile",
    tab,
    index: tabIndex,
    tabCount,
    menuTestIDBase,
    isDeveloperMode,
    onCopyResumeCommand,
    onCopyTerminalId,
    onCopyAgentId,
    onCopyFilePath,
    onReloadAgent,
    onRenameTab,
    onCloseTab,
    onCloseTabsBefore: onCloseTabsAbove,
    onCloseTabsAfter: onCloseTabsBelow,
    onCloseOtherTabs,
    onArchiveAgent,
    onDeleteAgent,
    onMoveToWorkspace,
    canMoveToWorkspace: canMove,
    labels: tabMenuLabels,
  });

  const fallbackLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      browser: t("workspace.tabs.fallback.browser"),
      agent: t("workspace.tabs.fallback.agent"),
      visualizer: t("workspace.tabs.fallback.visualizer"),
      contextManagement: t("workspace.contextManagement.tabLabel"),
    }),
    [t],
  );
  const fallbackLabel = getFallbackTabOptionLabel(tab, fallbackLabels);
  const trailingAccessory = useMemo(
    () => (
      <MobileTabTrailingAccessory
        menuTestIDBase={menuTestIDBase}
        presentationLabel={fallbackLabel}
        menuEntries={menuEntries}
      />
    ),
    [menuTestIDBase, fallbackLabel, menuEntries],
  );

  const renderPresentation = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <WorkspaceTabOptionRow
        presentation={presentation}
        selected={selected}
        active={active}
        onPress={onPress}
        trailingAccessory={trailingAccessory}
      />
    ),
    [selected, active, onPress, trailingAccessory],
  );

  return (
    <WorkspaceTabPresentationResolver
      tab={tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {renderPresentation}
    </WorkspaceTabPresentationResolver>
  );
}

const MobileWorkspaceTabSwitcher = memo(function MobileWorkspaceTabSwitcher({
  tabs,
  activeTabKey,
  activeTab,
  tabSwitcherOptions,
  tabByKey,
  normalizedServerId,
  normalizedWorkspaceId,
  onSelectSwitcherTab,
  onCopyResumeCommand,
  onCopyTerminalId,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTab,
  onCloseTabsAbove,
  onCloseTabsBelow,
  onCloseOtherTabs,
  onArchiveAgent,
  onDeleteAgent,
}: MobileWorkspaceTabSwitcherProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const tabIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    tabs.forEach((tab, index) => {
      map.set(tab.key, index);
    });
    return map;
  }, [tabs]);

  const handleOpenSwitcher = useCallback(() => {
    Keyboard.dismiss();
    setIsOpen(true);
  }, []);

  const renderTabOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      const tab = tabByKey.get(option.id);
      if (!tab) {
        return <View />;
      }
      const tabIndex = tabIndexByKey.get(tab.key) ?? -1;
      if (tabIndex < 0) {
        return <View />;
      }
      return (
        <MobileWorkspaceTabOption
          tab={tab}
          tabIndex={tabIndex}
          tabCount={tabs.length}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          selected={selected}
          active={active}
          onPress={onPress}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyTerminalId={onCopyTerminalId}
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTab={onCloseTab}
          onCloseTabsAbove={onCloseTabsAbove}
          onCloseTabsBelow={onCloseTabsBelow}
          onCloseOtherTabs={onCloseOtherTabs}
          onArchiveAgent={onArchiveAgent}
          onDeleteAgent={onDeleteAgent}
        />
      );
    },
    [
      tabByKey,
      tabIndexByKey,
      tabs.length,
      normalizedServerId,
      normalizedWorkspaceId,
      onCopyResumeCommand,
      onCopyTerminalId,
      onCopyAgentId,
      onCopyFilePath,
      onReloadAgent,
      onRenameTab,
      onCloseTab,
      onCloseTabsAbove,
      onCloseTabsBelow,
      onCloseOtherTabs,
      onArchiveAgent,
      onDeleteAgent,
    ],
  );

  return (
    <View style={styles.mobileTabsRow} testID="workspace-tabs-row">
      <Pressable
        ref={anchorRef}
        testID="workspace-tab-switcher-trigger"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.switcher.trigger", { count: tabs.length })}
        style={switcherTriggerStyle}
        onPress={handleOpenSwitcher}
      >
        <View style={styles.switcherTriggerLeft}>
          <MobileActiveTabTrigger
            activeTab={activeTab}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
          />
        </View>
        <ThemedChevronDown uniProps={mutedSmMapping} />
      </Pressable>

      <Combobox
        options={tabSwitcherOptions}
        value={activeTabKey}
        onSelect={onSelectSwitcherTab}
        searchable={false}
        title={t("workspace.tabs.switcher.title")}
        searchPlaceholder={t("workspace.tabs.switcher.searchPlaceholder")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        renderOption={renderTabOption}
        mobileScrollToValueOnOpen
      />
    </View>
  );
});

interface MobileMountedTabSlotProps {
  tabDescriptor: WorkspaceTabDescriptor;
  isVisible: boolean;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  paneId: string | null;
  buildPaneContentModel: (input: {
    paneId: string | null;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
}

const selectBlackTabBackground = (settings: AppSettings) => settings.blackTabBackground;

// A hidden retained tab freezes its stream store subscription by design. Keep
// the slot itself subscribed to this pane-wide appearance setting so React
// reconciles its content when the black chat background changes.
function useBlackChatBackgroundRefresh(): void {
  useAppSettingValue(selectBlackTabBackground);
}

const MobileMountedTabSlot = memo(function MobileMountedTabSlot({
  tabDescriptor,
  isVisible,
  isWorkspaceFocused,
  isPaneFocused,
  paneId,
  buildPaneContentModel,
}: MobileMountedTabSlotProps) {
  useBlackChatBackgroundRefresh();
  const content = useMemo(
    () =>
      buildPaneContentModel({
        paneId,
        tab: tabDescriptor,
      }),
    [buildPaneContentModel, paneId, tabDescriptor],
  );

  return (
    <RenderProfile id={`MobileMountedTabSlot:${tabDescriptor.kind}:${tabDescriptor.tabId}`}>
      <RetainedPanel active={isVisible} style={styles.mobileMountedTabSlot}>
        <WorkspacePaneContent
          content={content}
          isWorkspaceFocused={isWorkspaceFocused}
          isPaneFocused={isPaneFocused}
          // Already encodes route focus + frontmost tab, i.e. on screen.
          isVisible={isVisible}
        />
      </RetainedPanel>
    </RenderProfile>
  );
});

function useStableTabDescriptorMap(tabDescriptors: WorkspaceTabDescriptor[]) {
  const cacheRef = useRef(new Map<string, WorkspaceTabDescriptor>());
  const tabDescriptorMap = useMemo(() => {
    const next = new Map<string, WorkspaceTabDescriptor>();
    for (const tabDescriptor of tabDescriptors) {
      const cachedDescriptor = cacheRef.current.get(tabDescriptor.tabId);
      if (
        cachedDescriptor &&
        cachedDescriptor.key === tabDescriptor.key &&
        cachedDescriptor.kind === tabDescriptor.kind &&
        workspaceTabTargetsEqual(cachedDescriptor.target, tabDescriptor.target)
      ) {
        next.set(tabDescriptor.tabId, cachedDescriptor);
        continue;
      }
      next.set(tabDescriptor.tabId, tabDescriptor);
    }
    return next;
  }, [tabDescriptors]);
  useEffect(() => {
    cacheRef.current = tabDescriptorMap;
  }, [tabDescriptorMap]);

  return tabDescriptorMap;
}

export const WorkspaceScreen = memo(function WorkspaceScreen({
  serverId,
  workspaceId,
  isRouteFocused,
}: WorkspaceScreenProps) {
  const navigationFocused = useIsFocused();
  return (
    <WorkspaceScreenContent
      serverId={serverId}
      workspaceId={workspaceId}
      isRouteFocused={isRouteFocused ?? navigationFocused}
    />
  );
});

interface UseCloseTabsResult {
  closingTabIds: Set<string>;
  closeTab: (tabId: string, action: () => Promise<void>) => Promise<void>;
}

/** Gate that stays false until initial interactions settle, so deferred
 * warm-up work does not compete with the mount that scheduled it. */
function useEnabledAfterInteractions(enabled: boolean): boolean {
  const [interactionsSettled, setInteractionsSettled] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setInteractionsSettled(true));
    return () => task.cancel();
  }, []);
  return enabled && interactionsSettled;
}

function isDictationTab(target: WorkspaceTabTarget | undefined): boolean {
  return ["agent", "draft"].includes(target?.kind ?? "");
}

function isWorkspaceMicrophoneAvailable(enabled: boolean, hasDictationTab: boolean): boolean {
  return shouldShowWakeWordToolbarButton({
    featureEnabled: enabled,
    supported: getWakeWordCapability().available,
    hasDictationTab,
  });
}

function getWorkspaceMicrophoneAvailability(
  enabled: boolean,
  activeTab: { descriptor: { target: WorkspaceTabTarget } } | null | undefined,
): boolean {
  return isWorkspaceMicrophoneAvailable(enabled, isDictationTab(activeTab?.descriptor.target));
}

function useCloseTabs(): UseCloseTabsResult {
  const pendingRef = useRef(new Set<string>());
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(EMPTY_SET);

  const closeTab = useCallback(async (tabId: string, action: () => Promise<void>) => {
    const normalized = tabId.trim();
    if (!normalized || pendingRef.current.has(normalized)) {
      return;
    }
    pendingRef.current.add(normalized);
    setClosingTabIds(new Set(pendingRef.current));
    try {
      await action();
    } finally {
      pendingRef.current.delete(normalized);
      setClosingTabIds(new Set(pendingRef.current));
    }
  }, []);

  return { closingTabIds, closeTab };
}

interface WorkspaceHeaderMenuProps {
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  currentBranchName: string | null;
  showWorkspaceSetup: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  // Fallback items for header buttons the compact width fit dropped (see
  // `resolveCompactHeaderActions`); all false while every button still fits.
  showVisualizerMenuItem: boolean;
  showVoiceCuesMenuItem: boolean;
  showExplorerMenuItem: boolean;
  showScriptsMenuItem: boolean;
  // Scripts data for the collapsed Play fallback's hidden dropdown anchor.
  workspaceScripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds: string[];
  onToggleExplorer: () => void;
  onScriptTerminalStarted: (terminalId: string) => void;
  onViewScriptTerminal: (terminalId: string) => void;
  onOpenUrlInBrowserTab: (url: string) => void;
  createTerminalDisabled: boolean;
  importAgentDisabled: boolean;
  copyPathDisabled: boolean;
  menuNewAgentIcon: ReactElement;
  menuNewTerminalIcon: ReactElement;
  menuNewBrowserIcon: ReactElement;
  menuImportIcon: ReactElement;
  menuCopyIcon: ReactElement;
  menuSettingsIcon: ReactElement;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfileInput) => void;
  onCreateBrowser: () => void;
  onOpenImportSheet: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
  onOpenContextManagement: () => void;
  onOpenProjectKnowledge: () => void;
}
interface HeaderMenuProfileItemProps {
  profile: { id: string; name: string; command: string; args?: string[]; icon?: string };
  disabled: boolean;
  onCreateTerminalWithProfile: (profile: TerminalProfileInput) => void;
}

function HeaderMenuProfileItem({
  profile,
  disabled,
  onCreateTerminalWithProfile,
}: HeaderMenuProfileItemProps) {
  const handleSelect = useCallback(() => {
    onCreateTerminalWithProfile({
      name: profile.name,
      command: profile.command,
      args: profile.args,
    });
  }, [onCreateTerminalWithProfile, profile]);

  const icon = getTerminalProfileIcon(profile);

  const leading = useMemo(() => {
    if (!icon) {
      return (
        <View style={styles.headerMenuProfileIconWrapper}>
          <ThemedSquareTerminal uniProps={mutedMdMapping} />
        </View>
      );
    }
    return (
      <View style={styles.headerMenuProfileIconWrapper}>
        <ThemedDynamicProviderIcon iconKey={icon} uniProps={mutedMdMapping} />
      </View>
    );
  }, [icon]);

  return (
    <DropdownMenuItem leading={leading} disabled={disabled} onSelect={handleSelect}>
      {profile.name}
    </DropdownMenuItem>
  );
}

// The "..." trigger sits beside the diff toggle in the mobile header, both using
// the menu button's auto-sized chrome - a 2x icon would overflow that chrome, so
// this scales at 1.5x instead of the usual compact doubling (see `useIconSize`).
function WorkspaceHeaderMenuTriggerIcon({
  hovered,
  open,
  isMobile,
}: {
  hovered: boolean;
  open: boolean;
  isMobile: boolean;
}) {
  const Icon = isMobile ? ThemedEllipsisVertical : ThemedEllipsis;
  const iconSize = useIconSize(1.5);
  const colorMapping = hovered || open ? foregroundColorMapping : mutedColorMapping;
  return <Icon size={iconSize.md} uniProps={colorMapping} />;
}

function headerActionTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
}) {
  return [
    styles.headerActionButton,
    (Boolean(hovered) || Boolean(pressed) || Boolean(open)) && styles.headerActionButtonHovered,
  ];
}

// Mirrors the menu button's own chrome (`headerIconSlotStyle`) instead of a
// separately-sized fixed box, so the mobile "..." trigger matches it exactly.
function compactHeaderActionTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
}) {
  return [
    headerIconSlotStyle.slot,
    (Boolean(hovered) || Boolean(pressed) || Boolean(open)) && headerIconSlotStyle.slotHovered,
  ];
}

// The git-checkout variant of the explorer toggle (with its diff-stat badge and
// tooltip). Extracted from the workspace header so the header's JSX stays under
// the nesting-depth cap; it's developer-only, gated at the mount site.
function GitCheckoutExplorerToggle({
  anchorRef,
  onPress,
  accessibilityLabel,
  accessibilityState,
  style,
  isExplorerOpen,
  diffStat,
  showDiffStat,
}: {
  anchorRef: ComponentProps<typeof Pressable>["ref"];
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityState: { expanded: boolean };
  style: ComponentProps<typeof Pressable>["style"];
  isExplorerOpen: boolean;
  diffStat: { additions: number; deletions: number } | null | undefined;
  showDiffStat: boolean;
}) {
  const { t } = useTranslation();
  const explorerToggleKeys = useShortcutKeys("toggle-right-sidebar");
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          ref={anchorRef}
          testID="workspace-explorer-toggle"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={accessibilityState}
          style={style}
        >
          {({ hovered, pressed }) => {
            const inactiveMapping = hovered || pressed ? foregroundMdMapping : mutedMdMapping;
            return (
              <View style={styles.explorerToggleShortcutDiscoveryAnchor}>
                {isExplorerOpen ? (
                  <ThemedExplore uniProps={accentMdMapping} />
                ) : (
                  <ThemedExplore uniProps={inactiveMapping} />
                )}
                {diffStat && showDiffStat ? (
                  <DiffStat
                    additions={diffStat.additions}
                    deletions={diffStat.deletions}
                    style={styles.sourceControlDiffStat}
                  />
                ) : null}
                <ShortcutDiscoveryHint
                  action="sidebar.toggle.right"
                  style={styles.explorerToggleShortcutDiscoveryHint}
                />
              </View>
            );
          }}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent
        testID="workspace-explorer-toggle-tooltip"
        side="bottom"
        align="center"
        offset={8}
      >
        <View style={styles.explorerTooltipRow}>
          <Text style={styles.explorerTooltipText}>{t("workspace.tabs.explorer.toggle")}</Text>
          {explorerToggleKeys ? (
            <Shortcut chord={explorerToggleKeys} style={styles.explorerTooltipShortcut} />
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

// The plain Explore toggle (no git-aware diff badge) used to open/close the
// explorer sidebar. Developer mode uses it for non-git checkouts; User interface
// mode always uses it, since that mode shows a Files-only explorer.
function PlainExplorerToggle({
  isMobile,
  anchorRef,
  onPress,
  isExplorerOpen,
  accessibilityLabel,
  accessibilityState,
}: {
  isMobile: boolean;
  anchorRef: ComponentProps<typeof HeaderToggleButton>["anchorRef"];
  onPress: () => void;
  isExplorerOpen: boolean;
  accessibilityLabel: string;
  accessibilityState: { expanded: boolean };
}) {
  const { t } = useTranslation();
  const headerActionIconSize = useIconSize(1.5);
  const explorerToggleKeys = useShortcutKeys("toggle-right-sidebar");
  if (isMobile) {
    return (
      <HeaderToggleButton
        anchorRef={anchorRef}
        testID="workspace-explorer-toggle"
        onPress={onPress}
        tooltipLabel={t("workspace.tabs.explorer.toggle")}
        tooltipKeys={explorerToggleKeys}
        tooltipSide="bottom"
        active={isExplorerOpen}
        shortcutDiscoveryAction="sidebar.toggle.right"
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        style={headerIconSlotStyle.compactSlot}
      >
        {({ hovered }) =>
          isExplorerOpen ? (
            <ThemedExplore size={headerActionIconSize.lg} uniProps={accentColorMapping} />
          ) : (
            <ThemedExplore
              size={headerActionIconSize.lg}
              uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
            />
          )
        }
      </HeaderToggleButton>
    );
  }
  return (
    <HeaderToggleButton
      anchorRef={anchorRef}
      testID="workspace-explorer-toggle"
      onPress={onPress}
      tooltipLabel={t("workspace.tabs.explorer.toggle")}
      tooltipKeys={explorerToggleKeys}
      tooltipSide="bottom"
      style={styles.compactHeaderActionButton}
      active={isExplorerOpen}
      shortcutDiscoveryAction="sidebar.toggle.right"
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
    >
      {({ hovered }) =>
        isExplorerOpen ? (
          <ThemedExplore uniProps={accentMdMapping} />
        ) : (
          <ThemedExplore uniProps={hovered ? foregroundMdMapping : mutedMdMapping} />
        )
      }
    </HeaderToggleButton>
  );
}

function WorkspaceHeaderMenu({
  normalizedServerId,
  normalizedWorkspaceId,
  currentBranchName,
  showWorkspaceSetup,
  showCreateBrowserTab,
  isMobile,
  showVisualizerMenuItem,
  showVoiceCuesMenuItem,
  showExplorerMenuItem,
  showScriptsMenuItem,
  workspaceScripts,
  liveTerminalIds,
  onToggleExplorer,
  onScriptTerminalStarted,
  onViewScriptTerminal,
  onOpenUrlInBrowserTab,
  createTerminalDisabled,
  importAgentDisabled,
  copyPathDisabled,
  menuNewAgentIcon,
  menuNewTerminalIcon,
  menuNewBrowserIcon,
  menuImportIcon,
  menuCopyIcon,
  menuSettingsIcon,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateTerminalWithProfile,
  onCreateBrowser,
  onOpenImportSheet,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
  onOpenContextManagement,
  onOpenProjectKnowledge,
}: WorkspaceHeaderMenuProps) {
  const { t } = useTranslation();
  const router = useRouter();
  // User mode hides the developer affordances in this menu (filesystem path /
  // branch copy, and the whole terminal-profiles section).
  const isDeveloperMode = useIsDeveloperMode();
  const { config } = useDaemonConfig(normalizedServerId);
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );
  const supportsArtifacts = useHostFeature(normalizedServerId, "artifacts");
  // The artifacts dropdown is its own controlled menu anchored to a hidden
  // zero-size trigger (same pattern as the tab row's collapsed tools): the
  // "Add artifact" item below flips it open after this menu dismisses.
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const handleOpenArtifacts = useCallback(() => setArtifactsOpen(true), []);
  // The collapsed Play fallback works the same way: its dropdown is anchored to
  // a hidden zero-size WorkspaceScriptsButton below, opened after this menu
  // dismisses.
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const handleOpenScripts = useCallback(() => setScriptsOpen(true), []);

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);

  const handleOpenSettings = useCallback(() => {
    router.push(buildSettingsHostRoute(normalizedServerId) as Href);
  }, [normalizedServerId, router]);

  const renderTriggerIcon = useCallback(
    ({ hovered, open }: { hovered: boolean; open: boolean }) => (
      <WorkspaceHeaderMenuTriggerIcon hovered={hovered} open={open} isMobile={isMobile} />
    ),
    [isMobile],
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <DropdownMenuTrigger
              testID="workspace-header-menu-trigger"
              style={isMobile ? compactHeaderActionTriggerStyle : headerActionTriggerStyle}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.header.actions.workspaceActions")}
            >
              {renderTriggerIcon}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            testID="workspace-header-menu-tooltip"
            side="bottom"
            align="center"
            offset={8}
          >
            <Text style={styles.headerMenuTooltipText}>
              {t("workspace.header.actions.workspaceActionsTooltip")}
            </Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" width={220} testID="workspace-header-menu">
          <DropdownMenuItem
            testID="workspace-header-new-agent"
            leading={menuNewAgentIcon}
            onSelect={onCreateDraftTab}
          >
            {t("workspace.header.actions.newAgent")}
          </DropdownMenuItem>
          {showCreateBrowserTab ? (
            <DropdownMenuItem
              testID="workspace-header-new-browser"
              leading={menuNewBrowserIcon}
              onSelect={onCreateBrowser}
            >
              {t("workspace.header.actions.newBrowser")}
            </DropdownMenuItem>
          ) : null}
          {supportsArtifacts ? (
            <DropdownMenuItem
              testID="workspace-header-add-artifact"
              leading={MENU_ADD_ARTIFACT_ICON}
              onSelect={handleOpenArtifacts}
            >
              Add artifact
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            testID="workspace-header-import-agent"
            leading={menuImportIcon}
            disabled={importAgentDisabled}
            onSelect={onOpenImportSheet}
          >
            {t("workspace.header.actions.importSession")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isDeveloperMode ? (
            <DropdownMenuItem
              testID="workspace-header-copy-path"
              leading={menuCopyIcon}
              disabled={copyPathDisabled}
              onSelect={onCopyWorkspacePath}
            >
              {t("workspace.header.actions.copyPath")}
            </DropdownMenuItem>
          ) : null}
          {isDeveloperMode && currentBranchName ? (
            <DropdownMenuItem
              testID="workspace-header-copy-branch-name"
              leading={menuCopyIcon}
              onSelect={onCopyBranchName}
            >
              {t("workspace.header.actions.copyBranchName")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {/* Fallbacks for header buttons the compact width fit dropped (see
              resolveCompactHeaderActions): narrowing the window moves each
              control in here instead of removing it, in the buttons' own
              left-to-right order. Wide rows render none of these. */}
          {showVoiceCuesMenuItem ? <WorkspaceVoiceCuesMenuItem /> : null}
          {showVisualizerMenuItem ? (
            <WorkspaceVisualizerMenuItem
              serverId={normalizedServerId}
              workspaceId={normalizedWorkspaceId}
            />
          ) : null}
          {showScriptsMenuItem ? (
            <DropdownMenuItem
              testID="workspace-header-run-scripts"
              leading={MENU_PLAY_ICON}
              onSelect={handleOpenScripts}
            >
              {t("workspace.scripts.title")}
            </DropdownMenuItem>
          ) : null}
          {showExplorerMenuItem ? (
            <DropdownMenuItem
              testID="workspace-header-explorer"
              leading={MENU_EXPLORER_ICON}
              onSelect={onToggleExplorer}
            >
              {t("workspace.tabs.explorer.toggle")}
            </DropdownMenuItem>
          ) : null}
          {showWorkspaceSetup ? (
            <DropdownMenuItem
              testID="workspace-header-show-setup"
              leading={menuSettingsIcon}
              onSelect={onOpenSetupTab}
            >
              {t("workspace.header.actions.showSetup")}
            </DropdownMenuItem>
          ) : null}
          {/* Unconditional, and deliberately NOT nested in the setup block:
              whether a workspace has setup commands says nothing about whether
              it has context to manage, and gating on it hid this item on every
              ordinary workspace. The composer warning only appears once context
              is already heavy, so this is the way in the rest of the time. */}
          <DropdownMenuItem
            testID="workspace-header-context-management"
            leading={MENU_CONTEXT_ICON}
            onSelect={onOpenContextManagement}
          >
            {t("workspace.contextManagement.openAction")}
          </DropdownMenuItem>
          <DropdownMenuItem
            testID="workspace-header-project-knowledge"
            leading={MENU_KNOWLEDGE_ICON}
            onSelect={onOpenProjectKnowledge}
          >
            Manage knowledge
          </DropdownMenuItem>
          {isDeveloperMode ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("workspace.tabs.actions.terminalProfilesMenu")}
              </DropdownMenuLabel>
              <DropdownMenuItem
                testID="workspace-header-new-terminal"
                leading={menuNewTerminalIcon}
                disabled={createTerminalDisabled}
                onSelect={onCreateTerminal}
              >
                {t("workspace.header.actions.newTerminal")}
              </DropdownMenuItem>
              {profiles.map((profile) => (
                <HeaderMenuProfileItem
                  key={profile.id}
                  profile={profile}
                  disabled={createTerminalDisabled}
                  onCreateTerminalWithProfile={onCreateTerminalWithProfile}
                />
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID="workspace-header-edit-terminal-profiles"
                onSelect={handleEditProfiles}
              >
                {t("workspace.tabs.actions.editTerminalProfiles")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            testID="workspace-header-open-settings"
            leading={menuSettingsIcon}
            onSelect={handleOpenSettings}
          >
            {t("workspace.header.actions.settings")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Host for the "Add artifact" flow (added in fb74fb6b2). There is NO
          visible artifact button here - the entry point is the "Add artifact"
          item in the "..." menu above, which flips `artifactsOpen` on. On compact
          form factors that opens a bottom sheet (the feature's original purpose),
          which needs no anchor. On desktop the same controlled menu renders as a
          dropdown, and a dropdown must position against an on-screen element -
          this is that anchor. `hideTrigger` renders it with no glyph; its style is
          `position: absolute` so it stays out of the button row's flex flow and
          can't distort the gap between the buttons. */}
      {supportsArtifacts ? (
        <ArtifactOpenMenu
          serverId={normalizedServerId}
          workspaceId={normalizedWorkspaceId}
          open={artifactsOpen}
          onOpenChange={setArtifactsOpen}
          hideTrigger
        />
      ) : null}
      {/* Hidden anchor for the collapsed Play fallback, same pattern as the
          artifacts host above: the "Run scripts" item flips `scriptsOpen` on
          after this menu dismisses, and the scripts dropdown opens here. */}
      {showScriptsMenuItem ? (
        <WorkspaceScriptsButton
          serverId={normalizedServerId}
          workspaceId={normalizedWorkspaceId}
          scripts={workspaceScripts}
          liveTerminalIds={liveTerminalIds}
          onScriptTerminalStarted={onScriptTerminalStarted}
          onViewTerminal={onViewScriptTerminal}
          onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
          open={scriptsOpen}
          onOpenChange={setScriptsOpen}
          hideTrigger
        />
      ) : null}
    </>
  );
}

interface WorkspaceHeaderTitleBarProps {
  isLoading: boolean;
  title: string;
  subtitle: string;
  showSubtitle: boolean;
  currentBranchName: string | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  activeChatAttachmentScopeKey: string | null;
  workspaceScripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds: string[];
  showWorkspaceSetup: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  // Compact responsive drops (see `fitCompactHeaderActions`); always true on desktop.
  showVisualizerAction: boolean;
  showVoiceCuesAction: boolean;
  showPlayAction: boolean;
  microphoneAvailable: boolean;
  // Pinned, not fitted: the Brain status light never drops to the "..." menu.
  // True whenever the sidebar is not showing its own Brain button.
  showBrainAction: boolean;
  // The dropped actions' "..." menu fallbacks; always false on desktop.
  showVisualizerMenuItem: boolean;
  showVoiceCuesMenuItem: boolean;
  showExplorerMenuItem: boolean;
  showScriptsMenuItem: boolean;
  onToggleExplorer: () => void;
  createTerminalDisabled: boolean;
  importAgentDisabled: boolean;
  copyPathDisabled: boolean;
  menuNewAgentIcon: ReactElement;
  menuNewTerminalIcon: ReactElement;
  menuNewBrowserIcon: ReactElement;
  menuImportIcon: ReactElement;
  menuCopyIcon: ReactElement;
  menuSettingsIcon: ReactElement;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfileInput) => void;
  onCreateBrowser: () => void;
  onOpenImportSheet: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
  onOpenContextManagement: () => void;
  onOpenProjectKnowledge: () => void;
  onScriptTerminalStarted: (terminalId: string) => void;
  onViewScriptTerminal: (terminalId: string) => void;
  onOpenUrlInBrowserTab: (url: string) => void;
}

// On Electron desktop the header sits beneath the titlebar drag overlay
// (TitlebarDragRegion). The project/workspace labels and the empty strip between
// them and the ... menu are static, non-interactive space, but aren't part of
// any drag rect, so a click-drag over them doesn't move the window. Opt the
// whole title container back into the drag region; the container also carries
// data-app-region-drag so the scoped no-drag backstop in index.html keeps the
// interactive menu trigger inside it clickable.
// Web-only; inert on native.
const HEADER_LABEL_DRAG_STYLE = isWeb ? ({ WebkitAppRegion: "drag" } as object) : null;
const HEADER_LABEL_DRAG_DATASET = isWeb ? { "app-region-drag": "" } : undefined;
const selectZoomRecorderEnabled = (settings: AppSettings) => settings.zoomRecorderEnabled;
const selectZoomRecorderPaused = (settings: AppSettings) => settings.zoomRecorderPaused;

function getActiveChatAttachmentScopeKey(tab: WorkspaceTabDescriptor | null): string | null {
  if (tab?.target.kind === "draft")
    return buildDraftWorkspaceAttachmentScopeKey(tab.target.draftId);
  if (tab?.target.kind === "agent")
    return buildAgentWorkspaceAttachmentScopeKey(tab.target.agentId);
  return null;
}

function zoomRecorderColorMapping(
  state: ReturnType<typeof useZoomRecorderStatus>["status"]["state"],
  modelReady: boolean,
  active: boolean,
) {
  const titlebarState = getZoomMeetingTitlebarState(state, modelReady);
  return (theme: Theme) => {
    if (!active) return { color: theme.colors.foregroundMuted };
    switch (titlebarState.tone) {
      case "success":
        return { color: theme.colors.statusSuccess };
      case "warning":
        return { color: theme.colors.statusWarning };
      case "info":
        return { color: theme.colors.statusInfo };
      case "danger":
        return { color: theme.colors.statusDanger };
      default:
        return { color: theme.colors.foregroundMuted };
    }
  };
}

function meetingNotesTriggerStyle(
  {
    hovered,
    pressed,
    open,
    focused,
  }: {
    hovered?: boolean;
    pressed?: boolean;
    open?: boolean;
    focused?: boolean;
  },
  active: boolean,
) {
  return [
    styles.headerActionButton,
    active && styles.headerActionButtonActive,
    Boolean(focused) && styles.headerActionButtonFocused,
    (Boolean(hovered) || Boolean(pressed) || Boolean(open)) && styles.headerActionButtonHovered,
  ];
}

function resolveZoomTeamChatConnectionState(
  connectionState: CommunicationProviderConnectionState | undefined,
): { label: string; isConnected: boolean } {
  switch (connectionState) {
    case "connected":
      return { label: "Connected", isConnected: true };
    case "connecting":
      return { label: "Signing in", isConnected: false };
    case "reauth_required":
      return { label: "Reconnect required", isConnected: false };
    case "error":
      return { label: "Needs attention", isConnected: false };
    default:
      return { label: "Not connected", isConnected: false };
  }
}

function canStartZoomTeamChatSignIn({
  supportsCommunications,
  supportsIntegrationAuthorization,
  isHostConnected,
  isLocalDaemon,
  isStartingSignIn,
}: {
  supportsCommunications: boolean;
  supportsIntegrationAuthorization: boolean;
  isHostConnected: boolean;
  isLocalDaemon: boolean;
  isStartingSignIn: boolean;
}): boolean {
  return (
    supportsCommunications &&
    supportsIntegrationAuthorization &&
    isHostConnected &&
    isLocalDaemon &&
    !isStartingSignIn
  );
}

function zoomTeamChatAccessibilityLabel(unreadCount: number, enabled: boolean): string {
  if (!enabled) return "Open Chat. Disabled.";
  return unreadCount > 0 ? `Open Chat. ${unreadCount} unread.` : "Open Chat";
}

function zoomTeamChatTooltip(
  unreadCount: number,
  connectionLabel: string,
  presenceStatus: CommunicationPresenceStatus,
  observedStatusLabel: string | null,
  enabled: boolean,
): string {
  if (!enabled) return "Chat: Disabled";
  if (unreadCount > 0) return "Chat: Notification";
  return `Chat: ${
    connectionLabel === "Connected"
      ? formatZoomChatPresence(presenceStatus, observedStatusLabel)
      : connectionLabel
  }`;
}

type ZoomChatDisplayedPresenceStatus = CommunicationPresenceStatus | "pending";

function zoomTeamChatPresenceColorMapping(status: ZoomChatDisplayedPresenceStatus) {
  return (theme: Theme) => {
    switch (status) {
      case "available":
        return { color: theme.colors.statusSuccess };
      case "busy":
      case "do_not_disturb":
        return { color: theme.colors.statusDanger };
      case "away":
      case "out_of_office":
        return { color: theme.colors.foregroundMuted };
      default:
        return { color: theme.colors.foregroundMuted };
    }
  };
}

const notificationColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

function ZoomTeamChatTitleIcon({
  unreadCount,
  connected,
  presenceStatus,
  enabled,
  iconSize,
}: {
  unreadCount: number;
  connected: boolean;
  presenceStatus: CommunicationPresenceStatus;
  enabled: boolean;
  iconSize: number;
}): ReactElement {
  if (enabled && unreadCount > 0) {
    return <ThemedMarkChatUnread size={iconSize} uniProps={notificationColorMapping} />;
  }
  return connected && enabled ? (
    <ThemedChatBubble size={iconSize} uniProps={zoomTeamChatPresenceColorMapping(presenceStatus)} />
  ) : (
    <ThemedChatBubbleOff size={iconSize} uniProps={mutedColorMapping} />
  );
}

function toLegacyChatHomeSections(
  conversations: CommunicationConversationSummary[],
): CommunicationHomeSection[] {
  const directMessages = conversations.filter((conversation) => conversation.kind === "direct");
  const groups = conversations.filter((conversation) => conversation.kind === "group");
  const channels = conversations.filter((conversation) => conversation.kind === "channel");
  return [
    {
      id: "direct-messages",
      label: "Direct messages",
      conversations: directMessages,
      collections: [],
    },
    { id: "groups", label: "Groups", conversations: groups, collections: [] },
    { id: "channels", label: "Channels", conversations: channels, collections: [] },
  ].filter((section) => section.conversations.length > 0);
}

interface ZoomChatPresenceOption {
  id: Exclude<CommunicationPresenceStatus, "unknown"> | "offline";
  label: string;
}

const ZOOM_CHAT_PRESENCE_OPTIONS: ZoomChatPresenceOption[] = [
  { id: "available", label: "Available" },
  { id: "busy", label: "Busy" },
  { id: "do_not_disturb", label: "Do not disturb" },
  { id: "away", label: "Away" },
  { id: "out_of_office", label: "Out of office" },
  { id: "offline", label: "Offline" },
];

function formatZoomChatPresence(
  status: CommunicationPresenceStatus,
  observedStatusLabel: string | null,
): string {
  return (
    observedStatusLabel ??
    ZOOM_CHAT_PRESENCE_OPTIONS.find((option) => option.id === status)?.label ??
    ""
  );
}

function zoomChatPresenceDisplayText(
  status: CommunicationPresenceStatus,
  enabled: boolean,
  updating: boolean,
  pendingStatus: CommunicationPresenceStatus | null,
  observedStatusLabel: string | null,
): string | null {
  if (updating) return "Updating...";
  if (pendingStatus) return "Pending";
  if (!enabled) return "Offline";
  return formatZoomChatPresence(status, observedStatusLabel) || null;
}

function zoomStatusUpdateErrorMessage(error: unknown): string {
  const cooldownMatch = /available again at (\d{4}-\d{2}-\d{2}T[^.]+\.\d{3}Z)/.exec(
    getErrorMessage(error),
  );
  if (cooldownMatch) return "Status can be updated once per minute. Please wait for the timer.";
  const statusCode = /status (\d{3})/.exec(getErrorMessage(error))?.[1];
  return statusCode
    ? `The service rejected this status update (HTTP ${statusCode}).`
    : "Could not apply this status update.";
}

function statusChangeAvailableAtFromError(error: unknown): string | null {
  const value = /available again at (\d{4}-\d{2}-\d{2}T[^.]+\.\d{3}Z)/.exec(
    getErrorMessage(error),
  )?.[1];
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function resolveZoomChatPresenceAfterUpdate(
  previous: CommunicationPresenceStatus,
  requested: CommunicationPresenceStatus,
  observed: CommunicationPresenceStatus,
): CommunicationPresenceStatus {
  if (observed === requested || observed !== "unknown") return observed;
  return previous;
}

function canChangeZoomChatPresence(
  current: CommunicationPresenceStatus,
  next: CommunicationPresenceStatus,
): boolean {
  if (current === next) return false;
  // Zoom's REST API does not permit entering Do Not Disturb on current desktop
  // clients. It remains display-only here, while a user already in DND can
  // return to a writable status.
  switch (current) {
    case "available":
      return next === "away";
    case "away":
      return next === "available";
    case "do_not_disturb":
      return next === "available" || next === "away";
    default:
      return false;
  }
}

function canSelectZoomChatPresenceOption({
  option,
  enabled,
  supportsPresence,
  currentPresence,
  statusChangeLocked,
  pendingStatus,
}: {
  option: ZoomChatPresenceOption;
  enabled: boolean;
  supportsPresence: boolean;
  currentPresence: CommunicationPresenceStatus;
  statusChangeLocked: boolean;
  pendingStatus: CommunicationPresenceStatus | null;
}): boolean {
  if (option.id === "offline") return enabled;
  if (!enabled) return option.id === "available";
  if (pendingStatus) return false;
  if (statusChangeLocked) return false;
  // A connected user can be in a Zoom presence which Otto does not expose as
  // a selectable state (for example, in a meeting). Available is the single
  // documented recovery transition that we can offer without inventing a
  // current status in the picker.
  if (currentPresence === "unknown") return option.id === "available";
  return supportsPresence && canChangeZoomChatPresence(currentPresence, option.id);
}

function getStatusChangeCooldownMs(
  availableAt: string | null,
  now: number,
  availableInMs?: number | null,
  snapshotReceivedAt?: number,
): number {
  if (availableInMs !== null && availableInMs !== undefined && snapshotReceivedAt !== undefined) {
    return Math.max(0, availableInMs - (now - snapshotReceivedAt));
  }
  if (!availableAt) return 0;
  const expiresAt = Date.parse(availableAt);
  return Number.isNaN(expiresAt) ? 0 : Math.max(0, expiresAt - now);
}

function formatStatusChangeCooldown(remainingMs: number): string {
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function zoomChatPresenceOptionAccessibilityLabel(params: {
  option: ZoomChatPresenceOption;
  disabled: boolean;
  statusChangeLocked: boolean;
  statusChangeCooldownMs: number;
}): string {
  if (!params.disabled) return `Set Chat status to ${params.option.label}`;
  if (params.statusChangeLocked && params.option.id !== "offline") {
    return `${params.option.label}, status changes available in ${formatStatusChangeCooldown(params.statusChangeCooldownMs)}`;
  }
  return `${params.option.label}, unavailable from the current status`;
}

function getZoomChatDisplayedPresenceStatus(params: {
  enabled: boolean;
  pendingStatus: CommunicationPresenceStatus | null;
  status: CommunicationPresenceStatus;
}): ZoomChatDisplayedPresenceStatus | "offline" {
  if (!params.enabled) return "offline";
  return params.pendingStatus ? "pending" : params.status;
}

function refreshWhenZoomChatMenuOpens(nextOpen: boolean, refresh: () => void): void {
  if (nextOpen) refresh();
}

function useZoomChatStatusChangeCooldown(
  statusChangeAvailableAt: string | null,
  statusChangeAvailableInMs: number | null,
  supported: boolean,
): { statusChangeCooldownMs: number; statusChangeLocked: boolean } {
  const [clock, setClock] = useState(() => Date.now());
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());
  const statusChangeCooldownMs = getStatusChangeCooldownMs(
    statusChangeAvailableAt,
    clock,
    statusChangeAvailableInMs,
    snapshotReceivedAt,
  );
  const statusChangeLocked = supported && statusChangeCooldownMs > 0;

  useEffect(() => {
    const receivedAt = Date.now();
    setClock(receivedAt);
    setSnapshotReceivedAt(receivedAt);
  }, [statusChangeAvailableAt, statusChangeAvailableInMs]);

  useEffect(() => {
    const remainingMs = getStatusChangeCooldownMs(statusChangeAvailableAt, clock);
    if (remainingMs <= 0) return;
    const timeout = setTimeout(() => setClock(Date.now()), Math.min(1_000, remainingMs));
    return () => clearTimeout(timeout);
  }, [clock, snapshotReceivedAt, statusChangeAvailableAt, statusChangeAvailableInMs]);

  return { statusChangeCooldownMs, statusChangeLocked };
}

function useZoomChatPendingPresenceRefresh(params: {
  enabled: boolean;
  pendingStatus: CommunicationPresenceStatus | null;
  statusChangeAvailableAt: string | null;
  statusChangeAvailableInMs: number | null;
  refresh: () => void;
}): void {
  const [refreshTick, setRefreshTick] = useState(0);
  const { enabled, pendingStatus, statusChangeAvailableAt, statusChangeAvailableInMs, refresh } =
    params;

  useEffect(() => {
    if (!enabled || !pendingStatus) return;
    const remainingMs = getStatusChangeCooldownMs(
      statusChangeAvailableAt,
      Date.now(),
      statusChangeAvailableInMs,
    );
    const delayMs = remainingMs > 0 ? remainingMs + 1_000 : 2_000;
    const timeout = setTimeout(() => {
      refresh();
      setRefreshTick((current) => current + 1);
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [
    enabled,
    pendingStatus,
    refresh,
    refreshTick,
    statusChangeAvailableAt,
    statusChangeAvailableInMs,
  ]);
}

function ZoomChatPresenceIcon({
  status,
  size,
}: {
  status: ZoomChatDisplayedPresenceStatus | "offline";
  size: number;
}): ReactElement {
  if (status === "pending") {
    return <ThemedMoreHorizontal size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  if (status === "busy") {
    return <ThemedCircleX size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  if (status === "away") {
    return <ThemedAlarmClock size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  if (status === "out_of_office") {
    return <ThemedCalendarClock size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  let dotColor = styles.teamChatPresenceDotMuted;
  if (status === "available") dotColor = styles.teamChatPresenceDotSuccess;
  if (status === "do_not_disturb") dotColor = styles.teamChatPresenceDotDanger;
  return (
    <View style={[styles.teamChatPresenceDot, { width: size, height: size }, dotColor]}>
      {status === "do_not_disturb" ? <View style={styles.teamChatPresenceDndBar} /> : null}
    </View>
  );
}

function zoomChatSearchInitials(title: string): string {
  const initials = title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials || "?";
}

function ZoomChatFavoriteButton({
  favorite,
  disabled,
  onPress,
  testID,
}: {
  favorite: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={favorite ? "Remove from Chat favorites" : "Add to Chat favorites"}
      style={[styles.teamChatFavoriteButton, disabled && styles.teamChatFavoriteButtonDisabled]}
    >
      {favorite ? (
        <ThemedStarFilled size={16} uniProps={notificationColorMapping} />
      ) : (
        <ThemedStar size={16} uniProps={mutedSmMapping} />
      )}
    </Pressable>
  );
}

function useZoomChatDestinationSearch({
  client,
  enabled,
}: {
  client: ReturnType<typeof useHostRuntimeClient>;
  enabled: boolean;
}): {
  query: string;
  setQuery: (query: string) => void;
  reset: () => void;
  refresh: () => void;
  isSearchActive: boolean;
  people: CommunicationSearchResult[];
  conversations: CommunicationSearchResult[];
  isSearching: boolean;
  error: string | null;
} {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommunicationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const requestSequence = useRef(0);
  const isSearchActive = enabled && query.trim().length >= 2;
  const reset = useCallback(() => {
    requestSequence.current += 1;
    setQuery("");
    setResults([]);
    setError(null);
    setIsSearching(false);
  }, []);
  const refresh = useCallback(() => setRefreshSequence((sequence) => sequence + 1), []);
  useEffect(() => {
    const searchQuery = query.trim();
    const currentRequest = ++requestSequence.current;
    if (!isSearchActive || !client) {
      setResults([]);
      setError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      const search = async (): Promise<void> => {
        try {
          const searchResults = await client.communicationsInboxSearch({
            providerId: "zoom-team-chat",
            query: searchQuery,
          });
          if (requestSequence.current !== currentRequest) return;
          setResults(searchResults);
        } catch {
          if (requestSequence.current !== currentRequest) return;
          setResults([]);
          setError("Could not search Chat. Reconnect if access was just granted.");
        } finally {
          if (requestSequence.current === currentRequest) setIsSearching(false);
        }
      };
      void search();
    }, 300);
    return () => clearTimeout(timer);
  }, [client, isSearchActive, query, refreshSequence]);
  return {
    query,
    setQuery,
    reset,
    refresh,
    isSearchActive,
    people: results.filter((result) => result.category === "person"),
    conversations: results.filter((result) => result.category === "conversation"),
    isSearching,
    error,
  };
}

function ZoomChatSearchResultRow({
  result,
  iconSize,
  onOpenConversation,
  canToggleFavorite,
  isFavoriteUpdating,
  onToggleFavorite,
}: {
  result: CommunicationSearchResult;
  iconSize: number;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  canToggleFavorite: boolean;
  isFavoriteUpdating: boolean;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
}): ReactElement {
  const onPress = useCallback(
    () => onOpenConversation(result.conversation),
    [onOpenConversation, result.conversation],
  );
  const isPerson = result.category === "person";
  const favorite = result.conversation.favorite === true;
  const toggleFavorite = useCallback(
    () => onToggleFavorite(result.conversation, !favorite),
    [favorite, onToggleFavorite, result.conversation],
  );
  const detail = [result.detail, result.presenceLabel].filter(Boolean).join(" · ");
  return (
    <View style={styles.teamChatSearchResult}>
      <Pressable
        testID={`workspace-zoom-team-chat-search-${result.conversation.conversationId}`}
        onPress={onPress}
        accessibilityLabel={`${isPerson ? "Message" : "Open"} ${result.conversation.title}`}
        style={styles.teamChatSearchResultPrimary}
      >
        {isPerson ? (
          <View style={styles.teamChatSearchAvatar}>
            <Text style={styles.teamChatSearchAvatarText}>
              {zoomChatSearchInitials(result.conversation.title)}
            </Text>
          </View>
        ) : (
          <View style={styles.teamChatSearchConversationIcon}>
            <ChatBubble size={iconSize} color={styles.teamChatSearchConversationIconGlyph.color} />
          </View>
        )}
        <View style={styles.teamChatSearchResultCopy}>
          <Text style={styles.teamChatSearchResultTitle} numberOfLines={1}>
            {result.conversation.title}
          </Text>
          {detail ? (
            <View style={styles.teamChatSearchResultDetailRow}>
              {result.presenceStatus ? (
                <ZoomChatPresenceIcon status={result.presenceStatus} size={10} />
              ) : null}
              <Text style={styles.teamChatSearchResultDetail} numberOfLines={1}>
                {detail}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {canToggleFavorite && result.conversation.canFavorite !== false ? (
        <ZoomChatFavoriteButton
          favorite={favorite}
          disabled={isFavoriteUpdating}
          onPress={toggleFavorite}
          testID={`workspace-zoom-team-chat-search-favorite-${result.conversation.conversationId}`}
        />
      ) : null}
    </View>
  );
}

function ZoomChatSearchResults({
  people,
  conversations,
  isSearching,
  error,
  iconSize,
  onOpenConversation,
  canToggleFavorite,
  isFavoriteUpdating,
  onToggleFavorite,
}: {
  people: CommunicationSearchResult[];
  conversations: CommunicationSearchResult[];
  isSearching: boolean;
  error: string | null;
  iconSize: number;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  canToggleFavorite: boolean;
  isFavoriteUpdating: (conversationId: string) => boolean;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
}): ReactElement {
  const empty = !isSearching && !error && people.length === 0 && conversations.length === 0;
  return (
    <View style={styles.teamChatSearchResults}>
      {isSearching ? (
        <View style={styles.teamChatSearchLoading}>
          <ActivityIndicator size="small" />
          <Text style={styles.teamChatSearchStatus}>Searching...</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.teamChatSearchError}>{error}</Text> : null}
      {people.length > 0 ? (
        <View style={styles.teamChatSearchGroup}>
          <Text style={styles.teamChatSearchGroupLabel}>People</Text>
          {people.map((result) => (
            <ZoomChatSearchResultRow
              key={`${result.category}:${result.conversation.conversationId}`}
              result={result}
              iconSize={iconSize}
              onOpenConversation={onOpenConversation}
              canToggleFavorite={canToggleFavorite}
              isFavoriteUpdating={isFavoriteUpdating(result.conversation.conversationId)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </View>
      ) : null}
      {conversations.length > 0 ? (
        <View style={styles.teamChatSearchGroup}>
          <Text style={styles.teamChatSearchGroupLabel}>Chats & channels</Text>
          {conversations.map((result) => (
            <ZoomChatSearchResultRow
              key={`${result.category}:${result.conversation.conversationId}`}
              result={result}
              iconSize={iconSize}
              onOpenConversation={onOpenConversation}
              canToggleFavorite={canToggleFavorite}
              isFavoriteUpdating={isFavoriteUpdating(result.conversation.conversationId)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </View>
      ) : null}
      {empty ? (
        <View style={styles.teamChatEmpty}>
          <Text style={styles.teamChatEmptyText}>No people or chats found.</Text>
        </View>
      ) : null}
    </View>
  );
}

function ZoomChatPopupSearchContents({
  connected,
  enabled,
  query,
  onChangeQuery,
  isSearchActive,
  people,
  conversations,
  isSearching,
  error,
  iconSize,
  onOpenConversation,
  canToggleFavorite,
  isFavoriteUpdating,
  onToggleFavorite,
  homeSections,
}: {
  connected: boolean;
  enabled: boolean;
  query: string;
  onChangeQuery: (query: string) => void;
  isSearchActive: boolean;
  people: CommunicationSearchResult[];
  conversations: CommunicationSearchResult[];
  isSearching: boolean;
  error: string | null;
  iconSize: number;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  canToggleFavorite: boolean;
  isFavoriteUpdating: (conversationId: string) => boolean;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
  homeSections: CommunicationHomeSection[];
}): ReactElement {
  const showSearch = connected && enabled;
  const showEmptyHome = showSearch && !isSearchActive && homeSections.length === 0 && !query;
  const showNoMatches =
    showSearch && !isSearchActive && Boolean(query) && homeSections.length === 0;
  return (
    <>
      {showSearch ? (
        <TitlebarPopupSearchField
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search chats or people"
          accessibilityLabel="Search chats or people"
        />
      ) : null}
      {isSearchActive ? (
        <ZoomChatSearchResults
          people={people}
          conversations={conversations}
          isSearching={isSearching}
          error={error}
          iconSize={iconSize}
          onOpenConversation={onOpenConversation}
          canToggleFavorite={canToggleFavorite}
          isFavoriteUpdating={isFavoriteUpdating}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}
      {showEmptyHome ? (
        <View style={styles.teamChatEmpty}>
          <Text style={styles.teamChatEmptyText}>No conversations yet.</Text>
        </View>
      ) : null}
      {showNoMatches ? (
        <View style={styles.teamChatEmpty}>
          <Text style={styles.teamChatEmptyText}>No matching chats.</Text>
        </View>
      ) : null}
    </>
  );
}

function ZoomChatHomeConversationRow({
  conversation,
  iconSize,
  canToggleFavorite,
  isFavoriteUpdating,
  onOpenConversation,
  onToggleFavorite,
}: {
  conversation: CommunicationConversationSummary;
  iconSize: number;
  canToggleFavorite: boolean;
  isFavoriteUpdating: boolean;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
}): ReactElement {
  const favorite = conversation.favorite === true;
  const isDirect = conversation.kind === "direct";
  const detail = zoomChatHomeConversationDetail(conversation);
  const openConversation = useCallback(
    () => onOpenConversation(conversation),
    [conversation, onOpenConversation],
  );
  const toggleFavorite = useCallback(
    () => onToggleFavorite(conversation, !favorite),
    [conversation, favorite, onToggleFavorite],
  );
  return (
    <View style={styles.teamChatHomeConversation}>
      <Pressable
        testID={`workspace-zoom-team-chat-home-${conversation.conversationId}`}
        onPress={openConversation}
        accessibilityLabel={`Open ${conversation.title}`}
        style={styles.teamChatHomeConversationPrimary}
      >
        {isDirect ? (
          <View style={styles.teamChatSearchAvatar}>
            <Text style={styles.teamChatSearchAvatarText}>
              {zoomChatSearchInitials(conversation.title)}
            </Text>
          </View>
        ) : (
          <View style={styles.teamChatSearchConversationIcon}>
            <ChatBubble size={iconSize} color={styles.teamChatSearchConversationIconGlyph.color} />
          </View>
        )}
        <View style={styles.teamChatSearchResultCopy}>
          <Text style={styles.teamChatSearchResultTitle} numberOfLines={1}>
            {conversation.title}
          </Text>
          {detail ? (
            <Text style={styles.teamChatSearchResultDetail} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {canToggleFavorite && conversation.canFavorite !== false ? (
        <ZoomChatFavoriteButton
          favorite={favorite}
          disabled={isFavoriteUpdating}
          onPress={toggleFavorite}
          testID={`workspace-zoom-team-chat-home-favorite-${conversation.conversationId}`}
        />
      ) : null}
    </View>
  );
}

function zoomChatHomeConversationDetail(
  conversation: CommunicationConversationSummary,
): string | null {
  if (conversation.preview) return conversation.preview;
  if (conversation.kind === "direct") {
    const encodedTarget = conversation.conversationId.startsWith("contact:")
      ? conversation.conversationId.slice("contact:".length)
      : null;
    if (encodedTarget) {
      try {
        const contact = decodeURIComponent(encodedTarget);
        if (contact.includes("@")) return contact;
      } catch {
        // A malformed provider id cannot make a Home row fail to render.
      }
    }
    return "Direct message";
  }
  if (conversation.kind === "group") return "Group chat";
  if (conversation.kind === "channel") return "Channel";
  return null;
}

function zoomChatFavoriteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("Reconnect Zoom Chat in Settings")) {
    return "Reconnect Chat in Settings to allow favorites.";
  }
  return "Could not update Chat favorites. Try again.";
}

function canSearchZoomChatDestinations(
  supportsInboxSearch: boolean,
  connected: boolean,
  enabled: boolean,
): boolean {
  return supportsInboxSearch && connected && enabled;
}

function WorkspaceTeamChatButton({ serverId }: { serverId: string }) {
  const isDesktop = getIsElectron();
  const supportsCommunications = useHostFeature(serverId, "communications");
  const supportsChatHome = useHostFeature(serverId, "communicationsChatHome");
  const supportsInboxSearch = useHostFeature(serverId, "communicationsInboxSearch");
  const supportsChatFavorites = useHostFeature(serverId, "communicationsFavorites");
  const supportsPresence = useHostFeature(serverId, "communicationsPresence");
  const supportsChatAvailability = useHostFeature(serverId, "communicationsChatAvailability");
  const supportsPresenceChangeTiming = useHostFeature(
    serverId,
    "communicationsPresenceChangeTiming",
  );
  const supportsPresenceUpdates = useHostFeature(serverId, "communicationsPresenceUpdates");
  const supportsIntegrationAuthorization = useHostFeature(serverId, "integrationAuthorization");
  const client = useHostRuntimeClient(serverId);
  const isHostConnected = useHostRuntimeIsConnected(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const iconSize = useIconSize(1.5);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatConnectionLabel, setChatConnectionLabel] = useState("Not connected");
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [isChatConnected, setIsChatConnected] = useState(false);
  const [isChatEnabled, setIsChatEnabled] = useState(false);
  const [conversations, setConversations] = useState<CommunicationConversationSummary[]>([]);
  const [chatHomeSections, setChatHomeSections] = useState<CommunicationHomeSection[]>([]);
  const [favoriteUpdatingIds, setFavoriteUpdatingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [presenceStatus, setPresenceStatus] = useState<CommunicationPresenceStatus>("unknown");
  const [observedPresenceLabel, setObservedPresenceLabel] = useState<string | null>(null);
  const [pendingPresenceStatus, setPendingPresenceStatus] =
    useState<CommunicationPresenceStatus | null>(null);
  const [statusChangeAvailableAt, setStatusChangeAvailableAt] = useState<string | null>(null);
  const [statusChangeAvailableInMs, setStatusChangeAvailableInMs] = useState<number | null>(null);
  const [presencePickerOpen, setPresencePickerOpen] = useState(false);
  const [isUpdatingPresence, setIsUpdatingPresence] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const {
    query: chatSearch,
    setQuery: setChatSearch,
    reset: resetChatSearch,
    refresh: refreshChatSearch,
    isSearchActive: isChatDestinationSearch,
    people: chatSearchPeople,
    conversations: chatSearchConversations,
    isSearching: isSearchingChat,
    error: chatSearchError,
  } = useZoomChatDestinationSearch({
    client,
    enabled: canSearchZoomChatDestinations(supportsInboxSearch, isChatConnected, isChatEnabled),
  });
  const [selectedConversation, setSelectedConversation] =
    useState<CommunicationConversationSummary | null>(null);
  const applyZoomChatPresence = useCallback((presence: CommunicationPresence) => {
    // `unknown` is transport state, not a user-facing presence. Preserve a
    // confirmed value through a transient provider read failure.
    if (presence.status !== "unknown") setPresenceStatus(presence.status);
    if (presence.observedStatusLabel) setObservedPresenceLabel(presence.observedStatusLabel);
    setStatusChangeAvailableAt(presence.statusChangeAvailableAt ?? null);
    setStatusChangeAvailableInMs(presence.statusChangeAvailableInMs ?? null);
    setPendingPresenceStatus(presence.pendingStatus ?? null);
    setPresenceError(presence.statusChangeError ?? null);
    setIsChatEnabled((enabled) => presence.enabled ?? enabled);
  }, []);
  const refreshPendingZoomChatPresence = useCallback(() => {
    void client
      ?.communicationsInboxGetPresence("zoom-team-chat")
      .then(applyZoomChatPresence)
      .catch(() => undefined);
  }, [applyZoomChatPresence, client]);
  const refreshCommunicationsState = useCallback(() => {
    if (!isDesktop || !supportsCommunications || !client || !isHostConnected) {
      setUnreadCount(0);
      setChatConnectionLabel(
        supportsCommunications ? "Not connected" : "Update this host to use Chat",
      );
      setIsChatConnected(false);
      setIsChatEnabled(false);
      return;
    }

    void (async () => {
      try {
        const overview = await client.communicationsGetOverview();
        setUnreadCount(overview.unreadCount);
        setConversations(
          overview.conversations.filter(
            (conversation) => conversation.providerId === "zoom-team-chat",
          ),
        );
        const zoom = overview.providers.find(
          (provider) => provider.providerId === "zoom-team-chat",
        );
        const chatConnectionState = resolveZoomTeamChatConnectionState(zoom?.connectionState);
        const chatEnabled = chatConnectionState.isConnected && zoom?.enabled !== false;
        setChatConnectionLabel(chatEnabled ? chatConnectionState.label : "Disabled");
        setIsChatConnected(chatConnectionState.isConnected);
        setIsChatEnabled(chatEnabled);
        if (supportsChatHome && chatConnectionState.isConnected) {
          try {
            const home = await client.communicationsInboxGetHome("zoom-team-chat");
            setChatHomeSections(home.sections);
          } catch {
            // Home access can be newly granted after the original token was
            // issued. Keep the established connection state honest and let the
            // settings reconnect flow obtain the expanded token.
            setChatHomeSections([]);
          }
        } else {
          setChatHomeSections([]);
        }
        if (supportsPresence && chatConnectionState.isConnected) {
          try {
            const presence = await client.communicationsInboxGetPresence("zoom-team-chat");
            applyZoomChatPresence(presence);
            setIsChatEnabled(presence.enabled ?? chatEnabled);
          } catch {
            setPresenceStatus("unknown");
          }
        } else {
          setPresenceStatus("unknown");
        }
      } catch {
        setUnreadCount(0);
        setConversations([]);
        setChatHomeSections([]);
        setPresenceStatus("unknown");
        setChatConnectionLabel("Unavailable");
        setIsChatConnected(false);
        setIsChatEnabled(false);
      }
    })();
  }, [
    client,
    applyZoomChatPresence,
    isDesktop,
    isHostConnected,
    supportsChatHome,
    supportsCommunications,
    supportsPresence,
  ]);
  useEffect(() => {
    refreshCommunicationsState();
  }, [refreshCommunicationsState]);
  useEffect(() => {
    if (!client || !supportsPresenceUpdates) return;
    return client.on("communications.inbox.presence.changed.notification", (message) => {
      if (message.payload.presence.providerId === "zoom-team-chat") {
        applyZoomChatPresence(message.payload.presence);
      }
    });
  }, [applyZoomChatPresence, client, supportsPresenceUpdates]);
  const { statusChangeCooldownMs, statusChangeLocked } = useZoomChatStatusChangeCooldown(
    statusChangeAvailableAt,
    statusChangeAvailableInMs,
    supportsPresenceChangeTiming,
  );
  useZoomChatPendingPresenceRefresh({
    // The daemon event is the normal path. Keep one pending-only watchdog so a
    // reconnect or mixed-version host cannot strand a visible Pending state if
    // that event is missed. A successful event clears Pending and cancels this
    // timeout before it performs a read.
    enabled: true,
    pendingStatus: pendingPresenceStatus,
    statusChangeAvailableAt,
    statusChangeAvailableInMs,
    refresh: refreshPendingZoomChatPresence,
  });
  const handleMenuOpenChange = useCallback(
    (nextOpen: boolean) => {
      setMenuOpen(nextOpen);
      // The status chooser belongs to this popup session only. Closing the
      // Chat popup never changes provider presence, but it must collapse the
      // chooser so the next open begins with the compact Chat Home.
      setPresencePickerOpen(false);
      if (!nextOpen) {
        resetChatSearch();
      }
      refreshWhenZoomChatMenuOpens(nextOpen, refreshCommunicationsState);
    },
    [refreshCommunicationsState, resetChatSearch],
  );
  const canStartSignIn = canStartZoomTeamChatSignIn({
    supportsCommunications,
    supportsIntegrationAuthorization,
    isHostConnected,
    isLocalDaemon,
    isStartingSignIn,
  });
  const handleStartSignIn = useCallback(() => {
    if (!client || !canStartSignIn) {
      return;
    }
    const start = async (): Promise<void> => {
      setIsStartingSignIn(true);
      try {
        const result = await client.integrationsZoomStartAuthorization();
        if (!result.authorizationUrl) {
          throw new Error(result.error ?? "Could not start Chat sign-in.");
        }
        setChatConnectionLabel("Finish sign-in in your browser");
        await openExternalUrl(result.authorizationUrl);
      } catch {
        setChatConnectionLabel("Could not start Chat sign-in");
      } finally {
        setIsStartingSignIn(false);
      }
    };
    void start();
  }, [client, canStartSignIn]);
  const togglePresencePicker = useCallback(() => {
    setPresencePickerOpen((open) => !open);
  }, []);
  const handlePresenceSelect = useCallback(
    (status: string) => {
      if (!client || isUpdatingPresence || pendingPresenceStatus) return;
      const nextStatus = status as ZoomChatPresenceOption["id"];
      const updatePresence = async (): Promise<void> => {
        setIsUpdatingPresence(true);
        try {
          let presence: CommunicationPresence;
          if (nextStatus === "offline") {
            presence = await client.communicationsInboxSetEnabled({
              providerId: "zoom-team-chat",
              enabled: false,
            });
          } else {
            if (!isChatEnabled) {
              await client.communicationsInboxSetEnabled({
                providerId: "zoom-team-chat",
                enabled: true,
              });
            }
            presence = await client.communicationsInboxSetPresence({
              providerId: "zoom-team-chat",
              status: nextStatus,
            });
          }
          let resolvedStatus = presence.pendingStatus ? presenceStatus : presence.status;
          if (nextStatus !== "offline" && !presence.pendingStatus) {
            resolvedStatus = isChatEnabled
              ? resolveZoomChatPresenceAfterUpdate(presenceStatus, nextStatus, presence.status)
              : nextStatus;
          }
          setPresenceStatus(resolvedStatus);
          setStatusChangeAvailableAt(presence.statusChangeAvailableAt ?? null);
          setStatusChangeAvailableInMs(presence.statusChangeAvailableInMs ?? null);
          setPendingPresenceStatus(presence.pendingStatus ?? null);
          setIsChatEnabled(presence.enabled ?? nextStatus !== "offline");
          setChatConnectionLabel(
            (presence.enabled ?? nextStatus !== "offline") ? "Connected" : "Disabled",
          );
          setPresenceError(
            presence.pendingStatus ||
              nextStatus === "offline" ||
              !isChatEnabled ||
              resolvedStatus === nextStatus
              ? null
              : "The service did not apply that status update. Your current status is unchanged.",
          );
          setPresencePickerOpen(false);
        } catch (error) {
          const availableAt = statusChangeAvailableAtFromError(error);
          if (availableAt) {
            setStatusChangeAvailableAt(availableAt);
          }
          setPresenceError(zoomStatusUpdateErrorMessage(error));
          setPresencePickerOpen(false);
        } finally {
          setIsUpdatingPresence(false);
        }
      };
      void updatePresence();
    },
    [client, isChatEnabled, isUpdatingPresence, pendingPresenceStatus, presenceStatus],
  );
  const presenceSelectHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const option of ZOOM_CHAT_PRESENCE_OPTIONS) {
      handlers.set(option.id, () => handlePresenceSelect(option.id));
    }
    return handlers;
  }, [handlePresenceSelect]);
  const chatTitlebarTriggerStyle = useCallback(
    (state: { hovered?: boolean; pressed?: boolean; open?: boolean; focused?: boolean }) =>
      meetingNotesTriggerStyle(state, isChatConnected && isChatEnabled),
    [isChatConnected, isChatEnabled],
  );
  const visibleChatHomeSections = useMemo(() => {
    const query = isChatDestinationSearch ? "" : chatSearch.trim().toLocaleLowerCase();
    const source = supportsChatHome ? chatHomeSections : toLegacyChatHomeSections(conversations);
    if (!query) return source;
    const sections: CommunicationHomeSection[] = [];
    for (const section of source) {
      const matchingConversations = section.conversations.filter((conversation) =>
        conversation.title.toLocaleLowerCase().includes(query),
      );
      const matchingCollections = section.collections.filter((collection) =>
        `${collection.title}\n${collection.description ?? ""}`.toLocaleLowerCase().includes(query),
      );
      if (matchingConversations.length > 0 || matchingCollections.length > 0) {
        sections.push({
          id: section.id,
          label: section.label,
          conversations: matchingConversations,
          collections: matchingCollections,
        });
      }
    }
    return sections;
  }, [chatHomeSections, chatSearch, conversations, isChatDestinationSearch, supportsChatHome]);
  const displayedChatHomeSections = isChatDestinationSearch ? [] : visibleChatHomeSections;
  const openConversation = useCallback((conversation: CommunicationConversationSummary) => {
    setMenuOpen(false);
    setSelectedConversation(conversation);
  }, []);
  const closeConversation = useCallback(() => setSelectedConversation(null), []);
  const isFavoriteUpdating = useCallback(
    (conversationId: string) => favoriteUpdatingIds.has(conversationId),
    [favoriteUpdatingIds],
  );
  const handleToggleFavorite = useCallback(
    (conversation: CommunicationConversationSummary, favorite: boolean) => {
      if (
        !client ||
        !supportsChatFavorites ||
        favoriteUpdatingIds.has(conversation.conversationId)
      ) {
        return;
      }
      setFavoriteError(null);
      setFavoriteUpdatingIds((ids) => new Set(ids).add(conversation.conversationId));
      void client
        .communicationsInboxSetFavorite({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
          favorite,
        })
        .then((home) => {
          setChatHomeSections(home.sections);
          refreshChatSearch();
          return undefined;
        })
        .catch((error: unknown) => setFavoriteError(zoomChatFavoriteErrorMessage(error)))
        .finally(() => {
          setFavoriteUpdatingIds((ids) => {
            const next = new Set(ids);
            next.delete(conversation.conversationId);
            return next;
          });
        });
    },
    [client, favoriteUpdatingIds, refreshChatSearch, supportsChatFavorites],
  );
  // Chat's availability switch is a product-level setting. Unlike Zoom
  // presence, turning it off removes the title-bar surface entirely; Settings
  // remains the single place to turn the integration back on.
  if (!isDesktop || !isChatEnabled) {
    return null;
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <DropdownMenuTrigger
              testID="workspace-zoom-team-chat-trigger"
              suppressFocusOutline
              accessibilityRole="button"
              accessibilityLabel={zoomTeamChatAccessibilityLabel(unreadCount, isChatEnabled)}
              style={chatTitlebarTriggerStyle}
            >
              {() => (
                <ZoomTeamChatTitleIcon
                  unreadCount={unreadCount}
                  connected={isChatConnected}
                  enabled={isChatEnabled}
                  presenceStatus={presenceStatus}
                  iconSize={iconSize.md}
                />
              )}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.headerMenuTooltipText}>
              {zoomTeamChatTooltip(
                unreadCount,
                chatConnectionLabel,
                presenceStatus,
                observedPresenceLabel,
                isChatEnabled,
              )}
            </Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          width={320}
          maxHeight={420}
          scrollable
          testID="workspace-zoom-team-chat-menu"
        >
          <View style={styles.teamChatPopup}>
            <View style={styles.teamChatPopupHeader}>
              <View style={styles.teamChatPopupHeaderCopy}>
                <Text style={styles.teamChatPopupTitle}>{chatConnectionLabel}</Text>
              </View>
              {isChatConnected ? (
                <Pressable
                  testID="workspace-zoom-team-chat-presence"
                  onPress={togglePresencePicker}
                  disabled={!supportsPresence || isUpdatingPresence}
                  accessibilityLabel="Change Zoom Chat status"
                  style={styles.teamChatPresenceTrigger}
                >
                  <ZoomChatPresenceIcon
                    status={getZoomChatDisplayedPresenceStatus({
                      enabled: isChatEnabled,
                      pendingStatus: pendingPresenceStatus,
                      status: presenceStatus,
                    })}
                    size={iconSize.sm}
                  />
                  {zoomChatPresenceDisplayText(
                    presenceStatus,
                    isChatEnabled,
                    isUpdatingPresence,
                    pendingPresenceStatus,
                    observedPresenceLabel,
                  ) ? (
                    <Text style={styles.teamChatPresenceText} numberOfLines={1}>
                      {zoomChatPresenceDisplayText(
                        presenceStatus,
                        isChatEnabled,
                        isUpdatingPresence,
                        pendingPresenceStatus,
                        observedPresenceLabel,
                      )}
                    </Text>
                  ) : null}
                </Pressable>
              ) : (
                <Button
                  testID="workspace-zoom-team-chat-open"
                  variant="secondary"
                  size="xs"
                  onPress={handleStartSignIn}
                  disabled={!canStartSignIn}
                >
                  Sign in
                </Button>
              )}
            </View>
            {presenceError ? (
              <View style={styles.teamChatPresenceErrorCallout}>
                <Text style={styles.teamChatPresenceError}>{presenceError}</Text>
              </View>
            ) : null}
            {favoriteError ? (
              <View style={styles.teamChatFavoriteErrorCallout}>
                <Text style={styles.teamChatSearchError}>{favoriteError}</Text>
              </View>
            ) : null}
            {isChatConnected && presencePickerOpen ? (
              <View style={styles.teamChatPresenceOptions}>
                {ZOOM_CHAT_PRESENCE_OPTIONS.filter(
                  (option) => option.id !== "offline" || supportsChatAvailability,
                ).map((option) => {
                  const canSelect = canSelectZoomChatPresenceOption({
                    option,
                    enabled: isChatEnabled,
                    supportsPresence,
                    currentPresence: presenceStatus,
                    statusChangeLocked,
                    pendingStatus: pendingPresenceStatus,
                  });
                  const disabled = !canSelect || isUpdatingPresence;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={disabled ? undefined : presenceSelectHandlers.get(option.id)}
                      disabled={disabled}
                      accessibilityLabel={zoomChatPresenceOptionAccessibilityLabel({
                        option,
                        disabled,
                        statusChangeLocked,
                        statusChangeCooldownMs,
                      })}
                      style={[
                        styles.teamChatPresenceOption,
                        disabled && styles.teamChatPresenceOptionDisabled,
                      ]}
                    >
                      <ZoomChatPresenceIcon status={option.id} size={iconSize.sm} />
                      <Text
                        style={[
                          styles.teamChatPresenceOptionText,
                          disabled && styles.teamChatPresenceOptionTextDisabled,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
                {statusChangeLocked ? (
                  <Text style={styles.teamChatPresenceCooldown}>
                    Status changes available in {formatStatusChangeCooldown(statusChangeCooldownMs)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <ZoomChatPopupSearchContents
              connected={isChatConnected}
              enabled={isChatEnabled}
              query={chatSearch}
              onChangeQuery={setChatSearch}
              isSearchActive={isChatDestinationSearch}
              people={chatSearchPeople}
              conversations={chatSearchConversations}
              isSearching={isSearchingChat}
              error={chatSearchError}
              iconSize={iconSize.sm}
              onOpenConversation={openConversation}
              canToggleFavorite={supportsChatFavorites && isChatConnected && isChatEnabled}
              isFavoriteUpdating={isFavoriteUpdating}
              onToggleFavorite={handleToggleFavorite}
              homeSections={displayedChatHomeSections}
            />
          </View>
          {displayedChatHomeSections.map((section) => (
            <View key={section.id}>
              <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
              {section.conversations.map((conversation) => (
                <ZoomChatHomeConversationRow
                  key={conversation.conversationId}
                  conversation={conversation}
                  iconSize={iconSize.sm}
                  canToggleFavorite={supportsChatFavorites && isChatConnected && isChatEnabled}
                  isFavoriteUpdating={isFavoriteUpdating(conversation.conversationId)}
                  onOpenConversation={openConversation}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
              {section.collections.map((collection) => (
                <DropdownMenuItem
                  key={collection.collectionId}
                  description={collection.description ?? "Coming soon"}
                  disabled
                >
                  {collection.title}
                </DropdownMenuItem>
              ))}
            </View>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ZoomTeamChatConversationSheet
        client={client}
        conversation={selectedConversation}
        onClose={closeConversation}
      />
    </>
  );
}

function WorkspaceMeetingNotesButton({
  serverId,
  workspaceId,
  activeChatAttachmentScopeKey,
}: {
  serverId: string;
  workspaceId: string;
  activeChatAttachmentScopeKey: string | null;
}) {
  const isDesktop = getIsElectron();
  const zoomRecorderEnabled = useAppSettingValue(selectZoomRecorderEnabled);
  const zoomRecorderPaused = useAppSettingValue(selectZoomRecorderPaused);
  const { status } = useZoomRecorderStatus();
  const iconSize = useIconSize(1.5);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const attachmentScopeKey = useMemo(
    () =>
      activeChatAttachmentScopeKey
        ? activeChatAttachmentScopeKey
        : buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd: "/" }),
    [activeChatAttachmentScopeKey, serverId, workspaceId],
  );
  const recorderActive = !zoomRecorderPaused;
  const triggerStyle = useCallback(
    (triggerState: { hovered?: boolean; pressed?: boolean; open?: boolean; focused?: boolean }) =>
      meetingNotesTriggerStyle(triggerState, recorderActive),
    [recorderActive],
  );
  const supported = isDesktop && zoomRecorderEnabled && supportsZoomRecorder(getDesktopHost());

  if (!supported) {
    return null;
  }

  const stateLabel = recorderActive
    ? getZoomMeetingTitlebarState(status.state, status.modelReady).label
    : "Disabled";
  return (
    <DropdownMenu open={libraryOpen} onOpenChange={setLibraryOpen}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="triggerRef">
          <DropdownMenuTrigger
            testID="workspace-zoom-meetings-trigger"
            suppressFocusOutline
            style={triggerStyle}
            accessibilityRole="button"
            accessibilityLabel={`Open Meeting notes. ${stateLabel}.`}
          >
            {recorderActive ? (
              <ThemedHeadsetMic
                size={iconSize.md}
                uniProps={zoomRecorderColorMapping(status.state, status.modelReady, recorderActive)}
              />
            ) : (
              <ThemedHeadsetOff size={iconSize.md} uniProps={mutedColorMapping} />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={styles.headerMenuTooltipText}>Meeting: {stateLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <MeetingTranscriptLibrary
        open={libraryOpen}
        onClose={closeLibrary}
        serverId={serverId}
        attachmentScopeKey={attachmentScopeKey}
      />
    </DropdownMenu>
  );
}

function WorkspaceHeaderTitleBar({
  isLoading,
  title,
  subtitle,
  showSubtitle,
  currentBranchName,
  normalizedServerId,
  normalizedWorkspaceId,
  activeChatAttachmentScopeKey,
  workspaceScripts,
  liveTerminalIds,
  showWorkspaceSetup,
  showCreateBrowserTab,
  isMobile,
  showVisualizerAction,
  showVoiceCuesAction,
  showPlayAction,
  microphoneAvailable,
  showBrainAction,
  showVisualizerMenuItem,
  showVoiceCuesMenuItem,
  showExplorerMenuItem,
  showScriptsMenuItem,
  onToggleExplorer,
  createTerminalDisabled,
  importAgentDisabled,
  copyPathDisabled,
  menuNewAgentIcon,
  menuNewTerminalIcon,
  menuNewBrowserIcon,
  menuImportIcon,
  menuCopyIcon,
  menuSettingsIcon,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateTerminalWithProfile,
  onCreateBrowser,
  onOpenImportSheet,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
  onOpenContextManagement,
  onOpenProjectKnowledge,
  onScriptTerminalStarted,
  onViewScriptTerminal,
  onOpenUrlInBrowserTab,
}: WorkspaceHeaderTitleBarProps) {
  const containerStyle = useMemo(() => [styles.headerTitleContainer, HEADER_LABEL_DRAG_STYLE], []);
  // Match the Explorer toggle's icon sizing so the mobile Play button beside the
  // "..." menu shares the same chrome and glyph size.
  const headerActionIconSize = useIconSize(1.5);
  return (
    <View style={containerStyle} dataSet={HEADER_LABEL_DRAG_DATASET}>
      {isLoading ? (
        <View style={styles.headerTitleTextGroup}>
          <View style={styles.headerTitleSkeleton} />
        </View>
      ) : (
        <View style={styles.headerTitleTextGroup}>
          <ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>
          {showSubtitle ? (
            <Text
              testID="workspace-header-subtitle"
              style={styles.headerProjectTitle}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      )}
      <View style={styles.compactHeaderMenuCluster}>
        <WorkspaceHeaderMenu
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          currentBranchName={currentBranchName}
          showWorkspaceSetup={showWorkspaceSetup}
          showCreateBrowserTab={showCreateBrowserTab}
          isMobile={isMobile}
          showVisualizerMenuItem={showVisualizerMenuItem}
          showVoiceCuesMenuItem={showVoiceCuesMenuItem}
          showExplorerMenuItem={showExplorerMenuItem}
          showScriptsMenuItem={showScriptsMenuItem}
          workspaceScripts={workspaceScripts}
          liveTerminalIds={liveTerminalIds}
          onToggleExplorer={onToggleExplorer}
          onScriptTerminalStarted={onScriptTerminalStarted}
          onViewScriptTerminal={onViewScriptTerminal}
          onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
          createTerminalDisabled={createTerminalDisabled}
          importAgentDisabled={importAgentDisabled}
          copyPathDisabled={copyPathDisabled}
          menuNewAgentIcon={menuNewAgentIcon}
          menuNewTerminalIcon={menuNewTerminalIcon}
          menuNewBrowserIcon={menuNewBrowserIcon}
          menuImportIcon={menuImportIcon}
          menuCopyIcon={menuCopyIcon}
          menuSettingsIcon={menuSettingsIcon}
          onCreateDraftTab={onCreateDraftTab}
          onCreateTerminal={onCreateTerminal}
          onCreateTerminalWithProfile={onCreateTerminalWithProfile}
          onCreateBrowser={onCreateBrowser}
          onOpenImportSheet={onOpenImportSheet}
          onCopyWorkspacePath={onCopyWorkspacePath}
          onCopyBranchName={onCopyBranchName}
          onOpenSetupTab={onOpenSetupTab}
          onOpenContextManagement={onOpenContextManagement}
          onOpenProjectKnowledge={onOpenProjectKnowledge}
        />
        <WorkspaceTeamChatButton serverId={normalizedServerId} />
        <WorkspaceMeetingNotesButton
          serverId={normalizedServerId}
          workspaceId={normalizedWorkspaceId}
          activeChatAttachmentScopeKey={activeChatAttachmentScopeKey}
        />
        {microphoneAvailable ? <WorkspaceWakeWordButton /> : null}
        {showVoiceCuesAction ? <WorkspaceVoiceCuesButton /> : null}
        {showVisualizerAction ? (
          <WorkspaceVisualizerButton
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
          />
        ) : null}
        {/* There is no second header button for the PIP any more. The Visualizer
            button above is the single entry point - it opens the surface you
            last used - and switching surfaces lives inside the Visualizer
            itself (the tab toolbar's PIP control, the PIP's expand control).
            See use-visualizer-surface.ts. */}
        {isMobile && showPlayAction ? (
          <WorkspaceScriptsButton
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            scripts={workspaceScripts}
            liveTerminalIds={liveTerminalIds}
            onScriptTerminalStarted={onScriptTerminalStarted}
            onViewTerminal={onViewScriptTerminal}
            onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
            hideLabels
            presentation="ghost"
            ghostIconSize={headerActionIconSize.lg}
          />
        ) : null}
        {/* The Brain status light, standing in for the sidebar's own whenever
            the sidebar is collapsed or overlaid. It is immediately before
            Explorer and never fitted away - see workspace-brain-button.tsx. */}
        {showBrainAction ? <WorkspaceBrainButton /> : null}
      </View>
    </View>
  );
}

type PaneDirection = "left" | "right" | "up" | "down";

function parsePaneDirection(actionId: string): PaneDirection | null {
  const direction = actionId.split(".").pop();
  if (direction === "left" || direction === "right" || direction === "up" || direction === "down") {
    return direction;
  }
  return null;
}

interface WakeWordEmptyStateListenerProps {
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  isRouteFocused: boolean;
  hasActiveTab: boolean;
  hasHydratedAgents: boolean;
  wakeWordEnabled: boolean;
  wakeWordListeningPaused: boolean;
  wakeWordPhrase: string;
  wakeWordSensitivity: number;
  wakeWordSilenceTimeoutMs: number;
  wakeWordAutoSend: boolean;
  openWorkspaceDraftTab: (input?: { draftId?: string; focus?: boolean }) => void;
  onError: (error: Error) => void;
}

/** Catches "Hey Otto" when a workspace is focused but no chat tab is open -
 * MessageInput (and its own wake-word listener) doesn't mount in that state,
 * so nothing would otherwise be listening. On trigger, opens a fresh draft
 * chat tab and queues an auto-start-dictation request for it (consumed once
 * that tab's composer mounts and is ready, see workspace-tab.tsx). */
function WakeWordEmptyStateListener(props: WakeWordEmptyStateListenerProps): null {
  const {
    normalizedServerId,
    normalizedWorkspaceId,
    isRouteFocused,
    hasActiveTab,
    hasHydratedAgents,
    wakeWordEnabled,
    wakeWordListeningPaused,
    wakeWordPhrase,
    wakeWordSensitivity,
    wakeWordSilenceTimeoutMs,
    wakeWordAutoSend,
    openWorkspaceDraftTab,
    onError,
  } = props;

  const startDictation = useCallback(
    (autoSend?: boolean, preRollPcm?: string, speechAlreadyDetected?: boolean) => {
      const draftId = generateDraftId();
      openWorkspaceDraftTab({ draftId });
      useWakeWordAutoStartStore.getState().setPending({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
        draftId,
        autoSend: autoSend ?? wakeWordAutoSend,
        preRollPcm,
        speechAlreadyDetected,
      });
    },
    [normalizedServerId, normalizedWorkspaceId, openWorkspaceDraftTab, wakeWordAutoSend],
  );

  useWakeWordListening({
    settings: {
      enabled: shouldStartWakeWordListening({
        featureEnabled: wakeWordEnabled,
        listeningPaused: wakeWordListeningPaused,
        isPaneFocused: isRouteFocused && !hasActiveTab && hasHydratedAgents,
      }),
      phrase: wakeWordPhrase,
      sensitivity: wakeWordSensitivity,
      silenceTimeoutMs: wakeWordSilenceTimeoutMs,
      autoSend: wakeWordAutoSend,
    },
    startDictation,
    onError,
  });

  return null;
}

interface RenderWorkspaceContentInput {
  isMissingWorkspaceDirectory: boolean;
  activeTabDescriptor: WorkspaceTabDescriptor | null;
  hasHydratedAgents: boolean;
  mountedFocusedPaneTabIds: string[];
  focusedPaneTabDescriptorMap: Map<string, WorkspaceTabDescriptor>;
  isRouteFocused: boolean;
  focusedPaneId: string | null;
  buildMobilePaneContentModel: (input: {
    paneId: string | null;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
}

function renderWorkspaceContent(input: RenderWorkspaceContentInput): React.ReactNode {
  const {
    isMissingWorkspaceDirectory,
    activeTabDescriptor,
    hasHydratedAgents,
    mountedFocusedPaneTabIds,
    focusedPaneTabDescriptorMap,
    isRouteFocused,
    focusedPaneId,
    buildMobilePaneContentModel,
  } = input;

  if (isMissingWorkspaceDirectory) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>
          Workspace directory is missing. Reload workspace data before opening tabs.
        </Text>
      </View>
    );
  }
  if (!activeTabDescriptor && !hasHydratedAgents) {
    return (
      <View style={styles.emptyState}>
        <ThemedActivityIndicator uniProps={mutedColorMapping} />
      </View>
    );
  }
  if (!activeTabDescriptor) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>
          No tabs are available yet. Use New tab to create an agent or terminal.
        </Text>
      </View>
    );
  }
  return mountedFocusedPaneTabIds.map((tabId) => {
    const tabDescriptor = focusedPaneTabDescriptorMap.get(tabId);
    if (!tabDescriptor) {
      return null;
    }
    return (
      <MobileMountedTabSlot
        key={tabId}
        tabDescriptor={tabDescriptor}
        isVisible={isRouteFocused && tabId === activeTabDescriptor.tabId}
        isWorkspaceFocused={isRouteFocused}
        isPaneFocused={tabId === activeTabDescriptor.tabId}
        paneId={focusedPaneId}
        buildPaneContentModel={buildMobilePaneContentModel}
      />
    );
  });
}

interface WorkspaceHeaderFields {
  isWorkspaceHeaderLoading: boolean;
  workspaceHeaderTitle: string;
  workspaceHeaderSubtitle: string;
  shouldShowWorkspaceHeaderSubtitle: boolean;
  isGitCheckout: boolean;
  currentBranchName: string | null;
}

function buildWorkspaceHeaderCheckoutState(input: {
  isCheckoutStatusLoading: boolean;
  isError: boolean;
  data: CheckoutStatusPayload | undefined;
}): WorkspaceHeaderCheckoutState {
  if (input.isCheckoutStatusLoading) {
    return { kind: "pending" };
  }
  if (input.isError || !input.data) {
    return { kind: "error" };
  }
  return {
    kind: "ready",
    checkout: {
      isGit: input.data.isGit,
      currentBranch: input.data.currentBranch,
    },
  };
}

function deriveWorkspaceHeaderFields(input: {
  workspace: WorkspaceDescriptor | null;
  checkoutState: WorkspaceHeaderCheckoutState;
}): WorkspaceHeaderFields {
  const renderState = resolveWorkspaceHeaderRenderState(input);
  if (renderState.kind !== "ready") {
    return {
      isWorkspaceHeaderLoading: true,
      workspaceHeaderTitle: "",
      workspaceHeaderSubtitle: "",
      shouldShowWorkspaceHeaderSubtitle: false,
      isGitCheckout: false,
      currentBranchName: null,
    };
  }
  return {
    isWorkspaceHeaderLoading: false,
    workspaceHeaderTitle: renderState.title,
    workspaceHeaderSubtitle: renderState.subtitle,
    shouldShowWorkspaceHeaderSubtitle: renderState.shouldShowSubtitle,
    isGitCheckout: renderState.isGitCheckout,
    currentBranchName: renderState.currentBranchName,
  };
}

function getHostDisplayName(host: { label?: string | null } | null, fallback: string): string {
  const trimmed = host?.label?.trim();
  return trimmed ? trimmed : fallback;
}

function useWorkspaceRouteActions(normalizedServerId: string): {
  handleRetryHost: () => void;
  handleManageHost: () => void;
  handleDismissMissingWorkspace: () => void;
} {
  const router = useRouter();
  const handleRetryHost = useCallback(() => {
    if (!normalizedServerId) {
      return;
    }
    void getHostRuntimeStore().runProbeCycleNow(normalizedServerId);
  }, [normalizedServerId]);
  const handleManageHost = useCallback(() => {
    if (!normalizedServerId) {
      return;
    }
    router.push(buildSettingsHostRoute(normalizedServerId) as Href);
  }, [normalizedServerId, router]);
  const handleDismissMissingWorkspace = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (normalizedServerId) {
      router.replace(buildHostRootRoute(normalizedServerId) as Href);
      return;
    }
    router.replace("/" as Href);
  }, [normalizedServerId, router]);

  return {
    handleRetryHost,
    handleManageHost,
    handleDismissMissingWorkspace,
  };
}

function useResolvedWorkspaceRouteState(input: {
  serverId: string;
  workspaceId: string;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
}): { state: WorkspaceRouteState; recovery: WorkspaceRecoveryController } {
  const hosts = useHosts();
  const host = useMemo(
    () => hosts.find((entry) => entry.serverId === input.serverId) ?? null,
    [hosts, input.serverId],
  );
  const hostSnapshot = useHostRuntimeSnapshot(input.serverId);
  const hostName = useMemo(() => getHostDisplayName(host, input.serverId), [host, input.serverId]);
  const recoveryController = useWorkspaceRecovery({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    enabled: true,
  });

  const state = useMemo(
    () =>
      resolveWorkspaceRouteState({
        hostName,
        connectionStatus: hostSnapshot?.connectionStatus ?? "connecting",
        lastError: hostSnapshot?.lastError ?? null,
        workspace: input.workspace,
        hasHydratedWorkspaces: input.hasHydratedWorkspaces,
        recovery: recoveryController.state,
      }),
    [
      hostName,
      hostSnapshot?.connectionStatus,
      hostSnapshot?.lastError,
      input.workspace,
      input.hasHydratedWorkspaces,
      recoveryController.state,
    ],
  );

  return { state, recovery: recoveryController };
}

function WorkspaceScreenGateFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <ScreenHeader left={GATED_WORKSPACE_HEADER_LEFT} />
      <View style={styles.centerContent}>{children}</View>
    </>
  );
}

function renderWorkspaceScreenGateShell(input: {
  gate: ReactNode;
  workspaceKey: string | null;
}): ReactElement | null {
  if (!input.gate) {
    return null;
  }

  return (
    <WorkspaceFocusProvider workspaceKey={input.workspaceKey}>
      <View style={styles.container}>
        <View style={styles.threePaneRow}>
          <View style={styles.centerColumn}>
            <WorkspaceScreenGateFrame>{input.gate}</WorkspaceScreenGateFrame>
          </View>
        </View>
      </View>
    </WorkspaceFocusProvider>
  );
}

function WorkspaceDocumentTitleEffectSlot({
  tab,
  serverId,
  workspaceId,
  isRouteFocused,
}: {
  tab: WorkspaceTabDescriptor | null;
  serverId: string;
  workspaceId: string;
  isRouteFocused: boolean;
}) {
  if (!isRouteFocused || !isWeb || !tab) {
    return null;
  }

  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <WorkspaceDocumentTitleEffect
          label={presentation.label}
          titleState={presentation.titleState}
        />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function shouldShowWorkspaceScreenHeader(input: {
  isFocusModeEnabled: boolean;
  isMobile: boolean;
}): boolean {
  return !input.isFocusModeEnabled || input.isMobile;
}

function shouldShowWorkspaceExplorerSidebar(input: {
  isRouteFocused: boolean;
  isFocusModeEnabled: boolean;
  isMobile: boolean;
}): boolean {
  // Shown in both interface modes. User mode gets a Files-only explorer (the
  // sidebar itself filters Changes / Search / PR); see interface-modes.md.
  return !input.isMobile && input.isRouteFocused && shouldShowWorkspaceScreenHeader(input);
}

function buildWorkspaceTerminalScopeKey(serverId: string, workspaceId: string): string | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  return `${serverId}:${workspaceId}`;
}

interface WorkspaceTerminalTabActionsInput {
  persistenceKey: string | null;
  focusWorkspacePane: (workspaceKey: string, paneId: string) => void;
  openWorkspaceTabFocused: (workspaceKey: string, target: WorkspaceTabTarget) => string | null;
  labels: {
    workspacePathUnavailable: string;
    terminalQueued: string;
  };
  toast: {
    error: (message: string) => void;
    show: (message: string) => void;
  };
}

interface WorkspaceTerminalTabActions {
  handleTerminalCreated: (input: { terminalId: string; paneId?: string }) => void;
  handleScriptTerminalSelected: (terminalId: string) => void;
  handleWorkspacePathUnavailable: () => void;
  handleTerminalCreateQueued: () => void;
  handleTerminalCreateFailed: (reason: string) => void;
}

function useWorkspaceTerminalTabActions({
  persistenceKey,
  focusWorkspacePane,
  openWorkspaceTabFocused,
  labels,
  toast,
}: WorkspaceTerminalTabActionsInput): WorkspaceTerminalTabActions {
  const handleTerminalCreated = useCallback(
    ({ terminalId, paneId }: { terminalId: string; paneId?: string }) => {
      if (!persistenceKey) {
        return;
      }
      if (paneId) {
        focusWorkspacePane(persistenceKey, paneId);
      }
      openWorkspaceTabFocused(persistenceKey, { kind: "terminal", terminalId });
    },
    [focusWorkspacePane, openWorkspaceTabFocused, persistenceKey],
  );
  const handleScriptTerminalSelected = useCallback(
    (terminalId: string) => {
      if (!persistenceKey) {
        return;
      }
      openWorkspaceTabFocused(persistenceKey, { kind: "terminal", terminalId });
    },
    [openWorkspaceTabFocused, persistenceKey],
  );
  const handleWorkspacePathUnavailable = useCallback(() => {
    toast.error(labels.workspacePathUnavailable);
  }, [labels.workspacePathUnavailable, toast]);
  const handleTerminalCreateQueued = useCallback(() => {
    toast.show(labels.terminalQueued);
  }, [labels.terminalQueued, toast]);
  const handleTerminalCreateFailed = useCallback(
    (reason: string) => {
      toast.error(reason);
    },
    [toast],
  );

  return {
    handleTerminalCreated,
    handleScriptTerminalSelected,
    handleWorkspacePathUnavailable,
    handleTerminalCreateQueued,
    handleTerminalCreateFailed,
  };
}

/** The workspace's center column body plus the overlays that float above the
 * whole pane tree. Extracted from WorkspaceScreenContent purely to keep that
 * function inside the repo's complexity/JSX-depth budgets - it holds no state. */
function WorkspaceCenterContent({
  serverId,
  workspaceId,
  isRouteFocused,
  onOpenPipFile,
  children,
}: {
  serverId: string;
  workspaceId: string;
  isRouteFocused: boolean;
  onOpenPipFile: (request: WorkspaceFileOpenRequest) => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.centerContent}>
      {children}
      {/* Picture-in-picture Visualizer, pinned top-right of the workspace
          content so it sits over the conversation without belonging to any one
          pane. Mounted here rather than inside the chat panel on purpose: a
          per-pane mount would remount (and, on Electron, RELOAD) its guest every
          time you switched chats - see visualizer-pip.tsx. Renders nothing
          unless the PIP is open and no Visualizer tab exists. */}
      <VisualizerPipHost
        serverId={serverId}
        workspaceId={workspaceId}
        isVisible={isRouteFocused}
        onOpenFile={onOpenPipFile}
      />
    </View>
  );
}

// Module-level so the subscription is stable: this screen must re-render when
// the tab retention limit changes and on nothing else in settings.
const selectMountedTabLimit = (settings: AppSettings) => settings.mountedTabLimit;

function WorkspaceScreenContent({
  serverId,
  workspaceId,
  isRouteFocused,
}: WorkspaceScreenContentProps) {
  const { t } = useTranslation();
  const _insets = useSafeAreaInsets();
  const toast = useToast();
  // Close any open tabs belonging to a feature the user just turned off, across
  // every workspace (see docs/feature-flags or the features/ registry).
  useCloseDisabledFeatureTabs();
  const isMobile = useIsCompactFormFactor();
  // User interface mode hides the developer surfaces (explorer, terminals, file
  // tabs, git actions, scripts). Presentation only - the stores/daemon are
  // untouched (see projects/first-time-wizard/interface-modes.md).
  const isDeveloperMode = useIsDeveloperMode();
  // The mobile diff/explorer toggle sits in the menu button's auto-sized chrome,
  // so its icon scales at 1.5x instead of the usual compact doubling.
  const headerActionIconSize = useIconSize(1.5);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);

  const normalizedServerId = useMemo(() => trimNonEmpty(decodeSegment(serverId)) ?? "", [serverId]);

  const normalizedWorkspaceId = useMemo(
    () => resolveWorkspaceRouteId({ routeWorkspaceId: workspaceId }) ?? "",
    [workspaceId],
  );
  const workspaceDescriptor = useWorkspace(normalizedServerId, normalizedWorkspaceId);
  const workspaceScripts = getWorkspaceScripts(workspaceDescriptor);
  // Browser-tools-off heads-up wiring for handleCreateBrowserTab below.
  const { config: browserToolsConfig } = useDaemonConfig(normalizedServerId);
  const browserToolsCopy = useBrowserToolsWarningCopy();
  const openBrowserToolsSettings = useOpenBrowserToolsSettings(normalizedServerId);
  const suppressBrowserToolsWarning = useAppSettingValue(
    (settings) => settings.suppressBrowserToolsWarning,
  );
  // How many of the focused pane's tabs stay mounted behind the frontmost one.
  // Unset resolves per device, which on this path is usually the compact one.
  // See screens/workspace/mounted-tab-retention.ts.
  const mountedTabLimitSetting = useAppSettingValue(selectMountedTabLimit);
  const mountedTabLimit = resolveMountedTabLimit({
    setting: mountedTabLimitSetting,
    isCompact: isMobile,
  });
  const { handleRetryHost, handleManageHost, handleDismissMissingWorkspace } =
    useWorkspaceRouteActions(normalizedServerId);

  const workspaceTerminalScopeKey = useMemo(
    () => buildWorkspaceTerminalScopeKey(normalizedServerId, normalizedWorkspaceId),
    [normalizedServerId, normalizedWorkspaceId],
  );
  useWorkspaceTerminalSessionRetention({
    scopeKey: workspaceTerminalScopeKey,
  });

  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const workspaceDirectory = workspaceDescriptor?.workspaceDirectory || null;
  const isMissingWorkspaceDirectory = Boolean(workspaceDescriptor) && !workspaceDirectory;
  const [isImportSheetVisible, setIsImportSheetVisible] = useState(false);
  // The draft tab that asked for the import, so the imported chat can take that
  // tab over instead of appearing beside the empty draft the user started from.
  // Null when the import came from the header menu, which has no tab context.
  const importRequestTabIdRef = useRef<string | null>(null);
  const canOpenImportSheet = [client, isConnected, workspaceDirectory].every(Boolean);
  const openImportSheet = useCallback((requestingTabId?: string) => {
    importRequestTabIdRef.current = requestingTabId ?? null;
    setIsImportSheetVisible(true);
  }, []);
  const closeImportSheet = useCallback(() => {
    setIsImportSheetVisible(false);
  }, []);

  // Warm the workspace-scoped provider snapshot so the model picker is ready
  // when opened. Deferred past initial interactions so the warm-up fetch does
  // not compete with the workspace switch itself.
  useProvidersSnapshot(normalizedServerId, {
    cwd: workspaceDirectory,
    enabled: useEnabledAfterInteractions(isRouteFocused),
  });

  const persistenceKey = useMemo(
    () =>
      buildWorkspaceTabPersistenceKey({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
      }),
    [normalizedServerId, normalizedWorkspaceId],
  );
  const crossProjectFileOpenGate = useCrossProjectFileOpenGate(
    normalizedServerId,
    getWorkspaceProjectId(workspaceDescriptor),
  );
  const openWorkspaceTabFocused = useWorkspaceLayoutStore((state) => state.openTabFocused);
  const openWorkspaceChildTabFocused = useWorkspaceLayoutStore(
    (state) => state.openChildTabFocused,
  );
  const focusWorkspacePane = useWorkspaceLayoutStore((state) => state.focusPane);
  const hasHydratedWorkspaces = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.hasHydratedWorkspaces ?? false,
  );

  const selectWorkspaceAgentVisibility = useMemo(
    () =>
      createWorkspaceAgentVisibilitySelector({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
      }),
    [normalizedServerId, normalizedWorkspaceId],
  );
  const workspaceAgentVisibility = useStoreWithEqualityFn(
    useSessionStore,
    selectWorkspaceAgentVisibility,
    workspaceAgentVisibilityEqual,
  );

  // Artifact generation agents are internal (never broadcast via agent_state,
  // so they never land in workspaceAgentVisibility's known/active sets) and
  // would otherwise get closed the instant they're opened, since tab
  // reconciliation prunes any agent tab not in that known set once agents are
  // hydrated. Fold in generating artifacts' agent ids so an explicitly opened
  // "view generation log" tab survives for the duration of the run.
  const generatingArtifactAgentIds = useGeneratingArtifactAgentIds({
    serverId: normalizedServerId,
    workspaceDirectory,
    projectId: getWorkspaceProjectId(workspaceDescriptor),
  });
  const reconcileAgentVisibility = useMemo(
    () =>
      generatingArtifactAgentIds.size === 0
        ? workspaceAgentVisibility
        : {
            ...workspaceAgentVisibility,
            activeAgentIds: new Set([
              ...workspaceAgentVisibility.activeAgentIds,
              ...generatingArtifactAgentIds,
            ]),
            knownAgentIds: new Set([
              ...workspaceAgentVisibility.knownAgentIds,
              ...generatingArtifactAgentIds,
            ]),
          },
    [generatingArtifactAgentIds, workspaceAgentVisibility],
  );

  const {
    handleTerminalCreated,
    handleScriptTerminalSelected,
    handleWorkspacePathUnavailable,
    handleTerminalCreateQueued,
    handleTerminalCreateFailed,
  } = useWorkspaceTerminalTabActions({
    persistenceKey,
    focusWorkspacePane,
    openWorkspaceTabFocused,
    labels: {
      workspacePathUnavailable: t("workspace.header.toasts.workspacePathUnavailable"),
      terminalQueued: t("workspace.header.toasts.terminalQueued"),
    },
    toast,
  });
  const queryClient = useQueryClient();
  const {
    createMutation: createTerminalMutation,
    createTerminal,
    handleScriptTerminalStarted,
    handleViewScriptTerminal,
    invalidateTerminals,
    killMutation: killTerminalMutation,
    knownTerminalIds,
    liveTerminalIds,
    pendingCreateInput: pendingTerminalCreateInput,
    query: terminalsQuery,
    queryKey: terminalsQueryKey,
    removeTerminalFromCache,
    standaloneTerminalIds,
    terminals,
  } = useWorkspaceTerminals({
    client,
    isConnected,
    isRouteFocused,
    normalizedServerId,
    normalizedWorkspaceId,
    workspaceDirectory,
    workspaceScripts,
    hasHydratedWorkspaces,
    isMissingWorkspaceDirectory,
    onTerminalCreated: handleTerminalCreated,
    onScriptTerminalSelected: handleScriptTerminalSelected,
    onWorkspacePathUnavailable: handleWorkspacePathUnavailable,
    onTerminalCreateQueued: handleTerminalCreateQueued,
    onTerminalCreateFailed: handleTerminalCreateFailed,
  });
  const { archiveAgent } = useArchiveAgent();
  const { deleteAgent } = useDeleteAgent();
  const { settings } = useSettings();

  const { checkoutQuery, isCheckoutStatusLoading } = useWorkspaceCheckoutStatus({
    client,
    isConnected,
    isRouteFocused,
    normalizedServerId,
    normalizedWorkspaceId,
    workspaceDirectory,
  });
  const hasHydratedAgents = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.hasHydratedAgents ?? false,
  );
  const { state: workspaceRouteState, recovery: workspaceRecovery } =
    useResolvedWorkspaceRouteState({
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      workspace: workspaceDescriptor,
      hasHydratedWorkspaces,
    });
  const handleRecoverWorkspace = useCallback(() => {
    workspaceRecovery.restore();
  }, [workspaceRecovery]);
  const handleRetryRecoveryInspection = useCallback(() => {
    workspaceRecovery.retryInspection();
  }, [workspaceRecovery]);
  const workspaceHeaderCheckoutState = buildWorkspaceHeaderCheckoutState({
    isCheckoutStatusLoading,
    isError: checkoutQuery.isError,
    data: checkoutQuery.data,
  });
  const {
    isWorkspaceHeaderLoading,
    workspaceHeaderTitle,
    workspaceHeaderSubtitle,
    shouldShowWorkspaceHeaderSubtitle,
    isGitCheckout,
    currentBranchName,
  } = deriveWorkspaceHeaderFields({
    workspace: workspaceDescriptor,
    checkoutState: workspaceHeaderCheckoutState,
  });

  const isExplorerOpen = usePanelStore((state) =>
    selectIsFileExplorerOpen(state, { isCompact: isMobile }),
  );
  const isSidebarOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isMobile }),
  );
  const toggleFileExplorerForCheckout = usePanelStore(
    (state) => state.toggleFileExplorerForCheckout,
  );
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const requestProjectSearchFocus = usePanelStore((state) => state.requestProjectSearchFocus);
  const requestFileFinderOpen = usePanelStore((state) => state.requestFileFinderOpen);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const activeExplorerCheckout = useMemo<ExplorerCheckoutContext | null>(() => {
    if (!normalizedServerId || !workspaceDirectory) {
      return null;
    }
    return {
      serverId: normalizedServerId,
      cwd: workspaceDirectory,
      isGit: isGitCheckout,
    };
  }, [isGitCheckout, normalizedServerId, workspaceDirectory]);

  const explorerToggleAnchorRef = useTutorialAnchor("explorer-toggle");
  const explorerToggleKeys = useShortcutKeys("toggle-right-sidebar");

  const handleToggleExplorer = useCallback(() => {
    if (!activeExplorerCheckout) {
      return;
    }
    toggleFileExplorerForCheckout({
      isCompact: isMobile,
      checkout: activeExplorerCheckout,
    });
  }, [activeExplorerCheckout, isMobile, toggleFileExplorerForCheckout]);

  const handleOpenExplorerTab = useCallback(
    (tab: ExplorerTab) => {
      if (!activeExplorerCheckout) {
        return;
      }
      openFileExplorerForCheckout({
        isCompact: isMobile,
        checkout: activeExplorerCheckout,
      });
      setExplorerTabForCheckout({ ...activeExplorerCheckout, tab });
    },
    [activeExplorerCheckout, isMobile, openFileExplorerForCheckout, setExplorerTabForCheckout],
  );

  const hasDiffStat = useMemo(() => Boolean(workspaceDescriptor?.diffStat), [workspaceDescriptor]);
  // The open sidebar already shows the diff stats on the workspace row - hide
  // the header copy to avoid the duplicate; they reappear when it's closed.
  const showExplorerDiffStat = useMemo(
    () => hasDiffStat && !isSidebarOpen,
    [hasDiffStat, isSidebarOpen],
  );
  const explorerToggleStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.sourceControlButton,
      showExplorerDiffStat && styles.sourceControlButtonWithStats,
      // Chrome held while the explorer is open, matching the other header toggles.
      isExplorerOpen && styles.sourceControlButtonActive,
      (Boolean(hovered) || Boolean(pressed)) && styles.sourceControlButtonHovered,
    ],
    [isExplorerOpen, showExplorerDiffStat],
  );
  const explorerToggleAccessibilityState = useMemo(
    () => ({ expanded: isExplorerOpen }),
    [isExplorerOpen],
  );

  useEffect(() => {
    if (!isRouteFocused || isWeb || !isExplorerOpen) {
      return;
    }

    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isExplorerOpen) {
        showMobileAgent();
        return true;
      }
      return false;
    });

    return () => handler.remove();
  }, [isExplorerOpen, isRouteFocused, showMobileAgent]);

  const workspaceLayout = useWorkspaceLayoutStore((state) =>
    persistenceKey ? (state.layoutByWorkspace[persistenceKey] ?? null) : null,
  );
  const hasHydratedWorkspaceLayoutStore = useWorkspaceLayoutStoreHydrated();
  // Report pane-content readiness for the app-wide route-fade veil. A workspace
  // is "ready" to reveal once it has a layout - the tab strip and panes render
  // from it (see desktopSplitContent). On a cold or freshly-seeded workspace this
  // flips null -> populated a beat after the shell mounts, so the veil holds its
  // reveal until this fires (RouteFadeContainer) instead of lifting on the bare
  // shell and letting the panes pop in after. Post-paint so it marks once the
  // panes have painted; cleared on unmount so a pruned deck entry never reads as
  // ready.
  const contentReadyKey = getWorkspaceContentReadyKey(normalizedServerId, normalizedWorkspaceId);
  const hasWorkspaceLayout = workspaceLayout !== null;
  useEffect(() => {
    if (!hasWorkspaceLayout) {
      clearWorkspaceContentReady(contentReadyKey);
      return;
    }
    markWorkspaceContentReady(contentReadyKey);
    return () => clearWorkspaceContentReady(contentReadyKey);
  }, [contentReadyKey, hasWorkspaceLayout]);
  const workspaceSetupSnapshot = useWorkspaceSetupStore((state) =>
    persistenceKey ? (state.snapshots[persistenceKey] ?? null) : null,
  );
  const ensureWorkspaceSetupStatus = useWorkspaceSetupStore((state) => state.ensureSetupStatus);
  const showWorkspaceSetup = shouldShowWorkspaceSetup(workspaceSetupSnapshot);
  const uiTabs = useMemo(
    () => (workspaceLayout ? collectAllTabs(workspaceLayout.root) : EMPTY_UI_TABS),
    [workspaceLayout],
  );
  // What actually renders (tab strip + pane content). In User mode the
  // developer-only tab kinds (terminal, file) are filtered out; the unfiltered
  // `uiTabs` still drives store reconciliation and file-open, so nothing is
  // closed or mutated - switching back to Developer restores everything.
  const visibleUiTabs = useMemo(
    () => hideDeveloperTabs(uiTabs, isDeveloperMode),
    [uiTabs, isDeveloperMode],
  );
  const focusedPaneTabState = useMemo(
    () =>
      deriveWorkspacePaneState({
        layout: workspaceLayout,
        tabs: visibleUiTabs,
      }),
    [visibleUiTabs, workspaceLayout],
  );
  useSyncWorkspaceActiveBrowser({
    workspaceLayout,
    isRouteFocused,
    workspaceId: normalizedWorkspaceId,
  });
  const openWorkspaceTabInBackground = useWorkspaceLayoutStore(
    (state) => state.openTabInBackground,
  );
  const focusWorkspaceTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const closeWorkspaceTab = useWorkspaceLayoutStore((state) => state.closeTab);
  const unpinWorkspaceAgent = useWorkspaceLayoutStore((state) => state.unpinAgent);
  const hideWorkspaceAgent = useWorkspaceLayoutStore((state) => state.hideAgent);
  const retargetWorkspaceTab = useWorkspaceLayoutStore((state) => state.retargetTab);
  const reconcileWorkspaceTabs = useWorkspaceLayoutStore((state) => state.reconcileTabs);
  const splitWorkspacePane = useWorkspaceLayoutStore((state) => state.splitPane);
  const splitWorkspacePaneEmpty = useWorkspaceLayoutStore((state) => state.splitPaneEmpty);
  const moveWorkspaceTabToPane = useWorkspaceLayoutStore((state) => state.moveTabToPane);
  const paneFocusSuppressedRef = useRef(false);
  const resizeWorkspaceSplit = useWorkspaceLayoutStore((state) => state.resizeSplit);
  const reorderWorkspaceTabsInPane = useWorkspaceLayoutStore((state) => state.reorderTabsInPane);
  const _pinnedAgentIds = useWorkspaceLayoutStore((state) =>
    persistenceKey
      ? (state.pinnedAgentIdsByWorkspace[persistenceKey] ?? EMPTY_PINNED_AGENT_IDS)
      : EMPTY_PINNED_AGENT_IDS,
  );
  const _hiddenAgentIds = useWorkspaceLayoutStore((state) =>
    persistenceKey ? (state.hiddenAgentIdsByWorkspace[persistenceKey] ?? EMPTY_SET) : EMPTY_SET,
  );
  const pendingByDraftId = useCreateFlowStore((state) => state.pendingByDraftId);
  const { closingTabIds, closeTab } = useCloseTabs();
  // One measurement drives two header decisions: whether desktop tool buttons
  // show their labels, and (compact) which action buttons still fit. Measured on
  // the header row, whose width doesn't depend on what we decide to render - a
  // narrower container like the title cluster would oscillate.
  const { onLayout: onHeaderLayout, width: headerRowWidth } = useContainerWidth();
  // Unmeasured (0) counts as narrow, matching the label-first initial render.
  const showCompactButtonLabels = headerRowWidth < 700;
  // Compact only: the "..." menu and a readable title always win, so the action
  // buttons drop in order (Voice cues, then Visualizer, then Explorer, then
  // Play) as the row narrows. Decided once here because the strip straddles the
  // header's `left` and `right` containers and both halves must spend the same
  // budget.
  const visualizerEnabled = useFeatureEnabled("visualizer");
  const voiceCuesAvailable = useVoiceCuesAvailable(normalizedServerId);
  const microphoneAvailable = getWorkspaceMicrophoneAvailability(
    settings.wakeWordEnabled,
    focusedPaneTabState.activeTab,
  );
  // The Brain status light moves into the header whenever the sidebar is not
  // showing its own, so the local AI host's state is visible at all times rather
  // than only while the sidebar happens to be open.
  const showBrainAction = shouldShowHeaderBrainButton({
    isCompact: isMobile,
    isSidebarOpen,
  });
  const headerActionFit = useMemo(
    () =>
      resolveCompactHeaderActions({
        isCompact: isMobile,
        rowWidth: headerRowWidth,
        isDeveloperMode,
        visualizerEnabled,
        voiceCuesAvailable,
        microphoneAvailable,
        hasWorkspaceScripts: workspaceScripts.length > 0,
        hasWorkspaceDirectory: Boolean(workspaceDirectory),
        hasBrainButton: showBrainAction,
      }),
    [
      isMobile,
      headerRowWidth,
      isDeveloperMode,
      visualizerEnabled,
      voiceCuesAvailable,
      microphoneAvailable,
      workspaceScripts.length,
      workspaceDirectory,
      showBrainAction,
    ],
  );
  const closeWorkspaceTabWithCleanup = useCallback(
    function closeWorkspaceTabWithCleanup(input: {
      tabId: string;
      target?: WorkspaceTabTarget | null;
    }) {
      const normalizedTabId = trimNonEmpty(input.tabId);
      if (!normalizedTabId || !persistenceKey) {
        return;
      }

      if (input.target?.kind === "agent") {
        unpinWorkspaceAgent(persistenceKey, input.target.agentId);
        hideWorkspaceAgent(persistenceKey, input.target.agentId);
        // Closing the tab is what ends the by-id projection an archived chat
        // was opened with; a pane unmounting is not (mounted-tab retention and
        // deck eviction unmount panes whose tabs stay open). A surface that
        // somehow still shows the chat re-fetches it by id.
        useSessionStore.getState().releaseClosedChat(normalizedServerId, input.target.agentId);
      }
      if (input.target?.kind === "file") {
        // Every close path funnels through here - single close, "Close all" /
        // "Close others" (workspace-bulk-close.ts), and pane close - so this is
        // where a file tab's editor buffer is released. Only a CLEAN one:
        // unsaved text is never discarded without the confirm in
        // panels/file-panel.tsx, so a dirty or conflicted buffer stays retained.
        releaseCleanEditorBuffer({
          serverId: normalizedServerId,
          // Match the origin-aware buffer key the pane uses (gated-multi-root).
          workspaceId: input.target.origin?.workspaceId ?? normalizedWorkspaceId,
          path: input.target.path,
        });
      }
      if (input.target?.kind === "browser") {
        const { browserId } = input.target;
        // Check isPreview/previewServerId BEFORE removing the record
        const browserRecord = useBrowserStore.getState().browsersById[browserId];
        useBrowserStore.getState().removeBrowser(browserId);
        removeResidentBrowserWebview(browserId);

        // Auto-stop this tab's own preview server if the setting is enabled.
        if (
          browserRecord?.isPreview &&
          browserRecord.previewServerId &&
          settings.previewServerCloseBehavior === "stop-on-close"
        ) {
          void client?.previewStop(browserRecord.previewServerId).catch(() => undefined);
        }
      }
      closeWorkspaceTab(persistenceKey, normalizedTabId);
    },
    [
      client,
      closeWorkspaceTab,
      hideWorkspaceAgent,
      normalizedServerId,
      normalizedWorkspaceId,
      persistenceKey,
      settings,
      unpinWorkspaceAgent,
    ],
  );

  // Selective timeline delivery: the daemon only forwards agent_stream events for
  // agents this client has declared it is viewing. Without this declaration the
  // subscription set stays empty and no live message ever reaches the transcript;
  // the rows still land in the daemon's timeline, so a reload appears to "fix" it.
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.viewedTimelineSync ?? null,
  );
  const visibleAgentIds = useMemo(
    () =>
      selectVisibleAgentIds({
        layout: workspaceLayout,
        tabs: visibleUiTabs,
        routeFocused: isRouteFocused,
        focusedPaneOnly: isMobile || isFocusModeEnabled || !supportsDesktopPaneSplits(),
      }),
    [isFocusModeEnabled, isMobile, isRouteFocused, visibleUiTabs, workspaceLayout],
  );
  useLayoutEffect(() => {
    if (!persistenceKey || !viewedTimelineSync) {
      return;
    }
    viewedTimelineSync.replaceVisibleAgentIds(persistenceKey, visibleAgentIds);
  }, [persistenceKey, viewedTimelineSync, visibleAgentIds]);
  useEffect(() => {
    if (!persistenceKey || !viewedTimelineSync) {
      return;
    }
    return () => viewedTimelineSync.replaceVisibleAgentIds(persistenceKey, []);
  }, [persistenceKey, viewedTimelineSync]);

  const setFocusedAgentId = useSessionStore((state) => state.setFocusedAgentId);
  const setFocusedTerminalId = useSessionStore((state) => state.setFocusedTerminalId);
  const focusedPaneAgentId = useMemo(() => {
    const target = focusedPaneTabState.activeTab?.descriptor.target;
    if (target?.kind !== "agent") {
      return null;
    }
    return target.agentId;
  }, [focusedPaneTabState.activeTab]);
  const focusedPaneTerminalId = useMemo(() => {
    const target = focusedPaneTabState.activeTab?.descriptor.target;
    if (target?.kind !== "terminal") {
      return null;
    }
    return target.terminalId;
  }, [focusedPaneTabState.activeTab]);

  // Both setters drop the write when the server has no session entry yet, and on
  // a cold boot straight into a workspace the pane resolves its agent tab from
  // the route before the daemon connection has created that entry. Without the
  // session's existence in the dependency list nothing here changes again, so
  // that one dropped write left `focusedAgentId` null for the rest of the
  // session - which silently takes "Add to context" out of Changes, Files and
  // Search, since all three only offer it while a chat is focused.
  const hasSessionEntry = useSessionStore(
    (state) => state.sessions[normalizedServerId] !== undefined,
  );
  useEffect(() => {
    if (!isRouteFocused || !hasSessionEntry) {
      return;
    }
    setFocusedAgentId(normalizedServerId, focusedPaneAgentId);
    setFocusedTerminalId(normalizedServerId, focusedPaneTerminalId);
  }, [
    focusedPaneAgentId,
    focusedPaneTerminalId,
    hasSessionEntry,
    isRouteFocused,
    normalizedServerId,
    setFocusedAgentId,
    setFocusedTerminalId,
  ]);

  useEffect(() => {
    if (!isRouteFocused) {
      return;
    }
    return () => {
      setFocusedAgentId(normalizedServerId, null);
      setFocusedTerminalId(normalizedServerId, null);
    };
  }, [isRouteFocused, normalizedServerId, setFocusedAgentId, setFocusedTerminalId]);

  const openWorkspaceDraftTab = useCallback(
    function openWorkspaceDraftTab(input?: { draftId?: string; focus?: boolean }) {
      if (!persistenceKey) {
        return null;
      }

      const target = normalizeWorkspaceTabTarget({
        kind: "draft",
        draftId: trimNonEmpty(input?.draftId) ?? generateDraftId(),
      });
      invariant(target?.kind === "draft", "Draft tab target must be valid");
      if (input?.focus === false) {
        return openWorkspaceTabInBackground(persistenceKey, target);
      }
      return openWorkspaceTabFocused(persistenceKey, target);
    },
    [openWorkspaceTabFocused, openWorkspaceTabInBackground, persistenceKey],
  );

  const handleWakeWordEmptyStateError = useCallback(
    (error: Error) => toast.error(error.message),
    [toast],
  );

  useEffect(() => {
    if (!isRouteFocused) {
      return;
    }
    if (!normalizedServerId || !normalizedWorkspaceId || !persistenceKey) {
      return;
    }
    if (!hasHydratedWorkspaceLayoutStore) {
      return;
    }

    const hasActivePendingDraftCreateInWorkspace = uiTabs.some((tab) => {
      if (tab.target.kind !== "draft") {
        return false;
      }
      const pending = pendingByDraftId[tab.target.draftId];
      return pending?.serverId === normalizedServerId && pending.lifecycle === "active";
    });

    reconcileWorkspaceTabs(
      persistenceKey,
      buildWorkspaceTabSnapshot({
        agentVisibility: reconcileAgentVisibility,
        agentsHydrated: hasHydratedAgents,
        terminalsHydrated: terminalsQuery.isSuccess,
        knownTerminalIds,
        standaloneTerminalIds,
        hasActivePendingDraftCreate: hasActivePendingDraftCreateInWorkspace,
      }),
    );
  }, [
    hasHydratedAgents,
    hasHydratedWorkspaceLayoutStore,
    isRouteFocused,
    normalizedServerId,
    normalizedWorkspaceId,
    pendingByDraftId,
    persistenceKey,
    reconcileWorkspaceTabs,
    knownTerminalIds,
    standaloneTerminalIds,
    terminalsQuery.isSuccess,
    uiTabs,
    reconcileAgentVisibility,
  ]);

  const activeTabId = focusedPaneTabState.activeTabId;
  const activeTab = focusedPaneTabState.activeTab;

  const tabs = useMemo<WorkspaceTabDescriptor[]>(
    () => focusedPaneTabState.tabs.map((tab) => tab.descriptor),
    [focusedPaneTabState.tabs],
  );
  const hasSetupTab = useMemo(
    () =>
      uiTabs.some(
        (tab) => tab.target.kind === "setup" && tab.target.workspaceId === normalizedWorkspaceId,
      ),
    [normalizedWorkspaceId, uiTabs],
  );

  const navigateToTabId = useCallback(
    function navigateToTabId(tabId: string) {
      if (!tabId || !persistenceKey) {
        return;
      }
      focusWorkspaceTab(persistenceKey, tabId);
    },
    [focusWorkspaceTab, persistenceKey],
  );
  const handleImportedAgent = useCallback(
    (agentId: string) => {
      if (!persistenceKey) {
        return;
      }
      // Same handoff a submitted draft gets: the tab that requested the import
      // becomes the imported chat. Only still-draft tabs qualify - the user may
      // have retargeted or closed it while the import was in flight.
      const requestingTabId = importRequestTabIdRef.current;
      importRequestTabIdRef.current = null;
      const requestingTab = requestingTabId
        ? uiTabs.find((tab) => tab.tabId === requestingTabId)
        : undefined;
      if (requestingTab?.target.kind === "draft") {
        retargetWorkspaceTab(persistenceKey, requestingTab.tabId, { kind: "agent", agentId });
        navigateToTabId(requestingTab.tabId);
        return;
      }
      const tabId = openWorkspaceTabFocused(persistenceKey, { kind: "agent", agentId });
      if (tabId) {
        navigateToTabId(tabId);
      }
    },
    [navigateToTabId, openWorkspaceTabFocused, persistenceKey, retargetWorkspaceTab, uiTabs],
  );

  const emptyWorkspaceSeedRef = useRef<string | null>(null);
  const autoOpenedSetupTabWorkspaceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isRouteFocused || !client || !normalizedServerId || !normalizedWorkspaceId) {
      return;
    }
    ensureWorkspaceSetupStatus({
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      client,
    });
  }, [
    client,
    ensureWorkspaceSetupStatus,
    isRouteFocused,
    normalizedServerId,
    normalizedWorkspaceId,
  ]);

  useEffect(() => {
    if (
      !shouldSeedEmptyWorkspaceDraft({
        isRouteFocused,
        hasPersistenceKey: Boolean(persistenceKey),
        hasWorkspaceDirectory: Boolean(workspaceDirectory),
        hasHydratedWorkspaceLayoutStore,
        hasHydratedAgents,
        hasLoadedTerminals: terminalsQuery.isSuccess,
        activeAgentCount: workspaceAgentVisibility.activeAgentIds.size,
        terminalCount: terminals.length,
        tabCount: tabs.length,
      })
    ) {
      emptyWorkspaceSeedRef.current = null;
      return;
    }
    const workspaceKey = `${normalizedServerId}:${normalizedWorkspaceId}`;
    if (emptyWorkspaceSeedRef.current === workspaceKey) {
      return;
    }
    emptyWorkspaceSeedRef.current = workspaceKey;
    openWorkspaceDraftTab();
  }, [
    normalizedServerId,
    normalizedWorkspaceId,
    openWorkspaceDraftTab,
    persistenceKey,
    hasHydratedAgents,
    hasHydratedWorkspaceLayoutStore,
    isRouteFocused,
    terminals.length,
    terminalsQuery.isSuccess,
    tabs.length,
    workspaceDirectory,
    workspaceAgentVisibility.activeAgentIds.size,
  ]);

  useEffect(() => {
    if (!isRouteFocused) {
      return;
    }
    if (!persistenceKey) {
      return;
    }
    if (!workspaceSetupSnapshot || !showWorkspaceSetup) {
      if (autoOpenedSetupTabWorkspaceRef.current === persistenceKey) {
        autoOpenedSetupTabWorkspaceRef.current = null;
      }
      return;
    }

    const snapshotAge = Date.now() - workspaceSetupSnapshot.updatedAt;
    const shouldAutoOpen =
      workspaceSetupSnapshot.status === "running" ||
      snapshotAge <= WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS;
    if (!shouldAutoOpen) {
      return;
    }
    if (hasSetupTab) {
      autoOpenedSetupTabWorkspaceRef.current = persistenceKey;
      return;
    }
    if (autoOpenedSetupTabWorkspaceRef.current === persistenceKey) {
      return;
    }

    const target = normalizeWorkspaceTabTarget({
      kind: "setup",
      workspaceId: normalizedWorkspaceId,
    });
    if (!target) {
      return;
    }

    const tabId = openWorkspaceTabInBackground(persistenceKey, target);
    if (!tabId) {
      return;
    }

    autoOpenedSetupTabWorkspaceRef.current = persistenceKey;
  }, [
    hasSetupTab,
    isRouteFocused,
    normalizedWorkspaceId,
    openWorkspaceTabInBackground,
    persistenceKey,
    showWorkspaceSetup,
    workspaceSetupSnapshot,
  ]);

  const handleOpenFileFromExplorer = useCallback(
    function handleOpenFileFromExplorer(
      filePath: string,
      options?: { edit?: boolean; lineStart?: number },
    ) {
      if (!persistenceKey) {
        return;
      }
      const location = normalizeWorkspaceFileLocation({
        path: filePath,
        lineStart: options?.lineStart,
      });
      if (!location) {
        return;
      }
      if (options?.edit) {
        // One tab per file: "Edit" opens the same file tab in editor view.
        setFileViewModeFor({ persistenceKey, path: location.path, mode: "editor" });
      }
      const tabId = openWorkspaceTabFocused(persistenceKey, createWorkspaceFileTabTarget(location));
      if (tabId) {
        navigateToTabId(tabId);
      }
    },
    [navigateToTabId, openWorkspaceTabFocused, persistenceKey],
  );

  const handleOpenFileFromChat = useCallback(
    (location: WorkspaceFileLocation, options?: { parentTabId?: string | null }) => {
      const normalizedLocation = normalizeWorkspaceFileLocation(location);
      if (!normalizedLocation) {
        return;
      }
      if (isMobile) {
        showMobileAgent();
      }
      if (!persistenceKey) {
        return;
      }
      // Resolve cross-project / project-less opens (gated-multi-root): a file in
      // another project or outside every project opens in place with an origin
      // discriminator; editing it is gated later at edit time. The open never blocks.
      const resolved = crossProjectFileOpenGate(normalizedLocation);
      const target = createWorkspaceFileTabTarget(resolved.location, resolved.origin);
      const tabId = options?.parentTabId
        ? openWorkspaceChildTabFocused(persistenceKey, target, options.parentTabId)
        : openWorkspaceTabFocused(persistenceKey, target);
      if (tabId) {
        navigateToTabId(tabId);
      }
    },
    [
      crossProjectFileOpenGate,
      isMobile,
      navigateToTabId,
      openWorkspaceChildTabFocused,
      openWorkspaceTabFocused,
      persistenceKey,
      showMobileAgent,
    ],
  );

  const handleOpenFileFromChatInSidePane = useCallback(
    (input: {
      location: WorkspaceFileLocation;
      sourcePaneId?: string;
      parentTabId?: string | null;
    }) => {
      const location = normalizeWorkspaceFileLocation(input.location);
      if (!location) {
        return;
      }
      if (!persistenceKey || isMobile || !input.sourcePaneId) {
        handleOpenFileFromChat(location, { parentTabId: input.parentTabId });
        return;
      }

      // Resolve cross-project / project-less origin so a side-pane open of an
      // out-of-project file is scoped to its owning (or synthesized) workspace.
      const resolved = crossProjectFileOpenGate(location);
      const target: WorkspaceTabTarget = createWorkspaceFileTabTarget(
        resolved.location,
        resolved.origin,
      );
      const placement = resolveSideFileOpenPlacement({
        layout: workspaceLayout,
        sourcePaneId: input.sourcePaneId,
        tabs: uiTabs,
        target,
      });
      if (placement.kind === "focus-side-pane") {
        focusWorkspacePane(persistenceKey, placement.paneId);
      } else if (placement.kind === "split-side-pane") {
        splitWorkspacePaneEmpty(persistenceKey, {
          targetPaneId: placement.paneId,
          position: "right",
        });
      }

      const tabId = input.parentTabId
        ? openWorkspaceChildTabFocused(persistenceKey, target, input.parentTabId)
        : openWorkspaceTabFocused(persistenceKey, target);
      if (tabId) {
        navigateToTabId(tabId);
      }
    },
    [
      crossProjectFileOpenGate,
      handleOpenFileFromChat,
      isMobile,
      focusWorkspacePane,
      navigateToTabId,
      openWorkspaceChildTabFocused,
      openWorkspaceTabFocused,
      persistenceKey,
      splitWorkspacePaneEmpty,
      uiTabs,
      workspaceLayout,
    ],
  );

  const handleOpenWorkspaceFileFromPane = useStableEvent(function handleOpenWorkspaceFileFromPane({
    request,
    paneId,
    parentTabId,
    focusPaneBeforeOpen,
  }: {
    request: WorkspaceFileOpenRequest;
    paneId?: string | null;
    parentTabId: string;
    focusPaneBeforeOpen?: boolean;
  }) {
    if (focusPaneBeforeOpen && paneId && persistenceKey) {
      focusWorkspacePane(persistenceKey, paneId);
    }
    if (request.disposition === "side") {
      handleOpenFileFromChatInSidePane({
        location: request.location,
        sourcePaneId: paneId ?? undefined,
        parentTabId,
      });
      return;
    }
    handleOpenFileFromChat(request.location, { parentTabId });
  });

  // A file opened from the PIP graph. PIP belongs to no pane, so there is no
  // source pane to open beside and no parent tab to hang it off - route it
  // through the plain chat opener, which lands it in the focused pane.
  const handleOpenWorkspaceFileFromPip = useStableEvent(function handleOpenWorkspaceFileFromPip(
    request: WorkspaceFileOpenRequest,
  ) {
    handleOpenFileFromChat(request.location);
  });

  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const { handleRenameTab, renamingTab, handleRenameModalSubmit, handleRenameModalClose } =
    useWorkspaceTabRename({
      client,
      normalizedServerId,
      queryClient,
      terminalsData: terminalsQuery.data,
      terminalsQueryKey,
    });

  const allTabDescriptorsById = useMemo(() => {
    const map = new Map<string, WorkspaceTabDescriptor>();
    for (const tab of uiTabs) {
      map.set(tab.tabId, {
        key: tab.tabId,
        tabId: tab.tabId,
        kind: tab.target.kind,
        target: tab.target,
      });
    }
    return map;
  }, [uiTabs]);
  const bulkCloseConfirmationLabels = useMemo<BulkCloseConfirmationLabels>(
    () => ({
      all: ({ agents, terminals: terminalCount, tabs: tabCount }) =>
        t("workspace.tabs.confirmations.bulk.all", {
          agents,
          terminals: terminalCount,
          tabs: tabCount,
        }),
      agentsAndTerminals: ({ agents, terminals: terminalCount }) =>
        t("workspace.tabs.confirmations.bulk.agentsAndTerminals", {
          agents,
          terminals: terminalCount,
        }),
      terminalsAndTabs: ({ terminals: terminalCount, tabs: tabCount }) =>
        t("workspace.tabs.confirmations.bulk.terminalsAndTabs", {
          terminals: terminalCount,
          tabs: tabCount,
        }),
      agentsAndTabs: ({ agents, tabs: tabCount }) =>
        t("workspace.tabs.confirmations.bulk.agentsAndTabs", { agents, tabs: tabCount }),
      terminals: ({ terminals: terminalCount }) =>
        t("workspace.tabs.confirmations.bulk.terminals", { terminals: terminalCount }),
      tabs: ({ tabs: tabCount }) => t("workspace.tabs.confirmations.bulk.tabs", { tabs: tabCount }),
      agents: ({ agents }) => t("workspace.tabs.confirmations.bulk.agents", { agents }),
    }),
    [t],
  );
  const explorerToggleLabel = isExplorerOpen
    ? t("workspace.tabs.explorer.close")
    : t("workspace.tabs.explorer.open");

  const activeTabKey = useMemo(() => activeTabId ?? "", [activeTabId]);
  const tabFallbackLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      workspaceSetup: t("workspace.tabs.fallback.workspaceSetup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      browser: t("workspace.tabs.fallback.browser"),
      agent: t("workspace.tabs.fallback.agent"),
      visualizer: t("workspace.tabs.fallback.visualizer"),
      contextManagement: t("workspace.contextManagement.tabLabel"),
    }),
    [t],
  );

  // Mobile collapses the workspace to a single visible pane, but a tab can live
  // in a *different* pane (e.g. the Visualizer, which splits into its own pane on
  // desktop/web - see open-visualizer-tab). Those tabs are absent from the
  // focused-pane `tabs` above, so the mobile switcher enumerates every pane's
  // tabs as one flat list. Selecting one cross-pane-focuses it (focusTabInLayout
  // moves `focusedPaneId` to the tab's pane), after which the focused-pane render
  // shows it - so only the *list* needs widening, not the mount/select paths.
  const mobileSwitcherTabs = useMemo<WorkspaceTabDescriptor[]>(
    () =>
      visibleUiTabs.map((tab) => ({
        key: tab.tabId,
        tabId: tab.tabId,
        kind: tab.target.kind,
        target: tab.target,
      })),
    [visibleUiTabs],
  );
  const mobileTabByKey = useMemo(() => {
    const map = new Map<string, WorkspaceTabDescriptor>();
    for (const tab of mobileSwitcherTabs) {
      map.set(tab.key, tab);
    }
    return map;
  }, [mobileSwitcherTabs]);
  const mobileTabSwitcherOptions = useMemo(
    () =>
      mobileSwitcherTabs.map((tab) => ({
        id: tab.key,
        label: getFallbackTabOptionLabel(tab, tabFallbackLabels),
        description: getFallbackTabOptionDescription(tab, tabFallbackLabels),
      })),
    [mobileSwitcherTabs, tabFallbackLabels],
  );

  const handleCreateDraftTab = useCallback(
    (input?: { paneId?: string }) => {
      if (!persistenceKey) {
        openWorkspaceDraftTab();
        return;
      }

      // A "New chat" must never open as a second tab inside the Visualizer's
      // pane - the Visualizer is a companion view that owns its pane. Redirect
      // the draft to a sibling pane instead: reuse one that's already on screen,
      // or split a fresh pane to the left of the Visualizer when it stands alone.
      const placement = resolveWorkspaceNewChatPlacement({
        layout: workspaceLayout,
        tabs: uiTabs,
        requestedPaneId: input?.paneId ?? null,
        supportsPaneSplits: supportsDesktopPaneSplits(),
      });

      if (placement.kind === "reuse-pane") {
        focusWorkspacePane(persistenceKey, placement.paneId);
        openWorkspaceDraftTab();
        return;
      }

      if (placement.kind === "split-left") {
        const newPaneId = splitWorkspacePaneEmpty(persistenceKey, {
          targetPaneId: placement.targetPaneId,
          position: "left",
        });
        if (newPaneId) {
          focusWorkspacePane(persistenceKey, newPaneId);
        }
        openWorkspaceDraftTab();
        return;
      }

      if (input?.paneId) {
        focusWorkspacePane(persistenceKey, input.paneId);
      }
      openWorkspaceDraftTab();
    },
    [
      focusWorkspacePane,
      openWorkspaceDraftTab,
      persistenceKey,
      splitWorkspacePaneEmpty,
      uiTabs,
      workspaceLayout,
    ],
  );

  const handleCreateTerminal = useCallback(
    (input?: { paneId?: string; profile?: TerminalProfileInput }) => {
      // Focus the pane synchronously, at click time, rather than waiting for
      // the daemon round-trip in createTerminal's onSuccess. Otherwise the
      // tab lands wherever the layout's focused pane happens to be once the
      // async create resolves, not the pane the button was clicked in.
      if (input?.paneId && persistenceKey) {
        focusWorkspacePane(persistenceKey, input.paneId);
      }
      createTerminal(input);
    },
    [createTerminal, focusWorkspacePane, persistenceKey],
  );

  const handleCreateTerminalWithProfile = useCallback(
    (profile: TerminalProfileInput) => {
      createTerminal({ profile });
    },
    [createTerminal],
  );

  // Every user-driven "new browser tab" path funnels through here, so this is
  // the one place the Browser-tools-off heads-up has to live. Informational
  // only - the tab is still useful to the human - so it proceeds on "Not now"
  // and can be silenced for good. Agent-driven tab creation
  // (browser-automation/handler.ts) never reaches this and must not warn.
  const handleCreateBrowserTab = useCallback(
    (input?: { paneId?: string }) => {
      if (!persistenceKey || !getIsElectron()) {
        return;
      }
      void (async () => {
        const proceed = await confirmBrowserToolsOffBeforeOpening({
          config: browserToolsConfig,
          copy: browserToolsCopy,
          suppressed: suppressBrowserToolsWarning,
          onOpenSettings: openBrowserToolsSettings,
        });
        if (!proceed) {
          return;
        }
        if (input?.paneId) {
          focusWorkspacePane(persistenceKey, input.paneId);
        }
        const { browserId } = createWorkspaceBrowser();
        openWorkspaceTabFocused(persistenceKey, { kind: "browser", browserId });
      })();
    },
    [
      browserToolsConfig,
      browserToolsCopy,
      focusWorkspacePane,
      openBrowserToolsSettings,
      openWorkspaceTabFocused,
      persistenceKey,
      suppressBrowserToolsWarning,
    ],
  );

  const handleOpenUrlInBrowserTab = useCallback(
    (url: string) => {
      if (!persistenceKey || !getIsElectron()) {
        return;
      }
      const { browserId } = createWorkspaceBrowser({ initialUrl: url });
      openWorkspaceTabFocused(persistenceKey, { kind: "browser", browserId });
    },
    [openWorkspaceTabFocused, persistenceKey],
  );

  useDesktopBrowserNewTabRequests({
    enabled: Boolean(persistenceKey),
    workspaceLayout,
    openUrl: handleOpenUrlInBrowserTab,
  });

  // While this workspace is mounted, the global openLink() helper can route
  // "in-app" link opens into a normal Otto browser tab here (Electron only -
  // handleOpenUrlInBrowserTab is a no-op elsewhere). See utils/open-link.ts.
  useEffect(() => {
    if (!persistenceKey || !getIsElectron()) {
      return;
    }
    return registerInAppLinkOpener(handleOpenUrlInBrowserTab);
  }, [handleOpenUrlInBrowserTab, persistenceKey]);

  const handleSelectSwitcherTab = useCallback(
    (key: string) => {
      navigateToTabId(key);
    },
    [navigateToTabId],
  );

  const handleCreateDraftSplit = useCallback(
    (input: { targetPaneId: string; position: "left" | "right" | "top" | "bottom" }) => {
      if (!persistenceKey) {
        return;
      }

      const paneId = splitWorkspacePaneEmpty(persistenceKey, input);
      if (!paneId) {
        return;
      }

      handleCreateDraftTab({ paneId });
    },
    [handleCreateDraftTab, persistenceKey, splitWorkspacePaneEmpty],
  );

  const killTerminalAsync = killTerminalMutation.mutateAsync;

  const handleCloseTerminalTab = useCallback(
    async (input: { tabId: string; terminalId: string }) => {
      const { tabId, terminalId } = input;
      await closeTab(tabId, async () => {
        const confirmed = await confirmDialog({
          title: t("workspace.tabs.confirmations.closeTerminalTitle"),
          message: t("workspace.tabs.confirmations.closeTerminalMessage"),
          confirmLabel: t("workspace.tabs.confirmations.close"),
          cancelLabel: t("workspace.tabs.confirmations.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }

        removeTerminalFromCache(terminalId);
        setHoveredCloseTabKey((current) => (current === tabId ? null : current));
        if (persistenceKey) {
          closeWorkspaceTabWithCleanup({
            tabId,
            target: { kind: "terminal", terminalId },
          });
        }

        void killTerminalAsync(terminalId).catch(invalidateTerminals);
      });
    },
    [
      closeTab,
      closeWorkspaceTabWithCleanup,
      invalidateTerminals,
      killTerminalAsync,
      persistenceKey,
      removeTerminalFromCache,
      t,
    ],
  );

  const handleArchiveAgentFromMenu = useCallback(
    async (agentId: string) => {
      if (!normalizedServerId) return;
      const session = useSessionStore.getState().sessions[normalizedServerId];
      const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
      if (agent?.status === "running") {
        const confirmed = await confirmDialog({
          title: t("workspace.tabs.confirmations.archiveRunningAgentTitle"),
          message: t("workspace.tabs.confirmations.archiveRunningAgentMessage"),
          confirmLabel: t("workspace.tabs.confirmations.archive"),
          cancelLabel: t("workspace.tabs.confirmations.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
      }
      void archiveAgent({ serverId: normalizedServerId, agentId }).catch(() => {});
    },
    [archiveAgent, normalizedServerId, t],
  );

  const handleDeleteAgentFromMenu = useCallback(
    async (agentId: string) => {
      if (!normalizedServerId) return;
      if (!isHistoryDeleteSupported(normalizedServerId)) {
        await alertDialog(resolveHistoryDeleteUnsupportedDialog());
        return;
      }
      const session = useSessionStore.getState().sessions[normalizedServerId];
      const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
      const confirmed = await confirmDialog(resolveDeleteAgentDialog({ title: agent?.title }));
      if (confirmed) {
        void deleteAgent({ serverId: normalizedServerId, agentId }).catch(() => {});
      }
    },
    [deleteAgent, normalizedServerId],
  );

  const handleCloseAgentTab = useCallback(
    async (input: { tabId: string; agentId: string }) => {
      const { tabId, agentId } = input;
      await closeTab(tabId, async () => {
        if (!normalizedServerId) {
          return;
        }

        // Consult both maps: an opened observed subagent is an ephemeral
        // projection that lives in agentDetails (fetched, no projectPlacement),
        // not agents. Reading only `agents` would miss its parentAgentId and
        // wrongly fall through to archive-on-close - cancelling a run the user
        // only meant to close. See docs/agent-lifecycle.md (Item 5).
        const session = useSessionStore.getState().sessions[normalizedServerId];
        const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
        const closePolicy = resolveCloseAgentTabPolicy(agent);
        const isRunning = agent?.status === "running";

        if (closePolicy.kind === "archive-on-close") {
          const choice = await confirmCloseChat({ forcePrompt: isRunning });
          if (choice === "cancel") {
            return;
          }
          if (choice === "delete") {
            if (!isHistoryDeleteSupported(normalizedServerId)) {
              await alertDialog(resolveHistoryDeleteUnsupportedDialog());
              return;
            }
            const deleteConfirmed = await confirmDialog(
              resolveDeleteAgentDialog({ title: agent?.title }),
            );
            if (!deleteConfirmed) {
              return;
            }
            void deleteAgent({ serverId: normalizedServerId, agentId }).catch(() => {});
            setHoveredCloseTabKey((current) => (current === tabId ? null : current));
            if (persistenceKey) {
              closeWorkspaceTabWithCleanup({
                tabId,
                target: { kind: "agent", agentId },
              });
            }
            return;
          }
        }

        setHoveredCloseTabKey((current) => (current === tabId ? null : current));
        if (persistenceKey) {
          closeWorkspaceTabWithCleanup({
            tabId,
            target: { kind: "agent", agentId },
          });
        }

        if (closePolicy.kind === "layout-only") {
          return;
        }

        // Errors (e.g. timeout) are handled by the mutation's onSettled callback
        void archiveAgent({ serverId: normalizedServerId, agentId }).catch(() => {});
      });
    },
    [
      archiveAgent,
      closeTab,
      closeWorkspaceTabWithCleanup,
      deleteAgent,
      normalizedServerId,
      persistenceKey,
    ],
  );

  const handleCloseDraftOrFileTab = useCallback(
    function handleCloseDraftOrFileTab(input: {
      tabId: string;
      target?: WorkspaceTabTarget | null;
    }) {
      setHoveredCloseTabKey((current) => (current === input.tabId ? null : current));
      if (persistenceKey) {
        closeWorkspaceTabWithCleanup({ tabId: input.tabId, target: input.target });
      }
    },
    [closeWorkspaceTabWithCleanup, persistenceKey],
  );

  const handleCloseTabById = useCallback(
    async (tabId: string) => {
      const tab = allTabDescriptorsById.get(tabId);
      if (!tab) {
        return;
      }
      // Panels can veto their own close (e.g. the editor's unsaved-changes
      // guard); terminal/agent closes below keep their dedicated confirms.
      const registration = getPanelRegistration(tab.target.kind);
      if (registration?.confirmClose) {
        const confirmed = await registration.confirmClose(tab.target, {
          serverId: normalizedServerId,
          workspaceId: normalizedWorkspaceId,
          tabId: tab.tabId,
        });
        if (!confirmed) {
          return;
        }
      }
      if (tab.target.kind === "terminal") {
        await handleCloseTerminalTab({ tabId, terminalId: tab.target.terminalId });
        return;
      }
      if (tab.target.kind === "agent") {
        await handleCloseAgentTab({ tabId, agentId: tab.target.agentId });
        return;
      }
      handleCloseDraftOrFileTab({ tabId, target: tab.target });
    },
    [
      allTabDescriptorsById,
      handleCloseAgentTab,
      handleCloseDraftOrFileTab,
      handleCloseTerminalTab,
      normalizedServerId,
      normalizedWorkspaceId,
    ],
  );

  const handleCopyAgentId = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      try {
        await Clipboard.setStringAsync(agentId);
        toast.copied(t("workspace.tabs.toasts.agentIdCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [toast, t],
  );

  const handleCopyFilePath = useCallback(
    async (path: string) => {
      if (!path) return;
      try {
        await Clipboard.setStringAsync(path);
        toast.copied(t("workspace.tabs.toasts.filePathCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [toast, t],
  );

  const handleCopyTerminalId = useCallback(
    async (terminalId: string) => {
      if (!terminalId) return;
      try {
        await Clipboard.setStringAsync(terminalId);
        toast.copied(t("workspace.tabs.toasts.terminalIdCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [t, toast],
  );

  const handleCopyResumeCommand = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      const agent =
        useSessionStore.getState().sessions[normalizedServerId]?.agents?.get(agentId) ?? null;
      const providerSessionId =
        agent?.runtimeInfo?.sessionId ?? agent?.persistence?.sessionId ?? null;
      if (!agent || !providerSessionId) {
        toast.error(t("workspace.tabs.toasts.resumeIdUnavailable"));
        return;
      }

      const command =
        buildProviderCommand({
          provider: agent.provider,
          id: "resume",
          sessionId: providerSessionId,
        }) ?? null;
      if (!command) {
        toast.error(t("workspace.tabs.toasts.resumeCommandUnavailable"));
        return;
      }
      try {
        await Clipboard.setStringAsync(command);
        toast.copied(t("workspace.tabs.toasts.resumeCommandCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [normalizedServerId, toast, t],
  );

  const handleReloadAgent = useCallback(
    async (agentId: string) => {
      if (!client || !isConnected) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }

      toast.show(t("workspace.tabs.toasts.reloadingAgent"), { durationMs: null });
      try {
        await client.refreshAgent(agentId);
        // Send the existing cursor so the server detects the new epoch and
        // returns reset:true. Without a cursor, the server returns reset:false
        // and the client takes the incremental path, where new-epoch rows are
        // dropped against the stale cursor.
        const sessionState = useSessionStore.getState().sessions[normalizedServerId];
        const currentCursor = sessionState?.agentTimelineCursor.get(agentId);
        await client.fetchAgentTimeline(agentId, {
          direction: "tail",
          projection: "projected",
          ...(currentCursor
            ? { cursor: { epoch: currentCursor.epoch, seq: currentCursor.endSeq } }
            : {}),
        });
        toast.show(t("workspace.tabs.toasts.reloadedAgent"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToReloadAgent"),
        );
      }
    },
    [client, isConnected, normalizedServerId, toast, t],
  );

  const handleCopyWorkspacePath = useCallback(async () => {
    if (!workspaceDirectory) {
      toast.error(t("workspace.header.toasts.workspacePathUnavailable"));
      return;
    }

    try {
      await Clipboard.setStringAsync(workspaceDirectory);
      toast.copied(t("workspace.header.toasts.workspacePathCopiedLabel"));
    } catch {
      toast.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [toast, workspaceDirectory, t]);

  const handleCopyBranchName = useCallback(async () => {
    if (!currentBranchName) {
      toast.error(t("workspace.header.toasts.branchNameUnavailable"));
      return;
    }

    try {
      await Clipboard.setStringAsync(currentBranchName);
      toast.copied(t("workspace.header.toasts.branchNameCopiedLabel"));
    } catch {
      toast.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [currentBranchName, toast, t]);

  const handleOpenSetupTab = useCallback(() => {
    if (!persistenceKey) {
      return;
    }
    const target = normalizeWorkspaceTabTarget({
      kind: "setup",
      workspaceId: normalizedWorkspaceId,
    });
    if (!target) {
      return;
    }
    openWorkspaceTabFocused(persistenceKey, target);
  }, [normalizedWorkspaceId, openWorkspaceTabFocused, persistenceKey]);

  const handleOpenContextManagement = useCallback(() => {
    openContextManagementTab({
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
    });
  }, [normalizedServerId, normalizedWorkspaceId]);

  const handleOpenProjectKnowledge = useCallback(() => {
    openProjectKnowledgeTab({
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
    });
  }, [normalizedServerId, normalizedWorkspaceId]);

  const handleBulkCloseTabs = useCallback(
    async (input: { tabsToClose: WorkspaceTabDescriptor[]; title: string; logLabel: string }) => {
      const { tabsToClose, title, logLabel } = input;
      if (tabsToClose.length === 0) {
        return;
      }

      const groups = classifyBulkClosableTabs(tabsToClose);
      const confirmed = await confirmDialog({
        title,
        message: buildBulkCloseConfirmationMessage(groups, bulkCloseConfirmationLabels),
        confirmLabel: t("workspace.tabs.confirmations.close"),
        cancelLabel: t("workspace.tabs.confirmations.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      await closeBulkWorkspaceTabs({
        client,
        groups,
        closeTab,
        closeWorkspaceTabWithCleanup: (cleanupInput) => {
          if (!persistenceKey) {
            return;
          }
          closeWorkspaceTabWithCleanup(cleanupInput);
        },
        logLabel,
        warn: (message, payload) => {
          console.warn(message, payload);
        },
      });

      const closedKeys = new Set(tabsToClose.map((tab) => tab.key));
      setHoveredCloseTabKey((current) => (current && closedKeys.has(current) ? null : current));
    },
    [
      bulkCloseConfirmationLabels,
      client,
      closeTab,
      closeWorkspaceTabWithCleanup,
      persistenceKey,
      t,
    ],
  );

  const handleCloseTabsToLeftInPane = useCallback(
    async (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const index = paneTabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) {
        return;
      }
      await handleBulkCloseTabs({
        tabsToClose: paneTabs.slice(0, index),
        title: t("workspace.tabs.confirmations.closeTabsLeftTitle"),
        logLabel: "to the left",
      });
    },
    [handleBulkCloseTabs, t],
  );

  const handleCloseTabsToLeft = useCallback(
    async (tabId: string) => {
      await handleCloseTabsToLeftInPane(tabId, tabs);
    },
    [handleCloseTabsToLeftInPane, tabs],
  );

  const handleCloseTabsToRightInPane = useCallback(
    async (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const index = paneTabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) {
        return;
      }
      await handleBulkCloseTabs({
        tabsToClose: paneTabs.slice(index + 1),
        title: t("workspace.tabs.confirmations.closeTabsRightTitle"),
        logLabel: "to the right",
      });
    },
    [handleBulkCloseTabs, t],
  );

  const handleCloseTabsToRight = useCallback(
    async (tabId: string) => {
      await handleCloseTabsToRightInPane(tabId, tabs);
    },
    [handleCloseTabsToRightInPane, tabs],
  );

  const handleCloseOtherTabsInPane = useCallback(
    async (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const tabsToClose = paneTabs.filter((tab) => tab.tabId !== tabId);
      await handleBulkCloseTabs({
        tabsToClose,
        title: t("workspace.tabs.confirmations.closeOtherTabsTitle"),
        logLabel: "from close other tabs",
      });
    },
    [handleBulkCloseTabs, t],
  );

  const handleCloseOtherTabs = useCallback(
    async (tabId: string) => {
      await handleCloseOtherTabsInPane(tabId, tabs);
    },
    [handleCloseOtherTabsInPane, tabs],
  );

  // Mobile switcher variants: "close above/below/others" act on the flattened
  // all-panes list (mobileSwitcherTabs), matching what that switcher displays.
  const handleCloseTabsToLeftMobile = useCallback(
    async (tabId: string) => {
      await handleCloseTabsToLeftInPane(tabId, mobileSwitcherTabs);
    },
    [handleCloseTabsToLeftInPane, mobileSwitcherTabs],
  );
  const handleCloseTabsToRightMobile = useCallback(
    async (tabId: string) => {
      await handleCloseTabsToRightInPane(tabId, mobileSwitcherTabs);
    },
    [handleCloseTabsToRightInPane, mobileSwitcherTabs],
  );
  const handleCloseOtherTabsMobile = useCallback(
    async (tabId: string) => {
      await handleCloseOtherTabsInPane(tabId, mobileSwitcherTabs);
    },
    [handleCloseOtherTabsInPane, mobileSwitcherTabs],
  );

  const handleWorkspaceTabAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      switch (action.id) {
        case "workspace.tab.new":
          handleCreateDraftTab();
          return true;
        case "workspace.terminal.new":
          handleCreateTerminal();
          return true;
        case "workspace.tab.close-current":
          if (activeTabId) {
            void handleCloseTabById(activeTabId);
          }
          return true;
        case "workspace.tab.navigate-index": {
          const next = tabs[action.index - 1] ?? null;
          if (next?.tabId) {
            navigateToTabId(next.tabId);
          }
          return true;
        }
        case "workspace.tab.navigate-relative": {
          if (tabs.length > 0) {
            const currentIndex = tabs.findIndex((tab) => tab.tabId === activeTabId);
            const fromIndex = currentIndex >= 0 ? currentIndex : 0;
            const nextIndex = (fromIndex + action.delta + tabs.length) % tabs.length;
            const next = tabs[nextIndex] ?? null;
            if (next?.tabId) {
              navigateToTabId(next.tabId);
            }
          }
          return true;
        }
        default:
          return false;
      }
    },
    [
      activeTabId,
      handleCloseTabById,
      handleCreateDraftTab,
      handleCreateTerminal,
      navigateToTabId,
      tabs,
    ],
  );

  const handleWorkspaceSidebarAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      switch (action.id) {
        case "sidebar.toggle.right":
          handleToggleExplorer();
          return true;
        case "sidebar.open.files":
          // Mod+F means "find" everywhere else in the app, so outside an editor
          // it opens the Files tab AND its filename finder - the tab on its own
          // is a destination, not an answer. Find-in-*project* (text, not
          // names) stays on Mod+Shift+F.
          handleOpenExplorerTab("files");
          requestFileFinderOpen();
          return true;
        case "sidebar.open.search":
          handleOpenExplorerTab("search");
          requestProjectSearchFocus();
          return true;
        case "sidebar.open.changes":
          handleOpenExplorerTab("changes");
          return true;
        default:
          return false;
      }
    },
    [handleOpenExplorerTab, handleToggleExplorer, requestFileFinderOpen, requestProjectSearchFocus],
  );

  const handleWorkspacePaneAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (!persistenceKey || !workspaceLayout) {
        return true;
      }

      const focusedPane = focusedPaneTabState.pane;
      if (!focusedPane) {
        return true;
      }

      if (action.id === "workspace.pane.split.right") {
        handleCreateDraftSplit({
          targetPaneId: focusedPane.id,
          position: "right",
        });
        return true;
      }

      if (action.id === "workspace.pane.split.down") {
        handleCreateDraftSplit({
          targetPaneId: focusedPane.id,
          position: "bottom",
        });
        return true;
      }

      if (action.id.startsWith("workspace.pane.focus.")) {
        const direction = parsePaneDirection(action.id);
        if (direction) {
          const adjacentPaneId = findAdjacentPane(workspaceLayout.root, focusedPane.id, direction);
          if (adjacentPaneId) {
            focusWorkspacePane(persistenceKey, adjacentPaneId);
          }
        }
        return true;
      }

      if (action.id.startsWith("workspace.pane.move-tab.")) {
        const direction = parsePaneDirection(action.id);
        if (direction) {
          const activePaneTabId = focusedPaneTabState.activeTabId;
          const adjacentPaneId = findAdjacentPane(workspaceLayout.root, focusedPane.id, direction);
          if (activePaneTabId && adjacentPaneId) {
            paneFocusSuppressedRef.current = true;
            moveWorkspaceTabToPane(persistenceKey, activePaneTabId, adjacentPaneId);
            requestAnimationFrame(() => {
              paneFocusSuppressedRef.current = false;
            });
          }
        }
        return true;
      }

      if (action.id === "workspace.pane.close") {
        for (const tabId of focusedPane.tabIds) {
          closeWorkspaceTabWithCleanup({
            tabId,
            target: allTabDescriptorsById.get(tabId)?.target ?? null,
          });
        }
        return true;
      }

      return false;
    },
    [
      allTabDescriptorsById,
      closeWorkspaceTabWithCleanup,
      focusWorkspacePane,
      handleCreateDraftSplit,
      moveWorkspaceTabToPane,
      persistenceKey,
      focusedPaneTabState.activeTabId,
      focusedPaneTabState.pane,
      workspaceLayout,
    ],
  );

  useKeyboardActionHandler({
    handlerId: `workspace-tab-actions:${normalizedServerId}:${normalizedWorkspaceId}`,
    actions: [
      "workspace.tab.new",
      "workspace.tab.close-current",
      "workspace.tab.navigate-index",
      "workspace.tab.navigate-relative",
      "workspace.terminal.new",
    ] as const,
    enabled: Boolean(isRouteFocused && normalizedServerId && normalizedWorkspaceId),
    priority: 100,
    isActive: () => true,
    handle: handleWorkspaceTabAction,
  });

  useKeyboardActionHandler({
    handlerId: `workspace-pane-actions:${normalizedServerId}:${normalizedWorkspaceId}`,
    actions: [
      "workspace.pane.split.right",
      "workspace.pane.split.down",
      "workspace.pane.focus.left",
      "workspace.pane.focus.right",
      "workspace.pane.focus.up",
      "workspace.pane.focus.down",
      "workspace.pane.move-tab.left",
      "workspace.pane.move-tab.right",
      "workspace.pane.move-tab.up",
      "workspace.pane.move-tab.down",
      "workspace.pane.close",
    ] as const,
    enabled: Boolean(isRouteFocused && normalizedServerId && normalizedWorkspaceId),
    priority: 100,
    isActive: () => true,
    handle: handleWorkspacePaneAction,
  });

  useKeyboardActionHandler({
    handlerId: `workspace-sidebar-actions:${normalizedServerId}:${normalizedWorkspaceId}`,
    actions: [
      "sidebar.toggle.right",
      "sidebar.open.files",
      "sidebar.open.search",
      "sidebar.open.changes",
    ] as const,
    enabled: Boolean(isRouteFocused && normalizedServerId && normalizedWorkspaceId),
    priority: 100,
    isActive: () => true,
    handle: handleWorkspaceSidebarAction,
  });

  const activeTabDescriptor = useMemo(() => activeTab?.descriptor ?? null, [activeTab]);
  const activeFileFields = getWorkspaceFileLocationFields(activeTabDescriptor);
  const activeFilePath = activeFileFields.path;
  const activeFileLineStart = activeFileFields.lineStart;
  const activeFileLineEnd = activeFileFields.lineEnd;
  const activeFileLocation = useMemo<WorkspaceFileLocation | null>(
    () =>
      buildWorkspaceFileLocation({
        path: activeFilePath,
        lineStart: activeFileLineStart,
        lineEnd: activeFileLineEnd,
      }),
    [activeFileLineEnd, activeFileLineStart, activeFilePath],
  );
  const canRenderDesktopPaneSplits = supportsDesktopPaneSplits();
  const shouldRenderDesktopPaneFallback = useMemo(
    () => !isMobile && !canRenderDesktopPaneSplits,
    [isMobile, canRenderDesktopPaneSplits],
  );
  useEffect(() => {
    if (!isRouteFocused || isNative || typeof document === "undefined" || activeTabDescriptor) {
      return;
    }
    document.title = "Workspace";
  }, [activeTabDescriptor, isRouteFocused]);
  const buildPaneContentModel = useCallback(
    (input: {
      tab: WorkspaceTabDescriptor;
      paneId?: string | null;
      focusPaneBeforeOpen?: boolean;
    }) =>
      buildWorkspacePaneContentModel({
        tab: input.tab,
        normalizedServerId,
        normalizedWorkspaceId,
        onOpenTab: (target) => {
          if (!persistenceKey) {
            return;
          }
          if (input.focusPaneBeforeOpen && input.paneId) {
            focusWorkspacePane(persistenceKey, input.paneId);
          }
          const tabId = openWorkspaceChildTabFocused(persistenceKey, target, input.tab.tabId);
          if (tabId) {
            navigateToTabId(tabId);
          }
        },
        onCloseCurrentTab: () => {
          void handleCloseTabById(input.tab.tabId);
        },
        onRetargetCurrentTab: (target) => {
          if (!persistenceKey) {
            return;
          }
          retargetWorkspaceTab(persistenceKey, input.tab.tabId, target);
        },
        onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => {
          handleOpenWorkspaceFileFromPane({
            request,
            paneId: input.paneId,
            parentTabId: input.tab.tabId,
            focusPaneBeforeOpen: input.focusPaneBeforeOpen,
          });
        },
        onOpenImportSheet: () => {
          openImportSheet(input.tab.tabId);
        },
      }),
    [
      handleCloseTabById,
      focusWorkspacePane,
      handleOpenWorkspaceFileFromPane,
      navigateToTabId,
      normalizedServerId,
      normalizedWorkspaceId,
      openImportSheet,
      openWorkspaceChildTabFocused,
      persistenceKey,
      retargetWorkspaceTab,
    ],
  );
  const focusedPaneId = useMemo(
    () => focusedPaneTabState.pane?.id ?? null,
    [focusedPaneTabState.pane],
  );
  const focusedPaneTabIds = useMemo(() => tabs.map((tab) => tab.tabId), [tabs]);
  const focusedPaneTabDescriptorMap = useStableTabDescriptorMap(tabs);
  const { mountedTabIds: mountedFocusedPaneTabIdsSet } = useMountedTabSet({
    activeTabId,
    allTabIds: focusedPaneTabIds,
    cap: mountedTabLimit,
  });
  const mountedFocusedPaneTabIds = useMemo(
    () => focusedPaneTabIds.filter((tabId) => mountedFocusedPaneTabIdsSet.has(tabId)),
    [focusedPaneTabIds, mountedFocusedPaneTabIdsSet],
  );
  const buildMobilePaneContentModel = useCallback(
    function buildMobilePaneContentModel(input: {
      paneId: string | null;
      tab: WorkspaceTabDescriptor;
    }) {
      return buildPaneContentModel({
        tab: input.tab,
        paneId: input.paneId,
        focusPaneBeforeOpen: false,
      });
    },
    [buildPaneContentModel],
  );
  const content = renderWorkspaceContent({
    isMissingWorkspaceDirectory,
    activeTabDescriptor,
    hasHydratedAgents,
    mountedFocusedPaneTabIds,
    focusedPaneTabDescriptorMap,
    isRouteFocused,
    focusedPaneId,
    buildMobilePaneContentModel,
  });

  const buildDesktopPaneContentModel = useCallback(
    function buildDesktopPaneContentModel(input: { paneId: string; tab: WorkspaceTabDescriptor }) {
      return buildPaneContentModel({
        tab: input.tab,
        paneId: input.paneId,
        focusPaneBeforeOpen: true,
      });
    },
    [buildPaneContentModel],
  );

  const desktopTabRowItems = useMemo<WorkspaceDesktopTabRowItem[]>(
    () =>
      tabs.map((tab) => ({
        tab,
        isActive: tab.tabId === activeTabDescriptor?.tabId,
        isCloseHovered: hoveredCloseTabKey === tab.key,
        isClosingTab: closingTabIds.has(tab.tabId),
      })),
    [activeTabDescriptor?.tabId, closingTabIds, hoveredCloseTabKey, tabs],
  );

  const handleFocusPane = useStableEvent(function handleFocusPane(paneId: string) {
    if (!persistenceKey || paneFocusSuppressedRef.current) {
      return;
    }
    focusWorkspacePane(persistenceKey, paneId);
  });

  const handleSplitPane = useCallback(
    function handleSplitPane(input: {
      tabId: string;
      targetPaneId: string;
      position: "left" | "right" | "top" | "bottom";
    }) {
      if (!persistenceKey) {
        return;
      }
      splitWorkspacePane(persistenceKey, input);
    },
    [persistenceKey, splitWorkspacePane],
  );

  const handleMoveTabToPane = useCallback(
    function handleMoveTabToPane(tabId: string, toPaneId: string) {
      if (!persistenceKey) {
        return;
      }
      moveWorkspaceTabToPane(persistenceKey, tabId, toPaneId);
    },
    [moveWorkspaceTabToPane, persistenceKey],
  );

  const handleResizePaneSplit = useCallback(
    function handleResizePaneSplit(groupId: string, sizes: number[]) {
      if (!persistenceKey) {
        return;
      }
      resizeWorkspaceSplit(persistenceKey, groupId, sizes);
    },
    [persistenceKey, resizeWorkspaceSplit],
  );

  const handleReorderTabsInPane = useCallback(
    function handleReorderTabsInPane(paneId: string, tabIds: string[]) {
      if (!persistenceKey) {
        return;
      }
      reorderWorkspaceTabsInPane(persistenceKey, paneId, tabIds);
    },
    [persistenceKey, reorderWorkspaceTabsInPane],
  );

  const handleReorderTabsInFocusedPane = useCallback(
    (nextTabs: WorkspaceTabDescriptor[]) => {
      if (!focusedPaneId) {
        return;
      }
      handleReorderTabsInPane(
        focusedPaneId,
        nextTabs.map((tab) => tab.tabId),
      );
    },
    [focusedPaneId, handleReorderTabsInPane],
  );

  const renderSplitPaneEmptyState = useCallback(
    function renderSplitPaneEmptyState() {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>{t("workspace.tabs.emptyPane")}</Text>
        </View>
      );
    },
    [t],
  );

  const containerStyle = containerWithWorkspaceBackgroundStyle;

  const menuNewAgentIcon = MENU_NEW_AGENT_ICON;
  const menuNewTerminalIcon = MENU_NEW_TERMINAL_ICON;
  const menuCopyIcon = MENU_COPY_ICON;
  const menuSettingsIcon = MENU_SETTINGS_ICON;
  const workspaceScreenGate = renderWorkspaceRouteGate({
    state: workspaceRouteState,
    actions: {
      onRetryHost: handleRetryHost,
      onManageHost: handleManageHost,
      onDismissMissingWorkspace: handleDismissMissingWorkspace,
      onRecoverWorkspace: handleRecoverWorkspace,
      onRetryRecoveryInspection: handleRetryRecoveryInspection,
    },
  });
  const gatedWorkspaceScreen = renderWorkspaceScreenGateShell({
    gate: workspaceScreenGate,
    workspaceKey: persistenceKey,
  });

  const headerRight = useMemo(
    () => (
      <View style={styles.headerRight}>
        {/* Appearance-relocated Active Team switcher: first in the tools
            cluster, before every other tool (renders null unless the setting
            moved it here). */}
        {!isMobile ? <HeaderActiveTeamSwitchers /> : null}
        {/* Everything below is developer-only; User mode keeps just the team
            switcher above. Presentation only (see interface-modes.md). */}
        {isDeveloperMode ? (
          <>
            {!isMobile &&
            workspaceDescriptor &&
            workspaceDescriptor.scripts.length > 0 &&
            settings.workspaceToolsPlacement !== "workspaceList" ? (
              <WorkspaceScriptsButton
                serverId={normalizedServerId}
                workspaceId={normalizedWorkspaceId}
                scripts={workspaceDescriptor.scripts}
                liveTerminalIds={liveTerminalIds}
                onScriptTerminalStarted={handleScriptTerminalStarted}
                onViewTerminal={handleViewScriptTerminal}
                onOpenUrlInBrowserTab={handleOpenUrlInBrowserTab}
                // Labelled like the Git actions split button beside it. An
                // unlabelled Play glyph in a row of glyphs is how "Run Scripts"
                // got lost in the title bar; it only drops its label when the
                // header is too narrow to spell it out.
                hideLabels={showCompactButtonLabels}
              />
            ) : null}
            {!isMobile &&
            workspaceDirectory &&
            settings.workspaceToolsPlacement !== "workspaceList" ? (
              <WorkspaceOpenInEditorButton
                serverId={normalizedServerId}
                cwd={workspaceDirectory}
                activeFile={activeFileLocation}
                hideLabels
              />
            ) : null}
            {!isMobile && workspaceDirectory ? (
              <>
                {workspaceDirectory && settings.workspaceToolsPlacement !== "workspaceList" ? (
                  <WorkspaceActions
                    serverId={normalizedServerId}
                    cwd={workspaceDirectory}
                    hideLabels={showCompactButtonLabels}
                  />
                ) : null}
                {isGitCheckout ? (
                  <GitCheckoutExplorerToggle
                    anchorRef={explorerToggleAnchorRef}
                    onPress={handleToggleExplorer}
                    accessibilityLabel={explorerToggleLabel}
                    accessibilityState={explorerToggleAccessibilityState}
                    style={explorerToggleStyle}
                    isExplorerOpen={isExplorerOpen}
                    diffStat={workspaceDescriptor?.diffStat}
                    showDiffStat={showExplorerDiffStat}
                  />
                ) : null}
              </>
            ) : null}
            {!isMobile && !isGitCheckout ? (
              <HeaderToggleButton
                anchorRef={explorerToggleAnchorRef}
                testID="workspace-explorer-toggle"
                onPress={handleToggleExplorer}
                tooltipLabel={t("workspace.tabs.explorer.toggle")}
                tooltipKeys={explorerToggleKeys}
                tooltipSide="bottom"
                style={styles.compactHeaderActionButton}
                active={isExplorerOpen}
                shortcutDiscoveryAction="sidebar.toggle.right"
                accessible
                accessibilityRole="button"
                accessibilityLabel={explorerToggleLabel}
                accessibilityState={explorerToggleAccessibilityState}
              >
                {({ hovered }) => {
                  if (isExplorerOpen) {
                    return <ThemedExplore uniProps={accentMdMapping} />;
                  }
                  return (
                    <ThemedExplore uniProps={hovered ? foregroundMdMapping : mutedMdMapping} />
                  );
                }}
              </HeaderToggleButton>
            ) : null}
            {headerActionFit.showCompactExplorer ? (
              <HeaderToggleButton
                anchorRef={explorerToggleAnchorRef}
                testID="workspace-explorer-toggle"
                onPress={handleToggleExplorer}
                tooltipLabel={t("workspace.tabs.explorer.toggle")}
                tooltipKeys={explorerToggleKeys}
                tooltipSide="bottom"
                active={isExplorerOpen}
                shortcutDiscoveryAction="sidebar.toggle.right"
                accessible
                accessibilityRole="button"
                accessibilityLabel={explorerToggleLabel}
                accessibilityState={explorerToggleAccessibilityState}
                style={headerIconSlotStyle.compactSlot}
              >
                {({ hovered }) => {
                  if (isExplorerOpen) {
                    return (
                      <ThemedExplore size={headerActionIconSize.lg} uniProps={accentColorMapping} />
                    );
                  }
                  return (
                    <ThemedExplore
                      size={headerActionIconSize.lg}
                      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
                    />
                  );
                }}
              </HeaderToggleButton>
            ) : null}
          </>
        ) : (
          <>
            {/* User interface mode: a plain Explore toggle for the Files-only
                explorer (no git-aware diff badge). Desktop + mobile. */}
            {headerActionFit.showPlainExplorer ? (
              <PlainExplorerToggle
                isMobile={isMobile}
                anchorRef={explorerToggleAnchorRef}
                onPress={handleToggleExplorer}
                isExplorerOpen={isExplorerOpen}
                accessibilityLabel={explorerToggleLabel}
                accessibilityState={explorerToggleAccessibilityState}
              />
            ) : null}
          </>
        )}
      </View>
    ),
    [
      isMobile,
      isDeveloperMode,
      workspaceDescriptor,
      normalizedServerId,
      normalizedWorkspaceId,
      workspaceDirectory,
      activeFileLocation,
      liveTerminalIds,
      handleScriptTerminalStarted,
      handleViewScriptTerminal,
      handleOpenUrlInBrowserTab,
      showCompactButtonLabels,
      isGitCheckout,
      handleToggleExplorer,
      explorerToggleAnchorRef,
      explorerToggleKeys,
      isExplorerOpen,
      explorerToggleLabel,
      explorerToggleAccessibilityState,
      explorerToggleStyle,
      showExplorerDiffStat,
      headerActionFit.showCompactExplorer,
      headerActionFit.showPlainExplorer,
      settings.workspaceToolsPlacement,
      headerActionIconSize.lg,
      t,
    ],
  );

  const showScreenHeader = useMemo(
    () => shouldShowWorkspaceScreenHeader({ isFocusModeEnabled, isMobile }),
    [isFocusModeEnabled, isMobile],
  );
  const showExplorerSidebar = useMemo(
    () =>
      shouldShowWorkspaceExplorerSidebar({
        isRouteFocused,
        isFocusModeEnabled,
        isMobile,
      }),
    [isRouteFocused, isFocusModeEnabled, isMobile],
  );

  // Drive the window-controls overlay color from the explorer sidebar's actual
  // painted state (same gate as its render below) instead of predicting from
  // route + open flag, so the chrome stays on the default surface through the
  // workspace load pause and flips to the sidebar surface only when the sidebar
  // appears.
  usePublishExplorerSidebarVisibility({
    showExplorerSidebar,
    workspaceDirectory,
    explorerOpen: isExplorerOpen,
  });
  // In focus mode the header is hidden and the desktop tab row becomes the top
  // strip under the native window controls - publish that so the caption strip
  // color follows the tab-row gutter (surfaceSidebar) rather than surface0.
  usePublishFocusModeTabStripVisibility({
    isFocusModeEnabled,
    isCompact: isMobile,
  });
  const createTerminalDisabled = useMemo(
    () => createTerminalMutation.isPending || pendingTerminalCreateInput !== null,
    [createTerminalMutation.isPending, pendingTerminalCreateInput],
  );
  const showCreateBrowserTab = getIsElectron();
  const focusedPaneIdOrUndefined = useMemo(() => focusedPaneId ?? undefined, [focusedPaneId]);
  // The non-split desktop fallback (shouldRenderDesktopPaneFallback, below)
  // still resolves and persists a per-pane orientation override so the
  // preference survives a later move to a pane-split-capable surface, even
  // though this narrow fallback always renders the horizontal row.
  const fallbackTabOrientation = useMemo(
    () =>
      (focusedPaneId && workspaceLayout
        ? findPaneById(workspaceLayout.root, focusedPaneId)?.tabOrientation
        : undefined) ?? settings.defaultTabOrientation,
    [focusedPaneId, settings.defaultTabOrientation, workspaceLayout],
  );
  const handleToggleFallbackTabOrientation = useCallback(() => {
    if (!persistenceKey || !focusedPaneId) {
      return;
    }
    useWorkspaceLayoutStore
      .getState()
      .setPaneTabOrientation(
        persistenceKey,
        focusedPaneId,
        fallbackTabOrientation === "vertical" ? "horizontal" : "vertical",
      );
  }, [fallbackTabOrientation, focusedPaneId, persistenceKey]);
  const workspaceFloatingPanelPortalHostName = useMemo(
    () =>
      `${WORKSPACE_FLOATING_PANEL_PORTAL_HOST_PREFIX}:${normalizedServerId}:${normalizedWorkspaceId}`,
    [normalizedServerId, normalizedWorkspaceId],
  );
  const desktopSplitContent = useMemo(() => {
    if (!canRenderDesktopPaneSplits || !workspaceLayout || !persistenceKey) {
      return null;
    }
    return (
      <SplitContainer
        layout={workspaceLayout}
        workspaceKey={persistenceKey}
        normalizedServerId={normalizedServerId}
        normalizedWorkspaceId={normalizedWorkspaceId}
        isWorkspaceFocused={isRouteFocused}
        uiTabs={visibleUiTabs}
        hoveredCloseTabKey={hoveredCloseTabKey}
        setHoveredCloseTabKey={setHoveredCloseTabKey}
        closingTabIds={closingTabIds}
        onNavigateTab={navigateToTabId}
        onCloseTab={handleCloseTabById}
        onCopyResumeCommand={handleCopyResumeCommand}
        onCopyTerminalId={handleCopyTerminalId}
        onCopyAgentId={handleCopyAgentId}
        onCopyFilePath={handleCopyFilePath}
        onReloadAgent={handleReloadAgent}
        onRenameTab={handleRenameTab}
        onCloseTabsToLeft={handleCloseTabsToLeftInPane}
        onCloseTabsToRight={handleCloseTabsToRightInPane}
        onCloseOtherTabs={handleCloseOtherTabsInPane}
        onCreateDraftTab={handleCreateDraftTab}
        onCreateTerminalTab={handleCreateTerminal}
        onCreateBrowserTab={handleCreateBrowserTab}
        showCreateBrowserTab={showCreateBrowserTab}
        buildPaneContentModel={buildDesktopPaneContentModel}
        onFocusPane={handleFocusPane}
        onSplitPane={handleSplitPane}
        onSplitPaneEmpty={handleCreateDraftSplit}
        onMoveTabToPane={handleMoveTabToPane}
        onResizeSplit={handleResizePaneSplit}
        onReorderTabsInPane={handleReorderTabsInPane}
        renderPaneEmptyState={renderSplitPaneEmptyState}
      />
    );
  }, [
    canRenderDesktopPaneSplits,
    workspaceLayout,
    persistenceKey,
    normalizedServerId,
    normalizedWorkspaceId,
    isRouteFocused,
    handleCopyTerminalId,
    visibleUiTabs,
    hoveredCloseTabKey,
    closingTabIds,
    navigateToTabId,
    handleCloseTabById,
    handleCopyResumeCommand,
    handleCopyAgentId,
    handleCopyFilePath,
    handleReloadAgent,
    handleRenameTab,
    handleCloseTabsToLeftInPane,
    handleCloseTabsToRightInPane,
    handleCloseOtherTabsInPane,
    handleCreateDraftTab,
    handleCreateTerminal,
    handleCreateBrowserTab,
    showCreateBrowserTab,
    buildDesktopPaneContentModel,
    handleFocusPane,
    handleSplitPane,
    handleCreateDraftSplit,
    handleMoveTabToPane,
    handleResizePaneSplit,
    handleReorderTabsInPane,
    renderSplitPaneEmptyState,
  ]);
  const desktopContent = desktopSplitContent ?? content;

  const workspaceCenterColumn = (
    <View style={styles.centerColumn}>
      {showScreenHeader && (
        <ScreenHeader
          onRowLayout={onHeaderLayout}
          left={
            <>
              <SidebarMenuToggle />
              <WorkspaceHeaderTitleBar
                isLoading={isWorkspaceHeaderLoading}
                title={workspaceHeaderTitle}
                subtitle={workspaceHeaderSubtitle}
                showSubtitle={shouldShowWorkspaceHeaderSubtitle}
                currentBranchName={currentBranchName}
                normalizedServerId={normalizedServerId}
                normalizedWorkspaceId={normalizedWorkspaceId}
                activeChatAttachmentScopeKey={getActiveChatAttachmentScopeKey(activeTabDescriptor)}
                workspaceScripts={workspaceScripts}
                liveTerminalIds={liveTerminalIds}
                showWorkspaceSetup={showWorkspaceSetup}
                showCreateBrowserTab={showCreateBrowserTab}
                isMobile={isMobile}
                showVisualizerAction={headerActionFit.showVisualizer}
                showVoiceCuesAction={headerActionFit.showVoiceCues}
                showPlayAction={headerActionFit.showPlay}
                microphoneAvailable={microphoneAvailable}
                showBrainAction={showBrainAction}
                showVisualizerMenuItem={headerActionFit.menuVisualizer}
                showVoiceCuesMenuItem={headerActionFit.menuVoiceCues}
                showExplorerMenuItem={headerActionFit.menuExplorer}
                showScriptsMenuItem={headerActionFit.menuPlay}
                onToggleExplorer={handleToggleExplorer}
                createTerminalDisabled={createTerminalDisabled}
                importAgentDisabled={!canOpenImportSheet}
                copyPathDisabled={!workspaceDirectory}
                menuNewAgentIcon={menuNewAgentIcon}
                menuNewTerminalIcon={menuNewTerminalIcon}
                menuNewBrowserIcon={MENU_NEW_BROWSER_ICON}
                menuImportIcon={MENU_IMPORT_ICON}
                menuCopyIcon={menuCopyIcon}
                menuSettingsIcon={menuSettingsIcon}
                onCreateDraftTab={handleCreateDraftTab}
                onCreateTerminal={handleCreateTerminal}
                onCreateTerminalWithProfile={handleCreateTerminalWithProfile}
                onCreateBrowser={handleCreateBrowserTab}
                onOpenImportSheet={openImportSheet}
                onCopyWorkspacePath={handleCopyWorkspacePath}
                onCopyBranchName={handleCopyBranchName}
                onOpenSetupTab={handleOpenSetupTab}
                onOpenContextManagement={handleOpenContextManagement}
                onOpenProjectKnowledge={handleOpenProjectKnowledge}
                onScriptTerminalStarted={handleScriptTerminalStarted}
                onViewScriptTerminal={handleViewScriptTerminal}
                onOpenUrlInBrowserTab={handleOpenUrlInBrowserTab}
              />
            </>
          }
          right={headerRight}
        />
      )}

      {isMobile ? (
        <MobileWorkspaceTabSwitcher
          tabs={mobileSwitcherTabs}
          activeTabKey={activeTabKey}
          activeTab={activeTabDescriptor}
          tabSwitcherOptions={mobileTabSwitcherOptions}
          tabByKey={mobileTabByKey}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          onSelectSwitcherTab={handleSelectSwitcherTab}
          onCopyResumeCommand={handleCopyResumeCommand}
          onCopyTerminalId={handleCopyTerminalId}
          onCopyAgentId={handleCopyAgentId}
          onCopyFilePath={handleCopyFilePath}
          onReloadAgent={handleReloadAgent}
          onRenameTab={handleRenameTab}
          onCloseTab={handleCloseTabById}
          onCloseTabsAbove={handleCloseTabsToLeftMobile}
          onCloseTabsBelow={handleCloseTabsToRightMobile}
          onCloseOtherTabs={handleCloseOtherTabsMobile}
          onArchiveAgent={handleArchiveAgentFromMenu}
          onDeleteAgent={handleDeleteAgentFromMenu}
        />
      ) : null}

      {shouldRenderDesktopPaneFallback ? (
        <WorkspaceDesktopTabsRow
          paneId={focusedPaneIdOrUndefined}
          isFocused={isRouteFocused}
          tabs={desktopTabRowItems}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          onNavigateTab={navigateToTabId}
          onCloseTab={handleCloseTabById}
          onCopyResumeCommand={handleCopyResumeCommand}
          onCopyTerminalId={handleCopyTerminalId}
          onCopyAgentId={handleCopyAgentId}
          onCopyFilePath={handleCopyFilePath}
          onReloadAgent={handleReloadAgent}
          onRenameTab={handleRenameTab}
          onCloseTabsToLeft={handleCloseTabsToLeft}
          onCloseTabsToRight={handleCloseTabsToRight}
          onCloseOtherTabs={handleCloseOtherTabs}
          onArchiveAgent={handleArchiveAgentFromMenu}
          onDeleteAgent={handleDeleteAgentFromMenu}
          onCreateDraftTab={handleCreateDraftTab}
          onCreateTerminalTab={handleCreateTerminal}
          onCreateBrowserTab={handleCreateBrowserTab}
          showCreateBrowserTab={showCreateBrowserTab}
          disableCreateTerminal={createTerminalMutation.isPending}
          isWaitingOnTerminalReadiness={pendingTerminalCreateInput !== null}
          onReorderTabs={handleReorderTabsInFocusedPane}
          onSplitRight={noop}
          onSplitDown={noop}
          showPaneSplitActions={false}
          tabOrientation={fallbackTabOrientation}
          onToggleTabOrientation={handleToggleFallbackTabOrientation}
        />
      ) : null}

      <WakeWordEmptyStateListener
        normalizedServerId={normalizedServerId}
        normalizedWorkspaceId={normalizedWorkspaceId}
        isRouteFocused={isRouteFocused}
        hasActiveTab={Boolean(activeTabDescriptor)}
        hasHydratedAgents={hasHydratedAgents}
        wakeWordEnabled={settings.wakeWordEnabled}
        wakeWordListeningPaused={settings.wakeWordListeningPaused}
        wakeWordPhrase={settings.wakeWordPhrase}
        wakeWordSensitivity={settings.wakeWordSensitivity}
        wakeWordSilenceTimeoutMs={settings.wakeWordSilenceTimeoutMs}
        wakeWordAutoSend={settings.wakeWordAutoSend}
        openWorkspaceDraftTab={openWorkspaceDraftTab}
        onError={handleWakeWordEmptyStateError}
      />

      <WorkspaceCenterContent
        serverId={normalizedServerId}
        workspaceId={normalizedWorkspaceId}
        isRouteFocused={isRouteFocused}
        onOpenPipFile={handleOpenWorkspaceFileFromPip}
      >
        {isMobile ? (
          <View style={styles.content}>{content}</View>
        ) : (
          <View style={styles.content}>{desktopContent}</View>
        )}
      </WorkspaceCenterContent>
    </View>
  );

  return (
    gatedWorkspaceScreen ?? (
      <WorkspaceFocusProvider workspaceKey={persistenceKey}>
        <RenderProfile id="WorkspaceScreenContent">
          <View style={containerStyle}>
            <WorkspaceDocumentTitleEffectSlot
              tab={activeTabDescriptor}
              serverId={normalizedServerId}
              workspaceId={normalizedWorkspaceId}
              isRouteFocused={isRouteFocused}
            />
            <View style={styles.threePaneRow}>
              <FloatingPanelPortalHostNameProvider hostName={workspaceFloatingPanelPortalHostName}>
                {workspaceCenterColumn}
              </FloatingPanelPortalHostNameProvider>

              <FloatingPanelPortalHost name={workspaceFloatingPanelPortalHostName} />

              {showExplorerSidebar && workspaceDirectory ? (
                <ExplorerSidebar
                  serverId={normalizedServerId}
                  workspaceId={normalizedWorkspaceId}
                  workspaceRoot={workspaceDirectory}
                  isGit={isGitCheckout}
                  onOpenFile={handleOpenFileFromExplorer}
                />
              ) : null}
            </View>
            <ImportSessionSheet
              visible={isImportSheetVisible}
              client={client}
              serverId={normalizedServerId}
              cwd={workspaceDirectory}
              workspaceId={normalizedWorkspaceId}
              onClose={closeImportSheet}
              onImportedAgent={handleImportedAgent}
            />
            <WorkspaceTabRenameModal
              renamingTab={renamingTab}
              onSubmit={handleRenameModalSubmit}
              onClose={handleRenameModalClose}
            />
            <MoveChatToWorkspaceHost />
          </View>
        </RenderProfile>
      </WorkspaceFocusProvider>
    )
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  containerWorkspaceBackground: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  threePaneRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "stretch",
  },
  centerColumn: {
    flex: 1,
    minHeight: 0,
  },
  headerTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: {
      xs: "400",
      md: "300",
    },
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  headerTitleContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: theme.spacing[1],
      md: theme.spacing[2],
    },
    overflow: "hidden",
  },
  headerTitleTextGroup: {
    // Compact floors the project/workspace labels so the action strip can never
    // squeeze them out entirely - `fitCompactHeaderActions` reserves the same
    // width when deciding which buttons still fit.
    minWidth: {
      xs: MIN_TITLE_WIDTH,
      md: 0,
    },
    overflow: "hidden",
    flexShrink: 1,
    flexGrow: 1,
    flexDirection: {
      xs: "column",
      md: "row",
    },
    alignItems: {
      xs: "flex-start",
      md: "center",
    },
    justifyContent: "flex-start",
    gap: {
      xs: 0,
      md: theme.spacing[2],
    },
  },
  headerProjectTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm,
      md: theme.fontSize.base,
    },
    flexShrink: 1,
    minWidth: 0,
  },
  headerTitleSkeleton: {
    width: 220,
    maxWidth: "100%",
    height: 22,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.25,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: theme.spacing[1],
      md: theme.spacing[2],
    },
  },
  headerActionButton: {
    // Reserve the focus border in the resting geometry. Reducing the padding
    // by the same pixel keeps this title-bar control's outer size unchanged.
    paddingVertical: compactUp(theme.spacing[2] - 1),
    paddingHorizontal: compactUp(theme.spacing[2] - 1),
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  // Hover and selection colors are shared with `headerIconSlotStyle` - see the
  // comments there, and the token derivations in `theme.ts`.
  headerActionButtonHovered: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  headerActionButtonActive: {
    backgroundColor: theme.colors.surfaceToggleSelected,
  },
  headerActionButtonFocused: {
    borderColor: theme.colors.accent,
  },
  teamChatPopup: {
    gap: 0,
    paddingTop: theme.spacing[2],
  },
  teamChatPopupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  teamChatPopupHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  teamChatPopupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  teamChatPresenceTrigger: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  teamChatPresenceText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  teamChatPresenceOptions: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  teamChatPresenceOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
  },
  teamChatPresenceOptionDisabled: {
    opacity: 0.45,
  },
  teamChatPresenceOptionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  teamChatPresenceOptionTextDisabled: {
    color: theme.colors.foregroundMuted,
  },
  teamChatPresenceCooldown: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  teamChatSearchResults: {
    paddingTop: theme.spacing[1],
  },
  teamChatSearchLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  teamChatSearchStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  teamChatSearchError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  teamChatSearchGroup: {
    paddingBottom: theme.spacing[1],
  },
  teamChatSearchGroupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  teamChatSearchResult: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  teamChatSearchResultPrimary: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  teamChatSearchAvatar: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.full,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  teamChatSearchAvatarText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  teamChatSearchConversationIcon: {
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  teamChatSearchConversationIconGlyph: {
    color: theme.colors.foregroundMuted,
  },
  teamChatSearchResultCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  teamChatSearchResultTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
  teamChatSearchResultDetailRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
    minWidth: 0,
  },
  teamChatSearchResultDetail: {
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
  },
  teamChatFavoriteButton: {
    alignItems: "center",
    borderRadius: theme.borderRadius.sm,
    height: 32,
    justifyContent: "center",
    marginLeft: theme.spacing[2],
    width: 32,
  },
  teamChatFavoriteButtonDisabled: {
    opacity: 0.45,
  },
  teamChatFavoriteErrorCallout: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[1],
  },
  teamChatHomeConversation: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  teamChatHomeConversationPrimary: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  teamChatPresenceDot: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  teamChatPresenceDotSuccess: {
    backgroundColor: theme.colors.statusSuccess,
  },
  teamChatPresenceDotDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  teamChatPresenceDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  teamChatPresenceDndBar: {
    width: "56%",
    height: 2,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  teamChatPresenceErrorCallout: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.statusDangerSurface,
  },
  teamChatPresenceError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  teamChatEmpty: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
  },
  teamChatEmptyText: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  },
  // Fixed touch-target box for the mobile "..." trigger - doubled alongside the
  // icon it wraps (`theme.iconSize.md`/`.lg`) so the icon keeps breathing room
  // instead of filling the box edge-to-edge once it doubles in compact mode.
  compactHeaderActionButton: {
    width: compactUp(theme.spacing[8]),
    height: compactUp(theme.spacing[8]),
    padding: 0,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  compactHeaderMenuCluster: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    // On desktop every chrome boundary in the header series is separated by the
    // standard `spacing[2]` gap (matching the `left`/`right`/headerRight
    // containers). This cluster sits flush against headerRight, which lives in a
    // different container, so no shared container-gap spans that seam - the
    // trailing padding supplies that one standard gap itself. Compact drops it:
    // the "..."/Visualizer/Play/Explorer run is a single flush strip there, so
    // the doubled touch targets fit without crowding the title.
    paddingRight: {
      xs: 0,
      md: theme.spacing[2],
    },
    gap: {
      xs: 0,
      md: theme.spacing[2],
    },
  },
  sourceControlButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: theme.spacing[8],
    height: theme.spacing[8],
    borderRadius: theme.borderRadius.lg,
  },
  sourceControlButtonWithStats: {
    width: undefined,
    paddingHorizontal: theme.spacing[2],
  },
  sourceControlButtonHovered: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  sourceControlButtonActive: {
    backgroundColor: theme.colors.surfaceToggleSelected,
  },
  sourceControlDiffStat: {
    paddingLeft: 5,
  },
  explorerToggleShortcutDiscoveryAnchor: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
  },
  explorerToggleShortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
    zIndex: 1,
  },
  newTabActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  newTabActionButton: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
  },
  newTabActionButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  newTabTooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  newTabTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  newTabTooltipShortcut: {},
  explorerTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  explorerTooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  explorerTooltipShortcut: {},
  headerMenuTooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  mobileTabsRow: {
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  switcherTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2] + theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  switcherTriggerPressed: {
    backgroundColor: theme.colors.surface1,
  },
  switcherTriggerLeft: {
    flexDirection: "row",
    alignItems: "center",
    // Was a flat 4, which the icon and label had already outgrown: the icon
    // doubles on compact and the label carries the +2 bump, so the same 4px
    // read as no gap at all. compactUp keeps desktop at 4 and gives compact 8.
    gap: compactUp(theme.spacing[1]),
    flex: 1,
    minWidth: 0,
  },
  switcherTriggerIcon: {
    flexShrink: 0,
  },
  switcherTriggerText: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    // Matches the +2 the switcher's own option rows already carry
    // (workspace-tab-presentation.tsx `optionLabel`) - the collapsed trigger
    // shows the same label and had been left at the base size.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
  },
  mobileTabMenuTrigger: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTabMenuTriggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  headerMenuProfileIconWrapper: {
    width: compactUp(16),
    height: compactUp(16),
  },
  tabsContainer: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
  },
  tabsScroll: {
    flex: 1,
    minWidth: 0,
  },
  tabsContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  tabsActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  centerContent: {
    flex: 1,
    minHeight: 0,
  },
  tab: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 260,
  },
  tabHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  tabIcon: {
    flexShrink: 0,
  },
  tabActive: {
    backgroundColor: theme.colors.surface2,
  },
  tabHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tabLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  tabLabelWithCloseButton: {
    paddingRight: 0,
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabCloseButton: {
    width: 18,
    height: 18,
    marginLeft: 0,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCloseButtonShown: {
    opacity: 1,
  },
  tabCloseButtonHidden: {
    opacity: 0,
  },
  tabCloseButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  content: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
    position: "relative",
  },
  mobileMountedTabSlot: {
    ...StyleSheet.absoluteFillObject,
  },
  contentPlaceholder: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));

const containerWithWorkspaceBackgroundStyle = [
  styles.container,
  styles.containerWorkspaceBackground,
];
