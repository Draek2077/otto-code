import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { SortableInlineList } from "@/components/sortable-inline-list";
import type { DraggableRenderItemInfo } from "@/components/draggable-list.types";
import {
  WORKSPACE_SECONDARY_HEADER_HEIGHT,
  WORKSPACE_TABS_RAIL_MIN_WIDTH,
} from "@/constants/layout";
import {
  getFallbackTabLabel,
  ResolvedDesktopTabChip,
  TabOrientationToggleButton,
  tabKeyExtractor,
  usePaneTabAgentFacts,
  WorkspaceTabRowExtras,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  computeWorkspaceTabRailWidth,
  RAIL_TAB_MAX_WIDTH,
  TAB_CLOSE_BUTTON_WIDTH,
  TAB_ESTIMATED_CHAR_WIDTH,
  TAB_HORIZONTAL_PADDING,
  TAB_ICON_WIDTH,
} from "@/screens/workspace/workspace-tab-layout";
import type { WorkspaceTabMenuLabels } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { RenderProfile } from "@/utils/render-profiler";

interface WorkspaceDesktopTabsRailProps {
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
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onCreateDraftTab: (input: { paneId?: string }) => void;
  onCreateTerminalTab: (input: { paneId?: string; profile?: TerminalProfileInput }) => void;
  onCreateBrowserTab: (input: { paneId?: string }) => void;
  showCreateBrowserTab?: boolean;
  disableCreateTerminal?: boolean;
  isWaitingOnTerminalReadiness?: boolean;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  showPaneSplitActions?: boolean;
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  tabOrientation: "horizontal" | "vertical";
  onToggleTabOrientation: () => void;
}

// Fixed header chrome around the pinned-tools slot: the header's left padding
// (8) + the orientation toggle (22) + the tools strip's own horizontal
// padding (16) + the more-actions chevron (22). Whatever is left of railWidth
// after this is the budget pinned tool buttons must fit into; the rest stay
// reachable through the chevron's catalog menu.
const RAIL_HEADER_FIXED_CHROME_WIDTH = 68;

// Scales the rail's content-driven width formula up from the horizontal
// row's per-char metrics — see railMetrics below.
const RAIL_WIDTH_SCALE = 1.5;

function noopStripLayout() {}

// The rail's column-shaped counterpart to WorkspaceDesktopTabsRow. It reuses
// the exact same tab-item chip (ResolvedDesktopTabChip, see step 2 of
// docs/design.md) rather than duplicating tab
// rendering, context-menu wiring, or drag-and-drop plumbing. Unlike the row,
// there is no viewport-driven shrink-to-fit algorithm: overflow is handled by
// plain vertical scroll, and the rail's width is content-driven instead
// (computeWorkspaceTabRailWidth) — every tab shares one width, sized to the
// widest current label and clamped to [WORKSPACE_TABS_RAIL_MIN_WIDTH,
// RAIL_TAB_MAX_WIDTH]. Every row always shows icon + a single-line truncated
// label (no icon-only sub-mode in v1).
export function WorkspaceDesktopTabsRail({
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
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateDraftTab,
  onCreateTerminalTab,
  onCreateBrowserTab,
  showCreateBrowserTab = false,
  disableCreateTerminal = false,
  isWaitingOnTerminalReadiness = false,
  onReorderTabs,
  onSplitRight,
  onSplitDown,
  showPaneSplitActions = true,
  externalDndContext = false,
  activeDragTabId = null,
  tabOrientation,
  onToggleTabOrientation,
}: WorkspaceDesktopTabsRailProps) {
  const { t } = useTranslation();
  const router = useRouter();
  // Reveals the hide-until-hover tools strip (see WorkspaceTabRowExtras'
  // rowHovered) while the pointer is anywhere over the rail — chips included —
  // mirroring the row, whose reveal region is the whole tab bar.
  const [railHovered, setRailHovered] = useState(false);
  const handleRailPointerEnter = useCallback(() => setRailHovered(true), []);
  const handleRailPointerLeave = useCallback(() => setRailHovered(false), []);

  const fallbackTabLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
    }),
    [t],
  );
  const tabLabelLengths = useMemo(
    () => tabs.map((item) => getFallbackTabLabel(item.tab, fallbackTabLabels).length),
    [fallbackTabLabels, tabs],
  );
  // The rail's own width formula is scaled up by RAIL_WIDTH_SCALE (on top of
  // the shared per-char metrics used for the horizontal row's math) so labels
  // in the middle of the min/max range grow too, not just the floor/ceiling.
  const railMetrics = useMemo(
    () => ({
      tabIconWidth: TAB_ICON_WIDTH * RAIL_WIDTH_SCALE,
      tabHorizontalPadding: TAB_HORIZONTAL_PADDING * RAIL_WIDTH_SCALE,
      estimatedCharWidth: TAB_ESTIMATED_CHAR_WIDTH * RAIL_WIDTH_SCALE,
      closeButtonWidth: TAB_CLOSE_BUTTON_WIDTH * RAIL_WIDTH_SCALE,
      maxTabWidth: RAIL_TAB_MAX_WIDTH,
      minTabWidth: WORKSPACE_TABS_RAIL_MIN_WIDTH,
    }),
    [],
  );
  // Content-driven, not viewport-driven: every tab in the rail shares this one
  // width, sized to the widest current label (short labels shrink the rail,
  // long ones truncate past RAIL_TAB_MAX_WIDTH — see computeWorkspaceTabRailWidth).
  const railWidth = useMemo(
    () => computeWorkspaceTabRailWidth({ tabLabelLengths, metrics: railMetrics }),
    [tabLabelLengths, railMetrics],
  );
  // Only the content's left padding is subtracted: chips run flush to the
  // rail's right edge so the active chip's open right side fuses with the
  // pane content (covering the right hairline), like the horizontal row's
  // active tab fuses with the pane below.
  const railChipWidth = railWidth - 4;
  const railOuterStyle = useMemo(
    () => [styles.rail, { width: railWidth, minWidth: railWidth, maxWidth: railWidth }],
    [railWidth],
  );

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
    (profile: TerminalProfileInput) => {
      onCreateTerminalTab({ paneId, profile });
    },
    [onCreateTerminalTab, paneId],
  );

  const handleCreateBrowser = useCallback(() => {
    onCreateBrowserTab({ paneId });
  }, [onCreateBrowserTab, paneId]);

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);

  const { focusedAgentId, paneHasEditableAgentTab, paneHasPreviewTab } = usePaneTabAgentFacts({
    tabs,
    focusedTab,
    normalizedServerId,
  });
  const terminalDisabled = disableCreateTerminal || isWaitingOnTerminalReadiness;

  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<WorkspaceDesktopTabRowItem>) => (
      <ResolvedDesktopTabChip
        key={`${item.tab.key}:${item.tab.kind}`}
        item={item}
        isFocused={isFocused}
        isDragging={isActive}
        index={index}
        tabCount={tabs.length}
        normalizedServerId={normalizedServerId}
        normalizedWorkspaceId={normalizedWorkspaceId}
        onCopyResumeCommand={onCopyResumeCommand}
        onCopyAgentId={onCopyAgentId}
        onCopyFilePath={onCopyFilePath}
        onReloadAgent={onReloadAgent}
        onRenameTab={onRenameTab}
        onCloseTabsToLeft={onCloseTabsToLeft}
        onCloseTabsToRight={onCloseTabsToRight}
        onCloseOtherTabs={onCloseOtherTabs}
        resolvedTabWidth={railChipWidth}
        showLabel
        showCloseButton
        orientation="vertical"
        setHoveredCloseTabKey={setHoveredCloseTabKey}
        onNavigateTab={onNavigateTab}
        onCloseTab={onCloseTab}
        labels={tabMenuLabels}
        dragHandleProps={dragHandleProps}
        showDropIndicatorBefore={false}
        showDropIndicatorAfter={false}
      />
    ),
    [
      isFocused,
      normalizedServerId,
      normalizedWorkspaceId,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      railChipWidth,
      setHoveredCloseTabKey,
      tabMenuLabels,
      tabs.length,
    ],
  );

  const rail = (
    <View
      style={railOuterStyle}
      testID="workspace-tabs-rail"
      onPointerEnter={handleRailPointerEnter}
      onPointerLeave={handleRailPointerLeave}
    >
      <View style={styles.railRightHairline} pointerEvents="none" />
      <View style={styles.header}>
        <TabOrientationToggleButton
          orientation={tabOrientation}
          onToggle={onToggleTabOrientation}
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
          tabsContainerWidth={0}
          tabCount={tabs.length}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          showPaneSplitActions={showPaneSplitActions}
          onStripLayout={noopStripLayout}
          toolsAvailableWidth={Math.max(0, railWidth - RAIL_HEADER_FIXED_CHROME_WIDTH)}
          rowHovered={railHovered}
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <SortableInlineList
          data={tabs}
          keyExtractor={tabKeyExtractor}
          useDragHandle
          disabled={!externalDndContext && tabs.length < 2}
          onDragEnd={handleDragEnd}
          externalDndContext={externalDndContext}
          activeId={activeDragTabId}
          getItemData={getTabDragData}
          renderItem={renderTab}
          orientation="vertical"
        />
      </ScrollView>
    </View>
  );

  return <RenderProfile id="WorkspaceDesktopTabsRail">{rail}</RenderProfile>;
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    // width/minWidth/maxWidth are applied dynamically via railOuterStyle —
    // see railWidth (computeWorkspaceTabRailWidth) above.
    height: "100%",
    backgroundColor: theme.colors.surfaceSidebar,
  },
  // The rail/pane separator is a positioned child rather than a borderRight so
  // the active chip (which runs flush to the rail's right edge) can paint over
  // it and fuse with the pane content — the vertical counterpart of the row's
  // tabsBottomHairline.
  railRightHairline: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 1,
    backgroundColor: theme.colors.border,
  },
  // Orientation toggle left, tools strip (New agent/terminal/browser +
  // catalog chevron) right. No right padding of its own — the strip carries
  // an 8px internal horizontal padding (styles.tabsActions in the row file),
  // which RAIL_HEADER_FIXED_CHROME_WIDTH accounts for.
  header: {
    // Same fixed height as the horizontal row's gutter (styles.tabsContainer
    // in the row file) so toggling orientation doesn't shift the pane content
    // edge; alignItems centers the 22px controls within it.
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  scroll: {
    flex: 1,
  },
  content: {
    // Left inset only — chips run flush to the rail's right edge so the active
    // chip's open side meets the pane content (see railChipWidth above).
    // Gutter and chip spacing match the horizontal row: 4px inset
    // (tabsContent's paddingHorizontal), adjacent chips with no gap.
    paddingLeft: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
}));
