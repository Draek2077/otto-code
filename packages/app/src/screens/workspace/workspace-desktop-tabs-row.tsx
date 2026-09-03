import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  Columns2,
  Copy,
  CopyX,
  FileText,
  FolderOpen,
  Globe,
  CloseFullscreen,
  MessageSquare,
  MoreHorizontal,
  OpenInFull,
  Pencil,
  PlayFilled,
  RotateCw,
  Rows2,
  SquarePen,
  SquareTerminal,
  Tabs,
  X,
} from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { SortableInlineList } from "@/components/sortable-inline-list";
import type {
  DraggableListDragHandleProps,
  DraggableRenderItemInfo,
} from "@/components/draggable-list.types";
import { isNative, isWeb } from "@/constants/platform";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useNonClientHover } from "@/hooks/use-non-client-hover";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { useWorkspaceTabLayout } from "@/screens/workspace/use-workspace-tab-layout";
import {
  TAB_CLOSE_BUTTON_WIDTH,
  TAB_ESTIMATED_CHAR_WIDTH,
  TAB_HORIZONTAL_PADDING,
  TAB_ICON_WIDTH,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
} from "@/screens/workspace/workspace-tab-layout";
import { useHostFeature } from "@/runtime/host-features";
import {
  WorkspaceTabPresentationResolver,
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import {
  buildWorkspaceDesktopTabActions,
  type WorkspaceDesktopTabActions,
  type WorkspaceTabMenuEntry,
  type WorkspaceTabMenuLabels,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { Theme } from "@/styles/theme";
import { RenderProfile } from "@/utils/render-profiler";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAppSettings } from "@/hooks/use-settings";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { resolveTerminalProfiles } from "@otto-code/protocol/terminal-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useMoveChatMenu } from "@/workspace/use-move-chat-menu";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useBrowserStore } from "@/stores/browser-store";
import { ArtifactOpenMenu } from "@/components/artifacts/artifact-open-menu";
import { panelTargetSupportsHost } from "@/plugins/workspace-panels/locations";
import {
  computeVisibleTabCount,
  reorderTabIntoVisible,
  splitTabsForOverflow,
} from "@/stores/workspace-tabs-store";

import {
  WorkspacePreviewCollapsedAnchor,
  useWorkspacePreviewController,
} from "./workspace-preview-controller";
import type { TerminalProfile } from "@otto-code/protocol/messages";
import { TAB_CONTENT_GAP } from "@/screens/workspace/workspace-tab-layout";
import { shouldRevealTabToolbarOptions } from "@/screens/workspace/workspace-tab-toolbar-options";

const DROPDOWN_WIDTH = 220;
// Fixed colors for content on the forced-black chat tab (Black tab background
// setting) - must stay readable on #000 regardless of the active theme.
const ON_BLACK_FOREGROUND = "#e4e4e4"; // neutral off-white - matches dark themes' foreground ink
const ON_BLACK_MUTED = "#a1a1aa";
const LOADING_TAB_LABEL_SKELETON_WIDTH = 80;
// Width math for the trailing-tools overflow. These mirror the style constants
// below (newTabActionButton / pin buttons / the artifact trigger are 22,
// tabsContent pads 4 per side, tabsActions pads 8 per side). The collapse
// decision must be derived from constants - not from measuring the strip -
// or hiding a button would change the measurement that decided to hide it.
const SMALL_TOOL_WIDTH = 22;
// The orientation toggle sits to the LEFT of the tabs (so it occupies the
// same top-left spot in both orientations and never moves under the pointer
// when toggled) - its button (22) plus the slot's left padding (8, matching
// the rail's styles.header paddingLeft in workspace-desktop-tabs-rail.tsx so
// the toggle lands in the same spot in both orientations) must be reserved
// out of the row width before tabs divide the rest.
const ORIENTATION_TOGGLE_RESERVED_WIDTH = SMALL_TOOL_WIDTH + 8;
// Width the tab-overflow control (icon + hidden count) occupies at the end of
// the strip. Reserved out of the tab-layout budget only while tabs are hidden,
// so the visible chips never render underneath it.
const TAB_OVERFLOW_CONTROL_WIDTH = 40;

const ThemedActivityIndicator = withUnistyles(LoadingSpinner);
const ThemedX = withUnistyles(X);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedGlobe = withUnistyles(Globe);
const ThemedPlayFilled = withUnistyles(PlayFilled);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);
const ThemedTabs = withUnistyles(Tabs);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedFileText = withUnistyles(FileText);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedCloseFullscreen = withUnistyles(CloseFullscreen);
const ThemedOpenInFull = withUnistyles(OpenInFull);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Leading icons for the more-actions catalog menu rows.
const MENU_AGENT_ICON = <ThemedMessageSquare size={14} uniProps={mutedColorMapping} />;
const MENU_PREVIEW_ICON = <ThemedPlayFilled size={14} uniProps={mutedColorMapping} />;
const MENU_ARTIFACTS_ICON = <ThemedFileText size={14} uniProps={mutedColorMapping} />;
const MENU_TERMINAL_ICON = <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />;
const MENU_BROWSER_ICON = <ThemedGlobe size={14} uniProps={mutedColorMapping} />;
const MENU_SPLIT_RIGHT_ICON = <ThemedColumns2 size={14} uniProps={mutedColorMapping} />;
const MENU_SPLIT_DOWN_ICON = <ThemedRows2 size={14} uniProps={mutedColorMapping} />;

function newTabActionButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.newTabActionButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function tabOverflowButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.tabOverflowButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function updateMeasuredWidth(setWidth: Dispatch<SetStateAction<number>>, event: LayoutChangeEvent) {
  const nextWidth = Math.round(event.nativeEvent.layout.width);
  setWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
}

export interface WorkspaceTabRowExtrasProps {
  onCreateAgentTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
  onEditProfiles: () => void;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  paneId?: string;
  focusedAgentId: string | null;
  showCreateBrowserTab: boolean;
  showPreviewButton: boolean;
  terminalDisabled: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
  showPaneSplitActions: boolean;
  onStripLayout: (event: LayoutChangeEvent) => void;
  rowHovered: boolean;
  showPaneMaximizeAction?: boolean;
  paneMaximized?: boolean;
  onTogglePaneMaximized?: () => void;
  focusModeEnabled?: boolean;
  onExitFocusMode?: () => void;
}

function TerminalProfileMenuItem({
  profile,
  disabled,
  onSelect,
}: {
  profile: TerminalProfile;
  disabled: boolean;
  onSelect: (profile: TerminalProfile) => void;
}) {
  const handleSelect = useCallback(() => onSelect(profile), [onSelect, profile]);
  return (
    <DropdownMenuItem disabled={disabled} onSelect={handleSelect}>
      {profile.name}
    </DropdownMenuItem>
  );
}

/** Shared composition point for the horizontal row and vertical rail. It adds Otto actions without owning tab state. */
// oxlint-disable-next-line complexity
export function WorkspaceTabRowExtras({
  onCreateAgentTab,
  onCreateTerminal,
  onCreateBrowser,
  onCreateTerminalWithProfile,
  onEditProfiles,
  normalizedServerId,
  normalizedWorkspaceId,
  paneId,
  focusedAgentId,
  showCreateBrowserTab,
  showPreviewButton,
  terminalDisabled,
  onSplitRight,
  onSplitDown,
  showPaneSplitActions,
  onStripLayout,
  rowHovered,
  showPaneMaximizeAction,
  paneMaximized,
  onTogglePaneMaximized,
  focusModeEnabled,
  onExitFocusMode,
}: WorkspaceTabRowExtrasProps) {
  const { t } = useTranslation();
  const { settings: appSettings } = useAppSettings();
  const { config } = useDaemonConfig(normalizedServerId);
  const isCompact = useIsCompactFormFactor();
  const isDeveloperMode = useIsDeveloperMode();
  const supportsArtifacts = useHostFeature(normalizedServerId, "artifacts");
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );
  const previewController = useWorkspacePreviewController({
    normalizedServerId,
    normalizedWorkspaceId,
    paneId,
    focusedAgentId,
    enabled: showPreviewButton,
  });
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const toolsRevealed = shouldRevealTabToolbarOptions({
    hideTabToolbarOptions: appSettings.hideTabToolbarOptions,
    isCompact,
    isToolbarActive: previewController.pickerOpen || artifactsOpen,
    isNative,
    rowHovered,
  });
  const openPreview = useCallback(
    () => void previewController.runPreviewFlow(),
    [previewController],
  );
  const openArtifacts = useCallback(() => setArtifactsOpen(true), []);
  return (
    <View style={TABS_ACTIONS_STYLE} onLayout={onStripLayout}>
      <View style={toolsRevealed ? styles.tabsTools : TABS_TOOLS_HIDDEN_STYLE}>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger
            testID="workspace-pinned-target-draft"
            accessibilityRole="button"
            accessibilityLabel={t("workspace.tabs.actions.newAgent")}
            onPress={onCreateAgentTab}
            style={newTabActionButtonStyle}
          >
            <ThemedSquarePen size="sm" uniProps={mutedColorMapping} />
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.newTabTooltipText}>{t("workspace.tabs.actions.newAgent")}</Text>
          </TooltipContent>
        </Tooltip>
        {isDeveloperMode ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger
              testID="workspace-pinned-target-terminal"
              disabled={terminalDisabled}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.tabs.actions.newTerminal")}
              onPress={terminalDisabled ? undefined : onCreateTerminal}
              style={newTabActionButtonStyle}
            >
              <ThemedSquareTerminal size="sm" uniProps={mutedColorMapping} />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <Text style={styles.newTabTooltipText}>
                {t("workspace.tabs.actions.newTerminal")}
              </Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {showCreateBrowserTab ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger
              testID="workspace-pinned-target-browser"
              accessibilityRole="button"
              accessibilityLabel={t("workspace.tabs.actions.newBrowser")}
              onPress={onCreateBrowser}
              style={newTabActionButtonStyle}
            >
              <ThemedGlobe size="sm" uniProps={mutedColorMapping} />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <Text style={styles.newTabTooltipText}>{t("workspace.tabs.actions.newBrowser")}</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      {showPreviewButton && isDeveloperMode ? (
        <WorkspacePreviewCollapsedAnchor controller={previewController} />
      ) : null}
      {supportsArtifacts ? (
        <ArtifactOpenMenu
          serverId={normalizedServerId}
          workspaceId={normalizedWorkspaceId}
          open={artifactsOpen}
          onOpenChange={setArtifactsOpen}
          hideTrigger
        />
      ) : null}
      {/* Pane chrome is pinned immediately before the catalog chevron. It must
          stay outside the hover-revealed tools group so its position and
          availability do not depend on pointer state. */}
      <WorkspacePaneChromeActions
        showPaneMaximizeAction={showPaneMaximizeAction}
        paneMaximized={paneMaximized}
        onTogglePaneMaximized={onTogglePaneMaximized}
        focusModeEnabled={focusModeEnabled}
        onExitFocusMode={onExitFocusMode}
      />
      <DropdownMenu>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <DropdownMenuTrigger
              testID="workspace-new-tab-menu-trigger"
              accessibilityRole="button"
              accessibilityLabel={t("workspace.tabs.actions.moreActions")}
              style={newTabActionButtonStyle}
            >
              <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.newTabTooltipText}>{t("workspace.tabs.actions.moreActions")}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="bottom" align="end" offset={4} minWidth={200}>
          <DropdownMenuItem
            testID="workspace-new-tab-menu-agent"
            leading={MENU_AGENT_ICON}
            onSelect={onCreateAgentTab}
          >
            {t("workspace.tabs.actions.newAgent")}
          </DropdownMenuItem>
          {isDeveloperMode ? (
            <DropdownMenuItem
              testID="workspace-new-tab-menu-terminal"
              leading={MENU_TERMINAL_ICON}
              disabled={terminalDisabled}
              onSelect={terminalDisabled ? undefined : onCreateTerminal}
            >
              {t("workspace.tabs.actions.newTerminal")}
            </DropdownMenuItem>
          ) : null}
          {showCreateBrowserTab ? (
            <DropdownMenuItem
              testID="workspace-new-tab-menu-browser"
              leading={MENU_BROWSER_ICON}
              onSelect={onCreateBrowser}
            >
              {t("workspace.tabs.actions.newBrowser")}
            </DropdownMenuItem>
          ) : null}
          {showPreviewButton && isDeveloperMode ? (
            <DropdownMenuItem
              testID="workspace-new-tab-menu-preview"
              leading={MENU_PREVIEW_ICON}
              disabled={previewController.disabled}
              onSelect={previewController.disabled ? undefined : openPreview}
            >
              {t("workspace.tabs.actions.preview")}
            </DropdownMenuItem>
          ) : null}
          {supportsArtifacts ? (
            <DropdownMenuItem
              testID="workspace-new-tab-menu-artifacts"
              leading={MENU_ARTIFACTS_ICON}
              onSelect={openArtifacts}
            >
              Add artifact
            </DropdownMenuItem>
          ) : null}
          {showPaneSplitActions && isDeveloperMode ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID="workspace-new-tab-menu-split-right"
                leading={MENU_SPLIT_RIGHT_ICON}
                onSelect={onSplitRight}
              >
                {t("workspace.tabs.actions.splitRight")}
              </DropdownMenuItem>
              <DropdownMenuItem
                testID="workspace-new-tab-menu-split-down"
                leading={MENU_SPLIT_DOWN_ICON}
                onSelect={onSplitDown}
              >
                {t("workspace.tabs.actions.splitDown")}
              </DropdownMenuItem>
            </>
          ) : null}
          {isDeveloperMode ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("workspace.tabs.actions.terminalProfilesMenu")}
              </DropdownMenuLabel>
              {profiles.map((profile) => (
                <TerminalProfileMenuItem
                  key={profile.id}
                  profile={profile}
                  disabled={terminalDisabled}
                  onSelect={onCreateTerminalWithProfile}
                />
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID="workspace-new-tab-menu-edit-profiles"
                onSelect={onEditProfiles}
              >
                {t("workspace.tabs.actions.editTerminalProfiles")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

export function WorkspacePaneChromeActions({
  showPaneMaximizeAction = false,
  paneMaximized = false,
  onTogglePaneMaximized,
  focusModeEnabled = false,
  onExitFocusMode,
}: {
  showPaneMaximizeAction?: boolean;
  paneMaximized?: boolean;
  onTogglePaneMaximized?: () => void;
  focusModeEnabled?: boolean;
  onExitFocusMode?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {focusModeEnabled && onExitFocusMode ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger
            testID="workspace-exit-focus-mode"
            accessibilityRole="button"
            accessibilityLabel={t("workspace.tabs.actions.exitFocusMode")}
            onPress={onExitFocusMode}
            style={newTabActionButtonStyle}
          >
            <ThemedX size={14} uniProps={mutedColorMapping} />
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.newTabTooltipText}>
              {t("workspace.tabs.actions.exitFocusMode")}
            </Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      {showPaneMaximizeAction && onTogglePaneMaximized ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger
            testID={paneMaximized ? "workspace-restore-pane" : "workspace-maximize-pane"}
            accessibilityRole="button"
            accessibilityLabel={t(
              paneMaximized
                ? "workspace.tabs.actions.restorePane"
                : "workspace.tabs.actions.maximizePane",
            )}
            onPress={onTogglePaneMaximized}
            style={newTabActionButtonStyle}
          >
            {paneMaximized ? (
              <ThemedCloseFullscreen size={14} uniProps={mutedColorMapping} />
            ) : (
              <ThemedOpenInFull size={14} uniProps={mutedColorMapping} />
            )}
          </TooltipTrigger>
        </Tooltip>
      ) : null}
    </>
  );
}
function TabContextMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    switch (entry.icon) {
      case "copy":
        return <ThemedCopy size={16} uniProps={mutedColorMapping} />;
      case "rotate-cw":
        return <ThemedRotateCw size={16} uniProps={mutedColorMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine size={16} uniProps={mutedColorMapping} />;
      case "copy-x":
        return <ThemedCopyX size={16} uniProps={mutedColorMapping} />;
      case "pencil":
        return <ThemedPencil size={16} uniProps={mutedColorMapping} />;
      case "folder-open":
        return <ThemedFolderOpen size={16} uniProps={mutedColorMapping} />;
      case "x":
        return <ThemedX size={16} uniProps={mutedColorMapping} />;
      default:
        return undefined;
    }
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return (
    <ContextMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </ContextMenuItem>
  );
}

// Exported so a sibling tab-item consumer (the vertical rail) can share the
// exact same key derivation without duplicating it.
export function tabKeyExtractor(tab: WorkspaceDesktopTabRowItem) {
  return `${tab.tab.key}:${tab.tab.kind}`;
}

/**
 * Facts about a pane's tabs that gate the tools strip - shared by the row and
 * the vertical rail so both feed WorkspaceTabRowExtras identical inputs.
 * Preview works by prompting a parent agent, so only attended agents count:
 * observed subagent tabs are read-only and can't be prompted (an agent
 * missing from the store is treated as attended, mirroring session-store's
 * absent-attend default).
 */
export function usePaneTabAgentFacts({
  tabs,
  focusedTab,
  normalizedServerId,
}: {
  tabs: WorkspaceDesktopTabRowItem[];
  focusedTab: WorkspaceTabDescriptor | null;
  normalizedServerId: string;
}) {
  const focusedTabAgentId = focusedTab?.target.kind === "agent" ? focusedTab.target.agentId : null;
  const focusedAgentId = useSessionStore((state) =>
    focusedTabAgentId &&
    state.sessions[normalizedServerId]?.agents.get(focusedTabAgentId)?.attend !== "observed"
      ? focusedTabAgentId
      : null,
  );
  const paneHasEditableAgentTab = useSessionStore((state) => {
    const agents = state.sessions[normalizedServerId]?.agents;
    return tabs.some(
      (item) =>
        item.tab.target.kind === "agent" &&
        agents?.get(item.tab.target.agentId)?.attend !== "observed",
    );
  });
  const browsersById = useBrowserStore((state) => state.browsersById);
  const paneHasPreviewTab = useMemo(
    () =>
      tabs.some(
        (item) =>
          item.tab.target.kind === "browser" &&
          browsersById[item.tab.target.browserId]?.isPreview === true,
      ),
    [browsersById, tabs],
  );
  return { focusedAgentId, paneHasEditableAgentTab, paneHasPreviewTab };
}

export interface WorkspaceDesktopTabRowItem {
  tab: WorkspaceTabDescriptor;
  isActive: boolean;
  isCloseHovered: boolean;
  isClosingTab: boolean;
}

export interface TabOrientationToggleButtonProps {
  orientation: "horizontal" | "vertical";
  onToggle: () => void;
}

// Shared by the row and the vertical rail (workspace-desktop-tabs-rail.tsx) so
// both surfaces expose the identical flip control. Uses the dedicated Tabs
// glyph (not Columns2/Rows2 - those are already the split-right/split-down
// icons, and reusing them here made the two unrelated actions look identical).
// Vertical rotates the same glyph 90° rather than switching to a different icon,
// so the control still reads as "tabs" in either orientation.
// Rotate the glyph 90° in vertical mode. In both orientations, nudge the
// whole button 1px left/1px down so it optically centers against its
// neighbor. Cross-mode alignment (same top-left spot in both orientations)
// is handled at the container level - see the row's
// ORIENTATION_TOGGLE_SLOT_STYLE paddingLeft vs the rail's styles.header
// paddingLeft in workspace-desktop-tabs-rail.tsx, which are kept equal on
// purpose. Don't try to re-align via button-level padding or margin here -
// that fights the container fix instead of matching it.
const verticalTabsIconStyle = { transform: [{ rotate: "90deg" as const }] };
const toggleButtonNudgeStyle = { transform: [{ translateX: -1 }, { translateY: 1 }] };

function toggleButtonStyle(state: PressableStateCallbackType) {
  return [newTabActionButtonStyle(state), toggleButtonNudgeStyle];
}

export function TabOrientationToggleButton({
  orientation,
  onToggle,
}: TabOrientationToggleButtonProps) {
  // i18n: English-only pending a translation pass (Vertical tabs).
  const label =
    orientation === "vertical" ? "Switch to horizontal tabs" : "Switch to vertical tabs";
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-tab-orientation-toggle"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={toggleButtonStyle}
      >
        <ThemedTabs
          size={14}
          uniProps={mutedColorMapping}
          style={orientation === "vertical" ? verticalTabsIconStyle : undefined}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.newTabTooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface WorkspaceDesktopTabsRowProps {
  paneId?: string;
  isFocused?: boolean;
  tabs: WorkspaceDesktopTabRowItem[];
  focusedTab?: WorkspaceTabDescriptor | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (
    path: string,
    target?: "filename" | "full-path" | "workspace-path",
  ) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
  onMoveTabToExplorer?: (tabId: string) => void;
  onCreateDraftTab: (input: { paneId?: string }) => void;
  onCreateTerminalTab: (input: { paneId?: string; profile?: TerminalProfile }) => void;
  onCreateBrowserTab: (input: { paneId?: string }) => void;
  showCreateBrowserTab?: boolean;
  disableCreateTerminal?: boolean;
  isWaitingOnTerminalReadiness?: boolean;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  tabDropPreviewIndex?: number | null;
  showPaneSplitActions?: boolean;
  showPaneMaximizeAction?: boolean;
  paneMaximized?: boolean;
  onTogglePaneMaximized?: () => void;
  focusModeEnabled?: boolean;
  onExitFocusMode?: () => void;
  tabOrientation: "horizontal" | "vertical";
  onToggleTabOrientation: () => void;
  /**
   * Reserve for the native window controls that overlap this row when it is the
   * top strip (focus mode on desktop). Applied as content inset on the inner
   * strip so the tab chips/tools clear the caption buttons, while the row's
   * gutter background and bottom hairline still span the full pane width. See
   * split-container's `windowControlsInset`.
   */
  windowControlsInset?: { left: number; right: number };
}

export function getFallbackTabLabel(
  tab: WorkspaceTabDescriptor,
  labels: { newAgent: string; setup: string; terminal: string; agent: string },
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
  if (tab.target.kind === "file") {
    return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
  }
  return labels.agent;
}

function useMiddleClickClose(onClose: () => void) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (isNative) return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;

    function handleAuxClick(event: MouseEvent) {
      if (event.button === 1) {
        event.preventDefault();
        onClose();
      }
    }

    // Linux/X11 primary-selection paste is initiated from the middle-button
    // PRESS, before auxclick fires - without cancelling it here, closing a tab
    // could paste the selection into whatever ends up under the cursor (the
    // revealed editor). Also suppresses Windows/ChromeOS middle-click
    // autoscroll starting on a tab.
    function handleMiddleDown(event: MouseEvent | PointerEvent) {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    node.addEventListener("auxclick", handleAuxClick);
    node.addEventListener("pointerdown", handleMiddleDown);
    node.addEventListener("mousedown", handleMiddleDown);
    return () => {
      node.removeEventListener("auxclick", handleAuxClick);
      node.removeEventListener("pointerdown", handleMiddleDown);
      node.removeEventListener("mousedown", handleMiddleDown);
    };
  }, [onClose]);

  return ref;
}

function closeWorkspaceTabIfAllowed(input: {
  canClose: boolean;
  tabId: string;
  onCloseTab: (tabId: string) => Promise<void> | void;
}): void {
  if (!input.canClose) return;
  void input.onCloseTab(input.tabId);
}

function shouldShowWorkspaceTabCloseButton(showCloseButton: boolean, canClose: boolean): boolean {
  return showCloseButton && canClose;
}

function TabHandleContent({
  presentation,
  isHighlighted,
  isActiveTab,
  showLabel,
  tabLabelSkeletonStyle,
  tabLabelStyle,
}: {
  presentation: WorkspaceTabPresentation;
  isHighlighted: boolean;
  isActiveTab: boolean;
  showLabel: boolean;
  tabLabelSkeletonStyle: React.ComponentProps<typeof View>["style"];
  tabLabelStyle: React.ComponentProps<typeof Text>["style"];
}) {
  const tabHandleDataSet = useMemo(
    () => ({ statusBucket: presentation.statusBucket ?? "none" }),
    [presentation.statusBucket],
  );

  return (
    <View style={styles.tabHandle} dataSet={tabHandleDataSet}>
      <View style={styles.tabIcon}>
        <WorkspaceTabIcon
          presentation={presentation}
          active={isHighlighted}
          accent={isActiveTab}
          backdrop="surface0"
        />
      </View>
      {showLabel && presentation.titleState === "loading" ? (
        <View style={tabLabelSkeletonStyle} />
      ) : null}
      {showLabel && presentation.titleState !== "loading" ? (
        <Text style={tabLabelStyle} selectable={false} numberOfLines={1} ellipsizeMode="tail">
          {presentation.label}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A chip's width: an explicit pixel value (the horizontal row, which sizes each
 * tab from its layout pass) or "stretch" to inherit the container's width (the
 * vertical rail, where every chip is as wide as the rail itself).
 */
export type ResolvedTabWidth = number | "stretch";

function isActiveTerminalTab(tab: WorkspaceTabDescriptor, isActive: boolean) {
  return isActive && tab.target.kind === "terminal";
}

function TabShortcutDiscoveryHint({
  isFocused,
  shortcutIndex,
}: {
  isFocused: boolean;
  shortcutIndex: number | null;
}) {
  if (!isFocused || shortcutIndex === null) {
    return null;
  }

  return (
    <ShortcutDiscoveryHint
      action="workspace.tab.navigate.index"
      digit={shortcutIndex}
      style={styles.tabShortcutDiscoveryHint}
    />
  );
}

function TabCloseShortcutDiscoveryHint({
  isActive,
  isFocused,
}: {
  isActive: boolean;
  isFocused: boolean;
}) {
  if (!isActive || !isFocused) {
    return null;
  }

  return (
    <ShortcutDiscoveryHint
      action="workspace.tab.close.current"
      style={styles.tabCloseShortcutDiscoveryHint}
    />
  );
}

function TabCloseButtonContents({
  isActive,
  isFocused,
  isClosingTab,
  onBlack,
  isCloseEmphasized,
}: {
  isActive: boolean;
  isFocused: boolean;
  isClosingTab: boolean;
  onBlack: boolean;
  isCloseEmphasized: boolean;
}) {
  let icon: React.ReactNode;
  if (onBlack) {
    icon = isClosingTab ? (
      <LoadingSpinner size={12} />
    ) : (
      <X size={12} color={isCloseEmphasized ? ON_BLACK_FOREGROUND : ON_BLACK_MUTED} />
    );
  } else {
    icon = isClosingTab ? (
      <ThemedActivityIndicator
        size={12}
        uniProps={isCloseEmphasized ? foregroundColorMapping : mutedColorMapping}
      />
    ) : (
      <ThemedX
        size={12}
        uniProps={isCloseEmphasized ? foregroundColorMapping : mutedColorMapping}
      />
    );
  }

  return (
    <View style={styles.tabCloseButtonContents}>
      {icon}
      <TabCloseShortcutDiscoveryHint isActive={isActive} isFocused={isFocused} />
    </View>
  );
}

function TabChip({
  tab,
  isActive,
  isDragging,
  isFocused,
  shortcutIndex,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  isCloseHovered,
  isClosingTab,
  presentation,
  tooltipLabel,
  resolvedTab,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  dragHandleProps,
  orientation = "horizontal",
}: {
  tab: WorkspaceTabDescriptor;
  isActive: boolean;
  isDragging: boolean;
  isFocused: boolean;
  shortcutIndex: number | null;
  resolvedTabWidth: ResolvedTabWidth;
  showLabel: boolean;
  showCloseButton: boolean;
  isCloseHovered: boolean;
  isClosingTab: boolean;
  presentation: WorkspaceTabPresentation;
  tooltipLabel: string;
  resolvedTab: WorkspaceDesktopTabActions;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  orientation?: "horizontal" | "vertical";
}) {
  const { closeButtonTestId, contextMenuTestId, menuEntries } = resolvedTab;
  const middleClickRef = useMiddleClickClose(
    useCallback(
      () =>
        closeWorkspaceTabIfAllowed({
          canClose: resolvedTab.canClose,
          tabId: tab.tabId,
          onCloseTab,
        }),
      [onCloseTab, resolvedTab.canClose, tab.tabId],
    ),
  );
  const [hovered, setHovered] = useState(false);
  const tabIndexJumpKeys = useShortcutKeys("workspace-tab-jump-index");
  const tabShortcutKeys = useMemo(() => {
    if (shortcutIndex === null || !tabIndexJumpKeys) return null;
    return tabIndexJumpKeys.map((combo) =>
      combo.map((key) => (key === "Digit" || key === "1-9" ? String(shortcutIndex) : key)),
    );
  }, [shortcutIndex, tabIndexJumpKeys]);
  const isHighlighted = isActive || hovered || isCloseHovered;
  const { settings } = useAppSettings();
  // Black tab background: the active chat tab's fill goes pure black so it
  // fuses with the black chat pane below; label + close button switch to
  // fixed on-black colors so they stay readable in any theme.
  const isChatTab = tab.target.kind === "agent" || tab.target.kind === "draft";
  const onBlack = settings.blackTabBackground && isChatTab && isActive;
  // Terminal panes paint their emulator against `surfaceCode`, so the active
  // terminal tab uses that same fill instead of the normal workspace surface.
  const onTerminalSurface = isActiveTerminalTab(tab, isActive);
  const closeButtonDragBlockers = isWeb
    ? ({
        onPointerDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
        onMouseDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
      } as const)
    : undefined;

  const vertical = orientation === "vertical";
  const tabChipStyle = useCallback(
    () => [
      styles.tab,
      vertical && styles.tabVertical,
      isActive && (vertical ? styles.tabActiveVertical : styles.tabActive),
      onTerminalSurface && (vertical ? styles.tabActiveTerminalVertical : styles.tabActiveTerminal),
      onBlack && (vertical ? styles.tabActiveBlackVertical : styles.tabActiveBlack),
      isWeb && isDragging && ({ cursor: "grabbing" } as object),
      // "stretch" lets the chip take its width from the container instead of a
      // number. The vertical rail uses it so a resize drag only has to change
      // the rail's own width - no per-frame re-render of every chip.
      resolvedTabWidth === "stretch"
        ? { alignSelf: "stretch" as const }
        : {
            minWidth: resolvedTabWidth,
            width: resolvedTabWidth,
            maxWidth: resolvedTabWidth,
          },
    ],
    [isActive, isDragging, onBlack, onTerminalSurface, resolvedTabWidth, vertical],
  );

  const handleTabHoverIn = useCallback(() => {
    setHovered(true);
  }, []);

  const handleTabHoverOut = useCallback(() => {
    setHovered(false);
  }, []);

  const handleNavigateTab = useCallback(() => {
    onNavigateTab(tab.tabId);
  }, [onNavigateTab, tab.tabId]);

  const handleCloseButtonPressIn = useCallback((event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
  }, []);

  const handleCloseButtonHoverIn = useCallback(() => {
    setHoveredCloseTabKey(tab.key);
  }, [setHoveredCloseTabKey, tab.key]);

  const handleCloseButtonHoverOut = useCallback(() => {
    setHoveredCloseTabKey((current) => (current === tab.key ? null : current));
  }, [setHoveredCloseTabKey, tab.key]);

  const handleCloseButtonPress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      void onCloseTab(tab.tabId);
    },
    [onCloseTab, tab.tabId],
  );

  const closeButtonStyle = useCallback(
    ({ hovered: isButtonHovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tabCloseButton,
      styles.tabCloseButtonShown,
      (Boolean(isButtonHovered) || pressed) &&
        (onBlack ? styles.tabCloseButtonActiveOnBlack : styles.tabCloseButtonActive),
    ],
    [onBlack],
  );

  const tabAccessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const showTabCloseButton = shouldShowWorkspaceTabCloseButton(
    showCloseButton,
    resolvedTab.canClose,
  );
  const tabLabelSkeletonStyle = useMemo(
    () => [styles.tabLabelSkeleton, showTabCloseButton && styles.tabLabelSkeletonWithCloseButton],
    [showTabCloseButton],
  );
  // The selected (active + focused) tab accent-colors its label to match its
  // accent icon. Accent is applied last so it wins even on the forced-black
  // chat tab, where the icon is already accent-colored too.
  const isSelectedTab = isActive && isFocused;
  const tabLabelStyle = useMemo(
    () => [
      styles.tabLabel,
      isHighlighted && styles.tabLabelActive,
      onBlack && styles.tabLabelOnBlack,
      isSelectedTab && styles.tabLabelAccent,
      showTabCloseButton && styles.tabLabelWithCloseButton,
    ],
    [isHighlighted, isSelectedTab, onBlack, showTabCloseButton],
  );

  return (
    <View ref={middleClickRef}>
      <ContextMenu key={tab.key}>
        <Tooltip delayDuration={400} enabledOnDesktop={!showLabel} enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              testID={`workspace-tab-${buildDeterministicWorkspaceTabId(tab.target)}`}
              triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
              enabled={menuEntries.length > 0}
              enabledOnMobile={false}
              style={tabChipStyle}
              onHoverIn={handleTabHoverIn}
              onHoverOut={handleTabHoverOut}
              onPressIn={handleNavigateTab}
              onPress={handleNavigateTab}
              accessibilityRole="button"
              accessibilityLabel={tooltipLabel}
              accessibilityState={tabAccessibilityState}
              aria-selected={isActive}
            >
              {hovered && !isActive ? (
                <View
                  style={vertical ? styles.tabHoverUnderlayVertical : styles.tabHoverUnderlay}
                  pointerEvents="none"
                />
              ) : null}
              {isActive ? (
                <View
                  style={
                    vertical ? styles.tabActiveInnerAccentVertical : styles.tabActiveInnerAccent
                  }
                  pointerEvents="none"
                />
              ) : null}
              <TabHandleContent
                presentation={presentation}
                isHighlighted={isHighlighted}
                isActiveTab={isActive && isFocused}
                showLabel={showLabel}
                tabLabelSkeletonStyle={tabLabelSkeletonStyle}
                tabLabelStyle={tabLabelStyle}
              />
              <TabShortcutDiscoveryHint isFocused={isFocused} shortcutIndex={shortcutIndex} />

              {showTabCloseButton ? (
                <Pressable
                  {...(closeButtonDragBlockers as object | undefined)}
                  testID={closeButtonTestId}
                  disabled={isClosingTab}
                  onPressIn={handleCloseButtonPressIn}
                  onHoverIn={handleCloseButtonHoverIn}
                  onHoverOut={handleCloseButtonHoverOut}
                  onPress={handleCloseButtonPress}
                  style={closeButtonStyle}
                >
                  {({ hovered: closeHovered, pressed }) => {
                    const isCloseEmphasized = Boolean(closeHovered) || pressed;
                    return (
                      <TabCloseButtonContents
                        isActive={isActive}
                        isFocused={isFocused}
                        isClosingTab={isClosingTab}
                        onBlack={onBlack}
                        isCloseEmphasized={isCloseEmphasized}
                      />
                    );
                  }}
                </Pressable>
              ) : null}
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <View style={styles.newTabTooltipRow}>
              <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
              {tabShortcutKeys ? <Shortcut chord={tabShortcutKeys} /> : null}
            </View>
          </TooltipContent>
        </Tooltip>

        <ContextMenuContent align="start" width={DROPDOWN_WIDTH} testID={contextMenuTestId}>
          {menuEntries.map((entry) =>
            entry.kind === "separator" ? (
              <ContextMenuSeparator key={entry.key} />
            ) : (
              <TabContextMenuItem key={entry.key} entry={entry} />
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    </View>
  );
}

// The resolved menu row - a real component (not the resolver's render callback)
// so it can memoize the leading icon element, which the react-perf lint requires
// for JSX-valued props.
function HiddenTabMenuItemRow({
  tab,
  presentation,
  onSelect,
}: {
  tab: WorkspaceTabDescriptor;
  presentation: WorkspaceTabPresentation;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const leading = useMemo(() => <WorkspaceTabIcon presentation={presentation} />, [presentation]);
  return (
    <DropdownMenuItem
      testID={`workspace-tab-overflow-item-${buildDeterministicWorkspaceTabId(tab.target)}`}
      onSelect={onSelect}
      leading={leading}
    >
      {presentation.titleState === "loading"
        ? t("workspace.tabs.loadingAgentTitle")
        : presentation.label}
    </DropdownMenuItem>
  );
}

// One row of the tab-overflow menu: the tab's real icon + title (resolved the
// same way the visible chips are), selecting it swaps the tab into the visible
// strip and focuses it. Only mounts while the menu is open (DropdownMenuContent
// renders nothing when closed), so hidden tabs cost no presentation resolvers
// until the user looks.
function HiddenTabMenuItem({
  item,
  normalizedServerId,
  normalizedWorkspaceId,
  onSelectTab,
}: {
  item: WorkspaceDesktopTabRowItem;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onSelectTab: (tabId: string) => void;
}) {
  const handleSelect = useCallback(
    () => onSelectTab(item.tab.tabId),
    [onSelectTab, item.tab.tabId],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={item.tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {(presentation) => (
        <HiddenTabMenuItemRow tab={item.tab} presentation={presentation} onSelect={handleSelect} />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

/**
 * The tab-overflow control: an always-visible button at the end of the strip
 * showing the hidden-tab count, opening a menu of the tabs that didn't fit.
 * Deliberately distinct from the trailing more-actions chevron (▾) next to it -
 * a horizontal ellipsis plus a count, reading as "more tabs this way" rather
 * than "more actions". Only rendered when at least one tab is hidden.
 */
function HiddenTabsOverflowMenu({
  hiddenTabs,
  normalizedServerId,
  normalizedWorkspaceId,
  onSelectTab,
}: {
  hiddenTabs: WorkspaceDesktopTabRowItem[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onSelectTab: (tabId: string) => void;
}) {
  // i18n: English-only pending a translation pass (tab overflow).
  const label = hiddenTabs.length === 1 ? "1 hidden tab" : `${hiddenTabs.length} hidden tabs`;
  // Self-hide when nothing overflows, so the row can render this unconditionally.
  if (hiddenTabs.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="triggerRef">
          <DropdownMenuTrigger
            testID="workspace-tab-overflow-trigger"
            accessibilityRole="button"
            accessibilityLabel={label}
            style={tabOverflowButtonStyle}
          >
            <ThemedMoreHorizontal size={14} uniProps={mutedColorMapping} />
            <Text style={styles.tabOverflowCount}>{hiddenTabs.length}</Text>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={styles.newTabTooltipText}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="end" offset={4} minWidth={220}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {hiddenTabs.map((item) => (
          <HiddenTabMenuItem
            key={`${item.tab.key}:${item.tab.kind}`}
            item={item}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            onSelectTab={onSelectTab}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Splits a pane's tabs into the visible strip and the overflow menu, and owns
 * the select-to-swap reorder. Kept as a hook (rather than inline in the row) so
 * the row stays under the cyclomatic-complexity cap; all overflow logic lives in
 * one place.
 */
function useWorkspaceTabOverflow({
  tabs,
  focusedTab,
  contentWidth,
  toolsStripWidth,
  onReorderTabs,
  onNavigateTab,
}: {
  tabs: WorkspaceDesktopTabRowItem[];
  focusedTab: WorkspaceTabDescriptor | null;
  /** Measured content strip width (0 until laid out). */
  contentWidth: number;
  /** Measured width of the trailing tools/actions strip. */
  toolsStripWidth: number;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  onNavigateTab: (tabId: string) => void;
}): {
  visibleTabs: WorkspaceDesktopTabRowItem[];
  hiddenTabs: WorkspaceDesktopTabRowItem[];
  hasHiddenTabs: boolean;
  compactLabels: boolean;
  /** Width to reserve for the overflow control (0 when no tabs are hidden). */
  overflowReservedWidth: number;
  handleSelectHiddenTab: (tabId: string) => void;
} {
  const activeTabId = focusedTab?.tabId ?? tabs.find((item) => item.isActive)?.tab.tabId ?? null;
  // Width the chips share, before any overflow reserve: the content strip minus
  // the orientation toggle, the tools/actions strip, and the row's own padding
  // (4px each side - mirrors layoutMetrics). 0 until measured.
  const availableWidth =
    contentWidth > 0
      ? Math.max(0, contentWidth - ORIENTATION_TOGGLE_RESERVED_WIDTH - toolsStripWidth - 8)
      : 0;
  // Preserve labels for as long as every tab can retain its readable minimum.
  // Once that is no longer possible, compact the visible tab chips. Overflow
  // continues to use its established capacity and selection behavior.
  const compactLabels = availableWidth > 0 && availableWidth < tabs.length * TAB_MIN_WIDTH;
  const cap = computeVisibleTabCount({
    totalTabs: tabs.length,
    availableWidth,
    minTabWidth: TAB_MIN_WIDTH,
    overflowControlWidth: TAB_OVERFLOW_CONTROL_WIDTH,
  });
  const split = useMemo(
    () =>
      splitTabsForOverflow({
        items: tabs,
        getId: (item) => item.tab.tabId,
        activeId: activeTabId,
        cap,
      }),
    [tabs, activeTabId, cap],
  );

  // Overflow-menu selection: swap the picked hidden tab into the last visible
  // slot (bumping the tab there into the menu) and focus it. Reordering the full
  // order - not just the visible slice - keeps the persisted tab order and the
  // bump semantics intact.
  const handleSelectHiddenTab = useCallback(
    (tabId: string) => {
      const orderedIds = reorderTabIntoVisible({
        tabIds: tabs.map((item) => item.tab.tabId),
        selectedId: tabId,
        cap,
      });
      const byId = new Map(tabs.map((item) => [item.tab.tabId, item.tab]));
      const nextDescriptors = orderedIds
        .map((id) => byId.get(id))
        .filter((tab): tab is WorkspaceTabDescriptor => Boolean(tab));
      onReorderTabs(nextDescriptors);
      onNavigateTab(tabId);
    },
    [cap, onNavigateTab, onReorderTabs, tabs],
  );

  const hasHiddenTabs = split.hidden.length > 0;
  return {
    visibleTabs: split.visible,
    hiddenTabs: split.hidden,
    hasHiddenTabs,
    compactLabels,
    overflowReservedWidth: hasHiddenTabs ? TAB_OVERFLOW_CONTROL_WIDTH : 0,
    handleSelectHiddenTab,
  };
}

// oxlint-disable-next-line complexity
export function WorkspaceDesktopTabsRow({
  paneId,
  isFocused = false,
  tabs,
  focusedTab = null,
  normalizedServerId,
  normalizedWorkspaceId,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  onCopyResumeCommand,
  onCopyTerminalId,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onArchiveAgent,
  onDeleteAgent,
  onMoveTabToExplorer,
  onCreateDraftTab,
  onCreateTerminalTab,
  onCreateBrowserTab,
  showCreateBrowserTab = false,
  disableCreateTerminal = false,
  isWaitingOnTerminalReadiness = false,
  onReorderTabs,
  onSplitRight,
  onSplitDown,
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  showPaneSplitActions = true,
  showPaneMaximizeAction = false,
  paneMaximized = false,
  onTogglePaneMaximized,
  focusModeEnabled = false,
  onExitFocusMode,
  tabOrientation,
  onToggleTabOrientation,
  windowControlsInset,
}: WorkspaceDesktopTabsRowProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [tabsContainerWidth, setTabsContainerWidth] = useState<number>(0);
  const [tabsActionsWidth, setTabsActionsWidth] = useState<number>(0);
  // Tools reveal on hover anywhere over the tab bar row, tab chips included.
  // Two trackers cover it because in the Electron desktop app the row's empty
  // gutter is a titlebar drag region (TitlebarDragRegion in split-container),
  // whose pixels never deliver DOM pointer events - only the no-drag islands
  // (chips, buttons, the tools strip) do. DOM pointerenter/leave covers those
  // islands; useNonClientHover covers the drag gutter via cursor positions
  // polled and forwarded by the Electron main process (Windows only; macOS
  // delivers DOM hover over drag regions natively). See docs/hover.md.
  const rowRef = useRef<View | null>(null);
  const [rowHovered, setRowHovered] = useState(false);
  const gutterHovered = useNonClientHover(rowRef);

  const handleRowPointerEnter = useCallback(() => setRowHovered(true), []);
  const handleRowPointerLeave = useCallback(() => setRowHovered(false), []);

  const handleTabsContainerLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsContainerWidth, event);
  }, []);

  // The window-controls reserve is applied as padding *inside* the tabsContainer
  // (keeping its background + hairline full-width), so the measured container
  // width now includes that reserve. Subtract it back out for the tab-layout and
  // tools-overflow math, which reason about the usable content strip.
  const insetLeft = windowControlsInset?.left ?? 0;
  const insetRight = windowControlsInset?.right ?? 0;
  const contentWidth = Math.max(0, tabsContainerWidth - insetLeft - insetRight);
  const tabsContainerStyle = useMemo(
    () =>
      insetLeft === 0 && insetRight === 0
        ? styles.tabsContainer
        : [styles.tabsContainer, { paddingLeft: insetLeft, paddingRight: insetRight }],
    [insetLeft, insetRight],
  );

  const handleTabsActionsLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsActionsWidth, event);
  }, []);

  // Labels collapse on the visible chips once the existing tab-capacity
  // calculation is under pressure. The active tab remains visible (see
  // splitTabsForOverflow); the full list still drives pane facts and
  // select-to-swap reordering.
  const { visibleTabs, hiddenTabs, compactLabels, overflowReservedWidth, handleSelectHiddenTab } =
    useWorkspaceTabOverflow({
      tabs,
      focusedTab,
      contentWidth,
      toolsStripWidth: tabsActionsWidth,
      onReorderTabs,
      onNavigateTab,
    });

  const layoutMetrics = useMemo(
    () => ({
      rowHorizontalInset: 0,
      // Reserve the overflow control's slot alongside the actions strip so the
      // visible chips never render underneath it - reserve is 0 unless tabs are
      // actually hidden and the control is mounted.
      actionsReservedWidth: Math.max(
        0,
        tabsActionsWidth + ORIENTATION_TOGGLE_RESERVED_WIDTH + overflowReservedWidth,
      ),
      // Mirrors tabsContent's paddingHorizontal so width math stays exact.
      rowPaddingHorizontal: 4,
      tabGap: 0,
      minTabWidth: TAB_MIN_WIDTH,
      maxTabWidth: TAB_MAX_WIDTH,
      tabIconWidth: TAB_ICON_WIDTH,
      tabContentGap: TAB_CONTENT_GAP,
      tabHorizontalPadding: TAB_HORIZONTAL_PADDING,
      estimatedCharWidth: TAB_ESTIMATED_CHAR_WIDTH,
      closeButtonWidth: TAB_CLOSE_BUTTON_WIDTH,
    }),
    [overflowReservedWidth, tabsActionsWidth],
  );

  const fallbackTabLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
    }),
    [t],
  );
  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyTerminalId: t("workspace.tabs.menu.copyTerminalId"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyFilename: t("workspace.tabs.menu.copyFilename"),
      copyFullPath: t("workspace.tabs.menu.copyFullPath"),
      copyWorkspacePath: t("workspace.tabs.menu.copyWorkspacePath"),
      rename: t("workspace.tabs.menu.rename"),
      moveToWorkspace: t("workspace.tabs.menu.moveToWorkspace"),
      moveToExplorer: t("workspace.tabs.menu.moveToExplorer"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeUp: t("workspace.tabs.menu.closeUp"),
      closeDown: t("workspace.tabs.menu.closeDown"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
  const tabLabelLengths = useMemo(
    () =>
      visibleTabs.map((tab) => {
        const label = getFallbackTabLabel(tab.tab, fallbackTabLabels);
        return label.length;
      }),
    [fallbackTabLabels, visibleTabs],
  );
  const { focusedAgentId, paneHasEditableAgentTab, paneHasPreviewTab } = usePaneTabAgentFacts({
    tabs,
    focusedTab,
    normalizedServerId,
  });

  // The row estimates label width from character count rather than measuring;
  // `estimatedCharWidth` is the conversion the rail's sizing already uses.
  const tabLabelWidths = useMemo(
    () => tabLabelLengths.map((length) => length * TAB_ESTIMATED_CHAR_WIDTH),
    [tabLabelLengths],
  );
  const { layout } = useWorkspaceTabLayout({
    tabLabelWidths,
    viewportWidthOverride: contentWidth > 0 ? contentWidth : null,
    metrics: layoutMetrics,
    compactLabels,
  });

  const handleDragEnd = useCallback(
    (nextTabs: WorkspaceDesktopTabRowItem[]) => {
      onReorderTabs(nextTabs.map((tab) => tab.tab));
    },
    [onReorderTabs],
  );

  const getTabDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (tab: WorkspaceDesktopTabRowItem) => ({
      kind: "workspace-tab" as const,
      paneId,
      tabId: tab.tab.tabId,
    });
  }, [paneId]);

  const handleCreateAgentTab = useCallback(() => {
    onCreateDraftTab({ paneId });
  }, [onCreateDraftTab, paneId]);

  const handleCreateTerminal = useCallback(() => {
    onCreateTerminalTab({ paneId });
  }, [onCreateTerminalTab, paneId]);

  const handleCreateTerminalWithProfile = useCallback(
    (profile: TerminalProfile) => {
      onCreateTerminalTab({ paneId, profile });
    },
    [onCreateTerminalTab, paneId],
  );

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);

  const handleCreateBrowser = useCallback(() => {
    onCreateBrowserTab({ paneId });
  }, [onCreateBrowserTab, paneId]);

  const terminalDisabled = disableCreateTerminal || isWaitingOnTerminalReadiness;

  // Full-order index per tab id. The rendered list is only the visible slice, so
  // the list's own index can't drive the chip's context-menu math (close
  // left/right/others), which must reason about the tab's place in the whole
  // pane, hidden tabs included.
  const fullIndexById = useMemo(
    () => new Map(tabs.map((item, index) => [item.tab.tabId, index])),
    [tabs],
  );

  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<WorkspaceDesktopTabRowItem>) => {
      const shouldShowCloseButton = layout.closeButtonPolicy === "all";
      const layoutItem = layout.items[index] ?? null;
      const resolvedTabWidth = layoutItem?.width ?? 150;
      const showLabel = layoutItem?.showLabel ?? true;
      // Drop indicators reason about the rendered (visible) list, so they use the
      // list index; the trailing pill only rides the last visible chip.
      const showDropIndicatorBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showDropIndicatorAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === visibleTabs.length &&
        index === visibleTabs.length - 1;

      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={fullIndexById.get(item.tab.tabId) ?? index}
          tabCount={tabs.length}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyTerminalId={onCopyTerminalId}
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          onArchiveAgent={onArchiveAgent}
          onDeleteAgent={onDeleteAgent}
          onMoveTabToExplorer={onMoveTabToExplorer}
          resolvedTabWidth={resolvedTabWidth}
          showLabel={showLabel}
          showCloseButton={shouldShowCloseButton}
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          onNavigateTab={onNavigateTab}
          onCloseTab={onCloseTab}
          labels={tabMenuLabels}
          dragHandleProps={dragHandleProps}
          showDropIndicatorBefore={showDropIndicatorBefore}
          showDropIndicatorAfter={showDropIndicatorAfter}
        />
      );
    },
    [
      activeDragTabId,
      fullIndexById,
      isFocused,
      layout.closeButtonPolicy,
      layout.items,
      normalizedServerId,
      normalizedWorkspaceId,
      onCloseOtherTabs,
      onArchiveAgent,
      onDeleteAgent,
      onMoveTabToExplorer,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onCopyTerminalId,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      setHoveredCloseTabKey,
      tabMenuLabels,
      tabDropPreviewIndex,
      tabs.length,
      visibleTabs.length,
    ],
  );

  const tabsScrollStyle = useMemo(
    () => [
      styles.tabsScroll,
      layout.requiresHorizontalScrollFallback
        ? styles.tabsScrollOverflow
        : styles.tabsScrollFitContent,
    ],
    [layout.requiresHorizontalScrollFallback],
  );

  const row = (
    <View
      ref={rowRef}
      style={tabsContainerStyle}
      testID="workspace-tabs-row"
      onLayout={handleTabsContainerLayout}
      onPointerEnter={handleRowPointerEnter}
      onPointerLeave={handleRowPointerLeave}
    >
      <View style={styles.tabsBottomHairline} pointerEvents="none" />
      <View style={ORIENTATION_TOGGLE_SLOT_STYLE}>
        <TabOrientationToggleButton
          orientation={tabOrientation}
          onToggle={onToggleTabOrientation}
        />
      </View>
      <ScrollView
        horizontal
        scrollEnabled={layout.requiresHorizontalScrollFallback}
        testID="workspace-tabs-scroll"
        style={tabsScrollStyle}
        contentContainerStyle={styles.tabsContent}
        showsHorizontalScrollIndicator={false}
      >
        <SortableInlineList
          data={visibleTabs}
          keyExtractor={tabKeyExtractor}
          useDragHandle
          disabled={!externalDndContext && visibleTabs.length < 2}
          onDragEnd={handleDragEnd}
          externalDndContext={externalDndContext}
          activeId={activeDragTabId}
          getItemData={getTabDragData}
          renderItem={renderTab}
        />
      </ScrollView>
      <HiddenTabsOverflowMenu
        hiddenTabs={hiddenTabs}
        normalizedServerId={normalizedServerId}
        normalizedWorkspaceId={normalizedWorkspaceId}
        onSelectTab={handleSelectHiddenTab}
      />
      <WorkspaceTabRowExtras
        onCreateAgentTab={handleCreateAgentTab}
        onCreateTerminal={handleCreateTerminal}
        onCreateBrowser={handleCreateBrowser}
        onCreateTerminalWithProfile={handleCreateTerminalWithProfile}
        onEditProfiles={handleEditProfiles}
        normalizedServerId={normalizedServerId}
        normalizedWorkspaceId={normalizedWorkspaceId}
        paneId={paneId}
        focusedAgentId={focusedAgentId}
        showCreateBrowserTab={showCreateBrowserTab}
        showPreviewButton={showCreateBrowserTab && !paneHasPreviewTab && paneHasEditableAgentTab}
        terminalDisabled={terminalDisabled}
        onSplitRight={onSplitRight}
        onSplitDown={onSplitDown}
        showPaneSplitActions={showPaneSplitActions}
        onStripLayout={handleTabsActionsLayout}
        rowHovered={rowHovered || gutterHovered}
        showPaneMaximizeAction={showPaneMaximizeAction}
        paneMaximized={paneMaximized}
        onTogglePaneMaximized={onTogglePaneMaximized}
        focusModeEnabled={focusModeEnabled}
        onExitFocusMode={onExitFocusMode}
      />
    </View>
  );

  return <RenderProfile id="WorkspaceDesktopTabsRow">{row}</RenderProfile>;
}
// Exported so a sibling tab-item consumer (the vertical rail) can render the
// exact same chip (presentation resolution + context menu + TabChip) without
// duplicating any of it.
export interface ResolvedDesktopTabChipProps {
  item: WorkspaceDesktopTabRowItem;
  isFocused: boolean;
  isDragging: boolean;
  index: number;
  tabCount: number;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (
    path: string,
    target?: "filename" | "full-path" | "workspace-path",
  ) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
  onMoveTabToExplorer?: (tabId: string) => void;
  resolvedTabWidth: ResolvedTabWidth;
  showLabel: boolean;
  showCloseButton: boolean;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  labels: WorkspaceTabMenuLabels;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
  /** Rotates the chip chrome 90° CCW for the vertical rail - see tabVertical. */
  orientation?: "horizontal" | "vertical";
}

export function ResolvedDesktopTabChip({
  item,
  isFocused,
  isDragging,
  index,
  tabCount,
  normalizedServerId,
  normalizedWorkspaceId,
  onCopyResumeCommand,
  onCopyTerminalId,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onArchiveAgent,
  onDeleteAgent,
  onMoveTabToExplorer,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  labels,
  dragHandleProps,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
  orientation = "horizontal",
}: ResolvedDesktopTabChipProps) {
  const { t } = useTranslation();
  const isDeveloperMode = useIsDeveloperMode();
  const workspaceDirectory = useWorkspace(
    normalizedServerId,
    normalizedWorkspaceId,
  )?.workspaceDirectory;
  const { onMoveToWorkspace, canMove } = useMoveChatMenu(normalizedServerId);
  const resolvedTab = useMemo(
    () =>
      buildWorkspaceDesktopTabActions({
        tab: item.tab,
        orientation,
        index,
        tabCount,
        workspaceDirectory,
        isDeveloperMode,
        onCopyResumeCommand,
        onCopyTerminalId,
        onCopyAgentId,
        onCopyFilePath,
        onReloadAgent,
        onRenameTab,
        onCloseTab,
        onCloseTabsToLeft,
        onCloseTabsToRight,
        onCloseOtherTabs,
        onArchiveAgent,
        onDeleteAgent,
        onMoveToWorkspace,
        canMoveToWorkspace: canMove,
        onMoveToExplorer: onMoveTabToExplorer,
        canMoveToExplorer: panelTargetSupportsHost(normalizedServerId, item.tab.target, "explorer"),
        labels,
      }),
    [
      canMove,
      index,
      item.tab,
      isDeveloperMode,
      normalizedServerId,
      orientation,
      onMoveToWorkspace,
      onMoveTabToExplorer,
      onCloseOtherTabs,
      onArchiveAgent,
      onDeleteAgent,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onCopyTerminalId,
      labels,
      onReloadAgent,
      onRenameTab,
      tabCount,
      workspaceDirectory,
    ],
  );

  return (
    <WorkspaceTabPresentationResolver
      tab={item.tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {(presentation) => {
        const tooltipLabel =
          presentation.titleState === "loading"
            ? t("workspace.tabs.loadingAgentTitle")
            : presentation.label;

        return (
          <View style={styles.tabSlot}>
            {showDropIndicatorBefore ? (
              <View
                style={
                  orientation === "vertical"
                    ? TAB_DROP_INDICATOR_ABOVE_STYLE
                    : TAB_DROP_INDICATOR_BEFORE_STYLE
                }
              />
            ) : null}
            <TabChip
              tab={item.tab}
              isActive={item.isActive}
              isDragging={isDragging}
              isFocused={isFocused}
              shortcutIndex={isFocused && index < 9 ? index + 1 : null}
              resolvedTabWidth={resolvedTabWidth}
              showLabel={showLabel}
              showCloseButton={showCloseButton}
              isCloseHovered={item.isCloseHovered}
              isClosingTab={item.isClosingTab}
              presentation={presentation}
              tooltipLabel={tooltipLabel}
              resolvedTab={resolvedTab}
              setHoveredCloseTabKey={setHoveredCloseTabKey}
              onNavigateTab={onNavigateTab}
              onCloseTab={onCloseTab}
              dragHandleProps={dragHandleProps}
              orientation={orientation}
            />
            {showDropIndicatorAfter ? (
              <View
                style={
                  orientation === "vertical"
                    ? TAB_DROP_INDICATOR_BELOW_STYLE
                    : TAB_DROP_INDICATOR_AFTER_STYLE
                }
              />
            ) : null}
          </View>
        );
      }}
    </WorkspaceTabPresentationResolver>
  );
}

const styles = StyleSheet.create((theme) => ({
  tabsContainer: {
    minWidth: 0,
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    backgroundColor: theme.colors.surfaceSidebar,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "visible",
  },
  // The row/pane separator is a positioned child rather than a borderBottom so
  // the active tab (which bottom-aligns flush with the container edge) can
  // paint over it and fuse with the pane content below.
  tabsBottomHairline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  tabsScroll: {
    minWidth: 0,
  },
  tabsScrollFitContent: {
    flex: 1,
  },
  tabsScrollOverflow: {
    flex: 1,
  },
  tabsContent: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: "100%",
    paddingHorizontal: theme.spacing[1],
  },
  tabsActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
  // Slot for the orientation toggle at the row's left edge - mirrored by the
  // rail header's left group so the control doesn't move when the user
  // toggles between modes. Width must stay in sync with
  // ORIENTATION_TOGGLE_RESERVED_WIDTH.
  orientationToggleSlot: {
    alignSelf: "center",
    paddingLeft: theme.spacing[2],
  },
  // Hover-revealed tools group. Hidden via opacity (never conditional
  // rendering or width changes) so the strip's geometry - and therefore the
  // tab layout math - is identical whether or not the pointer is over it.
  tabsTools: {
    flexDirection: "row",
    alignItems: "center",
    ...(isWeb
      ? {
          transitionProperty: "opacity",
          transitionDuration: "120ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  tabsToolsHidden: {
    opacity: 0,
    pointerEvents: "none",
  },
  // Chip is 1px shorter than the row minus its top inset so its bottom edge
  // lands exactly on the container edge, covering the hairline when active.
  tab: {
    position: "relative",
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT - theme.spacing[1],
    // Kept in sync with TAB_HORIZONTAL_PADDING (workspace-tab-layout.ts) so
    // the width math matches what the chip actually renders.
    paddingHorizontal: theme.spacing[2],
    borderTopLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.lg,
    // Constant border widths on every tab (transparent when inactive) so the
    // label area doesn't shift by a pixel when a tab becomes active.
    borderTopWidth: theme.borderWidth[1],
    borderLeftWidth: theme.borderWidth[1],
    borderRightWidth: theme.borderWidth[1],
    borderTopColor: "transparent",
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  tabShortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[1],
    zIndex: 1,
  },
  // Vertical-rail chrome: the horizontal chip's chrome turned 90° counter-
  // clockwise while keeping the wide shape. The opening moves from the bottom
  // edge to the right edge (where the chip meets the pane content), the
  // rounded corners and the outline's cap to the left, and the remaining
  // border sides to top/bottom. Same constant-border-width trick as the base
  // style so labels don't shift when a tab activates.
  tabVertical: {
    borderTopLeftRadius: theme.borderRadius.lg,
    borderBottomLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  // Hover wash is an inset underlay rather than a background on the chip so
  // it sits 1px inside the chip bounds on top/left/right and 1px off the
  // bottom edge (the chip's transparent 1px borders provide the side inset).
  tabHoverUnderlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 1,
    borderTopLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  // Vertical counterpart: the 1px inset moves from the bottom edge (pane seam
  // below) to the right edge (pane seam to the right).
  tabHoverUnderlayVertical: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 1,
    bottom: 0,
    borderTopLeftRadius: theme.borderRadius.lg,
    borderBottomLeftRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  // Active outline is an accent-to-border vertical gradient (accent at the tab
  // top, fading into the plain pane border where the chip meets the content).
  // The accent stop is `borderTabActive` (half-alpha accent, derived in the
  // theme builders); the border stop stays solid so the fade still fuses with
  // the pane border below. The alpha must be baked into the token: on web a
  // theme color read here is a CSS var, so an alpha suffix like `${accent}80`
  // is invalid CSS and silently drops the whole declaration (fill layer
  // included).
  // On web this is the two-layer gradient-border technique: the fill layer is
  // clipped to the padding box, the gradient layer to the border box, so the
  // gradient shows only through the transparent 1px border ring. Native can't
  // paint gradient borders, so it falls back to a solid accent ring.
  tabActive: isWeb
    ? ({
        backgroundImage:
          `linear-gradient(${theme.colors.surface0}, ${theme.colors.surface0}), ` +
          `linear-gradient(to bottom, ${theme.colors.borderTabActive}, ${theme.colors.border})`,
        backgroundOrigin: "border-box",
        backgroundClip: "padding-box, border-box",
      } as object)
    : {
        backgroundColor: theme.colors.surface0,
        borderTopColor: theme.colors.borderTabActive,
        borderLeftColor: theme.colors.borderTabActive,
        borderRightColor: theme.colors.borderTabActive,
      },
  // Vertical counterpart of tabActive: the accent-to-border fade runs left to
  // right (accent at the outline's left cap, fusing with the pane border at
  // the open right edge). Same two-layer gradient-border technique on web,
  // solid accent ring fallback on native.
  tabActiveVertical: isWeb
    ? ({
        backgroundImage:
          `linear-gradient(${theme.colors.surface0}, ${theme.colors.surface0}), ` +
          `linear-gradient(to right, ${theme.colors.borderTabActive}, ${theme.colors.border})`,
        backgroundOrigin: "border-box",
        backgroundClip: "padding-box, border-box",
      } as object)
    : {
        backgroundColor: theme.colors.surface0,
        borderTopColor: theme.colors.borderTabActive,
        borderLeftColor: theme.colors.borderTabActive,
        borderBottomColor: theme.colors.borderTabActive,
      },
  // Terminal tabs fuse with the terminal emulator, whose xterm background is
  // `surfaceCode` (components/terminal-pane.tsx). Keep the same active-border
  // gradient and replace only the fill layer.
  tabActiveTerminal: {
    backgroundColor: theme.colors.surfaceCode,
    ...(isWeb
      ? ({
          backgroundImage:
            `linear-gradient(${theme.colors.surfaceCode}, ${theme.colors.surfaceCode}), ` +
            `linear-gradient(to bottom, ${theme.colors.borderTabActive}, ${theme.colors.border})`,
        } as object)
      : {}),
  },
  tabActiveTerminalVertical: {
    backgroundColor: theme.colors.surfaceCode,
    ...(isWeb
      ? ({
          backgroundImage:
            `linear-gradient(${theme.colors.surfaceCode}, ${theme.colors.surfaceCode}), ` +
            `linear-gradient(to right, ${theme.colors.borderTabActive}, ${theme.colors.border})`,
        } as object)
      : {}),
  },
  // Inner highlight sheen on the active tab: an echo of the outline in the
  // outline's own accent, lightened and at 25% alpha (`borderTabActiveInner`),
  // fading to transparent toward the bottom. Its cap is a hair thicker (1.5px)
  // than its thin sides; the top starts at the padding box, i.e. exactly one
  // normal border-thickness below the tab's top edge, and the left/right
  // offsets put its thin side lines on the outline's sides.
  // On web the gradient is painted across the whole overlay and masked down
  // to the border ring (padding-box knocked out of border-box), which keeps
  // the rounded corners. Native can't paint gradient borders, so it falls
  // back to a solid ring, matching the tabActive fallback.
  tabActiveInnerAccent: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: -theme.borderWidth[1],
    right: -theme.borderWidth[1],
    borderTopLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.lg,
    borderTopWidth: 1.5,
    borderLeftWidth: theme.borderWidth[1],
    borderRightWidth: theme.borderWidth[1],
    borderTopColor: "transparent",
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    pointerEvents: "none",
    ...(isWeb
      ? ({
          backgroundImage: `linear-gradient(to bottom, ${theme.colors.borderTabActiveInner}, transparent)`,
          backgroundOrigin: "border-box",
          backgroundClip: "border-box",
          maskImage: "linear-gradient(#fff 0 0), linear-gradient(#fff 0 0)",
          maskClip: "padding-box, border-box",
          maskComposite: "exclude",
        } as object)
      : {
          borderTopColor: theme.colors.borderTabActiveInner,
          borderLeftColor: theme.colors.borderTabActiveInner,
          borderRightColor: theme.colors.borderTabActiveInner,
        }),
  },
  // Vertical counterpart of tabActiveInnerAccent: the 1.5px cap moves to the
  // left edge, the thin side lines to top/bottom (offset -1px to sit on the
  // outline's sides), and the sheen fades to transparent toward the open
  // right edge.
  tabActiveInnerAccentVertical: {
    position: "absolute",
    top: -theme.borderWidth[1],
    bottom: -theme.borderWidth[1],
    left: 0,
    right: 0,
    borderTopLeftRadius: theme.borderRadius.lg,
    borderBottomLeftRadius: theme.borderRadius.lg,
    borderLeftWidth: 1.5,
    borderTopWidth: theme.borderWidth[1],
    borderBottomWidth: theme.borderWidth[1],
    borderLeftColor: "transparent",
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    pointerEvents: "none",
    ...(isWeb
      ? ({
          backgroundImage: `linear-gradient(to right, ${theme.colors.borderTabActiveInner}, transparent)`,
          backgroundOrigin: "border-box",
          backgroundClip: "border-box",
          maskImage: "linear-gradient(#fff 0 0), linear-gradient(#fff 0 0)",
          maskClip: "padding-box, border-box",
          maskComposite: "exclude",
        } as object)
      : {
          borderLeftColor: theme.colors.borderTabActiveInner,
          borderTopColor: theme.colors.borderTabActiveInner,
          borderBottomColor: theme.colors.borderTabActiveInner,
        }),
  },
  // Black tab background setting: the active chat tab's fill inside the border
  // goes pure black so it fuses with the black chat pane below (see the
  // `black` scoped theme in `panels/agent-panel.tsx`). On web the fill lives
  // in the first background layer, so it must be re-declared there too.
  tabActiveBlack: {
    backgroundColor: "#000000",
    ...(isWeb
      ? ({
          backgroundImage:
            "linear-gradient(#000000, #000000), " +
            `linear-gradient(to bottom, ${theme.colors.borderTabActive}, ${theme.colors.border})`,
        } as object)
      : {}),
  },
  // Vertical counterpart of tabActiveBlack - same black fill, outline fade
  // rotated to run left-to-right like tabActiveVertical.
  tabActiveBlackVertical: {
    backgroundColor: "#000000",
    ...(isWeb
      ? ({
          backgroundImage:
            "linear-gradient(#000000, #000000), " +
            `linear-gradient(to right, ${theme.colors.borderTabActive}, ${theme.colors.border})`,
        } as object)
      : {}),
  },
  tabSlot: {
    position: "relative",
    overflow: "visible",
  },
  tabHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
    userSelect: "none",
  },
  tabIcon: {
    flexShrink: 0,
  },
  tabDropIndicator: {
    position: "absolute",
    top: theme.spacing[2],
    bottom: theme.spacing[2],
    width: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  tabDropIndicatorBefore: {
    left: -3,
  },
  tabDropIndicatorAfter: {
    right: -3,
  },
  // The rail's counterpart: the same pill turned 90°, so it reads as the gap
  // between two stacked chips rather than beside them. It is a separate base
  // style rather than an override because it has to unset top/bottom/width.
  tabDropIndicatorVertical: {
    position: "absolute",
    left: theme.spacing[2],
    right: theme.spacing[2],
    height: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  tabDropIndicatorAbove: {
    top: -3,
  },
  tabDropIndicatorBelow: {
    bottom: -3,
  },
  tabLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    // Tabs are compact navigation chrome. The smaller text leaves their
    // centered pill geometry intact while giving the workspace more breathing room.
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
  },
  tabLabelSkeleton: {
    width: 96,
    maxWidth: "100%",
    flexShrink: 1,
    minWidth: 0,
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.9,
  },
  tabLabelSkeletonWithCloseButton: {
    width: LOADING_TAB_LABEL_SKELETON_WIDTH,
  },
  tabLabelWithCloseButton: {
    paddingRight: 0,
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabLabelAccent: {
    color: theme.colors.accent,
  },
  tabLabelOnBlack: {
    color: ON_BLACK_FOREGROUND,
  },
  tabCloseButton: {
    width: 18,
    height: 18,
    marginLeft: 0,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCloseButtonContents: {
    position: "relative",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  tabCloseShortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
    zIndex: 1,
  },
  tabCloseButtonShown: {
    opacity: 1,
  },
  tabCloseButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  tabCloseButtonActiveOnBlack: {
    backgroundColor: "#27272a",
  },
  newTabActionButton: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  newTabActionButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  shortcutDiscoveryAnchor: {
    position: "relative",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
  },
  // The tab-overflow control: wider than the square action buttons because it
  // pairs the ellipsis icon with the hidden-tab count. alignSelf centers it in
  // the row (its siblings - the tabs scroll and the actions strip - stretch).
  tabOverflowButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    height: 22,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    alignSelf: "center",
  },
  tabOverflowCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  newTabTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  newTabTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  newTabTooltipShortcut: {},
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  terminalProfileIconWrapper: {
    width: 14,
    height: 14,
  },
}));

const TAB_DROP_INDICATOR_BEFORE_STYLE = [styles.tabDropIndicator, styles.tabDropIndicatorBefore];
const TAB_DROP_INDICATOR_AFTER_STYLE = [styles.tabDropIndicator, styles.tabDropIndicatorAfter];
const TAB_DROP_INDICATOR_ABOVE_STYLE = [
  styles.tabDropIndicatorVertical,
  styles.tabDropIndicatorAbove,
];
const TAB_DROP_INDICATOR_BELOW_STYLE = [
  styles.tabDropIndicatorVertical,
  styles.tabDropIndicatorBelow,
];
const TABS_TOOLS_HIDDEN_STYLE = [styles.tabsTools, styles.tabsToolsHidden];
// The tools strip opts out of the Electron titlebar drag region so its whole
// area - padding and hidden buttons included - delivers hover events, not just
// the no-drag holes the index.html backstop punches for the buttons themselves.
const TABS_ACTIONS_NO_DRAG_STYLE = isWeb ? ({ WebkitAppRegion: "no-drag" } as object) : null;
const TABS_ACTIONS_STYLE = [styles.tabsActions, TABS_ACTIONS_NO_DRAG_STYLE];
// The toggle slot sits in the row's Electron drag gutter, so it needs the
// same no-drag opt-out as the tools strip to receive clicks.
const ORIENTATION_TOGGLE_SLOT_STYLE = [styles.orientationToggleSlot, TABS_ACTIONS_NO_DRAG_STYLE];
