import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { ArrowLeftToLine, Plus, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import Animated from "react-native-reanimated";
import { SortableInlineList } from "@/components/sortable-inline-list";
import type {
  DraggableListDragHandleProps,
  DraggableRenderItemInfo,
} from "@/components/draggable-list.types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { titlebarDragSurfaceStyle } from "@/components/desktop/titlebar-drag-region";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";
import {
  iconButtonChromeGlyphSize,
  smallIconButtonChromeFrameSize,
} from "@/components/ui/icon-button-chrome";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { canCloseWorkspaceTab } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceDesktopTabRowItem } from "@/screens/workspace/workspace-desktop-tabs-row";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
} from "@/workspace-tabs/launcher";
import { panelSupportsHost } from "@/panels/panel-manifest";
import type { PanelIconProps } from "@/panels/panel-registry";
import { panelTargetSupportsHost } from "@/plugins/workspace-panels/locations";
import type { Theme } from "@/styles/theme";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import {
  HorizontalScrollBoundaryShades,
  useHorizontalScrollBoundary,
} from "@/components/ui/horizontal-scroll-boundary";

const TAB_GAP = 4;
const TAB_DROP_INDICATOR_WIDTH = 4;
// Explorer tabs are compact title-bar controls. This is their smallest useful
// labelled width; below it labels give way to the icon-only control.
const EXPLORER_TAB_LABELED_MIN_WIDTH = 80;

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ExplorerSidebarTabRailProps {
  paneId: string;
  tabs: WorkspaceDesktopTabRowItem[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  activeDragTabId: string | null;
  tabDropPreviewIndex: number | null;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCreateNewTab: () => void;
  onMoveTabToMain: (tabId: string) => void;
  onReorderTabs: (tabs: WorkspaceTabDescriptor[]) => void;
  trailingAccessory?: ReactNode;
}

function tabKey(item: WorkspaceDesktopTabRowItem): string {
  return `${item.tab.key}:${item.tab.kind}`;
}

function resolveExplorerSidebarTabBackdrop(): SurfaceBackdrop {
  return "surfaceSidebar";
}

function ExplorerSidebarTab({
  item,
  showLabel,
  isDragging,
  dragHandleProps,
  onNavigateTab,
  onCloseTab,
  onMoveTabToMain,
  normalizedServerId,
  normalizedWorkspaceId,
}: {
  item: WorkspaceDesktopTabRowItem;
  showLabel: boolean;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onMoveTabToMain: (tabId: string) => void;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const changesShortcutKeys = useShortcutKeys("workspace-tab-target-changes");
  const filesShortcutKeys = useShortcutKeys("workspace-tab-target-files");
  let shortcutKeys = null;
  if (item.tab.target.kind === "working_diff" || item.tab.target.kind === "changes_tree") {
    shortcutKeys = changesShortcutKeys;
  } else if (item.tab.target.kind === "files") {
    shortcutKeys = filesShortcutKeys;
  }
  const handlePress = useCallback(
    () => onNavigateTab(item.tab.tabId),
    [item.tab.tabId, onNavigateTab],
  );
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const handleClose = useCallback(() => {
    void onCloseTab(item.tab.tabId);
  }, [item.tab.tabId, onCloseTab]);
  const handleMoveToMain = useCallback(
    () => onMoveTabToMain(item.tab.tabId),
    [item.tab.tabId, onMoveTabToMain],
  );
  const canMoveToMain = panelTargetSupportsHost(normalizedServerId, item.tab.target, "main");
  const canClose = canCloseWorkspaceTab(item.tab);
  const moveToMainLeading = useMemo(
    () => <ThemedArrowLeftToLine size={14} uniProps={mutedColorMapping} />,
    [],
  );
  const closeLeading = useMemo(() => <ThemedX size={14} uniProps={mutedColorMapping} />, []);
  const accessibilityState = useMemo(() => ({ selected: item.isActive }), [item.isActive]);
  const renderPresentation = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <ContextMenu>
        <Tooltip delayDuration={300} enabledOnDesktop={!showLabel} enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              triggerRef={dragHandleProps?.setActivatorNodeRef as never}
              testID={`explorer-sidebar-tab-${item.tab.tabId}`}
              enabled={canMoveToMain || canClose}
              accessibilityRole="button"
              accessibilityLabel={presentation.tooltip}
              accessibilityState={accessibilityState}
              onPress={handlePress}
              onHoverIn={handleHoverIn}
              onHoverOut={handleHoverOut}
              style={[
                styles.tab,
                !showLabel ? styles.tabCompact : null,
                hovered ? styles.tabHovered : null,
                item.isActive ? styles.tabActive : null,
                isDragging ? styles.tabDragging : null,
              ]}
            >
              <WorkspaceTabIcon
                presentation={presentation}
                active={item.isActive}
                accent={item.isActive}
                size={iconButtonChromeGlyphSize("small")}
                strokeWidth={1.5}
                backdrop={resolveExplorerSidebarTabBackdrop()}
              />
              {showLabel ? (
                <Text
                  selectable={false}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[styles.tabLabel, item.isActive ? styles.tabLabelActive : null]}
                >
                  {presentation.label}
                </Text>
              ) : null}
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <View style={styles.tooltipRow}>
              <Text style={styles.tooltipText}>{presentation.label}</Text>
              {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
            </View>
          </TooltipContent>
        </Tooltip>
        <ContextMenuContent align="start" minWidth={180}>
          {canMoveToMain ? (
            <ContextMenuItem leading={moveToMainLeading} onSelect={handleMoveToMain}>
              {t("workspace.tabs.menu.moveToMain")}
            </ContextMenuItem>
          ) : null}
          {canMoveToMain && canClose ? <ContextMenuSeparator /> : null}
          {canClose ? (
            <ContextMenuItem leading={closeLeading} onSelect={handleClose}>
              {t("workspace.tabs.menu.close")}
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    ),
    [
      accessibilityState,
      dragHandleProps,
      handleHoverIn,
      handleHoverOut,
      handleClose,
      handleMoveToMain,
      handlePress,
      hovered,
      isDragging,
      item,
      canMoveToMain,
      canClose,
      closeLeading,
      moveToMainLeading,
      showLabel,
      shortcutKeys,
      t,
    ],
  );

  return (
    <WorkspaceTabPresentationResolver
      tab={item.tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {renderPresentation}
    </WorkspaceTabPresentationResolver>
  );
}

function CatalogIcon({
  Icon,
  color = "",
}: {
  Icon: ComponentType<PanelIconProps>;
  color?: string;
}) {
  return <Icon size={14} color={color} />;
}

const ThemedCatalogIcon = withUnistyles(CatalogIcon);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedPlus = withUnistyles(Plus);
const ThemedX = withUnistyles(X);

function ExplorerSidebarConfigurationItem({
  item,
  paneId,
  tab,
  onCloseTab,
}: {
  item: WorkspaceTabLaunchItem;
  paneId: string;
  tab: WorkspaceTabDescriptor | null;
  onCloseTab: (tabId: string) => Promise<void> | void;
}) {
  const leading = useMemo(() => {
    return item.Icon ? <ThemedCatalogIcon Icon={item.Icon} uniProps={mutedColorMapping} /> : null;
  }, [item.Icon]);
  const handleSelect = useCallback(() => {
    if (tab) {
      void onCloseTab(tab.tabId);
      return;
    }
    item.launch({ kind: "open", paneId });
  }, [item, onCloseTab, paneId, tab]);

  return (
    <ContextMenuItem
      leading={leading}
      selected={Boolean(tab)}
      showSelectedCheck
      disabled={!tab && item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </ContextMenuItem>
  );
}

function catalogItemMatchesTab(item: WorkspaceTabLaunchItem, tab: WorkspaceTabDescriptor): boolean {
  return item.panelKind === tab.target.kind;
}

export function ExplorerSidebarTabRail({
  paneId,
  tabs,
  normalizedServerId,
  normalizedWorkspaceId,
  activeDragTabId,
  tabDropPreviewIndex,
  onNavigateTab,
  onCloseTab,
  onCreateNewTab,
  onMoveTabToMain,
  onReorderTabs,
  trailingAccessory,
}: ExplorerSidebarTabRailProps) {
  const scrollBoundary = useHorizontalScrollBoundary();
  const { t } = useTranslation();
  const [tabsContainerWidth, setTabsContainerWidth] = useState(0);
  const handleTabsContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setTabsContainerWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
  }, []);
  const compactLabels =
    tabsContainerWidth > 0 && tabsContainerWidth < tabs.length * EXPLORER_TAB_LABELED_MIN_WIDTH;
  const groups = useWorkspaceTabLaunchCatalog({
    serverId: normalizedServerId,
    purpose: "supporting",
    host: "explorer",
  });
  const singletonConfigurationItems = useMemo(
    () =>
      (groups.find((group) => group.id === "tabs")?.items ?? []).filter(
        (item) => !panelSupportsHost(item.panelKind, "main"),
      ),
    [groups],
  );
  const newTabLeading = useMemo(() => <ThemedPlus size={14} uniProps={mutedColorMapping} />, []);
  const handleDragEnd = useCallback(
    (nextTabs: WorkspaceDesktopTabRowItem[]) => onReorderTabs(nextTabs.map((item) => item.tab)),
    [onReorderTabs],
  );
  const getTabDragData = useCallback(
    (item: WorkspaceDesktopTabRowItem) => ({
      kind: "workspace-tab" as const,
      paneId,
      tabId: item.tab.tabId,
    }),
    [paneId],
  );
  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<WorkspaceDesktopTabRowItem>) => {
      const showBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === tabs.length &&
        index === tabs.length - 1;
      return (
        <View style={styles.tabSlot}>
          {showBefore ? <View style={[styles.dropIndicator, styles.dropIndicatorBefore]} /> : null}
          <ExplorerSidebarTab
            item={item}
            showLabel={!compactLabels}
            isDragging={isActive}
            dragHandleProps={dragHandleProps}
            onNavigateTab={onNavigateTab}
            onCloseTab={onCloseTab}
            onMoveTabToMain={onMoveTabToMain}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
          />
          {showAfter ? <View style={[styles.dropIndicator, styles.dropIndicatorAfter]} /> : null}
        </View>
      );
    },
    [
      activeDragTabId,
      compactLabels,
      normalizedServerId,
      normalizedWorkspaceId,
      onNavigateTab,
      onCloseTab,
      onMoveTabToMain,
      tabDropPreviewIndex,
      tabs.length,
    ],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        contextOnly
        style={[styles.track, titlebarDragSurfaceStyle as never]}
        testID="explorer-sidebar-tab-rail"
      >
        <View style={styles.scrollContainer} onLayout={handleTabsContainerLayout}>
          <Animated.ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            onLayout={scrollBoundary.onLayout}
            onContentSizeChange={scrollBoundary.onContentSizeChange}
            onScroll={scrollBoundary.onScroll}
            scrollEventThrottle={16}
          >
            <SortableInlineList
              data={tabs}
              keyExtractor={tabKey}
              renderItem={renderTab}
              onDragEnd={handleDragEnd}
              useDragHandle
              externalDndContext
              activeId={activeDragTabId}
              getItemData={getTabDragData}
            />
          </Animated.ScrollView>
          <HorizontalScrollBoundaryShades
            visible
            backdrop="sidebar"
            testIDPrefix="explorer-sidebar-tabs-scroll-shade"
            leftStyle={scrollBoundary.leftShadeStyle}
            rightStyle={scrollBoundary.rightShadeStyle}
          />
        </View>
        {trailingAccessory ? (
          <View style={styles.trailingAccessory}>{trailingAccessory}</View>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" minWidth={200} testID="explorer-sidebar-tab-configuration">
        <ContextMenuItem leading={newTabLeading} onSelect={onCreateNewTab}>
          {t("workspace.tabs.actions.newTab")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {singletonConfigurationItems.map((item) => (
          <ExplorerSidebarConfigurationItem
            key={item.id}
            item={item}
            paneId={paneId}
            tab={tabs.find(({ tab }) => catalogItemMatchesTab(item, tab))?.tab ?? null}
            onCloseTab={onCloseTab}
          />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: {
    minWidth: 0,
    // The dock divides the whole workspace, including ScreenHeader. Its tab rail
    // must therefore share that primary chrome height, not the 36px pane-tab rail.
    height: HEADER_INNER_HEIGHT,
    backgroundColor: theme.colors.surfaceSidebarPanel,
    flexDirection: "row",
    alignItems: "center",
  },
  scrollContainer: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  trailingAccessory: {
    marginRight: 4,
  },
  tabSlot: {
    position: "relative",
    marginHorizontal: TAB_GAP / 2,
  },
  tab: {
    // Explorer tabs live beside the compact title-bar shortcuts. Match their
    // 32px interaction frame so chips and icon chrome share one visual rhythm.
    height: smallIconButtonChromeFrameSize(true),
    maxWidth: 180,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  tabCompact: {
    width: smallIconButtonChromeFrameSize(true),
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  tabHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceHover,
  },
  tabLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
  },
  tabLabelActive: {
    color: theme.colors.accent,
  },
  tabDragging: {
    opacity: 0.3,
  },
  dropIndicator: {
    position: "absolute",
    top: theme.spacing[0.5],
    bottom: theme.spacing[0.5],
    width: TAB_DROP_INDICATOR_WIDTH,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  dropIndicatorBefore: {
    left: -TAB_GAP / 2 - TAB_DROP_INDICATOR_WIDTH / 2,
  },
  dropIndicatorAfter: {
    right: -TAB_GAP / 2 - TAB_DROP_INDICATOR_WIDTH / 2,
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
}));
