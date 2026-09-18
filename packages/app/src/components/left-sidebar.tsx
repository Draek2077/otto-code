import { router, usePathname } from "expo-router";
import { FolderPlus, History, Import, Search, Server, X } from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { useTutorialAnchor } from "@/tutorial/use-tutorial-anchor";
import { useRevealActiveWorkspace } from "@/components/sidebar/use-reveal-active-workspace";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveBrainRailRoute, useBrainRail } from "@/components/brain/use-brain-rail-state";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { HostPicker } from "@/components/hosts/host-picker";
import { shouldUseSingleColumnNavigation } from "@/components/sidebar/sidebar-navigation-layout";
import {
  FooterIconButton,
  resolveSidebarFooterActiveItem,
  SidebarFooterNavRow,
} from "@/components/sidebar/sidebar-footer-nav";
import { SidebarActiveTeamSwitchers } from "@/components/active-team-switcher";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { Shortcut } from "@/components/ui/shortcut";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSidebarSlide } from "@/hooks/use-sidebar-slide";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useAppSettings } from "@/hooks/use-settings";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { type SidebarGroupMode, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useHosts } from "@/runtime/host-runtime";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import {
  buildOpenProjectRoute,
  buildSessionsRoute,
  buildSettingsAddHostRoute,
  buildSettingsHostSectionRoute,
  buildStatsRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { compactUp, useIconSize } from "@/styles/theme";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";
import { SidebarActiveWorkspaceTools } from "./sidebar/sidebar-active-workspace-tools";
import { SidebarSeamShadow } from "./sidebar-seam-shadow";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
import { resolveDesktopSidebarWidth } from "./desktop-sidebar-layout";
import { type SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { sidebarNavPlacement } from "@/sidebar-nav/otto-sidebar-nav";
import { useImportSession } from "@/hooks/use-import-session";

// How much to shave off the window-controls top spacer: the DESKTOP_* height
// constants are one-size guesses that read as surplus space above the sidebar
// menu, so the menu is nudged up slightly. Shared with the settings sidebar so
// the two "Back to workspace" / "New workspace" rows stay vertically aligned.
export const SIDEBAR_TOP_SPACER_TRIM = 6;

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  workspaceGroups: SidebarWorkspaceGroup[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleImportSession: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  handleStats: () => void;
  handleBrain: () => void;
  labels: SidebarLabels;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  addProject: string;
  home: string;
  settings: string;
  stats: string;
  switchHost: string;
  searchHosts: string;
  sessions: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  active: boolean;
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
  handleViewMoreNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  isOpen: boolean;
  handleViewMore: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({ active = true }: { active?: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const brainRail = useBrainRail();

  const {
    projects,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    workspaceGroups,
    pinnedGroups,
    collapsedProjectKeys,
    toggleProjectCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;

  // Scroll the active workspace's row into view whenever the active workspace
  // changes (route-derived). No-ops when its row isn't in the mounted list.
  useRevealActiveWorkspace();

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenProjectPicker();
  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();
  const handleImportSessionMobile = useCallback(() => {
    showMobileAgent();
    openImportSession();
  }, [showMobileAgent, openImportSession]);

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      router.push(buildSettingsHostSectionRoute(serverId, "connections"));
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    router.push(buildSettingsHostSectionRoute(serverId, "connections"));
  }, []);

  const handleHomeMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildOpenProjectRoute());
  }, [showMobileAgent]);

  const handleHomeDesktop = useCallback(() => {
    router.push(buildOpenProjectRoute());
  }, []);

  const handleStatsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildStatsRoute());
  }, [showMobileAgent]);

  const handleStatsDesktop = useCallback(() => {
    router.push(buildStatsRoute());
  }, []);

  // Destructured, not passed whole: `useBrainRail` returns a fresh object every
  // poll, so depending on it would rebuild these handlers on every tick.
  const { disabled: isBrainDisabled, serverId: brainServerId } = brainRail;

  const handleBrainMobile = useCallback(() => {
    showMobileAgent();
    router.push(resolveBrainRailRoute({ disabled: isBrainDisabled, serverId: brainServerId }));
  }, [isBrainDisabled, brainServerId, showMobileAgent]);

  const handleBrainDesktop = useCallback(() => {
    router.push(resolveBrainRailRoute({ disabled: isBrainDisabled, serverId: brainServerId }));
  }, [isBrainDisabled, brainServerId]);

  const handleViewMoreNavigate = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const labels = useMemo(
    (): SidebarLabels => ({
      addProject: t("sidebar.actions.addProject"),
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      // Existing Otto footer label; navigation labels live in sidebar-nav.
      stats: "Metrics",
      switchHost: t("sidebar.host.switchTitle"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      sessions: t("sidebar.sections.sessions"),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    workspaceGroups,
    pinnedGroups,
    projects,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    handleImportSession: openImportSession,
    labels,
  };

  if (isCompactLayout) {
    return (
      <>
        <RetainedPanelActivity active={active && isOpen}>
          <MobileSidebar
            {...sharedProps}
            active={active}
            handleImportSession={handleImportSessionMobile}
            insetsTop={insets.top}
            insetsBottom={insets.bottom}
            closeSidebar={showMobileAgent}
            handleOpenProject={handleOpenProjectMobile}
            handleHome={handleHomeMobile}
            handleSettings={handleSettingsMobile}
            handleStats={handleStatsMobile}
            handleBrain={handleBrainMobile}
            handleAddHost={handleAddHostMobile}
            handleOpenHostSettings={handleOpenHostSettingsMobile}
            handleViewMoreNavigate={handleViewMoreNavigate}
          />
        </RetainedPanelActivity>
        {importSessionSheet}
      </>
    );
  }

  return (
    <>
      <RetainedPanelActivity active={active && isOpen}>
        <DesktopSidebar
          {...sharedProps}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          isOpen={isOpen}
          handleOpenProject={handleOpenProjectDesktop}
          handleHome={handleHomeDesktop}
          handleSettings={handleSettingsDesktop}
          handleStats={handleStatsDesktop}
          handleBrain={handleBrainDesktop}
          handleAddHost={handleAddHostDesktop}
          handleOpenHostSettings={handleOpenHostSettingsDesktop}
          handleViewMore={handleViewMoreNavigate}
        />
      </RetainedPanelActivity>
      {importSessionSheet}
    </>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function SidebarHostPicker({
  theme,
  switchHostLabel,
  onAddHost,
  onOpenHostSettings,
}: {
  theme: SidebarTheme;
  switchHostLabel: string;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const hosts = useHosts();
  const iconSize = useIconSize();
  const triggerRef = useRef<View | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      onOpenHostSettings(id);
    },
    [onOpenHostSettings],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);

  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild triggerRefProp="buttonRef">
          <FooterIconButton
            buttonRef={triggerRef}
            onPress={handleOpen}
            testID="sidebar-hosts-trigger"
            accessibilityLabel="Hosts"
            icon={Server}
            iconSize={iconSize.chromeLg}
            theme={theme}
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <HeaderIconTooltipContent label={switchHostLabel} />
        </TooltipContent>
      </Tooltip>
    </HostPicker>
  );
}

function AddProjectTooltipContent({
  newAgentKeys,
  label,
}: {
  newAgentKeys: ReturnType<typeof useShortcutKeys>;
  label: string;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {newAgentKeys ? <Shortcut chord={newAgentKeys} /> : null}
    </View>
  );
}

function HeaderIconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

function SidebarNavigationHeader({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const [isSingleColumn, setIsSingleColumn] = useState(false);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setIsSingleColumn(shouldUseSingleColumnNavigation(event.nativeEvent.layout.width));
  }, []);
  return (
    <View onLayout={handleLayout} style={styles.sidebarNavigationHeader}>
      <SidebarActiveTeamSwitchers onBeforeNavigate={onBeforeNavigate} />
      <SidebarNavRows isSingleColumn={isSingleColumn} onBeforeNavigate={onBeforeNavigate} />
    </View>
  );
}

function SidebarFooter({
  theme,
  handleHome,
  handleSettings,
  handleStats,
  handleBrain,
  labels,
  handleAddHost,
  handleOpenHostSettings,
}: {
  theme: SidebarTheme;
  handleHome: () => void;
  handleSettings: () => void;
  handleStats: () => void;
  handleBrain: () => void;
  labels: {
    home: string;
    settings: string;
    stats: string;
    switchHost: string;
    searchHosts: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const settingsAnchorRef = useTutorialAnchor("settings");
  // Home, Brain and Metrics mark themselves the same way Settings already does
  // on its own screen (which renders its own footer row and hardcodes
  // "settings").
  const activeFooterItem = resolveSidebarFooterActiveItem(usePathname());

  return (
    <View style={styles.sidebarFooter}>
      <SidebarFooterNavRow
        theme={theme}
        labels={labels}
        onHome={handleHome}
        onSettings={handleSettings}
        onStats={handleStats}
        onBrain={handleBrain}
        activeItem={activeFooterItem}
        settingsButtonRef={settingsAnchorRef}
      >
        <SidebarHostPicker
          theme={theme}
          switchHostLabel={labels.switchHost}
          onAddHost={handleAddHost}
          onOpenHostSettings={handleOpenHostSettings}
        />
      </SidebarFooterNavRow>
    </View>
  );
}

function MobileSidebar({
  active,
  theme,
  workspaceGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleHome,
  handleSettings,
  handleStats,
  handleBrain,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
  handleViewMoreNavigate,
}: MobileSidebarProps) {
  const pathname = usePathname();
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const isSessionsActive = pathname.includes("/sessions");
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();
  const dragGestureHostSettled = useIsMobilePanelActive("agent-list");

  const handleViewMore = useCallback(() => {
    closeSidebar();
    handleViewMoreNavigate();
  }, [closeSidebar, handleViewMoreNavigate]);

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebarPanel,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebarPanel],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <View style={styles.sidebarHeaderGroup}>
          <SidebarNavigationHeader onBeforeNavigate={closeSidebar} />
        </View>
        <WorkspacesSectionHeader
          onAddProject={handleOpenProject}
          onImportSession={handleImportSession}
          addProjectLabel={labels.addProject}
          onViewHistory={handleViewMore}
          historyLabel={labels.sessions}
          isHistoryActive={isSessionsActive}
        />
        <Pressable
          style={styles.mobileCloseButton}
          onPress={closeSidebar}
          testID="sidebar-close"
          nativeID="sidebar-close"
          accessible
          accessibilityRole="button"
          accessibilityLabel={labels.closeSidebar}
          hitSlop={8}
        >
          {({ hovered, pressed }) => (
            <X
              size={theme.iconSize.md}
              color={hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
            />
          )}
        </Pressable>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            pinnedGroups={pinnedGroups}
            projects={projects}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
            parentGestureRef={closeGestureRef}
            dragGestureHostActive={active && dragGestureHostSettled}
          />
        )}

        <SidebarFooter
          theme={theme}
          handleHome={handleHome}
          handleSettings={handleSettings}
          handleStats={handleStats}
          handleBrain={handleBrain}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />
      </View>
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({
  theme,
  workspaceGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleHome,
  handleSettings,
  handleStats,
  handleBrain,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  isOpen,
  handleViewMore,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const isSessionsActive = pathname.includes("/sessions");
  const padding = useWindowControlsPadding("sidebar");
  const { settings } = useAppSettings();
  const showTopSpacer = padding.top > 0 && !settings.compactSidebarTopSpacing;
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const closeDesktopAgentList = usePanelStore((state) => state.closeDesktopAgentList);
  const { width: viewportWidth } = useWindowDimensions();

  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });
  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(visibleSidebarWidth);
  const [resizePressed, setResizePressed] = useState(false);
  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);

  useEffect(() => {
    resizeWidth.value = visibleSidebarWidth;
  }, [resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        // See the context-management splitter: Pan's default 15px activation
        // slop turns a 1px divider into a dead zone plus a catch-up jump.
        .minDistance(0)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => {
          scheduleOnRN(showResizeGrip);
        })
        // Horizontal intent only, so a finger dragging down the touch grip scrolls
        // the workspace list instead of resizing. Anchoring the start width to the
        // activation translation keeps the extra threshold from jumping the edge.
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleSidebarWidth - event.translationX;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        })
        .onFinalize(() => {
          scheduleOnRN(hideResizeGrip);
        }),
    [
      hideResizeGrip,
      resizeWidth,
      setSidebarWidth,
      showResizeGrip,
      viewportWidth,
      visibleSidebarWidth,
    ],
  );

  // Double-tapping the resize handle closes the sidebar, same as the toggle.
  const closeGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          runOnJS(closeDesktopAgentList)();
        }),
    [closeDesktopAgentList],
  );

  const resizeHandleGesture = useMemo(
    () => Gesture.Race(closeGesture, resizeGesture),
    [closeGesture, resizeGesture],
  );

  // Open/close slide (width + opacity) layered on top of the resize width.
  // `rendered` keeps the sidebar mounted through the close animation so the
  // exit can play; when animations are off it snaps shut exactly like the old
  // `!isOpen` return-null behavior.
  const { rendered, slideStyle } = useSidebarSlide({ isOpen, width: resizeWidth });

  // The raw window-controls guess overshoots the actual overlay strip; trim the
  // spacer so the menu sits a touch higher while still clearing the controls.
  const paddingTopSpacerStyle = useMemo(
    () => ({ height: Math.max(0, padding.top - SIDEBAR_TOP_SPACER_TRIM) }),
    [padding.top],
  );
  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, slideStyle],
    [slideStyle],
  );
  // Without paddingBottom, the pinned SidebarFooter (Home/Settings/Brain icons)
  // sits flush with the container's bottom edge and lands under the 3-button
  // Android nav bar in landscape/tablet layouts, where it can't be tapped.
  const desktopSidebarBorderStyle = useMemo(
    () => [
      styles.desktopSidebarBorder,
      { flex: 1, paddingTop: insetsTop, paddingBottom: insetsBottom },
    ],
    [insetsTop, insetsBottom],
  );
  if (!rendered) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          <TitlebarDragRegion />
          {showTopSpacer ? <View style={paddingTopSpacerStyle} /> : null}
          <View style={styles.sidebarHeaderGroup}>
            <SidebarNavigationHeader />
          </View>
        </View>
        <WorkspacesSectionHeader
          onAddProject={handleOpenProject}
          onImportSession={handleImportSession}
          addProjectLabel={labels.addProject}
          onViewHistory={handleViewMore}
          historyLabel={labels.sessions}
          isHistoryActive={isSessionsActive}
        />

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            pinnedGroups={pinnedGroups}
            projects={projects}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
          />
        )}

        <SidebarActiveWorkspaceTools />

        <SidebarCalloutSlot />

        <SidebarFooter
          theme={theme}
          handleHome={handleHome}
          handleSettings={handleSettings}
          handleStats={handleStats}
          handleBrain={handleBrain}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        <SidebarResizeHandle
          edge="right"
          gesture={resizeHandleGesture}
          pressed={resizePressed}
          testID="left-sidebar-resize-handle"
        />

        <SidebarSeamShadow seam="right" />
      </View>
    </Animated.View>
  );
}

function WorkspacesSectionHeader({
  onAddProject,
  onImportSession,
  addProjectLabel,
  onViewHistory,
  historyLabel,
  isHistoryActive,
}: {
  onAddProject: () => void;
  onImportSession: () => void;
  addProjectLabel: string;
  onViewHistory: () => void;
  historyLabel: string;
  isHistoryActive: boolean;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { items } = useSidebarNavItems();
  const headerActions = items.filter(
    (item) => item.visible && sidebarNavPlacement(item) === "workspace-header",
  );
  const workspacesAnchorRef = useTutorialAnchor("workspaces");
  // useIconSize (not theme.iconSize props) - the runtime theme patch doesn't
  // reliably reach icon size props; the hook scales with the breakpoint.
  const iconSize = useIconSize();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const newAgentKeys = useShortcutKeys("new-agent");
  const handleSearchPress = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const headerIconButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );
  const historyIconButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      isHistoryActive && styles.workspacesHeaderIconButtonActive,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [isHistoryActive],
  );

  const historyAction = (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={historyLabel}
          testID="sidebar-sessions"
          style={historyIconButtonStyle}
          onPress={onViewHistory}
        >
          {({ hovered, pressed }) => (
            <View style={styles.workspacesHeaderShortcutAnchor}>
              <History
                size={iconSize.sm}
                color={
                  hovered || pressed || isHistoryActive
                    ? theme.colors.foreground
                    : theme.colors.foregroundMuted
                }
              />
            </View>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="left" align="center" offset={8}>
        <HeaderIconTooltipContent label={historyLabel} />
      </TooltipContent>
    </Tooltip>
  );
  const searchAction = (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open command center"
          testID="sidebar-search"
          style={headerIconButtonStyle}
          onPress={handleSearchPress}
        >
          {({ hovered, pressed }) => (
            <View style={styles.workspacesHeaderShortcutAnchor}>
              <Search
                size={iconSize.sm}
                color={hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
              />
              <ShortcutDiscoveryHint
                action="command-center.toggle"
                style={styles.shortcutDiscoveryHint}
              />
            </View>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="left" align="center" offset={8}>
        <HeaderIconTooltipContent label="Search" shortcutKeys={commandCenterKeys} />
      </TooltipContent>
    </Tooltip>
  );

  return (
    <View ref={workspacesAnchorRef} collapsable={false} style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>Workspaces</Text>
      <View style={styles.workspacesSectionActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={addProjectLabel}
              testID="sidebar-add-project"
              style={headerIconButtonStyle}
              onPress={onAddProject}
            >
              {({ hovered, pressed }) => (
                <View style={styles.workspacesHeaderShortcutAnchor}>
                  <FolderPlus
                    size={iconSize.sm}
                    color={
                      hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                    }
                  />
                  <ShortcutDiscoveryHint action="agent.new" style={styles.shortcutDiscoveryHint} />
                </View>
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="left" align="center" offset={8}>
            <AddProjectTooltipContent newAgentKeys={newAgentKeys} label={addProjectLabel} />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("importSession.title")}
              testID="sidebar-import-session"
              style={headerIconButtonStyle}
              onPress={onImportSession}
            >
              {({ hovered, pressed }) => (
                <Import
                  size={iconSize.sm}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="left" align="center" offset={8}>
            <HeaderIconTooltipContent label={t("importSession.title")} />
          </TooltipContent>
        </Tooltip>
        {headerActions.map((item) => (
          <Fragment key={item.key}>
            {item.kind === "builtin" && item.id === "history" ? historyAction : searchAction}
          </Fragment>
        ))}

        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="left" align="center" offset={8}>
            <HeaderIconTooltipContent label="Display preferences" />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

// Static styles for Animated.Views - must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
    // Clip the fixed-width inner content while the outer width animates during
    // the open/close slide, so the panel edge reveals cleanly.
    overflow: "hidden" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: theme.spacing[1],
    // Keep the navigation group compact above the Workspaces section.
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sidebarNavigationHeader: {
    gap: theme.spacing[1],
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    // The additive Import action keeps full compact icon/button sizing. If the
    // title and action group cannot fit together, give the group its own line.
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Align the title with the compact rows' icons and the project icons below
    // (listContent + projectRow inner padding both spacing[2]).
    paddingLeft: theme.spacing[2] + theme.spacing[2],
    // Align the trailing action pill's right edge with the New workspace and
    // project row pills (both 8px from the sidebar edge).
    paddingRight: theme.spacing[2],
    // The 28px-tall action buttons center the title and add their own offset
    // above it, so trim the top padding to keep the section compact.
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  workspacesSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  workspacesHeaderIconButton: {
    width: compactUp(28),
    height: compactUp(28),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  workspacesHeaderIconButtonHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  workspacesHeaderIconButtonActive: {
    backgroundColor: theme.colors.surfaceInteractiveSelected,
  },
  workspacesHeaderShortcutAnchor: {
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
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButton: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[4],
    zIndex: 2,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebarPanel,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebarPanel,
  },
  sidebarDragArea: {
    position: "relative",
  },
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
