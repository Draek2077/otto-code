import {
  memo,
  useCallback,
  useEffect,
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
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import {
  CopyX,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  Copy,
  Ellipsis,
  EllipsisVertical,
  Explore,
  FileText,
  Globe,
  Import as ImportIcon,
  Pencil,
  RotateCw,
  Settings,
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
import { HeaderActiveTeamSwitchers } from "@/components/active-team-switcher";
import { useTutorialAnchor } from "@/tutorial/use-tutorial-anchor";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { ExplorerSidebar } from "@/components/explorer-sidebar";
import { SplitContainer } from "@/components/split-container";
import { RetainedPanel } from "@/components/retained-panel";
import { WorkspaceActions } from "@/git/workspace-actions";
import { WorkspaceOpenInEditorButton } from "@/screens/workspace/workspace-open-in-editor-button";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import { WorkspaceVisualizerButton } from "@/visualizer/workspace-visualizer-button";
import { openContextManagementTab } from "@/context-management/open-context-management-tab";
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
import {
  useSessionStore,
  useWorkspaceRestoreStatus,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  collectAllTabs,
  findPaneById,
  getFocusedBrowserId,
  type WorkspaceLayout,
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useSettings } from "@/hooks/use-settings";
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
import { confirmDialog } from "@/utils/confirm-dialog";
import { confirmArchiveChat } from "@/components/archive-chat-warning";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useStableEvent } from "@/hooks/use-stable-event";
import { removeResidentBrowserWebview } from "@/components/browser-webview-resident";
import { createWorkspaceBrowser, useBrowserStore } from "@/stores/browser-store";
import { getDesktopHost } from "@/desktop/host";
import { buildProviderCommand } from "@/utils/provider-command-templates";
import { generateDraftId } from "@/stores/draft-keys";
import { resolveWorkspaceRouteId } from "@/utils/workspace-identity";
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
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
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
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedEllipsisVertical = withUnistyles(EllipsisVertical);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedX = withUnistyles(X);
const ThemedFileText = withUnistyles(FileText);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedGlobe = withUnistyles(Globe);
const ThemedImport = withUnistyles(ImportIcon);
const ThemedSettings = withUnistyles(Settings);
const ThemedExplore = withUnistyles(Explore);

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
// (mobile) icon-doubling patch — a plain `size={16}` prop is a frozen literal.
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
  return tab.target.path;
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
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsAbove: (tabId: string) => Promise<void> | void;
  onCloseTabsBelow: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
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
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTab,
  onCloseTabsAbove,
  onCloseTabsBelow,
  onCloseOtherTabs,
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
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsAbove: (tabId: string) => Promise<void> | void;
  onCloseTabsBelow: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const isDeveloperMode = useIsDeveloperMode();
  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
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
  const menuTestIDBase = `workspace-tab-menu-${buildDeterministicWorkspaceTabId(tab.target)}`;
  const menuEntries = buildWorkspaceTabMenuEntries({
    surface: "mobile",
    tab,
    index: tabIndex,
    tabCount,
    menuTestIDBase,
    isDeveloperMode,
    onCopyResumeCommand,
    onCopyAgentId,
    onCopyFilePath,
    onReloadAgent,
    onRenameTab,
    onCloseTab,
    onCloseTabsBefore: onCloseTabsAbove,
    onCloseTabsAfter: onCloseTabsBelow,
    onCloseOtherTabs,
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
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTab,
  onCloseTabsAbove,
  onCloseTabsBelow,
  onCloseOtherTabs,
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
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTab={onCloseTab}
          onCloseTabsAbove={onCloseTabsAbove}
          onCloseTabsBelow={onCloseTabsBelow}
          onCloseOtherTabs={onCloseOtherTabs}
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
      onCopyAgentId,
      onCopyFilePath,
      onReloadAgent,
      onRenameTab,
      onCloseTab,
      onCloseTabsAbove,
      onCloseTabsBelow,
      onCloseOtherTabs,
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

const MobileMountedTabSlot = memo(function MobileMountedTabSlot({
  tabDescriptor,
  isVisible,
  isWorkspaceFocused,
  isPaneFocused,
  paneId,
  buildPaneContentModel,
}: MobileMountedTabSlotProps) {
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
// the menu button's auto-sized chrome — a 2x icon would overflow that chrome, so
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
              <>
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
              </>
            );
          }}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent
        testID="workspace-explorer-toggle-tooltip"
        side="left"
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
        tooltipSide="left"
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
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
      tooltipSide="left"
      style={styles.compactHeaderActionButton}
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
            side="left"
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
          {showWorkspaceSetup ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID="workspace-header-show-setup"
                leading={menuSettingsIcon}
                onSelect={onOpenSetupTab}
              >
                {t("workspace.header.actions.showSetup")}
              </DropdownMenuItem>
              {/* The composer warning only appears when context is already
                  heavy; this is the way in the rest of the time. */}
              <DropdownMenuItem
                testID="workspace-header-context-management"
                leading={menuSettingsIcon}
                onSelect={onOpenContextManagement}
              >
                {t("workspace.contextManagement.openAction")}
              </DropdownMenuItem>
            </>
          ) : null}
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
          visible artifact button here — the entry point is the "Add artifact"
          item in the "..." menu above, which flips `artifactsOpen` on. On compact
          form factors that opens a bottom sheet (the feature's original purpose),
          which needs no anchor. On desktop the same controlled menu renders as a
          dropdown, and a dropdown must position against an on-screen element —
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
  workspaceScripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds: string[];
  showWorkspaceSetup: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  // Compact responsive drops (see `fitCompactHeaderActions`); always true on desktop.
  showVisualizerAction: boolean;
  showPlayAction: boolean;
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

function WorkspaceHeaderTitleBar({
  isLoading,
  title,
  subtitle,
  showSubtitle,
  currentBranchName,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceScripts,
  liveTerminalIds,
  showWorkspaceSetup,
  showCreateBrowserTab,
  isMobile,
  showVisualizerAction,
  showPlayAction,
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
        />
        {showVisualizerAction ? (
          <WorkspaceVisualizerButton
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
          />
        ) : null}
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
}): WorkspaceRouteState {
  const hosts = useHosts();
  const host = useMemo(
    () => hosts.find((entry) => entry.serverId === input.serverId) ?? null,
    [hosts, input.serverId],
  );
  const hostSnapshot = useHostRuntimeSnapshot(input.serverId);
  const hostName = useMemo(() => getHostDisplayName(host, input.serverId), [host, input.serverId]);
  const restoreStatus = useWorkspaceRestoreStatus(input.serverId, input.workspaceId);

  return useMemo(
    () =>
      resolveWorkspaceRouteState({
        hostName,
        connectionStatus: hostSnapshot?.connectionStatus ?? "connecting",
        lastError: hostSnapshot?.lastError ?? null,
        workspace: input.workspace,
        hasHydratedWorkspaces: input.hasHydratedWorkspaces,
        restoreStatus,
      }),
    [
      hostName,
      hostSnapshot?.connectionStatus,
      hostSnapshot?.lastError,
      input.workspace,
      input.hasHydratedWorkspaces,
      restoreStatus,
    ],
  );
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
  // tabs, git actions, scripts). Presentation only — the stores/daemon are
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
  const canOpenImportSheet = [client, isConnected, workspaceDirectory].every(Boolean);
  const openImportSheet = useCallback(() => {
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
  const workspaceRouteState = useResolvedWorkspaceRouteState({
    serverId: normalizedServerId,
    workspaceId: normalizedWorkspaceId,
    workspace: workspaceDescriptor,
    hasHydratedWorkspaces,
  });
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
  // The open sidebar already shows the diff stats on the workspace row — hide
  // the header copy to avoid the duplicate; they reappear when it's closed.
  const showExplorerDiffStat = useMemo(
    () => hasDiffStat && !isSidebarOpen,
    [hasDiffStat, isSidebarOpen],
  );
  const explorerToggleStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.sourceControlButton,
      showExplorerDiffStat && styles.sourceControlButtonWithStats,
      (Boolean(hovered) || Boolean(pressed)) && styles.sourceControlButtonHovered,
    ],
    [showExplorerDiffStat],
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
  // is "ready" to reveal once it has a layout — the tab strip and panes render
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
  // closed or mutated — switching back to Developer restores everything.
  const visibleUiTabs = useMemo(
    () => hideDeveloperTabs(uiTabs, isDeveloperMode),
    [uiTabs, isDeveloperMode],
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
  // the header row, whose width doesn't depend on what we decide to render — a
  // narrower container like the title cluster would oscillate.
  const { onLayout: onHeaderLayout, width: headerRowWidth } = useContainerWidth();
  // Unmeasured (0) counts as narrow, matching the label-first initial render.
  const showCompactButtonLabels = headerRowWidth < 700;
  // Compact only: the "..." menu and a readable title always win, so the action
  // buttons drop in order (Play, then Visualizer, then Explorer) as the row
  // narrows. Decided once here because the strip straddles the header's `left`
  // and `right` containers and both halves must spend the same budget.
  const visualizerEnabled = useFeatureEnabled("visualizer");
  const headerActionFit = useMemo(
    () =>
      resolveCompactHeaderActions({
        isCompact: isMobile,
        rowWidth: headerRowWidth,
        isDeveloperMode,
        visualizerEnabled,
        hasWorkspaceScripts: workspaceScripts.length > 0,
        hasWorkspaceDirectory: Boolean(workspaceDirectory),
      }),
    [
      isMobile,
      headerRowWidth,
      isDeveloperMode,
      visualizerEnabled,
      workspaceScripts.length,
      workspaceDirectory,
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
      }
      if (input.target?.kind === "browser") {
        const { browserId } = input.target;
        // Check isPreview/previewServerId BEFORE removing the record
        const browserRecord = useBrowserStore.getState().browsersById[browserId];
        useBrowserStore.getState().removeBrowser(browserId);
        removeResidentBrowserWebview(browserId);
        void getDesktopHost()?.browser?.clearPartition?.(browserId);

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
    [client, closeWorkspaceTab, hideWorkspaceAgent, persistenceKey, settings, unpinWorkspaceAgent],
  );

  const focusedPaneTabState = useMemo(
    () =>
      deriveWorkspacePaneState({
        layout: workspaceLayout,
        tabs: visibleUiTabs,
      }),
    [visibleUiTabs, workspaceLayout],
  );
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

  useEffect(() => {
    if (!isRouteFocused) {
      return;
    }
    setFocusedAgentId(normalizedServerId, focusedPaneAgentId);
    setFocusedTerminalId(normalizedServerId, focusedPaneTerminalId);
  }, [
    focusedPaneAgentId,
    focusedPaneTerminalId,
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
      const tabId = openWorkspaceTabFocused(persistenceKey, { kind: "agent", agentId });
      if (tabId) {
        navigateToTabId(tabId);
      }
    },
    [navigateToTabId, openWorkspaceTabFocused, persistenceKey],
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
  // desktop/web — see open-visualizer-tab). Those tabs are absent from the
  // focused-pane `tabs` above, so the mobile switcher enumerates every pane's
  // tabs as one flat list. Selecting one cross-pane-focuses it (focusTabInLayout
  // moves `focusedPaneId` to the tab's pane), after which the focused-pane render
  // shows it — so only the *list* needs widening, not the mount/select paths.
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
      // pane — the Visualizer is a companion view that owns its pane. Redirect
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

  const handleCreateBrowserTab = useCallback(
    (input?: { paneId?: string }) => {
      if (!persistenceKey || !getIsElectron()) {
        return;
      }
      if (input?.paneId) {
        focusWorkspacePane(persistenceKey, input.paneId);
      }
      const { browserId } = createWorkspaceBrowser();
      openWorkspaceTabFocused(persistenceKey, { kind: "browser", browserId });
    },
    [focusWorkspacePane, openWorkspaceTabFocused, persistenceKey],
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
  // "in-app" link opens into a normal Otto browser tab here (Electron only —
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
        // wrongly fall through to archive-on-close — cancelling a run the user
        // only meant to close. See docs/agent-lifecycle.md (Item 5).
        const session = useSessionStore.getState().sessions[normalizedServerId];
        const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
        const closePolicy = resolveCloseAgentTabPolicy(agent);
        const isRunning = agent?.status === "running";

        if (closePolicy.kind === "archive-on-close") {
          if (isRunning) {
            const confirmed = await confirmDialog({
              title: t("workspace.tabs.confirmations.archiveRunningAgentTitle"),
              message: t("workspace.tabs.confirmations.archiveRunningAgentMessage"),
              confirmLabel: t("workspace.tabs.confirmations.archive"),
              cancelLabel: t("workspace.tabs.confirmations.cancel"),
              destructive: true,
            });
            if (!confirmed) {
              return;
            }
          } else {
            // Archiving a stopped chat moves it to History; warn unless the
            // user has suppressed this (checkbox in the confirmation).
            const confirmed = await confirmArchiveChat();
            if (!confirmed) {
              return;
            }
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
    [archiveAgent, closeTab, closeWorkspaceTabWithCleanup, normalizedServerId, persistenceKey, t],
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
          handleOpenExplorerTab("files");
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
    [handleOpenExplorerTab, handleToggleExplorer, requestProjectSearchFocus],
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
        onOpenImportSheet: openImportSheet,
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
    cap: 3,
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
                hideLabels
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
                tooltipSide="left"
                style={styles.compactHeaderActionButton}
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
                tooltipSide="left"
                accessible
                accessibilityRole="button"
                accessibilityLabel={explorerToggleLabel}
                accessibilityState={explorerToggleAccessibilityState}
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
  // strip under the native window controls — publish that so the caption strip
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
                workspaceScripts={workspaceScripts}
                liveTerminalIds={liveTerminalIds}
                showWorkspaceSetup={showWorkspaceSetup}
                showCreateBrowserTab={showCreateBrowserTab}
                isMobile={isMobile}
                showVisualizerAction={headerActionFit.showVisualizer}
                showPlayAction={headerActionFit.showPlay}
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
          onCopyAgentId={handleCopyAgentId}
          onCopyFilePath={handleCopyFilePath}
          onReloadAgent={handleReloadAgent}
          onRenameTab={handleRenameTab}
          onCloseTab={handleCloseTabById}
          onCloseTabsAbove={handleCloseTabsToLeftMobile}
          onCloseTabsBelow={handleCloseTabsToRightMobile}
          onCloseOtherTabs={handleCloseOtherTabsMobile}
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
          onCopyAgentId={handleCopyAgentId}
          onCopyFilePath={handleCopyFilePath}
          onReloadAgent={handleReloadAgent}
          onRenameTab={handleRenameTab}
          onCloseTabsToLeft={handleCloseTabsToLeft}
          onCloseTabsToRight={handleCloseTabsToRight}
          onCloseOtherTabs={handleCloseOtherTabs}
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

      <View style={styles.centerContent}>
        {isMobile ? (
          <View style={styles.content}>{content}</View>
        ) : (
          <View style={styles.content}>{desktopContent}</View>
        )}
      </View>
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
              onClose={closeImportSheet}
              onImportedAgent={handleImportedAgent}
            />
            <WorkspaceTabRenameModal
              renamingTab={renamingTab}
              onSubmit={handleRenameModalSubmit}
              onClose={handleRenameModalClose}
            />
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
    // squeeze them out entirely — `fitCompactHeaderActions` reserves the same
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
    paddingVertical: compactUp(theme.spacing[2]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.lg,
  },
  headerActionButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  // Fixed touch-target box for the mobile "..." trigger — doubled alongside the
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
    // different container, so no shared container-gap spans that seam — the
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
    backgroundColor: theme.colors.surfaceHover,
  },
  sourceControlDiffStat: {
    paddingLeft: 5,
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
    // (workspace-tab-presentation.tsx `optionLabel`) — the collapsed trigger
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
    backgroundColor: theme.colors.surface0,
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
