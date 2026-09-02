import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search } from "@/components/icons/material-icons";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { formatPrTabLabel, PullRequestTabIcon } from "@/git/pull-request-panel";
import {
  usePanelStore,
  selectIsCompactFileExplorerOpen,
  type ExplorerTab,
} from "@/stores/panel-store";
import { useCloseFileExplorerGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { ChangesSurface } from "@/git/diff-pane";
import { changesStateSchema, defaultChangesState, type ChangesState } from "@/panels/changes/state";
import { FileExplorerPane } from "./file-explorer-pane";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { shouldUseCompactExplorerKeyboardPadding } from "@/hooks/keyboard-shift-policy";
import { WindowChromeSafeArea } from "@/utils/window-chrome";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { RetainedPanel, RetainedPanelActivity } from "@/components/retained-panel";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
import { usePullRequestPanelAvailability } from "@/panels/pull-request-availability";
import { PullRequestContent } from "@/panels/pull-request";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { resolveExplorerSidebarWidth } from "@/components/explorer-sidebar-layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useProjectSearchFeature } from "@/editor/use-project-search-feature";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { ProjectSearchPane } from "@/components/project-search-pane";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { resolveCompactExplorerTabs } from "@/components/compact-explorer-sidebar-host-state";

function logExplorerSidebar(_event: string, _details: Record<string, unknown>): void {}

interface ExplorerSidebarProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const ThemedCloseIcon = withUnistyles(X);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedSearch = withUnistyles(Search);
const ThemedSourceControl = withUnistyles(SourceControlPanelIcon);
const ThemedPullRequestTabIcon = withUnistyles(PullRequestTabIcon);
const EXPLORER_TAB_LABELED_MIN_WIDTH = 80;

interface ExplorerSidebarSharedState {
  explorerTab: ExplorerTab;
  handleTabPress: (tab: ExplorerTab) => void;
}

function useExplorerSidebarSharedState({
  serverId,
  workspaceRoot,
  isGit,
}: Pick<ExplorerSidebarProps, "serverId" | "workspaceRoot" | "isGit">): ExplorerSidebarSharedState {
  const explorerTab = usePanelStore((state) => state.explorerTab);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const handleTabPress = useCallback(
    (tab: ExplorerTab) => {
      setExplorerTabForCheckout({ serverId, cwd: workspaceRoot, isGit, tab });
    },
    [isGit, serverId, setExplorerTabForCheckout, workspaceRoot],
  );

  return { explorerTab, handleTabPress };
}

export function CompactExplorerSidebar({
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  onOpenFile,
}: ExplorerSidebarProps) {
  const insets = useSafeAreaInsets();
  const isDeveloperMode = useIsDeveloperMode();
  const isOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });
  const usePanelKeyboardPadding = shouldUseCompactExplorerKeyboardPadding({
    isGit,
    explorerTab: isDeveloperMode ? explorerTab : "files",
  });
  const { style: mobileKeyboardInsetStyle } = useKeyboardShiftStyle({
    mode: "padding",
    enabled: usePanelKeyboardPadding,
  });
  const { gesture: closeGesture } = useCloseFileExplorerGesture();

  const handleClose = useCallback(
    (reason: string) => {
      logExplorerSidebar("handleClose", {
        reason,
        isOpen,
      });
      showMobileAgent();
    },
    [isOpen, showMobileAgent],
  );

  const handleHeaderClose = useCallback(() => handleClose("header-close-button"), [handleClose]);

  const mobileSidebarStyle = useMemo(
    () => [
      inlineUnistylesStyle({
        paddingTop: insets.top + HEADER_TOP_PADDING_MOBILE,
        paddingBottom: usePanelKeyboardPadding ? 0 : insets.bottom,
      }),
      styles.mobileSidebar,
      mobileKeyboardInsetStyle,
    ],
    [insets.bottom, insets.top, mobileKeyboardInsetStyle, usePanelKeyboardPadding],
  );

  return (
    <RetainedPanelActivity active={isOpen}>
      <MobilePanelOverlay
        panel="file-explorer"
        closeGesture={closeGesture}
        panelStyle={mobileSidebarStyle}
      >
        <ExplorerSidebarContent
          activeTab={explorerTab}
          onTabPress={handleTabPress}
          onClose={handleHeaderClose}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isGit={isGit}
          isOpen={isOpen}
          onOpenFile={onOpenFile}
        />
      </MobilePanelOverlay>
    </RetainedPanelActivity>
  );
}

interface NativeExplorerSidebarDockProps extends ExplorerSidebarProps {
  persistenceKey: string;
  containerWidth: number;
}

export function NativeExplorerSidebarDock({
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  onOpenFile,
  persistenceKey,
  containerWidth,
}: NativeExplorerSidebarDockProps) {
  const insets = useSafeAreaInsets();
  const isOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const storedWidth = useWorkspaceLayoutStore(
    (state) => state.explorerSidebarWidthByWorkspace[persistenceKey],
  );
  const resizeExplorerSidebar = useWorkspaceLayoutStore((state) => state.resizeExplorerSidebar);
  const visibleWidth = resolveExplorerSidebarWidth({
    requestedWidth: storedWidth,
    containerWidth,
  });
  const resizeWidth = useSharedValue(visibleWidth);
  const startWidthRef = useRef(visibleWidth);
  const [resizePressed, setResizePressed] = useState(false);
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });

  useEffect(() => {
    resizeWidth.value = visibleWidth;
  }, [resizeWidth, visibleWidth]);

  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);
  const commitWidth = useCallback(
    (width: number) => resizeExplorerSidebar(persistenceKey, width),
    [persistenceKey, resizeExplorerSidebar],
  );
  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(true)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => scheduleOnRN(showResizeGrip))
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleWidth + event.translationX;
          resizeWidth.value = visibleWidth;
        })
        .onUpdate((event) => {
          resizeWidth.value = resolveExplorerSidebarWidth({
            requestedWidth: startWidthRef.current - event.translationX,
            containerWidth,
          });
        })
        .onEnd(() => runOnJS(commitWidth)(resizeWidth.value))
        .onFinalize(() => scheduleOnRN(hideResizeGrip)),
    [commitWidth, containerWidth, hideResizeGrip, resizeWidth, showResizeGrip, visibleWidth],
  );
  const animatedWidthStyle = useAnimatedStyle(() => ({ width: resizeWidth.value }));
  const dockStyle = useMemo(
    () => [
      styles.nativeDock,
      inlineUnistylesStyle({
        display: isOpen ? ("flex" as const) : ("none" as const),
        paddingTop: insets.top + HEADER_TOP_PADDING_MOBILE,
      }),
      animatedWidthStyle,
    ],
    [animatedWidthStyle, insets.top, isOpen],
  );

  return (
    <RetainedPanelActivity active={isOpen}>
      <Animated.View style={dockStyle} testID="native-explorer-sidebar-dock">
        <View style={styles.nativeDockContent}>
          <SidebarResizeHandle
            edge="left"
            gesture={resizeGesture}
            pressed={resizePressed}
            testID="native-explorer-sidebar-resize-handle"
          />
          <ExplorerSidebarContent
            activeTab={explorerTab}
            onTabPress={handleTabPress}
            onClose={showMobileAgent}
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            isGit={isGit}
            isOpen={isOpen}
            onOpenFile={onOpenFile}
          />
        </View>
      </Animated.View>
    </RetainedPanelActivity>
  );
}

interface ExplorerTabButtonProps {
  tab: ExplorerTab;
  active: boolean;
  label: string;
  showLabel: boolean;
  pullRequestProvider?: React.ComponentProps<typeof PullRequestTabIcon>["provider"];
  onTabPress: (tab: ExplorerTab) => void;
  testID: string;
}

function ExplorerTabIcon({
  tab,
  active,
  pullRequestProvider,
}: Pick<ExplorerTabButtonProps, "tab" | "active" | "pullRequestProvider">) {
  const uniProps = active ? accentColorMapping : foregroundMutedColorMapping;
  if (tab === "changes") return <ThemedSourceControl size={14} uniProps={uniProps} />;
  if (tab === "files") return <ThemedFolderOpen size={14} uniProps={uniProps} />;
  if (tab === "search") return <ThemedSearch size={14} uniProps={uniProps} />;
  return <ThemedPullRequestTabIcon provider={pullRequestProvider} size={13} uniProps={uniProps} />;
}

function ExplorerTabButton({
  tab,
  active,
  label,
  showLabel,
  pullRequestProvider,
  onTabPress,
  testID,
}: ExplorerTabButtonProps) {
  const handlePress = useCallback(() => onTabPress(tab), [onTabPress, tab]);
  const changesShortcutKeys = useShortcutKeys("workspace-tab-target-changes");
  const filesShortcutKeys = useShortcutKeys("workspace-tab-target-files");
  let shortcutKeys = null;
  if (tab === "changes") {
    shortcutKeys = changesShortcutKeys;
  } else if (tab === "files") {
    shortcutKeys = filesShortcutKeys;
  }
  const tabStyle = useMemo(
    () => [styles.tab, !showLabel && styles.tabCompact, active && styles.tabActive],
    [active, showLabel],
  );
  const tabTextStyle = useMemo(() => [styles.tabText, active && styles.tabTextActive], [active]);
  return (
    <Tooltip delayDuration={300} enabledOnDesktop={!showLabel} enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="triggerRef">
        <Pressable
          testID={testID}
          style={tabStyle}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <ExplorerTabIcon tab={tab} active={active} pullRequestProvider={pullRequestProvider} />
          {showLabel ? <Text style={tabTextStyle}>{label}</Text> : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{label}</Text>
          {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

interface SidebarContentProps {
  activeTab: ExplorerTab;
  onTabPress: (tab: ExplorerTab) => void;
  onClose: () => void;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isOpen: boolean;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}

function ExplorerSidebarContent({
  activeTab,
  onTabPress,
  onClose,
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  isOpen,
  onOpenFile,
}: SidebarContentProps) {
  const { t } = useTranslation();
  const isDeveloperMode = useIsDeveloperMode();
  const hasProjectSearch = useProjectSearchFeature(serverId);
  const { prPane, showPullRequest: showPrTab } = usePullRequestPanelAvailability({
    serverId,
    cwd: workspaceRoot,
    isGit,
    requested: isDeveloperMode && activeTab === "pr",
    enabled: isDeveloperMode && isOpen,
    timelineEnabled: isDeveloperMode && activeTab === "pr",
  });
  const resolved = resolveCompactExplorerTabs({
    activeTab,
    isDeveloperMode,
    isGit,
    hasProjectSearch,
    showPullRequest: showPrTab,
  });
  const resolvedTab = resolved.activeTab;
  const prTabLabel = formatPrTabLabel(prPane.prNumber);
  const [tabsContainerWidth, setTabsContainerWidth] = useState(0);
  const handleTabsContainerLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width);
      setTabsContainerWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
    },
    [],
  );
  const compactLabels =
    tabsContainerWidth > 0 &&
    tabsContainerWidth < resolved.tabs.length * EXPLORER_TAB_LABELED_MIN_WIDTH;
  const { mountedTabIds } = useMountedTabSet({
    activeTabId: resolvedTab,
    allTabIds: resolved.tabs,
    cap: resolved.tabs.length,
  });

  return (
    <View style={styles.sidebarContent} pointerEvents="auto">
      {/* Header with tabs and close button */}
      <WindowChromeSafeArea
        placement="inline"
        horizontalPadding={8}
        style={styles.header}
        testID="explorer-header"
      >
        <TitlebarDragRegion />
        <View style={styles.tabsContainer} onLayout={handleTabsContainerLayout}>
          {isDeveloperMode && isGit && (
            <ExplorerTabButton
              tab="changes"
              active={resolvedTab === "changes"}
              label={t("workspace.tabs.explorerSidebar.changes")}
              showLabel={!compactLabels}
              onTabPress={onTabPress}
              testID="explorer-tab-changes"
            />
          )}
          <ExplorerTabButton
            tab="files"
            active={resolvedTab === "files"}
            label={t("workspace.tabs.explorerSidebar.files")}
            showLabel={!compactLabels}
            onTabPress={onTabPress}
            testID="explorer-tab-files"
          />
          {isDeveloperMode && hasProjectSearch && (
            <ExplorerTabButton
              tab="search"
              active={resolvedTab === "search"}
              label={t("workspace.tabs.explorer.search")}
              showLabel={!compactLabels}
              onTabPress={onTabPress}
              testID="explorer-tab-search"
            />
          )}
          {isDeveloperMode && isGit && showPrTab && (
            <ExplorerTabButton
              tab="pr"
              active={resolvedTab === "pr"}
              label={prTabLabel}
              showLabel={!compactLabels}
              pullRequestProvider={prPane.hostingProvider}
              onTabPress={onTabPress}
              testID="explorer-tab-pr"
            />
          )}
        </View>
        <View style={styles.headerRightSection}>
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            testID="explorer-close"
            nativeID="explorer-close"
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("workspace.tabs.explorerSidebar.close")}
            hitSlop={8}
          >
            {({ hovered, pressed }) => (
              <ThemedCloseIcon
                size={18}
                uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        </View>
      </WindowChromeSafeArea>

      {/* Content based on active tab */}
      <View style={styles.contentArea} testID="explorer-content-area">
        {mountedTabIds.has("changes") ? (
          <RetainedPanel active={resolvedTab === "changes"}>
            <ChangedFilesPane
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              isOpen={isOpen}
              onOpenFile={onOpenFile}
            />
          </RetainedPanel>
        ) : null}
        {mountedTabIds.has("files") ? (
          <RetainedPanel active={resolvedTab === "files"}>
            <FilesPane
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              onOpenFile={onOpenFile}
            />
          </RetainedPanel>
        ) : null}
        {mountedTabIds.has("search") ? (
          <RetainedPanel active={resolvedTab === "search"}>
            <ProjectSearchPane
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              onOpenFile={onOpenFile}
            />
          </RetainedPanel>
        ) : null}
        {mountedTabIds.has("pr") ? (
          <RetainedPanel active={resolvedTab === "pr"}>
            <PrTabContent
              serverId={serverId}
              workspaceId={workspaceId}
              cwd={workspaceRoot}
              prPane={prPane}
            />
          </RetainedPanel>
        ) : null}
      </View>
    </View>
  );
}

function ChangedFilesPane({
  serverId,
  workspaceId,
  workspaceRoot,
  isOpen,
  onOpenFile,
}: Pick<
  SidebarContentProps,
  "serverId" | "workspaceId" | "workspaceRoot" | "isOpen" | "onOpenFile"
>) {
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  const [changesState, setChangesState] = useState<ChangesState>(() =>
    changesStateSchema.parse(defaultChangesState),
  );
  return (
    <ChangesSurface
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={workspaceRoot}
      enabled={isOpen}
      modeScope="compact-explorer"
      onOpenFile={onOpenFile}
      onAddToChat={canAddToChat ? addFile : undefined}
      state={changesState}
      onStateChange={setChangesState}
    />
  );
}

function FilesPane({
  serverId,
  workspaceId,
  workspaceRoot,
  onOpenFile,
}: Pick<SidebarContentProps, "serverId" | "workspaceId" | "workspaceRoot" | "onOpenFile">) {
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  return (
    <FileExplorerPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      onOpenFile={onOpenFile}
      onAddToChat={canAddToChat ? addFile : undefined}
    />
  );
}

const PrTabContent = PullRequestContent;

const styles = StyleSheet.create((theme) => ({
  mobileSidebar: {
    backgroundColor: theme.colors.surfaceSidebarPanel,
  },
  nativeDock: {
    position: "relative",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSidebarPanel,
  },
  nativeDockContent: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  header: {
    position: "relative",
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabsContainer: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  tabCompact: {
    width: 32,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tabText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  tabTextActive: {
    color: theme.colors.accent,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tabTextMuted: {
    opacity: 0.8,
  },
  headerRightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  closeButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  contentArea: {
    flex: 1,
    minHeight: 0,
  },
}));
