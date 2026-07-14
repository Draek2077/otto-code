import { router, usePathname } from "expo-router";
import {
  CalendarClock,
  FileText,
  FolderPlus,
  History,
  Home,
  Network,
  Plus,
  Search,
  Gauge,
  Server,
  Settings,
  X,
  type IconComponent,
} from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useTutorialAnchor } from "@/tutorial/use-tutorial-anchor";
import { useRevealActiveWorkspace } from "@/components/sidebar/use-reveal-active-workspace";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableProps,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarActiveTeamSwitchers } from "@/components/active-team-switcher";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/sidebar-display-preferences-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useAppSettings } from "@/hooks/use-settings";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import { type SidebarGroupMode } from "@/stores/sidebar-view-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  selectIsAgentListOpen,
  usePanelStore,
} from "@/stores/panel-store";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import {
  buildOpenProjectRoute,
  buildArtifactsRoute,
  buildNewWorkspaceRoute,
  buildRunsRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildSettingsAddHostRoute,
  buildSettingsHostSectionRoute,
  buildStatsRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { compactUp, ICON_SIZE, useIconSize } from "@/styles/theme";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";
import { SidebarActiveWorkspaceTools } from "./sidebar/sidebar-active-workspace-tools";
import { SidebarSeamShadow } from "./sidebar-seam-shadow";

const MIN_CHAT_WIDTH = 400;

// How much to shave off the window-controls top spacer: the DESKTOP_* height
// constants are one-size guesses that read as surplus space above the sidebar
// menu, so the menu is nudged up slightly. Shared with the settings sidebar so
// the two "Back to workspace" / "New workspace" rows stay vertically aligned.
export const SIDEBAR_TOP_SPACER_TRIM = 6;

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  statusGroups: StatusGroup[];
  projects: SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByKey: Map<string, string>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  handleStats: () => void;
  labels: SidebarLabels;
  newWorkspaceKeys: ShortcutKey[][] | null;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  addProject: string;
  newWorkspace: string;
  home: string;
  settings: string;
  stats: string;
  switchHost: string;
  searchHosts: string;
  sessions: string;
  schedules: string;
  artifacts: string;
  runs: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
  handleViewMoreNavigate: () => void;
  handleViewSchedulesNavigate: () => void;
  handleViewArtifactsNavigate: () => void;
  handleViewRunsNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  isOpen: boolean;
  handleViewMore: () => void;
  handleViewSchedules: () => void;
  handleViewArtifacts: () => void;
  handleViewRuns: () => void;
}

export const LeftSidebar = memo(function LeftSidebar() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const {
    projects,
    workspaceEntriesByKey,
    projectNamesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    statusGroups,
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

  const handleViewMoreNavigate = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const handleViewSchedulesNavigate = useCallback(() => {
    router.push(buildSchedulesRoute());
  }, []);

  const handleViewArtifactsNavigate = useCallback(() => {
    router.push(buildArtifactsRoute());
  }, []);

  const handleViewRunsNavigate = useCallback(() => {
    router.push(buildRunsRoute());
  }, []);

  const newWorkspaceKeys = useShortcutKeys("new-workspace");
  const labels = useMemo(
    (): SidebarLabels => ({
      addProject: t("sidebar.actions.addProject"),
      newWorkspace: t("sidebar.actions.newWorkspace"),
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      // Temporary label (English-only), same rationale as `runs` below.
      stats: "Metrics",
      switchHost: t("sidebar.host.switchTitle"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      sessions: t("sidebar.sections.sessions"),
      schedules: t("sidebar.sections.schedules"),
      artifacts: t("sidebar.sections.artifacts"),
      // Temporary label (English-only) until Orchestrations get a permanent
      // home; avoids adding a locale key for a dev-facing entry.
      runs: "Orchestrations",
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    statusGroups,
    projects,
    workspaceEntriesByKey,
    projectNamesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    labels,
    newWorkspaceKeys,
  };

  if (isCompactLayout) {
    return (
      <RetainedPanelActivity active={isOpen}>
        <MobileSidebar
          {...sharedProps}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          closeSidebar={showMobileAgent}
          handleOpenProject={handleOpenProjectMobile}
          handleHome={handleHomeMobile}
          handleSettings={handleSettingsMobile}
          handleStats={handleStatsMobile}
          handleAddHost={handleAddHostMobile}
          handleOpenHostSettings={handleOpenHostSettingsMobile}
          handleViewMoreNavigate={handleViewMoreNavigate}
          handleViewSchedulesNavigate={handleViewSchedulesNavigate}
          handleViewArtifactsNavigate={handleViewArtifactsNavigate}
          handleViewRunsNavigate={handleViewRunsNavigate}
        />
      </RetainedPanelActivity>
    );
  }

  return (
    <RetainedPanelActivity active={isOpen}>
      <DesktopSidebar
        {...sharedProps}
        insetsTop={insets.top}
        isOpen={isOpen}
        handleOpenProject={handleOpenProjectDesktop}
        handleHome={handleHomeDesktop}
        handleSettings={handleSettingsDesktop}
        handleStats={handleStatsDesktop}
        handleAddHost={handleAddHostDesktop}
        handleOpenHostSettings={handleOpenHostSettingsDesktop}
        handleViewMore={handleViewMoreNavigate}
        handleViewSchedules={handleViewSchedulesNavigate}
        handleViewArtifacts={handleViewArtifactsNavigate}
        handleViewRuns={handleViewRunsNavigate}
      />
    </RetainedPanelActivity>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function footerIconButtonStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [
    styles.footerIconButton,
    (Boolean(hovered) || Boolean(pressed)) && styles.footerIconButtonHovered,
  ];
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  accessibilityLabel,
  icon: Icon,
  iconSize,
  theme,
  ...pressableProps
}: {
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
  icon: IconComponent;
  iconSize?: number;
  theme: SidebarTheme;
  buttonRef?: Ref<View>;
} & Omit<PressableProps, "onPress" | "testID" | "style" | "children">) {
  const isCompactLayout = useIsCompactFormFactor();
  // Footer icons are always scaled up on every form factor, and another 1.5x on
  // compact so they stay comfortably tappable. Static ICON_SIZE (not
  // theme.iconSize) — the theme tokens are already doubled on compact by
  // applyAppearance, which would compound here.
  const baseIconSize = iconSize ?? ICON_SIZE.md * 1.5;
  return (
    <Pressable
      {...pressableProps}
      ref={buttonRef}
      style={footerIconButtonStyle}
      testID={testID}
      nativeID={testID}
      collapsable={false}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
    >
      {({ hovered }) => (
        <Icon
          size={isCompactLayout ? baseIconSize * 1.5 : baseIconSize}
          color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      )}
    </Pressable>
  );
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
            iconSize={ICON_SIZE.sm * 1.5}
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

const SidebarNewWorkspaceHeaderRow = memo(function SidebarNewWorkspaceHeaderRow({
  label,
  testID,
  variant,
  shortcutKeys,
  onBeforeNavigate,
}: {
  label: string;
  testID: string;
  variant: "header" | "compact";
  shortcutKeys: ShortcutKey[][] | null;
  onBeforeNavigate?: () => void;
}) {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={label}
      onPress={handlePress}
      testID={testID}
      variant={variant}
      shortcutKeys={shortcutKeys}
    />
  );
});

function SidebarFooter({
  theme,
  handleOpenProject,
  handleHome,
  handleSettings,
  handleStats,
  labels,
  handleAddHost,
  handleOpenHostSettings,
}: {
  theme: SidebarTheme;
  handleOpenProject: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  handleStats: () => void;
  labels: {
    addProject: string;
    home: string;
    settings: string;
    stats: string;
    switchHost: string;
    searchHosts: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsAnchorRef = useTutorialAnchor("settings");

  return (
    <View style={styles.sidebarFooter}>
      <View style={styles.footerIconRow}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild triggerRefProp="buttonRef">
            <FooterIconButton
              onPress={handleHome}
              testID="sidebar-home"
              accessibilityLabel={labels.home}
              icon={Home}
              theme={theme}
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <HeaderIconTooltipContent label={labels.home} />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild triggerRefProp="buttonRef">
            <FooterIconButton
              buttonRef={settingsAnchorRef}
              onPress={handleSettings}
              testID="sidebar-settings"
              accessibilityLabel={labels.settings}
              icon={Settings}
              theme={theme}
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <HeaderIconTooltipContent label={labels.settings} />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild triggerRefProp="buttonRef">
            <FooterIconButton
              onPress={handleStats}
              testID="sidebar-stats"
              accessibilityLabel={labels.stats}
              icon={Gauge}
              theme={theme}
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <HeaderIconTooltipContent label={labels.stats} />
          </TooltipContent>
        </Tooltip>
      </View>
      <View style={styles.footerIconRow}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild triggerRefProp="buttonRef">
            <FooterIconButton
              onPress={handleOpenProject}
              testID="sidebar-add-project"
              accessibilityLabel={labels.addProject}
              icon={FolderPlus}
              theme={theme}
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <AddProjectTooltipContent newAgentKeys={newAgentKeys} label={labels.addProject} />
          </TooltipContent>
        </Tooltip>
        <SidebarHostPicker
          theme={theme}
          switchHostLabel={labels.switchHost}
          onAddHost={handleAddHost}
          onOpenHostSettings={handleOpenHostSettings}
        />
      </View>
    </View>
  );
}

function MobileSidebar({
  theme,
  statusGroups,
  projects,
  workspaceEntriesByKey,
  projectNamesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleOpenProject,
  handleHome,
  handleSettings,
  handleStats,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
  handleViewMoreNavigate,
  handleViewSchedulesNavigate,
  handleViewArtifactsNavigate,
  handleViewRunsNavigate,
}: MobileSidebarProps) {
  const pathname = usePathname();
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const isArtifactsActive = pathname.includes("/artifacts");
  const isRunsActive = pathname.includes("/runs");
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();

  const handleViewMore = useCallback(() => {
    closeSidebar();
    handleViewMoreNavigate();
  }, [closeSidebar, handleViewMoreNavigate]);

  const handleViewSchedules = useCallback(() => {
    closeSidebar();
    handleViewSchedulesNavigate();
  }, [closeSidebar, handleViewSchedulesNavigate]);

  const handleViewArtifacts = useCallback(() => {
    closeSidebar();
    handleViewArtifactsNavigate();
  }, [closeSidebar, handleViewArtifactsNavigate]);

  const handleViewRuns = useCallback(() => {
    closeSidebar();
    handleViewRunsNavigate();
  }, [closeSidebar, handleViewRunsNavigate]);

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <View style={styles.sidebarHeaderGroup}>
          <SidebarActiveTeamSwitchers onBeforeNavigate={closeSidebar} />
          <SidebarNewWorkspaceHeaderRow
            label={labels.newWorkspace}
            testID="sidebar-global-new-workspace"
            variant="compact"
            shortcutKeys={newWorkspaceKeys}
            onBeforeNavigate={closeSidebar}
          />
          <SidebarHeaderRow
            icon={History}
            label={labels.sessions}
            onPress={handleViewMore}
            isActive={isSessionsActive}
            testID="sidebar-sessions"
            variant="compact"
          />
          <SidebarHeaderRow
            icon={CalendarClock}
            label={labels.schedules}
            onPress={handleViewSchedules}
            isActive={isSchedulesActive}
            testID="sidebar-schedules"
            variant="compact"
          />
          <SidebarHeaderRow
            icon={FileText}
            label={labels.artifacts}
            onPress={handleViewArtifacts}
            isActive={isArtifactsActive}
            testID="sidebar-artifacts"
            variant="compact"
          />
          <SidebarHeaderRow
            icon={Network}
            label={labels.runs}
            onPress={handleViewRuns}
            isActive={isRunsActive}
            testID="sidebar-runs"
            variant="compact"
          />
        </View>
        <WorkspacesSectionHeader />
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

        {isInitialLoad ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            statusGroups={statusGroups}
            projects={projects}
            workspaceEntriesByKey={workspaceEntriesByKey}
            projectNamesByKey={projectNamesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            parentGestureRef={closeGestureRef}
          />
        )}

        <SidebarFooter
          theme={theme}
          handleOpenProject={handleOpenProject}
          handleHome={handleHome}
          handleSettings={handleSettings}
          handleStats={handleStats}
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
  statusGroups,
  projects,
  workspaceEntriesByKey,
  projectNamesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleOpenProject,
  handleHome,
  handleSettings,
  handleStats,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  isOpen,
  handleViewMore,
  handleViewSchedules,
  handleViewArtifacts,
  handleViewRuns,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const isArtifactsActive = pathname.includes("/artifacts");
  const isRunsActive = pathname.includes("/runs");
  const padding = useWindowControlsPadding("sidebar");
  const { settings } = useAppSettings();
  const showTopSpacer = padding.top > 0 && !settings.compactSidebarTopSpacing;
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const closeDesktopAgentList = usePanelStore((state) => state.closeDesktopAgentList);
  const { width: viewportWidth } = useWindowDimensions();

  const startWidthRef = useRef(sidebarWidth);
  const resizeWidth = useSharedValue(sidebarWidth);

  useEffect(() => {
    resizeWidth.value = sidebarWidth;
  }, [sidebarWidth, resizeWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = sidebarWidth;
          resizeWidth.value = sidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          const maxWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [sidebarWidth, resizeWidth, setSidebarWidth, viewportWidth],
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

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  // The raw window-controls guess overshoots the actual overlay strip; trim the
  // spacer so the menu sits a touch higher while still clearing the controls.
  const paddingTopSpacerStyle = useMemo(
    () => ({ height: Math.max(0, padding.top - SIDEBAR_TOP_SPACER_TRIM) }),
    [padding.top],
  );
  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, resizeAnimatedStyle],
    [resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const resizeHandleStyle = useMemo(
    () => [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)],
    [],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          <TitlebarDragRegion />
          {showTopSpacer ? <View style={paddingTopSpacerStyle} /> : null}
          <View style={styles.sidebarHeaderGroup}>
            <SidebarActiveTeamSwitchers />
            <SidebarNewWorkspaceHeaderRow
              label={labels.newWorkspace}
              testID="sidebar-global-new-workspace"
              variant="compact"
              shortcutKeys={newWorkspaceKeys}
            />
            <SidebarHeaderRow
              icon={History}
              label={labels.sessions}
              onPress={handleViewMore}
              isActive={isSessionsActive}
              testID="sidebar-sessions"
              variant="compact"
            />
            <SidebarHeaderRow
              icon={CalendarClock}
              label={labels.schedules}
              onPress={handleViewSchedules}
              isActive={isSchedulesActive}
              testID="sidebar-schedules"
              variant="compact"
            />
            <SidebarHeaderRow
              icon={Network}
              label={labels.runs}
              onPress={handleViewRuns}
              isActive={isRunsActive}
              testID="sidebar-runs"
              variant="compact"
            />
            <SidebarHeaderRow
              icon={FileText}
              label={labels.artifacts}
              onPress={handleViewArtifacts}
              isActive={isArtifactsActive}
              testID="sidebar-artifacts"
              variant="compact"
            />
          </View>
        </View>
        <WorkspacesSectionHeader />

        {isInitialLoad ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            statusGroups={statusGroups}
            projects={projects}
            workspaceEntriesByKey={workspaceEntriesByKey}
            projectNamesByKey={projectNamesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onAddProject={handleOpenProject}
          />
        )}

        <SidebarActiveWorkspaceTools />

        <SidebarCalloutSlot />

        <SidebarFooter
          theme={theme}
          handleOpenProject={handleOpenProject}
          handleHome={handleHome}
          handleSettings={handleSettings}
          handleStats={handleStats}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        {/* Resize handle - absolutely positioned over right border */}
        <GestureDetector gesture={resizeHandleGesture}>
          <View style={resizeHandleStyle} />
        </GestureDetector>

        <SidebarSeamShadow seam="right" />
      </View>
    </Animated.View>
  );
}

function WorkspacesSectionHeader() {
  const { theme } = useUnistyles();
  const workspacesAnchorRef = useTutorialAnchor("workspaces");
  // useIconSize (not theme.iconSize props) — the runtime theme patch doesn't
  // reliably reach icon size props; the hook scales with the breakpoint.
  const iconSize = useIconSize();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const handleSearchPress = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const searchButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );

  return (
    <View ref={workspacesAnchorRef} collapsable={false} style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>Workspaces</Text>
      <View style={styles.workspacesSectionActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open command center"
              testID="sidebar-command-center-search"
              style={searchButtonStyle}
              onPress={handleSearchPress}
            >
              {({ hovered, pressed }) => (
                <Search
                  size={iconSize.sm}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <HeaderIconTooltipContent label="Search" shortcutKeys={commandCenterKeys} />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <HeaderIconTooltipContent label="Display preferences" />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 2,
    // Distance from History's bottom edge to the divider. WorkspacesSectionHeader
    // uses a slightly smaller paddingTop to balance the action buttons' centering
    // offset so the divider reads as visually centered between the two.
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Align the title with the compact rows' icons and the project icons below
    // (listContent + projectRow inner padding both spacing[2]).
    paddingLeft: theme.spacing[2] + theme.spacing[2],
    // Align the trailing action pill's right edge with the New workspace and
    // project row pills (both 8px from the sidebar edge).
    paddingRight: theme.spacing[2],
    // Less than sidebarHeaderGroup's paddingBottom: the 28px-tall action buttons
    // center the title and add their own offset above it, so equal padding reads
    // as a larger gap than History's. Trim paddingTop to balance it visually.
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
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
    backgroundColor: theme.colors.surfaceSidebarHover,
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
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
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
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  footerIconButton: {
    // 1.5x on compact to wrap the icons' matching compact upscale.
    width: compactUp(theme.spacing[8], 1.5),
    height: compactUp(theme.spacing[8], 1.5),
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    borderRadius: theme.borderRadius.lg,
  },
  footerIconButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
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
