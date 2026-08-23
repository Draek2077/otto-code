// The workspace preview controller: the dev-server lifecycle hook, the
// preview tools-strip button with its collapsed anchor, the server menu
// item, and the bootstrap prompt. Extracted from
// workspace-desktop-tabs-row.tsx, which keeps one registration point per
// control. The row-item type rides a type-only import back (erased at
// runtime, no cycle).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { PlayFilled, X } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  confirmPreviewNeedsBrowserTools,
  useBrowserToolsWarningCopy,
  useOpenBrowserToolsSettings,
} from "@/utils/browser-tools-warning";
import { type PinnedTabTarget } from "@/workspace-pins/target";
import type { PreviewConfiguredServer, PreviewRunningServer } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { createWorkspaceBrowser, useBrowserStore } from "@/stores/browser-store";
import {
  usePreviewRunningServersStore,
  useHasRunningPreviewServer,
} from "@/stores/preview-running-servers-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

// Duplicated from workspace-desktop-tabs-row.tsx (keep in sync): one line
// each, and this module must not value-import the row.
const ThemedX = withUnistyles(X);
const ThemedActivityIndicator = withUnistyles(LoadingSpinner);
const ThemedPlayFilled = withUnistyles(PlayFilled);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Background refresh so the Preview icon reflects real server state without
// requiring the user to open the picker first.
const PREVIEW_SERVER_POLL_INTERVAL_MS = 10_000;

const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

export const PREVIEW_TARGET: PinnedTabTarget = { kind: "preview" };

const PREVIEW_BOOTSTRAP_PROMPT =
  "Detect this project's dev servers and save their configurations to `.claude/launch.json` " +
  "(create it if missing) using the format from the `preview_start` tool description. Then ask me " +
  "which ones to start, and call `preview_start` for each one I pick.";

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

interface WorkspacePreviewControllerInput {
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  paneId?: string;
  focusedAgentId: string | null;
  /** False when this pane offers no preview tool at all - skips the poll. */
  enabled: boolean;
}

export interface WorkspacePreviewController {
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
 * preview tab in a split pane to the right - the UI-driven counterpart to the
 * agent-facing preview_start tool. Disabled unless the pane's active tab is a
 * chat, since the server to preview is resolved from that agent's cwd.
 *
 * The logic lives in this hook rather than the button because the tools
 * overflow may collapse the button into the more-actions menu - the menu item
 * then drives the same flow, with the picker opening from a hidden anchor.
 */
export function useWorkspacePreviewController({
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

  // Opens a preview tab in a split pane beside this button's own pane and
  // returns its browserId. Shared by the start path (which opens the tab before
  // the spawn resolves, so the UI never blocks on a cold dev server) and the
  // attach path below.
  const openPreviewTab = useCallback(
    (cwd: string, serverName: string, initial?: { url: string; serverId: string }) => {
      const { browserId } = createWorkspaceBrowser({
        isPreview: true,
        previewServerName: serverName,
        previewCwd: cwd,
        ...(initial
          ? {
              initialUrl: initial.url,
              previewServerId: initial.serverId,
              previewStatus: "ready" as const,
            }
          : {}),
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
      return browserId;
    },
    [normalizedServerId, normalizedWorkspaceId, paneId],
  );

  /**
   * Attach a fresh tab to a server the picker already knows is running, using
   * the url the list_config poll reported. Deliberately does not go through
   * previewStart: for a server this daemon didn't spawn, that used to port-probe
   * and fail with "port already in use" - an error about a server the user was
   * looking at in the picker. The daemon adopts such servers now, but there is
   * still no reason to round-trip a spawn attempt when we hold the url.
   */
  const attachToRunningPreview = useCallback(
    async (cwd: string, running: PreviewRunningServer) => {
      const browserId = openPreviewTab(cwd, running.name, {
        url: running.url,
        serverId: running.serverId,
      });
      const client = useSessionStore.getState().sessions[normalizedServerId]?.client ?? null;
      await client?.previewBindTab(running.serverId, browserId).catch(() => undefined);
    },
    [normalizedServerId, openPreviewTab],
  );

  const startAndOpenPreview = useCallback(
    async (agentId: string, cwd: string, serverName: string) => {
      const client = useSessionStore.getState().sessions[normalizedServerId]?.client ?? null;
      if (!client) {
        return;
      }

      // BrowserPane shows a centered spinner while previewStatus is "starting"
      // and only navigates once ready.
      const browserId = openPreviewTab(cwd, serverName);

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
    [normalizedServerId, openPreviewTab],
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
        // Match on the exact server id, or - for a server reconciled after a
        // daemon restart, whose tab still holds the pre-restart id - on the
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
    // suppressible - see utils/browser-tools-warning.ts.
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
      // already running - otherwise fall through so the user can see it's running
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
  // cwd) hasn't loaded into the session store yet when this button mounts -
  // e.g. right after opening a workspace or reconnecting - an imperative read
  // would freeze at null forever and the poll below would never start until
  // something else (like focusedAgentId changing) re-ran the effect.
  const focusedAgentCwd = useSessionStore((state) =>
    focusedAgentId
      ? (state.sessions[normalizedServerId]?.agents.get(focusedAgentId)?.cwd ?? null)
      : null,
  );

  // A workspace the deck retains hidden, and the whole app while its window is
  // backgrounded, both keep this row mounted, so without these two gates every
  // workspace visited this session goes on hitting `preview.list_config`
  // forever. `isPanelActive` is the deck's route-focus signal (RetainedPanel
  // feeds it the same `isRouteFocused` WorkspaceScreen gets), `isAppVisible` the
  // window's. Same pairing as file-pane's re-read gate.
  const isPanelActive = useRetainedPanelActive();
  const isAppVisible = useAppVisible();

  // Background refresh: poll for this pane's running preview servers as soon
  // as a chat is focused, so the icon reflects real server state without the
  // user having to open the picker first. Regaining focus or visibility re-runs
  // the effect, whose first poll is immediate, so the icon is fresh on return.
  useEffect(() => {
    if (!enabled || !focusedAgentCwd || !isPanelActive || !isAppVisible) {
      return;
    }
    const cwd = focusedAgentCwd;

    const poll = () => {
      void fetchAndRecordRunningServers(cwd).catch(() => undefined);
    };
    poll();
    const intervalId = setInterval(poll, PREVIEW_SERVER_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [enabled, fetchAndRecordRunningServers, focusedAgentCwd, isAppVisible, isPanelActive]);

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

      const running = runningServersRef.current.get(serverName);
      if (running) {
        // Already running and its tab is still open: jump back to it.
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
      if (!cwd) {
        return;
      }
      // Running, but no tab here to return to - the tab was closed, or it
      // belongs to another chat or workspace. Point a new tab at the url the
      // poll already reported rather than asking the daemon to start what is
      // demonstrably up.
      if (running) {
        void attachToRunningPreview(cwd, running);
        return;
      }
      void startAndOpenPreview(focusedAgentId, cwd, serverName);
    },
    [
      attachToRunningPreview,
      focusedAgentId,
      normalizedServerId,
      normalizedWorkspaceId,
      startAndOpenPreview,
    ],
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

export function WorkspacePreviewButton({ controller }: { controller: WorkspacePreviewController }) {
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
                size="sm"
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
export function WorkspacePreviewCollapsedAnchor({
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

  // Running: a status row matching the menu item's metrics - filled green dot,
  // label, and a stop button pushed to the right edge. The row itself is
  // pressable (jumps back to / reopens the bound tab - see handlePickServer's
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
              size="sm"
              uniProps={hovered || pressed ? destructiveColorMapping : mutedColorMapping}
            />
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Zero-size anchor for collapsed tools whose picker menus still need a
  // position to open from (preview server picker); must never take layout
  // space or catch pointers.
  hiddenMenuAnchor: {
    width: 0,
    height: 0,
    opacity: 0,
    overflow: "hidden",
  },
  // Duplicated from workspace-screen.tsx styles (keep in sync).
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
  // Duplicated from workspace-screen.tsx styles (keep in sync).
  newTabActionButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  // Duplicated from workspace-screen.tsx styles (keep in sync).
  newTabTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  // Running-server row - mirrors DropdownMenuItem's `item` metrics so it lines up
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
