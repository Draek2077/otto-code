/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react/jsx-max-depth -- notification cards bind their own explicit conversation and acknowledgement identities. */
// Otto's workspace-screen controls: the explorer sidebar toggles, the
// vertical-rail fallback tabs with their center-content host, and the
// wake-word empty-state listener. Extracted from workspace-screen.tsx,
// which keeps one registration point per control.
import {
  useCallback,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { PanelRight, PanelRightClose } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";
import { HeaderToggleButton, headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VisualizerPipHost } from "@/visualizer/visualizer-pip-host";
import { generateDraftId } from "@/stores/draft-keys";
import { useWakeWordListening } from "@/hooks/use-wake-word-listening";
import { shouldStartWakeWordListening } from "@/voice/wake-word-control-state";
import { useWakeWordAutoStartStore } from "@/stores/wake-word-auto-start-store";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import { WorkspaceDesktopTabsRail } from "@/screens/workspace/workspace-desktop-tabs-rail";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { type TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { type WorkspaceFileOpenRequest } from "@/workspace/file-open";

// Duplicated from workspace-screen.tsx (keep in sync): a few lines each,
// and this module must not import the screen.
const ThemedPanelRight = withUnistyles(PanelRight);
const ThemedPanelRightClose = withUnistyles(PanelRightClose);
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });
const accentMdMapping = (theme: Theme) => ({
  color: theme.colors.accentBright,
  size: theme.iconSize.md,
});
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundMdMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.md,
});
const mutedMdMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});

function noop() {}

// The git-checkout variant of the explorer toggle (with its diff-stat badge and
// tooltip). Extracted from the workspace header so the header's JSX stays under
// the nesting-depth cap; it's developer-only, gated at the mount site.
export function GitCheckoutExplorerToggle({
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
                  <ThemedPanelRightClose uniProps={accentMdMapping} />
                ) : (
                  <ThemedPanelRight uniProps={inactiveMapping} />
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

// The plain explorer toggle (no git-aware diff badge) used to open/close the
// explorer sidebar. Developer mode uses it for non-git checkouts; User interface
// mode always uses it, since that mode shows a Files-only explorer.
export function PlainExplorerToggle({
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
            <ThemedPanelRightClose size={headerActionIconSize.lg} uniProps={accentColorMapping} />
          ) : (
            <ThemedPanelRight
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
          <ThemedPanelRightClose uniProps={accentMdMapping} />
        ) : (
          <ThemedPanelRight uniProps={hovered ? foregroundMdMapping : mutedMdMapping} />
        )
      }
    </HeaderToggleButton>
  );
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
export function WakeWordEmptyStateListener(props: WakeWordEmptyStateListenerProps): null {
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

/** The workspace's center column body plus the overlays that float above the
 * whole pane tree. Extracted from WorkspaceScreenContent purely to keep that
 * function inside the repo's complexity/JSX-depth budgets - it holds no state. */
export function WorkspaceCenterContent({
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

/** The non-split desktop fallback's tab chrome: the horizontal row above the
 * center content, or the vertical rail beside it, following the pane's
 * orientation. Extracted from WorkspaceScreenContent purely to keep that
 * function inside the repo's complexity budget - it holds no state and the
 * split-capable surface renders its own panes instead of this. */
export function WorkspaceFallbackTabs({
  tabOrientation,
  paneId,
  isFocused,
  tabs,
  focusedTab,
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
  onCreateDraftTab,
  onCreateTerminalTab,
  onCreateBrowserTab,
  showCreateBrowserTab,
  disableCreateTerminal,
  isWaitingOnTerminalReadiness,
  onReorderTabs,
  onArchiveAgent,
  onDeleteAgent,
  onToggleTabOrientation,
  children,
}: {
  tabOrientation: "horizontal" | "vertical";
  paneId?: string;
  isFocused: boolean;
  tabs: WorkspaceDesktopTabRowItem[];
  focusedTab: WorkspaceTabDescriptor | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void | Promise<void>;
  onCopyResumeCommand: (agentId: string) => void | Promise<void>;
  onCopyTerminalId: (terminalId: string) => void | Promise<void>;
  onCopyAgentId: (agentId: string) => void | Promise<void>;
  onCopyFilePath: (
    path: string,
    target?: "filename" | "full-path" | "workspace-path",
  ) => void | Promise<void>;
  onReloadAgent: (agentId: string) => void | Promise<void>;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => void | Promise<void>;
  onCloseTabsToRight: (tabId: string) => void | Promise<void>;
  onCloseOtherTabs: (tabId: string) => void | Promise<void>;
  onArchiveAgent?: (agentId: string) => void | Promise<void>;
  onDeleteAgent?: (agentId: string) => void | Promise<void>;
  onCreateDraftTab: (input: { paneId?: string }) => void;
  onCreateTerminalTab: (input: { paneId?: string; profile?: TerminalProfileInput }) => void;
  onCreateBrowserTab: (input: { paneId?: string }) => void;
  showCreateBrowserTab: boolean;
  disableCreateTerminal: boolean;
  isWaitingOnTerminalReadiness: boolean;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  onToggleTabOrientation: () => void;
  children: ReactNode;
}) {
  if (tabOrientation === "vertical") {
    return (
      <View style={styles.fallbackVerticalTabsRow}>
        <WorkspaceDesktopTabsRail
          paneId={paneId}
          isFocused={isFocused}
          tabs={tabs}
          focusedTab={focusedTab}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          onNavigateTab={onNavigateTab}
          onCloseTab={onCloseTab}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyTerminalId={onCopyTerminalId}
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          onCreateDraftTab={onCreateDraftTab}
          onCreateTerminalTab={onCreateTerminalTab}
          onCreateBrowserTab={onCreateBrowserTab}
          showCreateBrowserTab={showCreateBrowserTab}
          disableCreateTerminal={disableCreateTerminal}
          isWaitingOnTerminalReadiness={isWaitingOnTerminalReadiness}
          onReorderTabs={onReorderTabs}
          onSplitRight={noop}
          onSplitDown={noop}
          showPaneSplitActions={false}
          tabOrientation={tabOrientation}
          onToggleTabOrientation={onToggleTabOrientation}
        />
        {children}
      </View>
    );
  }
  return (
    <>
      <WorkspaceDesktopTabsRow
        paneId={paneId}
        isFocused={isFocused}
        tabs={tabs}
        normalizedServerId={normalizedServerId}
        normalizedWorkspaceId={normalizedWorkspaceId}
        setHoveredCloseTabKey={setHoveredCloseTabKey}
        onNavigateTab={onNavigateTab}
        onCloseTab={onCloseTab}
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
        onCreateDraftTab={onCreateDraftTab}
        onCreateTerminalTab={onCreateTerminalTab}
        onCreateBrowserTab={onCreateBrowserTab}
        showCreateBrowserTab={showCreateBrowserTab}
        disableCreateTerminal={disableCreateTerminal}
        isWaitingOnTerminalReadiness={isWaitingOnTerminalReadiness}
        onReorderTabs={onReorderTabs}
        onSplitRight={noop}
        onSplitDown={noop}
        showPaneSplitActions={false}
        tabOrientation={tabOrientation}
        onToggleTabOrientation={onToggleTabOrientation}
      />
      {children}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Duplicated from workspace-screen.tsx styles (keep in sync).
  centerContent: {
    flex: 1,
    minHeight: 0,
  },
  // Duplicated from workspace-screen.tsx styles (keep in sync).
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
  // The non-split fallback's vertical-tab layout: the rail is a left column,
  // the workspace content the rest of the width. The rail owns its own width
  // (content-driven or the user-saved one, capped at 60% of this row).
  fallbackVerticalTabsRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "stretch",
  },
}));
