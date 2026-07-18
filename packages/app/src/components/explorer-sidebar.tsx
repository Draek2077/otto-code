import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
  StyleSheet as RNStyleSheet,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useSharedValue, runOnJS } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { DocumentSearch, Files, X } from "@/components/icons/material-icons";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import {
  formatPrTabLabel,
  PullRequestPane,
  PullRequestPaneError,
  PullRequestPaneSkeleton,
  PullRequestTabIcon,
  usePrPaneData,
} from "@/git/pull-request-panel";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import {
  usePanelStore,
  selectIsFileExplorerOpen,
  MIN_EXPLORER_SIDEBAR_WIDTH,
  MAX_EXPLORER_SIDEBAR_WIDTH,
  type ExplorerTab,
} from "@/stores/panel-store";
import { useToast } from "@/contexts/toast-context";
import { useCloseFileExplorerGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";
import { GitDiffPane } from "@/git/diff-pane";
import { FileExplorerPane } from "./file-explorer-pane";
import { SidebarSeamShadow } from "./sidebar-seam-shadow";
import { ProjectSearchPane } from "./project-search-pane";
import { useProjectSearchFeature } from "@/editor/use-project-search-feature";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { useSidebarSlide } from "@/hooks/use-sidebar-slide";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { isWeb } from "@/constants/platform";
import { buildWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { useIconSize } from "@/styles/theme";

const MIN_CHAT_WIDTH = 400;
function logExplorerSidebar(_event: string, _details: Record<string, unknown>): void {}

interface ExplorerSidebarProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}

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
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: true }));
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const isDeveloperMode = useIsDeveloperMode();
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });
  const { style: mobileKeyboardInsetStyle } = useKeyboardShiftStyle({
    mode: "padding",
    enabled: true,
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
      {
        paddingTop: insets.top,
        backgroundColor: theme.colors.surfaceSidebar,
      },
      mobileKeyboardInsetStyle,
    ],
    [insets.top, theme.colors.surfaceSidebar, mobileKeyboardInsetStyle],
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
          isDeveloperMode={isDeveloperMode}
          isMobile
          isOpen={isOpen}
          onOpenFile={onOpenFile}
        />
      </MobilePanelOverlay>
    </RetainedPanelActivity>
  );
}

export function ExplorerSidebar({
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  onOpenFile,
}: ExplorerSidebarProps) {
  const insets = useSafeAreaInsets();
  const explorerWidth = usePanelStore((state) => state.explorerWidth);
  const setExplorerWidth = usePanelStore((state) => state.setExplorerWidth);
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: false }));
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const isDeveloperMode = useIsDeveloperMode();
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });
  const { width: viewportWidth } = useWindowDimensions();
  const startWidthRef = useRef(explorerWidth);
  const resizeWidth = useSharedValue(explorerWidth);

  useEffect(() => {
    const maxWidth = Math.max(
      MIN_EXPLORER_SIDEBAR_WIDTH,
      Math.min(MAX_EXPLORER_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
    );
    if (explorerWidth > maxWidth) {
      setExplorerWidth(maxWidth);
    }
  }, [explorerWidth, setExplorerWidth, viewportWidth]);

  const handleDesktopClose = useCallback(() => {
    logExplorerSidebar("handleClose", {
      reason: "desktop-close-button",
      isOpen,
    });
    closeDesktopFileExplorer();
  }, [closeDesktopFileExplorer, isOpen]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(true)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = explorerWidth;
          resizeWidth.value = explorerWidth;
        })
        .onUpdate((event) => {
          const newWidth = startWidthRef.current - event.translationX;
          const maxWidth = Math.max(
            MIN_EXPLORER_SIDEBAR_WIDTH,
            Math.min(MAX_EXPLORER_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_EXPLORER_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setExplorerWidth)(resizeWidth.value);
        }),
    [explorerWidth, resizeWidth, setExplorerWidth, viewportWidth],
  );

  // Double-tapping the resize handle closes the sidebar, same as the toggle.
  const closeGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          runOnJS(closeDesktopFileExplorer)();
        }),
    [closeDesktopFileExplorer],
  );

  const resizeHandleGesture = useMemo(
    () => Gesture.Race(closeGesture, resizeGesture),
    [closeGesture, resizeGesture],
  );

  // Open/close slide (width + opacity) layered on top of the resize width;
  // `rendered` keeps the panel mounted through the close animation. Snaps shut
  // like the old `!isOpen` return-null when animations are off.
  const { rendered, slideStyle } = useSidebarSlide({ isOpen, width: resizeWidth });
  const desktopSidebarStyle = useMemo(
    () => [explorerStaticStyles.desktopSidebar, slideStyle, { paddingTop: insets.top }],
    [slideStyle, insets.top],
  );

  if (!rendered) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={DESKTOP_SIDEBAR_BORDER_STYLE}>
        <GestureDetector gesture={resizeHandleGesture}>
          <View style={RESIZE_HANDLE_STYLE} />
        </GestureDetector>

        <ExplorerSidebarContent
          activeTab={explorerTab}
          onTabPress={handleTabPress}
          onClose={handleDesktopClose}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isGit={isGit}
          isDeveloperMode={isDeveloperMode}
          isMobile={false}
          isOpen={isOpen}
          onOpenFile={onOpenFile}
        />

        <SidebarSeamShadow seam="left" />
      </View>
    </Animated.View>
  );
}

/** How a tab renders: icon+label when roomy, label alone mid-width, icon alone when tight. */
type ExplorerTabDisplay = "icon-label" | "label" | "icon";

/**
 * Pick the widest display tier whose measured row fits. Zero measurements
 * (layout not reported yet) fall through to icon-only.
 */
export function resolveExplorerTabDisplay(input: {
  headerWidth: number;
  availableTabsWidth: number;
  labeledTabsWidth: number;
  textTabsWidth: number;
}): ExplorerTabDisplay {
  if (input.headerWidth <= 0) return "icon";
  if (input.labeledTabsWidth > 0 && input.labeledTabsWidth <= input.availableTabsWidth) {
    return "icon-label";
  }
  if (input.textTabsWidth > 0 && input.textTabsWidth <= input.availableTabsWidth) {
    return "label";
  }
  return "icon";
}

interface ExplorerTabButtonProps {
  tab: ExplorerTab;
  active: boolean;
  /** Accessible name; rendered as text unless `display` is "icon", then shown as a tooltip below. */
  label: string;
  display?: ExplorerTabDisplay;
  onTabPress: (tab: ExplorerTab) => void;
  testID: string;
  children?: React.ReactNode;
}

function ExplorerTabButton({
  tab,
  active,
  label,
  display = "icon-label",
  onTabPress,
  testID,
  children,
}: ExplorerTabButtonProps) {
  const handlePress = useCallback(() => onTabPress(tab), [onTabPress, tab]);
  const tabStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.tab,
      (active || hovered || pressed) && styles.tabActive,
    ],
    [active],
  );
  const tabTextStyle = useMemo(() => [styles.tabText, active && styles.tabTextActive], [active]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const button = (
    <Pressable
      testID={testID}
      style={tabStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
    >
      {display === "label" ? null : children}
      {display === "icon" ? null : <Text style={tabTextStyle}>{label}</Text>}
    </Pressable>
  );
  if (display !== "icon") {
    return button;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tabTooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function resolveActiveExplorerTab(input: {
  activeTab: ExplorerTab;
  isGit: boolean;
  hasProjectSearch: boolean;
  showPrTab: boolean;
  isDeveloperMode: boolean;
}): ExplorerTab {
  // User interface mode exposes only the Files tab (Changes / Search / PR are
  // developer-and-git surfaces). Any persisted dev-tab selection coerces to
  // files rather than rendering an empty pane — see interface-modes.md.
  if (!input.isDeveloperMode) {
    return "files";
  }
  const featureCoerced =
    input.activeTab === "search" && !input.hasProjectSearch ? "files" : input.activeTab;
  const requested =
    !input.isGit && (featureCoerced === "changes" || featureCoerced === "pr")
      ? "files"
      : featureCoerced;
  return requested === "pr" && !input.showPrTab ? "changes" : requested;
}

interface ExplorerTabDef {
  tab: ExplorerTab;
  label: string;
  testID: string;
  /** The PR tab keeps icon+label (it carries the PR number); others collapse by tier. */
  alwaysLabeled?: boolean;
  renderIcon: (color: string) => React.ReactNode;
}

interface SidebarContentProps {
  activeTab: ExplorerTab;
  onTabPress: (tab: ExplorerTab) => void;
  onClose: () => void;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isDeveloperMode: boolean;
  isMobile: boolean;
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
  isDeveloperMode,
  isMobile,
  isOpen,
  onOpenFile,
}: SidebarContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const iconSize = useIconSize();
  const toast = useToast();
  const padding = useWindowControlsPadding("explorerSidebar");
  // In User interface mode only the Files tab renders, so the PR/git query is
  // never needed — keep it from firing (a lens, not a lock: no dev-surface RPCs).
  const canQueryPullRequest = isDeveloperMode && isGit && Boolean(workspaceRoot);
  const prPane = usePrPaneData({
    serverId,
    cwd: workspaceRoot,
    enabled: canQueryPullRequest && isOpen,
    timelineEnabled: activeTab === "pr" && canQueryPullRequest && isOpen,
  });
  const hasPullRequest = prPane.prNumber !== null;
  const showPrTab = hasPullRequest || (activeTab === "pr" && prPane.isLoading);
  const hasProjectSearch = useProjectSearchFeature(serverId);
  const resolvedTab = resolveActiveExplorerTab({
    activeTab,
    isGit,
    hasProjectSearch,
    showPrTab,
    isDeveloperMode,
  });
  const prTabLabel = formatPrTabLabel(prPane.prNumber);
  const refreshGitActions = useCheckoutGitActionsStore((s) => s.refresh);
  const handlePrRetry = useCallback(() => {
    refreshGitActions({ serverId, cwd: workspaceRoot }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [refreshGitActions, serverId, t, toast, workspaceRoot]);
  const workspaceAttachmentScopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd: workspaceRoot }),
    [serverId, workspaceId, workspaceRoot],
  );

  const headerStyle = useMemo(
    () => [styles.header, { paddingRight: padding.right }],
    [padding.right],
  );

  const [headerWidth, setHeaderWidth] = useState(0);
  const [rightSectionWidth, setRightSectionWidth] = useState(0);
  const [labeledTabsWidth, setLabeledTabsWidth] = useState(0);
  const [textTabsWidth, setTextTabsWidth] = useState(0);
  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setHeaderWidth(event.nativeEvent.layout.width);
  }, []);
  const handleRightSectionLayout = useCallback((event: LayoutChangeEvent) => {
    setRightSectionWidth(event.nativeEvent.layout.width);
  }, []);
  const handleLabeledTabsLayout = useCallback((event: LayoutChangeEvent) => {
    setLabeledTabsWidth(event.nativeEvent.layout.width);
  }, []);
  const handleTextTabsLayout = useCallback((event: LayoutChangeEvent) => {
    setTextTabsWidth(event.nativeEvent.layout.width);
  }, []);

  // User mode shows only Files; Changes / Search / PR are developer-and-git
  // surfaces gated out of that lens (interface-modes.md). Search may return to
  // User mode later as a simpler variant — keep it behind the same gate for now.
  const tabDefs: ExplorerTabDef[] = [];
  if (isDeveloperMode && isGit) {
    tabDefs.push({
      tab: "changes",
      label: t("workspace.tabs.explorer.changes"),
      testID: "explorer-tab-changes",
      renderIcon: (color) => <SourceControlPanelIcon size={iconSize.sm} color={color} />,
    });
  }
  tabDefs.push({
    tab: "files",
    label: t("workspace.tabs.explorer.files"),
    testID: "explorer-tab-files",
    renderIcon: (color) => <Files size={iconSize.sm} color={color} />,
  });
  if (isDeveloperMode && hasProjectSearch) {
    tabDefs.push({
      tab: "search",
      label: t("workspace.tabs.explorer.search"),
      testID: "explorer-tab-search",
      renderIcon: (color) => <DocumentSearch size={iconSize.sm} color={color} />,
    });
  }
  if (isDeveloperMode && isGit && showPrTab) {
    tabDefs.push({
      tab: "pr",
      label: prTabLabel,
      testID: "explorer-tab-pr",
      alwaysLabeled: true,
      renderIcon: (color) => (
        <PullRequestTabIcon size={iconSize.sm} color={color} provider={prPane.hostingProvider} />
      ),
    });
  }

  // headerWidth includes the header's own padding: spacing[2] on the left,
  // padding.right (window-controls chrome) on the right. Keep one more
  // spacing[2] of breathing room before the right section.
  const availableTabsWidth = headerWidth - theme.spacing[2] * 2 - padding.right - rightSectionWidth;
  // Three tiers: icon+label when the fully-labeled row fits, label-only when
  // dropping the icons is enough (on the desktop app the window-controls
  // reservation makes the icon+label row miss by roughly the icons' width at
  // common sidebar sizes), icon-only otherwise.
  const tabDisplay = resolveExplorerTabDisplay({
    headerWidth,
    availableTabsWidth,
    labeledTabsWidth,
    textTabsWidth,
  });

  return (
    <View style={styles.sidebarContent} pointerEvents="auto">
      {/* Header with tabs and close button */}
      <View style={headerStyle} testID="explorer-header" onLayout={handleHeaderLayout}>
        <TitlebarDragRegion />
        <View style={styles.tabsContainer}>
          {tabDefs.map((def) => {
            const active = resolvedTab === def.tab;
            return (
              <ExplorerTabButton
                key={def.tab}
                tab={def.tab}
                active={active}
                label={def.label}
                display={def.alwaysLabeled ? "icon-label" : tabDisplay}
                onTabPress={onTabPress}
                testID={def.testID}
              >
                {def.renderIcon(active ? theme.colors.foreground : theme.colors.foregroundMuted)}
              </ExplorerTabButton>
            );
          })}
        </View>
        <View style={styles.headerRightSection} onLayout={handleRightSectionLayout}>
          {isMobile && (
            <Pressable onPress={onClose} style={styles.closeButton}>
              <X size={iconSize.md} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
        </View>
        {/* Invisible clones of the tab row — one icon+label, one label-only —
            whose natural widths decide which display tier the real tabs can
            afford. Absolute with pointerEvents none so they affect neither
            layout, clicks, nor the titlebar drag region. */}
        <View
          style={styles.tabsMeasureRow}
          pointerEvents="none"
          aria-hidden
          onLayout={handleLabeledTabsLayout}
        >
          {tabDefs.map((def) => (
            <View key={def.tab} style={styles.tab}>
              {def.renderIcon(theme.colors.foregroundMuted)}
              <Text style={styles.tabText} numberOfLines={1}>
                {def.label}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={styles.tabsMeasureRow}
          pointerEvents="none"
          aria-hidden
          onLayout={handleTextTabsLayout}
        >
          {tabDefs.map((def) => (
            <View key={def.tab} style={styles.tab}>
              {def.alwaysLabeled ? def.renderIcon(theme.colors.foregroundMuted) : null}
              <Text style={styles.tabText} numberOfLines={1}>
                {def.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Content based on active tab */}
      <View style={styles.contentArea} testID="explorer-content-area">
        {resolvedTab === "changes" && (
          <GitDiffPane
            serverId={serverId}
            workspaceId={workspaceId}
            cwd={workspaceRoot}
            enabled={isOpen}
            onOpenFile={onOpenFile}
          />
        )}
        {resolvedTab === "files" && (
          <FileExplorerPane
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            onOpenFile={onOpenFile}
          />
        )}
        {resolvedTab === "search" && (
          <ProjectSearchPane
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            onOpenFile={onOpenFile}
          />
        )}
        {resolvedTab === "pr" && (
          <PrTabContent
            serverId={serverId}
            cwd={workspaceRoot}
            prPane={prPane}
            workspaceAttachmentScopeKey={workspaceAttachmentScopeKey}
            onRetry={handlePrRetry}
          />
        )}
      </View>
    </View>
  );
}

interface PrTabContentProps {
  serverId: string;
  cwd: string;
  prPane: UsePrPaneDataResult;
  workspaceAttachmentScopeKey: string;
  onRetry: () => void;
}

function PrTabContent({
  serverId,
  cwd,
  prPane,
  workspaceAttachmentScopeKey,
  onRetry,
}: PrTabContentProps) {
  if (prPane.data) {
    return (
      <PullRequestPane
        serverId={serverId}
        cwd={cwd}
        data={prPane.data}
        activityLoading={prPane.activityLoading}
        workspaceAttachmentScopeKey={workspaceAttachmentScopeKey}
      />
    );
  }
  if (prPane.error) {
    return <PullRequestPaneError onRetry={onRetry} />;
  }
  return <PullRequestPaneSkeleton />;
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const explorerStaticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
    // Clip the inner content while the outer width animates during the
    // open/close slide, so the panel edge reveals cleanly.
    overflow: "hidden" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  desktopSidebarBorder: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  resizeHandle: {
    position: "absolute",
    left: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  header: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabsContainer: {
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  // Off-layout twin of tabsContainer used only to measure the labeled width.
  tabsMeasureRow: {
    position: "absolute",
    left: 0,
    top: 0,
    flexDirection: "row",
    gap: theme.spacing[1],
    opacity: 0,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tabText: {
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  tabTextActive: {
    color: theme.colors.foreground,
  },
  tabTextMuted: {
    opacity: 0.8,
  },
  tabTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
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

const DESKTOP_SIDEBAR_BORDER_STYLE = [styles.desktopSidebarBorder, { flex: 1 }];
const RESIZE_HANDLE_STYLE = [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)];
