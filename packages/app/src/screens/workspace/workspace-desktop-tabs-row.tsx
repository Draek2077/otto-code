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
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import {
  CopyX,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  Columns2,
  Copy,
  FileText,
  MessageSquare,
  Pencil,
  RotateCw,
  Rows2,
  Globe,
  PlayFilled,
  SquareTerminal,
  Tabs,
  X,
} from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useNonClientHover } from "@/hooks/use-non-client-hover";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useWorkspaceTabLayout } from "@/screens/workspace/use-workspace-tab-layout";
import {
  TAB_CLOSE_BUTTON_WIDTH,
  TAB_ESTIMATED_CHAR_WIDTH,
  TAB_HORIZONTAL_PADDING,
  TAB_ICON_WIDTH,
  TAB_MAX_WIDTH,
} from "@/screens/workspace/workspace-tab-layout";
import {
  computeVisibleTabActionKeys,
  type WorkspaceTabActionDescriptor,
} from "@/screens/workspace/workspace-tab-actions-overflow";
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
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@otto-code/protocol/terminal-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  confirmPreviewNeedsBrowserTools,
  useBrowserToolsWarningCopy,
  useOpenBrowserToolsSettings,
} from "@/utils/browser-tools-warning";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { ProfileIcon, usePinnedLaunchers, type ResolvedPin } from "@/workspace-pins/launch";
import { runPinnedTabTarget, type TabTargetHandlers } from "@/workspace-pins/run";
import { isTargetPinned, type PinnedTabTarget } from "@/workspace-pins/target";
import { usePinnedTargetsStore } from "@/workspace-pins/store";
import { PinnedTargetsRow } from "@/workspace-pins/pinned-targets-row";
import { PinnableMenuItem } from "@/workspace-pins/pinnable-menu-item";
import type { PreviewConfiguredServer, PreviewRunningServer } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { createWorkspaceBrowser, useBrowserStore } from "@/stores/browser-store";
import { ArtifactOpenMenu } from "@/components/artifacts/artifact-open-menu";
import {
  usePreviewRunningServersStore,
  useHasRunningPreviewServer,
} from "@/stores/preview-running-servers-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

const DROPDOWN_WIDTH = 220;
// Fixed colors for content on the forced-black chat tab (Black tab background
// setting) — must stay readable on #000 regardless of the active theme.
const ON_BLACK_FOREGROUND = "#e4e4e4"; // neutral off-white — matches dark themes' foreground ink
const ON_BLACK_MUTED = "#a1a1aa";
const LOADING_TAB_LABEL_SKELETON_WIDTH = 80;
// Width math for the trailing-tools overflow. These mirror the style constants
// below (newTabActionButton / pin buttons / the artifact trigger are 22,
// tabsContent pads 4 per side, tabsActions pads 8 per side). The collapse
// decision must be derived from constants — not from measuring the strip —
// or hiding a button would change the measurement that decided to hide it.
const SMALL_TOOL_WIDTH = 22;
const TABS_CONTENT_PADDING_TOTAL = 8;
const TOOLS_STRIP_PADDING_TOTAL = 16;
// The orientation toggle sits to the LEFT of the tabs (so it occupies the
// same top-left spot in both orientations and never moves under the pointer
// when toggled) — its button (22) plus the slot's left padding (8, matching
// the rail's styles.header paddingLeft in workspace-desktop-tabs-rail.tsx so
// the toggle lands in the same spot in both orientations) must be reserved
// out of the row width before tabs divide the rest.
const ORIENTATION_TOGGLE_RESERVED_WIDTH = SMALL_TOOL_WIDTH + 8;
// Background refresh so the Preview icon reflects real server state without
// requiring the user to open the picker first.
const PREVIEW_SERVER_POLL_INTERVAL_MS = 10_000;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedX = withUnistyles(X);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedGlobe = withUnistyles(Globe);
const ThemedPlayFilled = withUnistyles(PlayFilled);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);
const ThemedTabs = withUnistyles(Tabs);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedFileText = withUnistyles(FileText);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

// Leading icons for the more-actions catalog menu rows.
const MENU_AGENT_ICON = <ThemedMessageSquare size={14} uniProps={mutedColorMapping} />;
const MENU_PREVIEW_ICON = <ThemedPlayFilled size={14} uniProps={mutedColorMapping} />;
const MENU_ARTIFACTS_ICON = <ThemedFileText size={14} uniProps={mutedColorMapping} />;
const MENU_TERMINAL_ICON = <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />;
const MENU_BROWSER_ICON = <ThemedGlobe size={14} uniProps={mutedColorMapping} />;
const MENU_SPLIT_RIGHT_ICON = <ThemedColumns2 size={14} uniProps={mutedColorMapping} />;
const MENU_SPLIT_DOWN_ICON = <ThemedRows2 size={14} uniProps={mutedColorMapping} />;

// Pin targets for the catalog rows. Launcher pins get strip buttons; tool
// pins exempt the tool's button from overflow collapse.
const DRAFT_TARGET: PinnedTabTarget = { kind: "draft" };
const TERMINAL_TARGET: PinnedTabTarget = { kind: "terminal" };
const BROWSER_TARGET: PinnedTabTarget = { kind: "browser" };
const PREVIEW_TARGET: PinnedTabTarget = { kind: "preview" };
const ARTIFACT_TARGET: PinnedTabTarget = { kind: "artifact" };
const SPLIT_RIGHT_TARGET: PinnedTabTarget = { kind: "split-right" };
const SPLIT_DOWN_TARGET: PinnedTabTarget = { kind: "split-down" };
const PREVIEW_BOOTSTRAP_PROMPT =
  "Detect this project's dev servers and save their configurations to `.claude/launch.json` " +
  "(create it if missing) using the format from the `preview_start` tool description. Then ask me " +
  "which ones to start, and call `preview_start` for each one I pick.";

function newTabActionButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.newTabActionButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function previewServerStopButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [
    styles.previewServerStopButton,
    (hovered || pressed) && styles.previewServerStopButtonActive,
  ];
}

/**
 * Finds an already-open tab bound to the given preview dev server, so
 * re-selecting a running server from the picker can jump back to it instead
 * of no-op'ing (the tab may have been closed while the server itself, per the
 * "keep-running" close behavior, kept going).
 */
function findOpenPreviewTab(input: {
  workspaceKey: string;
  serverId: string;
  port: number;
}): string | null {
  const layoutStore = useWorkspaceLayoutStore.getState();
  const browsersById = useBrowserStore.getState().browsersById;
  const allTabs = layoutStore.getWorkspaceTabs(input.workspaceKey);
  const portNeedle = `:${input.port}`;
  for (const tab of allTabs) {
    if (tab.target.kind !== "browser") {
      continue;
    }
    const browser = browsersById[tab.target.browserId];
    if (!browser?.isPreview) {
      continue;
    }
    const matchesId = browser.previewServerId === input.serverId;
    const matchesPort = browser.url.includes(portNeedle);
    if (matchesId || matchesPort) {
      return tab.tabId;
    }
  }
  return null;
}

function updateMeasuredWidth(setWidth: Dispatch<SetStateAction<number>>, event: LayoutChangeEvent) {
  const nextWidth = Math.round(event.nativeEvent.layout.width);
  setWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
}

function ProfileLeadingIcon({ iconKey }: { iconKey: string | undefined }) {
  return (
    <View style={styles.terminalProfileIconWrapper}>
      <ProfileIcon iconKey={iconKey} />
    </View>
  );
}

interface PinnableProfileMenuItemProps {
  profile: { id: string; name: string; command: string; args?: string[]; icon?: string };
  disabled?: boolean;
  onLaunch: (target: PinnedTabTarget) => void;
}

function PinnableProfileMenuItem({ profile, disabled, onLaunch }: PinnableProfileMenuItemProps) {
  const target = useMemo<PinnedTabTarget>(
    () => ({ kind: "profile", profileId: profile.id }),
    [profile.id],
  );
  const leading = useMemo(
    () => <ProfileLeadingIcon iconKey={getTerminalProfileIcon(profile)} />,
    [profile],
  );
  const handleSelect = useCallback(() => onLaunch(target), [onLaunch, target]);

  return (
    <PinnableMenuItem
      target={target}
      label={profile.name}
      leading={leading}
      disabled={disabled}
      onSelect={handleSelect}
    />
  );
}

interface WorkspacePreviewControllerInput {
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  paneId?: string;
  focusedAgentId: string | null;
  /** False when this pane offers no preview tool at all — skips the poll. */
  enabled: boolean;
}

interface WorkspacePreviewController {
  isBusy: boolean;
  disabled: boolean;
  hasFocusedAgent: boolean;
  pickerOpen: boolean;
  pickerServers: PreviewConfiguredServer[];
  hasRunningPreviewServer: boolean;
  isServerRunning: (serverName: string) => boolean;
  runPreviewFlow: () => Promise<void>;
  handleOpenChange: (next: boolean) => void;
  handlePickServer: (serverName: string) => void;
  handleStopServer: (serverName: string) => void;
}

/**
 * Starts (or reuses) the focused chat's dev server and opens its designated
 * preview tab in a split pane to the right — the UI-driven counterpart to the
 * agent-facing preview_start tool. Disabled unless the pane's active tab is a
 * chat, since the server to preview is resolved from that agent's cwd.
 *
 * The logic lives in this hook rather than the button because the tools
 * overflow may collapse the button into the more-actions menu — the menu item
 * then drives the same flow, with the picker opening from a hidden anchor.
 */
function useWorkspacePreviewController({
  normalizedServerId,
  normalizedWorkspaceId,
  paneId,
  focusedAgentId,
  enabled,
}: WorkspacePreviewControllerInput): WorkspacePreviewController {
  const { config: daemonConfig } = useDaemonConfig(normalizedServerId);
  const browserToolsCopy = useBrowserToolsWarningCopy();
  const openBrowserToolsSettings = useOpenBrowserToolsSettings(normalizedServerId);
  const [isBusy, setIsBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerServers, setPickerServers] = useState<PreviewConfiguredServer[]>([]);
  const runningServersRef = useRef<Map<string, PreviewRunningServer>>(new Map());
  const hasRunningPreviewServer = useHasRunningPreviewServer(normalizedServerId);

  const startAndOpenPreview = useCallback(
    async (agentId: string, cwd: string, serverName: string) => {
      const client = useSessionStore.getState().sessions[normalizedServerId]?.client ?? null;
      if (!client) {
        return;
      }

      // Open the tab immediately, before the (possibly slow) start RPC resolves,
      // so the UI never blocks on a cold dev server. BrowserPane shows a centered
      // spinner while previewStatus is "starting" and only navigates once ready.
      const { browserId } = createWorkspaceBrowser({
        isPreview: true,
        previewServerName: serverName,
        previewCwd: cwd,
      });
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
      });
      if (workspaceKey && paneId) {
        const layoutStore = useWorkspaceLayoutStore.getState();
        const newTabId = layoutStore.openTabInBackground(workspaceKey, {
          kind: "browser",
          browserId,
        });
        if (newTabId) {
          layoutStore.splitPane(workspaceKey, {
            tabId: newTabId,
            targetPaneId: paneId,
            position: "right",
          });
        }
      }

      const started = await client.previewStart(cwd, serverName);
      if (!started.success || !started.server) {
        useBrowserStore.getState().updateBrowser(browserId, {
          previewStatus: "error",
          lastError: started.error ?? "unknown error",
        });
        await client
          .sendAgentMessage(
            agentId,
            `I tried to start the "${serverName}" preview server but it failed: ${
              started.error ?? "unknown error"
            }`,
          )
          .catch(() => undefined);
        return;
      }

      useBrowserStore.getState().updateBrowser(browserId, {
        url: started.server.url,
        previewServerId: started.server.serverId,
        previewStatus: "ready",
      });
      usePreviewRunningServersStore
        .getState()
        .markRunning(normalizedServerId, cwd, started.server.serverId);
      await client.previewBindTab(started.server.serverId, browserId).catch(() => undefined);
    },
    [normalizedServerId, normalizedWorkspaceId, paneId],
  );

  const stopServer = useCallback(
    async (serverId: string, serverName: string, port: number) => {
      const client = useSessionStore.getState().sessions[normalizedServerId]?.client ?? null;
      if (!client) {
        return;
      }

      await client.previewStop(serverId).catch(() => undefined);
      usePreviewRunningServersStore.getState().markStopped(normalizedServerId, serverId);

      // Close only the preview tab(s) bound to this specific server, not every browser tab.
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
      });

      if (workspaceKey) {
        // Match on the exact server id, or — for a server reconciled after a
        // daemon restart, whose tab still holds the pre-restart id — on the
        // dev-server port in the tab's URL.
        const tabId = findOpenPreviewTab({ workspaceKey, serverId, port });
        if (tabId) {
          useWorkspaceLayoutStore.getState().closeTab(workspaceKey, tabId);
        }
      }

      // Update running servers state to reflect the stop
      const map = runningServersRef.current;
      map.delete(serverName);
    },
    [normalizedServerId, normalizedWorkspaceId],
  );

  // Fetches launch config + live running servers for `cwd` and records the
  // running ones in the server-scoped store, independent of any tab/picker
  // UI. Shared by the click flow (runPreviewFlow) and the background poll
  // below, so the icon can turn accent-colored before the user ever opens it.
  const fetchAndRecordRunningServers = useCallback(
    async (cwd: string) => {
      const client = useSessionStore.getState().sessions[normalizedServerId]?.client ?? null;
      if (!client) {
        return null;
      }
      const config = await client.previewListConfig(cwd);
      usePreviewRunningServersStore.getState().replaceRunningForCwd(
        normalizedServerId,
        cwd,
        (config.runningServers ?? []).filter((s) => s.status !== "exited").map((s) => s.serverId),
      );
      return config;
    },
    [normalizedServerId],
  );

  const runPreviewFlow = useCallback(async () => {
    if (!focusedAgentId) {
      return;
    }
    // Hard gate, not a hint: with the Browser tools master off the agent has no
    // preview_*/browser_* tools, so a preview it can neither start nor look at
    // is not worth opening. Offer the switch instead. Deliberately never
    // suppressible — see utils/browser-tools-warning.ts.
    if (
      !(await confirmPreviewNeedsBrowserTools({
        config: daemonConfig,
        copy: browserToolsCopy,
        onOpenSettings: openBrowserToolsSettings,
      }))
    ) {
      return;
    }
    const session = useSessionStore.getState().sessions[normalizedServerId];
    const client = session?.client ?? null;
    const cwd = session?.agents.get(focusedAgentId)?.cwd ?? null;
    if (!client || !cwd) {
      return;
    }

    setIsBusy(true);
    try {
      const config = await fetchAndRecordRunningServers(cwd);
      if (!config || !config.configured || config.servers.length === 0) {
        await client.sendAgentMessage(focusedAgentId, PREVIEW_BOOTSTRAP_PROMPT);
        return;
      }

      // Store running servers from the response
      const map = new Map<string, PreviewRunningServer>();
      if (config.runningServers && config.runningServers.length > 0) {
        for (const s of config.runningServers) {
          map.set(s.name, s);
        }
      }
      runningServersRef.current = map;

      // Skip the picker only when there's a single configured server that isn't
      // already running — otherwise fall through so the user can see it's running
      // and gets the option to close it, same as the multi-server case.
      if (config.servers.length === 1 && !map.has(config.servers[0]!.name)) {
        await startAndOpenPreview(focusedAgentId, cwd, config.servers[0]!.name);
        return;
      }
      setPickerServers(config.servers);
      setPickerOpen(true);
    } finally {
      setIsBusy(false);
    }
  }, [
    browserToolsCopy,
    daemonConfig,
    fetchAndRecordRunningServers,
    focusedAgentId,
    normalizedServerId,
    openBrowserToolsSettings,
    startAndOpenPreview,
  ]);

  // Reactive, not a one-time getState() snapshot: if the agent record (and its
  // cwd) hasn't loaded into the session store yet when this button mounts —
  // e.g. right after opening a workspace or reconnecting — an imperative read
  // would freeze at null forever and the poll below would never start until
  // something else (like focusedAgentId changing) re-ran the effect.
  const focusedAgentCwd = useSessionStore((state) =>
    focusedAgentId
      ? (state.sessions[normalizedServerId]?.agents.get(focusedAgentId)?.cwd ?? null)
      : null,
  );

  // Background refresh: poll for this pane's running preview servers as soon
  // as a chat is focused, so the icon reflects real server state without the
  // user having to open the picker first.
  useEffect(() => {
    if (!enabled || !focusedAgentCwd) {
      return;
    }
    const cwd = focusedAgentCwd;

    const poll = () => {
      void fetchAndRecordRunningServers(cwd).catch(() => undefined);
    };
    poll();
    const intervalId = setInterval(poll, PREVIEW_SERVER_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [enabled, fetchAndRecordRunningServers, focusedAgentCwd]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setPickerOpen(false);
        return;
      }
      void runPreviewFlow();
    },
    [runPreviewFlow],
  );

  const handlePickServer = useCallback(
    (serverName: string) => {
      setPickerOpen(false);

      // Already running: if its tab is still open, just jump back to it. If the
      // tab was closed (keep-running left the server up), fall through to
      // startAndOpenPreview — previewStart reuses the running process, so this
      // just rebinds a fresh tab instead of restarting anything.
      const running = runningServersRef.current.get(serverName);
      if (running) {
        const workspaceKey = buildWorkspaceTabPersistenceKey({
          serverId: normalizedServerId,
          workspaceId: normalizedWorkspaceId,
        });
        const existingTabId = workspaceKey
          ? findOpenPreviewTab({ workspaceKey, serverId: running.serverId, port: running.port })
          : null;
        if (existingTabId && workspaceKey) {
          useWorkspaceLayoutStore.getState().focusTab(workspaceKey, existingTabId);
          return;
        }
      }

      if (!focusedAgentId) {
        return;
      }
      const cwd = useSessionStore
        .getState()
        .sessions[normalizedServerId]?.agents.get(focusedAgentId)?.cwd;
      if (cwd) {
        void startAndOpenPreview(focusedAgentId, cwd, serverName);
      }
    },
    [focusedAgentId, normalizedServerId, normalizedWorkspaceId, startAndOpenPreview],
  );

  const handleStopServer = useCallback(
    (serverName: string) => {
      setPickerOpen(false);
      const running = runningServersRef.current.get(serverName);
      if (running) {
        void stopServer(running.serverId, serverName, running.port);
      }
    },
    [stopServer],
  );

  const disabled = !focusedAgentId || isBusy;
  const isServerRunning = useCallback(
    (serverName: string) => runningServersRef.current.has(serverName),
    [],
  );

  return useMemo(
    () => ({
      isBusy,
      disabled,
      hasFocusedAgent: focusedAgentId !== null,
      pickerOpen,
      pickerServers,
      hasRunningPreviewServer,
      isServerRunning,
      runPreviewFlow,
      handleOpenChange,
      handlePickServer,
      handleStopServer,
    }),
    [
      disabled,
      focusedAgentId,
      handleOpenChange,
      handlePickServer,
      handleStopServer,
      hasRunningPreviewServer,
      isBusy,
      isServerRunning,
      pickerOpen,
      pickerServers,
      runPreviewFlow,
    ],
  );
}

function WorkspacePreviewMenuContent({ controller }: { controller: WorkspacePreviewController }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuContent side="bottom" align="end" offset={4} minWidth={200}>
      <DropdownMenuLabel>{t("workspace.tabs.actions.previewPickServer")}</DropdownMenuLabel>
      {controller.pickerServers.map((server) => (
        <PreviewServerMenuItem
          key={server.name}
          server={server}
          onSelect={controller.handlePickServer}
          onStop={controller.handleStopServer}
          isRunning={controller.isServerRunning(server.name)}
        />
      ))}
    </DropdownMenuContent>
  );
}

function WorkspacePreviewButton({ controller }: { controller: WorkspacePreviewController }) {
  const { t } = useTranslation();
  const { disabled, hasFocusedAgent, isBusy, hasRunningPreviewServer } = controller;
  const label = hasFocusedAgent
    ? t("workspace.tabs.actions.preview")
    : t("workspace.tabs.actions.previewDisabledTooltip");

  const previewButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.newTabActionButton,
      (hovered || pressed) && styles.newTabActionButtonHovered,
      disabled && styles.newTabActionButtonDisabled,
    ],
    [disabled],
  );

  return (
    <DropdownMenu open={controller.pickerOpen} onOpenChange={controller.handleOpenChange}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="triggerRef" disabled={false}>
          <DropdownMenuTrigger
            testID="workspace-preview-button"
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={previewButtonStyle}
          >
            {isBusy ? (
              <ThemedActivityIndicator size="small" uniProps={mutedColorMapping} />
            ) : (
              <ThemedPlayFilled
                size={14}
                uniProps={hasRunningPreviewServer ? accentColorMapping : mutedColorMapping}
              />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={styles.newTabTooltipText}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      <WorkspacePreviewMenuContent controller={controller} />
    </DropdownMenu>
  );
}

/**
 * Zero-size anchor for the collapsed preview tool: the more-actions menu item
 * runs the flow, and when a server picker is needed it opens from here (the
 * right edge of the tab bar), since the real button isn't rendered.
 */
function WorkspacePreviewCollapsedAnchor({
  controller,
}: {
  controller: WorkspacePreviewController;
}) {
  return (
    <DropdownMenu open={controller.pickerOpen} onOpenChange={controller.handleOpenChange}>
      <DropdownMenuTrigger
        testID="workspace-preview-collapsed-anchor"
        disabled
        accessibilityElementsHidden
        style={styles.hiddenMenuAnchor}
      >
        <View />
      </DropdownMenuTrigger>
      <WorkspacePreviewMenuContent controller={controller} />
    </DropdownMenu>
  );
}

function PreviewServerMenuItem({
  server,
  onSelect,
  onStop,
  isRunning,
}: {
  server: PreviewConfiguredServer;
  onSelect: (serverName: string) => void;
  onStop?: (serverName: string) => void;
  isRunning: boolean;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(server.name), [onSelect, server.name]);
  const handleStop = useCallback(() => onStop?.(server.name), [onStop, server.name]);
  const idleDot = useMemo(() => <View style={styles.previewServerIdleDot} />, []);

  // Not started yet: a normal menu item that starts the server on click. The
  // hollow ring in the leading slot marks it "not running" and keeps the label
  // aligned with the running rows (which fill the same slot with a green dot).
  if (!isRunning) {
    return (
      <DropdownMenuItem
        testID={`workspace-preview-pick-${server.name}`}
        onSelect={handleSelect}
        leading={idleDot}
      >
        {`${server.name} (:${server.port})`}
      </DropdownMenuItem>
    );
  }

  // Running: a status row matching the menu item's metrics — filled green dot,
  // label, and a stop button pushed to the right edge. The row itself is
  // pressable (jumps back to / reopens the bound tab — see handlePickServer's
  // "get back in" path); the stop button is a separately-hit-testable control
  // nested inside it, not a menu-item button-in-button.
  return (
    <Pressable
      testID={`workspace-preview-pick-${server.name}`}
      onPress={handleSelect}
      accessibilityRole="button"
      accessibilityLabel={`${server.name} (:${server.port})`}
      style={styles.previewServerRunningRow}
    >
      <View style={styles.previewServerDotSlot}>
        <View style={styles.previewServerRunningDot} />
      </View>
      <Text style={styles.previewServerRunningLabel} numberOfLines={1}>
        {`${server.name} (:${server.port})`}
      </Text>
      {onStop ? (
        <Pressable
          testID={`workspace-preview-stop-${server.name}`}
          onPress={handleStop}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.tabs.actions.previewStopServer", { name: server.name })}
          style={previewServerStopButtonStyle}
        >
          {({ hovered, pressed }) => (
            <ThemedX
              size={14}
              uniProps={hovered || pressed ? destructiveColorMapping : mutedColorMapping}
            />
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export interface WorkspaceTabRowExtrasProps {
  onCreateAgentTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfileInput) => void;
  onEditProfiles: () => void;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  paneId?: string;
  focusedAgentId: string | null;
  showCreateBrowserTab: boolean;
  showPreviewButton: boolean;
  terminalDisabled: boolean;
  tabsContainerWidth: number;
  tabCount: number;
  onSplitRight: () => void;
  onSplitDown: () => void;
  showPaneSplitActions: boolean;
  onStripLayout: (event: LayoutChangeEvent) => void;
  /**
   * When set, this exact width is what the pinned tool buttons must fit into,
   * bypassing the row's tabs-share-the-strip math — used by the vertical rail,
   * whose tools sit in a header above the tabs instead of beside them.
   */
  toolsAvailableWidth?: number | null;
  /**
   * True while the pointer is over the tab bar row — tab chips and the drag
   * gutter included. Tracked by the row (the reveal region is wider than this
   * strip), not by the strip itself: DOM pointerenter/leave for the no-drag
   * islands plus non-client mouse forwarding for the Electron drag gutter.
   */
  rowHovered: boolean;
}

interface WorkspaceTabToolsOverflow {
  showPreviewInline: boolean;
  showArtifactsInline: boolean;
  visibleLaunchers: ResolvedPin[];
  showSplitRightInline: boolean;
  showSplitDownInline: boolean;
  previewButtonAbsent: boolean;
  artifactsButtonAbsent: boolean;
}

/**
 * Decides which pinned tool buttons fit in the tab bar. Only pinned tools
 * have buttons at all — unpinned tools live solely in the more-actions
 * catalog. When the pane is too narrow for the tabs at full width, pinned
 * buttons disappear left-to-right (tabs win; the catalog row is always there,
 * so nothing is lost) and come back as soon as there's room.
 */
function useWorkspaceTabToolsOverflow(input: {
  showPreviewButton: boolean;
  supportsArtifacts: boolean;
  showPaneSplitActions: boolean;
  pinnedPreview: boolean;
  pinnedArtifact: boolean;
  pinnedSplitRight: boolean;
  pinnedSplitDown: boolean;
  launchers: ResolvedPin[];
  tabsContainerWidth: number;
  tabCount: number;
  availableWidthOverride?: number | null;
}): WorkspaceTabToolsOverflow {
  const {
    showPreviewButton,
    supportsArtifacts,
    showPaneSplitActions,
    pinnedPreview,
    pinnedArtifact,
    pinnedSplitRight,
    pinnedSplitDown,
    launchers,
    tabsContainerWidth,
    tabCount,
    availableWidthOverride = null,
  } = input;

  const pinnedButtons = useMemo(() => {
    const list: WorkspaceTabActionDescriptor[] = [];
    if (showPreviewButton && pinnedPreview) {
      list.push({ key: "preview", width: SMALL_TOOL_WIDTH });
    }
    if (supportsArtifacts && pinnedArtifact) {
      list.push({ key: "artifacts", width: SMALL_TOOL_WIDTH });
    }
    for (const launcher of launchers) {
      list.push({ key: `pin:${launcher.key}`, width: SMALL_TOOL_WIDTH });
    }
    if (showPaneSplitActions && pinnedSplitRight) {
      list.push({ key: "split-right", width: SMALL_TOOL_WIDTH });
    }
    if (showPaneSplitActions && pinnedSplitDown) {
      list.push({ key: "split-down", width: SMALL_TOOL_WIDTH });
    }
    return list;
  }, [
    launchers,
    pinnedArtifact,
    pinnedPreview,
    pinnedSplitDown,
    pinnedSplitRight,
    showPaneSplitActions,
    showPreviewButton,
    supportsArtifacts,
  ]);

  const visibleToolKeys = useMemo(() => {
    if (availableWidthOverride != null) {
      // Caller-supplied budget (the vertical rail's header) — already net of
      // that surface's fixed chrome, so fit the pinned buttons into it as-is.
      return computeVisibleTabActionKeys({
        actions: pinnedButtons,
        availableWidth: availableWidthOverride,
      });
    }
    if (tabsContainerWidth <= 0) {
      // Not measured yet — keep everything; the strip is invisible until
      // hovered anyway, so a one-frame correction can't flash.
      return new Set(pinnedButtons.map((tool) => tool.key));
    }
    const desiredTabsWidth = tabCount * TAB_MAX_WIDTH + TABS_CONTENT_PADDING_TOTAL;
    const availableWidth =
      tabsContainerWidth - desiredTabsWidth - TOOLS_STRIP_PADDING_TOTAL - SMALL_TOOL_WIDTH;
    return computeVisibleTabActionKeys({ actions: pinnedButtons, availableWidth });
  }, [availableWidthOverride, pinnedButtons, tabCount, tabsContainerWidth]);

  const visibleLaunchers = useMemo(
    () => launchers.filter((launcher) => visibleToolKeys.has(`pin:${launcher.key}`)),
    [launchers, visibleToolKeys],
  );

  const showPreviewInline = showPreviewButton && visibleToolKeys.has("preview");
  const showArtifactsInline = supportsArtifacts && visibleToolKeys.has("artifacts");

  return {
    showPreviewInline,
    showArtifactsInline,
    visibleLaunchers,
    showSplitRightInline: showPaneSplitActions && visibleToolKeys.has("split-right"),
    showSplitDownInline: showPaneSplitActions && visibleToolKeys.has("split-down"),
    // Tools whose button is absent (unpinned, or squeezed out by narrow
    // panes) still need a hidden anchor so the catalog row can open their
    // picker menus.
    previewButtonAbsent: showPreviewButton && !showPreviewInline,
    artifactsButtonAbsent: supportsArtifacts && !showArtifactsInline,
  };
}

/**
 * The pinnable tool rows of the more-actions catalog. Always rendered in full
 * (whether or not a tool currently shows a button) — the menu is the one
 * stable surface where every tool can be launched, pinned, or unpinned.
 */
function WorkspaceToolsCatalogMenuItems({
  onCreateAgentTab,
  showPreviewRow,
  previewDisabled,
  onPreview,
  showArtifactsRow,
  onArtifacts,
  showTerminalRow,
  terminalDisabled,
  onCreateTerminal,
  showBrowserRow,
  onCreateBrowser,
  showSplitRows,
  onSplitRight,
  onSplitDown,
}: {
  onCreateAgentTab: () => void;
  showPreviewRow: boolean;
  previewDisabled: boolean;
  onPreview: () => void;
  showArtifactsRow: boolean;
  onArtifacts: () => void;
  showTerminalRow: boolean;
  terminalDisabled: boolean;
  onCreateTerminal: () => void;
  showBrowserRow: boolean;
  onCreateBrowser: () => void;
  showSplitRows: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PinnableMenuItem
        testID="workspace-new-tab-menu-agent"
        target={DRAFT_TARGET}
        label={t("workspace.tabs.actions.newAgent")}
        leading={MENU_AGENT_ICON}
        onSelect={onCreateAgentTab}
      />
      {showTerminalRow ? (
        <PinnableMenuItem
          testID="workspace-new-tab-menu-terminal"
          target={TERMINAL_TARGET}
          label={t("workspace.tabs.actions.newTerminal")}
          leading={MENU_TERMINAL_ICON}
          disabled={terminalDisabled}
          onSelect={terminalDisabled ? undefined : onCreateTerminal}
        />
      ) : null}
      {showBrowserRow ? (
        <PinnableMenuItem
          testID="workspace-new-tab-menu-browser"
          target={BROWSER_TARGET}
          label={t("workspace.tabs.actions.newBrowser")}
          leading={MENU_BROWSER_ICON}
          onSelect={onCreateBrowser}
        />
      ) : null}
      {showPreviewRow ? (
        <PinnableMenuItem
          testID="workspace-new-tab-menu-preview"
          target={PREVIEW_TARGET}
          label={t("workspace.tabs.actions.preview")}
          leading={MENU_PREVIEW_ICON}
          disabled={previewDisabled}
          onSelect={previewDisabled ? undefined : onPreview}
        />
      ) : null}
      {showArtifactsRow ? (
        <PinnableMenuItem
          testID="workspace-new-tab-menu-artifacts"
          target={ARTIFACT_TARGET}
          label="Add artifact"
          leading={MENU_ARTIFACTS_ICON}
          onSelect={onArtifacts}
        />
      ) : null}
      {showSplitRows ? (
        <>
          <DropdownMenuSeparator />
          <PinnableMenuItem
            testID="workspace-new-tab-menu-split-right"
            target={SPLIT_RIGHT_TARGET}
            label={t("workspace.tabs.actions.splitRight")}
            leading={MENU_SPLIT_RIGHT_ICON}
            onSelect={onSplitRight}
          />
          <PinnableMenuItem
            testID="workspace-new-tab-menu-split-down"
            target={SPLIT_DOWN_TARGET}
            label={t("workspace.tabs.actions.splitDown")}
            leading={MENU_SPLIT_DOWN_ICON}
            onSelect={onSplitDown}
          />
        </>
      ) : null}
    </>
  );
}

// The catalog's terminal-profiles section (New-terminal profiles + Edit
// profiles). Developer-only — extracted so its gate lives at one mount site and
// the tab-row extras stay under the complexity cap. Renders nothing when hidden.
function TerminalProfilesCatalogSection({
  visible,
  profiles,
  terminalDisabled,
  onLaunch,
  onEditProfiles,
}: {
  visible: boolean;
  profiles: readonly PinnableProfileMenuItemProps["profile"][];
  terminalDisabled: boolean;
  onLaunch: (target: PinnedTabTarget) => void;
  onEditProfiles: () => void;
}) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
      {profiles.map((profile) => (
        <PinnableProfileMenuItem
          key={profile.id}
          profile={profile}
          disabled={terminalDisabled}
          onLaunch={onLaunch}
        />
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem testID="workspace-new-tab-menu-edit-profiles" onSelect={onEditProfiles}>
        {t("workspace.tabs.actions.editTerminalProfiles")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * The pinned buttons inside the trailing tools strip, in the fixed order:
 * new-agent/terminal/browser launchers, preview, artifacts, split right,
 * split down. Pulled out of `WorkspaceTabRowExtras` purely to keep that
 * function's complexity under the lint cap — no logic lives here beyond
 * ordering the same conditionals it used to inline.
 */
function WorkspaceToolsStrip({
  isDeveloperMode,
  visibleLaunchers,
  showPreviewInline,
  previewController,
  showArtifactsInline,
  normalizedServerId,
  normalizedWorkspaceId,
  artifactsOpen,
  onArtifactsOpenChange,
  showSplitRightInline,
  showSplitDownInline,
  onSplitRight,
  onSplitDown,
  splitRightKeys,
  splitDownKeys,
}: {
  isDeveloperMode: boolean;
  visibleLaunchers: ResolvedPin[];
  showPreviewInline: boolean;
  previewController: WorkspacePreviewController;
  showArtifactsInline: boolean;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  artifactsOpen: boolean;
  onArtifactsOpenChange: (open: boolean) => void;
  showSplitRightInline: boolean;
  showSplitDownInline: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
  splitRightKeys: ShortcutKey[][] | null;
  splitDownKeys: ShortcutKey[][] | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {isDeveloperMode ? (
        <PinnedTargetsRow launchers={visibleLaunchers} testIdPrefix="workspace-pinned-target" />
      ) : null}
      {showPreviewInline && isDeveloperMode ? (
        <WorkspacePreviewButton controller={previewController} />
      ) : null}
      {showArtifactsInline ? (
        <ArtifactOpenMenu
          serverId={normalizedServerId}
          workspaceId={normalizedWorkspaceId}
          open={artifactsOpen}
          onOpenChange={onArtifactsOpenChange}
        />
      ) : null}
      {isDeveloperMode && showSplitRightInline ? (
        <SplitActionButton
          icon="split-right"
          onPress={onSplitRight}
          label={t("workspace.tabs.actions.splitRight")}
          shortcutKeys={splitRightKeys}
        />
      ) : null}
      {isDeveloperMode && showSplitDownInline ? (
        <SplitActionButton
          icon="split-down"
          onPress={onSplitDown}
          label={t("workspace.tabs.actions.splitDown")}
          shortcutKeys={splitDownKeys}
        />
      ) : null}
    </>
  );
}

/**
 * The trailing tools strip of a pane's tab bar. Tool order is fixed —
 * pinned agent/terminal/browser launchers, preview, artifacts, split right,
 * split down — with the more-actions chevron always last. The ▾ menu is the
 * full tool catalog: every tool is always listed there with a pin toggle.
 * Three behaviors:
 *
 * - Pinning: only pinned tools/launchers have strip buttons; unpinned tools
 *   live solely in the catalog until pinned.
 * - Overflow: when the pane is too narrow for the tabs at full width, pinned
 *   buttons disappear left-to-right (see `computeVisibleTabActionKeys`) —
 *   tabs win, and the catalog row is always there.
 * - Hover reveal: every button except the chevron is invisible until the
 *   pointer is over the tab-bar gutter or a strip-owned menu is open. Hidden
 *   via opacity so the geometry never changes — see docs/hover.md.
 *
 * Exported for the vertical rail (workspace-desktop-tabs-rail.tsx), which
 * mounts the same strip in its header with a `toolsAvailableWidth` budget in
 * place of the row's tabs-share-the-strip overflow math.
 */
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
  tabsContainerWidth,
  tabCount,
  onSplitRight,
  onSplitDown,
  showPaneSplitActions,
  onStripLayout,
  toolsAvailableWidth = null,
  rowHovered,
}: WorkspaceTabRowExtrasProps) {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(normalizedServerId);
  const { settings } = useAppSettings();
  const isCompact = useIsCompactFormFactor();
  // User mode hides the developer catalog items (preview, terminals + profiles,
  // pane splits) and the pinned dev-tool strip. Keep New agent / Add artifact /
  // New browser. Presentation only — see interface-modes.md surface inventory.
  const isDeveloperMode = useIsDeveloperMode();
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const supportsArtifacts = useHostFeature(normalizedServerId, "artifacts");
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );

  const handlers = useMemo<TabTargetHandlers>(
    () => ({
      createDraft: onCreateAgentTab,
      createTerminal: onCreateTerminal,
      createBrowser: onCreateBrowser,
      createTerminalWithProfile: onCreateTerminalWithProfile,
    }),
    [onCreateAgentTab, onCreateBrowser, onCreateTerminal, onCreateTerminalWithProfile],
  );

  const onLaunch = useCallback(
    (target: PinnedTabTarget) => {
      runPinnedTabTarget(target, profiles, handlers);
    },
    [handlers, profiles],
  );

  const launchers = usePinnedLaunchers({ serverId: normalizedServerId, onLaunch });

  const previewController = useWorkspacePreviewController({
    normalizedServerId,
    normalizedWorkspaceId,
    paneId,
    focusedAgentId,
    enabled: showPreviewButton,
  });

  const [artifactsOpen, setArtifactsOpen] = useState(false);

  const pinnedPreview = usePinnedTargetsStore((state) =>
    isTargetPinned(state.pinned, PREVIEW_TARGET),
  );
  const pinnedArtifact = usePinnedTargetsStore((state) =>
    isTargetPinned(state.pinned, ARTIFACT_TARGET),
  );
  const pinnedSplitRight = usePinnedTargetsStore((state) =>
    isTargetPinned(state.pinned, SPLIT_RIGHT_TARGET),
  );
  const pinnedSplitDown = usePinnedTargetsStore((state) =>
    isTargetPinned(state.pinned, SPLIT_DOWN_TARGET),
  );

  const {
    showPreviewInline,
    showArtifactsInline,
    visibleLaunchers,
    showSplitRightInline,
    showSplitDownInline,
    previewButtonAbsent,
    artifactsButtonAbsent,
  } = useWorkspaceTabToolsOverflow({
    showPreviewButton,
    supportsArtifacts,
    showPaneSplitActions,
    pinnedPreview,
    pinnedArtifact,
    pinnedSplitRight,
    pinnedSplitDown,
    launchers,
    tabsContainerWidth,
    tabCount,
    availableWidthOverride: toolsAvailableWidth,
  });

  // Keep the tools revealed while one of their menus is open — the pointer is
  // inside the portaled menu then, which reads as "left the strip" to the
  // hover tracker. With hide-until-hover off (the default), the pinned tools
  // are always revealed.
  const toolsRevealed =
    !settings.hidePinnedToolbarOptions ||
    rowHovered ||
    isNative ||
    isCompact ||
    previewController.pickerOpen ||
    artifactsOpen;

  const handlePreviewFromMenu = useCallback(() => {
    void previewController.runPreviewFlow();
  }, [previewController]);
  const handleArtifactsFromMenu = useCallback(() => setArtifactsOpen(true), []);

  return (
    <View style={TABS_ACTIONS_STYLE} onLayout={onStripLayout}>
      <View style={toolsRevealed ? styles.tabsTools : TABS_TOOLS_HIDDEN_STYLE}>
        <WorkspaceToolsStrip
          isDeveloperMode={isDeveloperMode}
          visibleLaunchers={visibleLaunchers}
          showPreviewInline={showPreviewInline}
          previewController={previewController}
          showArtifactsInline={showArtifactsInline}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          artifactsOpen={artifactsOpen}
          onArtifactsOpenChange={setArtifactsOpen}
          showSplitRightInline={showSplitRightInline}
          showSplitDownInline={showSplitDownInline}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          splitRightKeys={splitRightKeys}
          splitDownKeys={splitDownKeys}
        />
      </View>
      {previewButtonAbsent && isDeveloperMode ? (
        <WorkspacePreviewCollapsedAnchor controller={previewController} />
      ) : null}
      {artifactsButtonAbsent ? (
        <ArtifactOpenMenu
          serverId={normalizedServerId}
          workspaceId={normalizedWorkspaceId}
          open={artifactsOpen}
          onOpenChange={setArtifactsOpen}
          hideTrigger
        />
      ) : null}
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
          <WorkspaceToolsCatalogMenuItems
            onCreateAgentTab={onCreateAgentTab}
            showPreviewRow={showPreviewButton && isDeveloperMode}
            previewDisabled={previewController.disabled}
            onPreview={handlePreviewFromMenu}
            showArtifactsRow={supportsArtifacts}
            onArtifacts={handleArtifactsFromMenu}
            showTerminalRow={isDeveloperMode}
            terminalDisabled={terminalDisabled}
            onCreateTerminal={onCreateTerminal}
            showBrowserRow={showCreateBrowserTab}
            onCreateBrowser={onCreateBrowser}
            showSplitRows={showPaneSplitActions && isDeveloperMode}
            onSplitRight={onSplitRight}
            onSplitDown={onSplitDown}
          />
          <TerminalProfilesCatalogSection
            visible={isDeveloperMode}
            profiles={profiles}
            terminalDisabled={terminalDisabled}
            onLaunch={onLaunch}
            onEditProfiles={onEditProfiles}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
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
 * Facts about a pane's tabs that gate the tools strip — shared by the row and
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

interface SplitActionButtonProps {
  onPress: () => void;
  label: string;
  shortcutKeys: ShortcutKey[][] | null;
  icon: "split-right" | "split-down";
}

function SplitActionButton({ onPress, label, shortcutKeys, icon }: SplitActionButtonProps) {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={newTabActionButtonStyle}
      >
        {icon === "split-right" ? (
          <ThemedColumns2 size={14} uniProps={mutedColorMapping} />
        ) : (
          <ThemedRows2 size={14} uniProps={mutedColorMapping} />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <View style={styles.newTabTooltipRow}>
          <Text style={styles.newTabTooltipText}>{label}</Text>
          {shortcutKeys ? (
            <Shortcut chord={shortcutKeys} style={styles.newTabTooltipShortcut} />
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

export interface TabOrientationToggleButtonProps {
  orientation: "horizontal" | "vertical";
  onToggle: () => void;
}

// Shared by the row and the vertical rail (workspace-desktop-tabs-rail.tsx) so
// both surfaces expose the identical flip control. Uses the dedicated Tabs
// glyph (not Columns2/Rows2 — those are already the split-right/split-down
// icons, and reusing them here made the two unrelated actions look identical).
// Vertical rotates the same glyph 90° rather than switching to a different icon,
// so the control still reads as "tabs" in either orientation.
// Rotate the glyph 90° in vertical mode. In both orientations, nudge the
// whole button 1px left/1px down so it optically centers against its
// neighbor. Cross-mode alignment (same top-left spot in both orientations)
// is handled at the container level — see the row's
// ORIENTATION_TOGGLE_SLOT_STYLE paddingLeft vs the rail's styles.header
// paddingLeft in workspace-desktop-tabs-rail.tsx, which are kept equal on
// purpose. Don't try to re-align via button-level padding or margin here —
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
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  tabDropPreviewIndex?: number | null;
  showPaneSplitActions?: boolean;
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
    // PRESS, before auxclick fires — without cancelling it here, closing a tab
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
        <WorkspaceTabIcon presentation={presentation} active={isHighlighted} accent={isActiveTab} />
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

function TabChip({
  tab,
  isActive,
  isDragging,
  isFocused,
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
    useCallback(() => void onCloseTab(tab.tabId), [onCloseTab, tab.tabId]),
  );
  const [hovered, setHovered] = useState(false);
  const isHighlighted = isActive || hovered || isCloseHovered;
  const { settings } = useAppSettings();
  // Black tab background: the active chat tab's fill goes pure black so it
  // fuses with the black chat pane below; label + close button switch to
  // fixed on-black colors so they stay readable in any theme.
  const isChatTab = tab.target.kind === "agent" || tab.target.kind === "draft";
  const onBlack = settings.blackTabBackground && isChatTab && isActive;
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
      onBlack && (vertical ? styles.tabActiveBlackVertical : styles.tabActiveBlack),
      isWeb && isDragging && ({ cursor: "grabbing" } as object),
      // "stretch" lets the chip take its width from the container instead of a
      // number. The vertical rail uses it so a resize drag only has to change
      // the rail's own width — no per-frame re-render of every chip.
      resolvedTabWidth === "stretch"
        ? { alignSelf: "stretch" as const }
        : {
            minWidth: resolvedTabWidth,
            width: resolvedTabWidth,
            maxWidth: resolvedTabWidth,
          },
    ],
    [isActive, isDragging, onBlack, resolvedTabWidth, vertical],
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
  const tabLabelSkeletonStyle = useMemo(
    () => [styles.tabLabelSkeleton, showCloseButton && styles.tabLabelSkeletonWithCloseButton],
    [showCloseButton],
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
      showCloseButton && styles.tabLabelWithCloseButton,
    ],
    [isHighlighted, isSelectedTab, onBlack, showCloseButton],
  );

  return (
    <View ref={middleClickRef}>
      <ContextMenu key={tab.key}>
        <Tooltip delayDuration={400} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              testID={`workspace-tab-${buildDeterministicWorkspaceTabId(tab.target)}`}
              triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
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

              {showCloseButton ? (
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
                    if (onBlack) {
                      const onBlackColor = isCloseEmphasized ? ON_BLACK_FOREGROUND : ON_BLACK_MUTED;
                      return isClosingTab ? (
                        <ActivityIndicator size={12} color={onBlackColor} />
                      ) : (
                        <X size={12} color={onBlackColor} />
                      );
                    }
                    return isClosingTab ? (
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
                  }}
                </Pressable>
              ) : null}
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            {tab.target.kind === "agent" ? (
              <View style={styles.tooltipAgentRow}>
                <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
                <Text style={styles.tooltipAgentId}>{tab.target.agentId.slice(0, 7)}</Text>
              </View>
            ) : (
              <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
            )}
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
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  showPaneSplitActions = true,
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
  // whose pixels never deliver DOM pointer events — only the no-drag islands
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

  const layoutMetrics = useMemo(
    () => ({
      rowHorizontalInset: 0,
      actionsReservedWidth: Math.max(0, tabsActionsWidth + ORIENTATION_TOGGLE_RESERVED_WIDTH),
      // Mirrors tabsContent's paddingHorizontal so width math stays exact.
      rowPaddingHorizontal: 4,
      tabGap: 0,
      maxTabWidth: TAB_MAX_WIDTH,
      tabIconWidth: TAB_ICON_WIDTH,
      tabHorizontalPadding: TAB_HORIZONTAL_PADDING,
      estimatedCharWidth: TAB_ESTIMATED_CHAR_WIDTH,
      closeButtonWidth: TAB_CLOSE_BUTTON_WIDTH,
    }),
    [tabsActionsWidth],
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
  const tabLabelLengths = useMemo(
    () =>
      tabs.map((tab) => {
        const label = getFallbackTabLabel(tab.tab, fallbackTabLabels);
        return label.length;
      }),
    [fallbackTabLabels, tabs],
  );
  const { focusedAgentId, paneHasEditableAgentTab, paneHasPreviewTab } = usePaneTabAgentFacts({
    tabs,
    focusedTab,
    normalizedServerId,
  });

  const { layout } = useWorkspaceTabLayout({
    tabLabelLengths,
    viewportWidthOverride: contentWidth > 0 ? contentWidth : null,
    metrics: layoutMetrics,
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
    (profile: TerminalProfileInput) => {
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
      const showDropIndicatorBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showDropIndicatorAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === tabs.length &&
        index === tabs.length - 1;

      return (
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
      isFocused,
      layout.closeButtonPolicy,
      layout.items,
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
      setHoveredCloseTabKey,
      tabMenuLabels,
      tabDropPreviewIndex,
      tabs.length,
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
          data={tabs}
          keyExtractor={tabKeyExtractor}
          useDragHandle
          disabled={!externalDndContext && tabs.length < 2}
          onDragEnd={handleDragEnd}
          externalDndContext={externalDndContext}
          activeId={activeDragTabId}
          getItemData={getTabDragData}
          renderItem={renderTab}
        />
      </ScrollView>
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
        tabsContainerWidth={contentWidth}
        tabCount={tabs.length}
        onSplitRight={onSplitRight}
        onSplitDown={onSplitDown}
        showPaneSplitActions={showPaneSplitActions}
        onStripLayout={handleTabsActionsLayout}
        rowHovered={rowHovered || gutterHovered}
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
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
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
  /** Rotates the chip chrome 90° CCW for the vertical rail — see tabVertical. */
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
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
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
  const resolvedTab = useMemo(
    () =>
      buildWorkspaceDesktopTabActions({
        tab: item.tab,
        index,
        tabCount,
        isDeveloperMode,
        onCopyResumeCommand,
        onCopyAgentId,
        onCopyFilePath,
        onReloadAgent,
        onRenameTab,
        onCloseTab,
        onCloseTabsToLeft,
        onCloseTabsToRight,
        onCloseOtherTabs,
        labels,
      }),
    [
      index,
      item.tab,
      isDeveloperMode,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      labels,
      onReloadAgent,
      onRenameTab,
      tabCount,
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
  // Slot for the orientation toggle at the row's left edge — mirrored by the
  // rail header's left group so the control doesn't move when the user
  // toggles between modes. Width must stay in sync with
  // ORIENTATION_TOGGLE_RESERVED_WIDTH.
  orientationToggleSlot: {
    alignSelf: "center",
    paddingLeft: theme.spacing[2],
  },
  // Hover-revealed tools group. Hidden via opacity (never conditional
  // rendering or width changes) so the strip's geometry — and therefore the
  // tab layout math — is identical whether or not the pointer is over it.
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
  // Zero-size anchor for collapsed tools whose picker menus still need a
  // position to open from (preview server picker); must never take layout
  // space or catch pointers.
  hiddenMenuAnchor: {
    width: 0,
    height: 0,
    opacity: 0,
    overflow: "hidden",
  },
  // Chip is 1px shorter than the row minus its top inset so its bottom edge
  // lands exactly on the container edge, covering the hairline when active.
  tab: {
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
    backgroundColor: theme.colors.surface1,
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
    backgroundColor: theme.colors.surface1,
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
  // Vertical counterpart of tabActiveBlack — same black fill, outline fade
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
    fontSize: theme.fontSize.sm,
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
    color: theme.colors.accentBright,
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
  newTabActionButtonDisabled: {
    opacity: 0.5,
  },
  newTabActionButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
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
  tooltipAgentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipAgentId: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  terminalProfileIconWrapper: {
    width: 14,
    height: 14,
  },
  // Running-server row — mirrors DropdownMenuItem's `item` metrics so it lines up
  // with the idle menu items above/below it.
  previewServerRunningRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  // 16px slot matching the item's leadingSlot so the dot (and thus the label)
  // aligns with the idle rows' leading ring.
  previewServerDotSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  previewServerRunningLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  previewServerRunningDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: theme.colors.success,
  },
  previewServerIdleDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: "transparent",
  },
  previewServerStopButton: {
    marginLeft: "auto",
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  previewServerStopButtonActive: {
    backgroundColor: theme.colors.surface2,
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
// area — padding and hidden buttons included — delivers hover events, not just
// the no-drag holes the index.html backstop punches for the buttons themselves.
const TABS_ACTIONS_NO_DRAG_STYLE = isWeb ? ({ WebkitAppRegion: "no-drag" } as object) : null;
const TABS_ACTIONS_STYLE = [styles.tabsActions, TABS_ACTIONS_NO_DRAG_STYLE];
// The toggle slot sits in the row's Electron drag gutter, so it needs the
// same no-drag opt-out as the tools strip to receive clicks.
const ORIENTATION_TOGGLE_SLOT_STYLE = [styles.orientationToggleSlot, TABS_ACTIONS_NO_DRAG_STYLE];
