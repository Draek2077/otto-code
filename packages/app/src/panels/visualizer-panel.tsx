import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Text, useColorScheme, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useIsSoftwareRendering } from "@/desktop/use-software-rendering";
import { collectRunAgentIds, useRuns } from "@/hooks/use-runs";
import { useAppSettings, useSettings } from "@/hooks/use-settings";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { VisualizerToolbar } from "@/panels/visualizer-toolbar";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceTabsStore,
  type WorkspaceTab,
} from "@/stores/workspace-tabs-store";
import {
  sessionIdForDraft,
  sessionIdForRootAgent,
  useVisualizerEventAdapter,
  type DraftSessionInput,
} from "@/visualizer/use-visualizer-event-adapter";
import { useVisualizerVoiceCues } from "@/visualizer/use-visualizer-voice-cues";
import { resolveVisualizerAppearance } from "@/visualizer/visualizer-appearance";
import { resolveVisualizerTheme } from "@/visualizer/visualizer-theme";
import { VisualizerView } from "@/visualizer/visualizer-view";
import type {
  VisualizerHostMessage,
  VisualizerViewHandle,
} from "@/visualizer/visualizer-view-types";
import { normalizeWorkspaceFileLocation } from "@/workspace/file-open";

// The demo scenario (the vendored bundle's built-in mock run — see
// docs/visualizer.md "Risks / gotchas") is retained in the bundle and reachable
// through the config protocol; it just no longer has a floating on-canvas
// button. To re-surface it later, post `config: { mode: "replay", autoPlay:
// true, showMockData: true }` to load it and `config: { mode: "live", autoPlay:
// false, showMockData: false }` to exit, and gate the event adapter's `active`
// off while it runs (the live stream + its reset would otherwise clobber the
// mock scenario). A `{ type: "reset" }` on each transition clears stale state.

// The shell caps the devicePixelRatio the page sees (emit-bundle.mjs
// placeholder) — the canvas backing store and bloom buffers scale with it.
// Measured on a maximized 2x pane: 1 → 52 FPS, 1.5 → 25 FPS, native 2 → 14
// FPS. "native" passes a high cap so min(native, cap) resolves to the
// display's own ratio.
const RENDER_SCALE_BY_QUALITY: Record<string, number> = {
  performance: 1,
  balanced: 1.25,
  sharp: 1.5,
  native: 4,
};

// The guest posts `ready` before its first paint, but the settings config
// (panels/render/hudHidden) only lands a frame or two AFTER the HUD has
// already painted its defaults — visible as a flash of the default HUD on
// open. An opaque cover (painted the stage background) hides the guest until
// the config has settled, then fades out. The delay gives the page time to
// receive + apply the config effect's message post-ready.
const LOAD_COVER_SETTLE_MS = 150;
const LOAD_COVER_FADE_MS = 200;

// A guest that never loads emits nothing — no `ready`, no error — leaving the
// opaque load cover up forever (the silent-blank-tab failure seen on machines
// running the Linux GPU software-rendering fallback). If the handshake hasn't
// arrived after this long of the pane being visible, surface a failure state
// instead. The bundle is local (no network), so a healthy load is far faster.
const READY_HANDSHAKE_TIMEOUT_MS = 15_000;

// Stable empty array so the workspace-tabs selectors don't return a fresh []
// each render (which would loop the store subscription).
const EMPTY_WORKSPACE_TABS: readonly WorkspaceTab[] = [];

/** The visualizer session id a workspace chat tab maps to: a root-agent session
 * for a started chat, or an empty draft session (see `sessionIdForDraft`) for a
 * chat that hasn't started an agent yet. Non-chat tabs (terminal / file /
 * visualizer / browser / …) have no session — returns null. */
function chatSessionIdForTab(tab: WorkspaceTab | undefined): string | null {
  if (tab?.target.kind === "agent") {
    return sessionIdForRootAgent(tab.target.agentId);
  }
  if (tab?.target.kind === "draft") {
    return sessionIdForDraft(tab.target.draftId);
  }
  return null;
}

// Exported so the thin registration module (visualizer-panel-registration.tsx)
// can pull it via React.lazy — the boundary that keeps this whole module (and
// the vendored render bundle it transitively loads) out of the startup graph.
export function VisualizerPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "visualizer", "VisualizerPanel requires visualizer target");
  // The Visualizer is a companion view — the user watches it in a split while
  // working in the chat pane, so it must keep tracking agents whenever it's on
  // screen, NOT only when it holds focus. Gate on visibility, not focus:
  // `isInteractive` (isPaneFocused) went false the instant you clicked into the
  // chat, disposing the adapter and freezing the graph / session tabs until you
  // clicked back or reopened the tab.
  const { isVisible } = usePaneFocus();
  const { settings } = useSettings();
  // The in-page mute toggle persists through this store (visualizer settings
  // are device-local AppSettings, written directly — they don't round-trip the
  // merged useSettings updater, which only routes a subset of fields).
  const { updateSettings: updateAppSettings } = useAppSettings();
  const viewRef = useRef<VisualizerViewHandle>(null);
  const connectedRef = useRef(false);
  const [ready, setReady] = useState(false);
  // Set when the guest reported a load failure (`load-failed`, Electron) or
  // the ready handshake timed out. `reason` is only ever shown as a small
  // diagnostic line; null reason = timeout.
  const [loadFailure, setLoadFailure] = useState<{ reason: string | null } | null>(null);
  // Mirror of the page's live session list + selection (page->host
  // `session-state`), driving the toolbar's chats dropdown. The page owns the
  // session state machine; the toolbar just renders + remote-controls it.
  const [sessionState, setSessionState] = useState<{
    sessions: { id: string; label: string; status: "active" | "completed" }[];
    selectedId: string | null;
    activityIds: string[];
  }>({ sessions: [], selectedId: null, activityIds: [] });

  // Follow-the-active-chat mode. On by default: the Visualizer auto-switches
  // its displayed chat to whatever chat tab is focused in the workspace, so it
  // tracks what you're actually looking at. Pinning (the toolbar Pin toggle, or
  // manually picking a chat from the dropdown) freezes it on one chat until you
  // unpin. The focused chat tab maps to a page session id via
  // `chatSessionIdForTab` — an agent tab → `sessionIdForRootAgent`, a draft tab
  // → `sessionIdForDraft` — the named seam for that keying contract.
  const [followActive, setFollowActive] = useState(true);

  // The workspace's tab set + focused tab drive both the chats dropdown (every
  // draft tab becomes an empty session) and follow-the-active-chat. Reading the
  // tabs store directly — not the session store's focusedAgentId — is what lets
  // a DRAFT tab drive selection: a draft has no agent, so focusedAgentId is null
  // and the old logic froze on the previous chat (the /clear-doesn't-reset bug).
  const tabPersistenceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
    [serverId, workspaceId],
  );
  const workspaceTabs = useWorkspaceTabsStore((state) =>
    tabPersistenceKey
      ? (state.uiTabsByWorkspace[tabPersistenceKey] ?? EMPTY_WORKSPACE_TABS)
      : EMPTY_WORKSPACE_TABS,
  );
  const focusedTabId = useWorkspaceTabsStore((state) =>
    tabPersistenceKey ? (state.focusedTabIdByWorkspace[tabPersistenceKey] ?? null) : null,
  );

  // Each draft chat tab (a chat with no agent yet) surfaced as an empty session
  // for the adapter — it shows in the dropdown and reads "Waiting for chat
  // activity" when selected. Started chats already come through as agent
  // sessions, so together the dropdown mirrors every chat tab.
  const draftSessions = useMemo<DraftSessionInput[]>(() => {
    const drafts: DraftSessionInput[] = [];
    for (const tab of workspaceTabs) {
      if (tab.target.kind === "draft") {
        drafts.push({ draftId: tab.target.draftId, label: "New chat" });
      }
    }
    return drafts;
  }, [workspaceTabs]);

  // The session the focused tab maps to, when it's a chat (agent or draft).
  const focusedChatSessionId = useMemo(
    () => chatSessionIdForTab(workspaceTabs.find((tab) => tab.tabId === focusedTabId)),
    [workspaceTabs, focusedTabId],
  );
  // The last chat tab that actually held focus. Focusing a NON-chat tab (the
  // Visualizer's own pane, a terminal, a file) yields no chat session; we keep
  // following the last real chat rather than blanking the selection. Seeded
  // lazily from the current focused chat so a companion Visualizer targets the
  // chat it was opened beside even if its own pane grabs focus first.
  const [followTargetSessionId, setFollowTargetSessionId] = useState<string | null>(() => {
    const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    if (!key) {
      return null;
    }
    const state = useWorkspaceTabsStore.getState();
    const tabs = state.uiTabsByWorkspace[key] ?? EMPTY_WORKSPACE_TABS;
    const focused = state.focusedTabIdByWorkspace[key] ?? null;
    return chatSessionIdForTab(tabs.find((tab) => tab.tabId === focused));
  });
  useEffect(() => {
    if (focusedChatSessionId) {
      setFollowTargetSessionId(focusedChatSessionId);
    }
  }, [focusedChatSessionId]);

  // Theme colors (docs/visualizer.md "Theme colors"): the guest palette is
  // derived from the active variant, resolved exactly like applyColorScheme —
  // settings picks plus the OS scheme for System mode. Baked into the guest
  // html per load (the vendor page consumes it at module init), so a theme
  // change remounts the guest, same as a quality change.
  const systemColorScheme = useColorScheme();
  const visualizerTheme = useMemo(
    () =>
      resolveVisualizerTheme({
        colorSchemeMode: settings.colorSchemeMode,
        lightTheme: settings.lightTheme,
        darkTheme: settings.darkTheme,
        systemColorScheme,
      }),
    [settings.colorSchemeMode, settings.lightTheme, settings.darkTheme, systemColorScheme],
  );

  // A quality or theme change reloads the guest (new dpr cap / palette baked
  // into the html), so the handshake state must reset — the fresh page
  // re-sends `ready`, which re-runs connection-status + config and
  // re-activates the adapter. The load cover snaps back opaque too: the fresh
  // page would flash its default HUD again before the re-sent config lands.
  const renderScale = RENDER_SCALE_BY_QUALITY[settings.visualizerRenderQuality] ?? 1;
  const loadCoverOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    connectedRef.current = false;
    setReady(false);
    setLoadFailure(null);
    loadCoverOpacity.stopAnimation();
    loadCoverOpacity.setValue(1);
  }, [renderScale, visualizerTheme.json, loadCoverOpacity]);

  // Ready-handshake watchdog. Counts only while the pane is visible — a tab
  // mounted in a hidden pane/workspace legitimately hasn't loaded yet (hidden
  // webviews may not attach at all), and the timer restarts from zero on every
  // visibility flip. A late `ready` clears the failure state (see
  // handleMessage), so a slow machine self-heals.
  useEffect(() => {
    if (ready || loadFailure !== null || !isVisible) {
      return;
    }
    const timer = setTimeout(() => {
      setLoadFailure({ reason: null });
    }, READY_HANDSHAKE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready, loadFailure, isVisible]);

  // Reveal the guest once the settings config has settled (see
  // LOAD_COVER_SETTLE_MS). `ready` only flips on a fresh handshake, so a tab
  // waking from resource sleep (state intact, no reload) never re-covers.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const timer = setTimeout(() => {
      Animated.timing(loadCoverOpacity, {
        toValue: 0,
        duration: LOAD_COVER_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: isNative,
      }).start();
    }, LOAD_COVER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, loadCoverOpacity]);

  // Runs "Visualize" scoping (target.runId set): restrict sessions to that
  // run's agent set. The adapter compares agentIdFilter by reference (see
  // use-visualizer-event-adapter.ts), and every runs.updated push replaces
  // the query array — even for patches that don't touch membership — so the
  // Set must be keyed on the actual membership (sorted, joined), not on the
  // runs array, or an active run resets + re-backfills the page on every
  // status/progress push.
  const runId = target.runId;
  const { data: runs } = useRuns(runId ? serverId : null);
  const agentIdsKey = useMemo(() => {
    if (!runId) {
      return null;
    }
    const run = runs?.find((candidate) => candidate.id === runId);
    return run ? [...collectRunAgentIds(run)].sort().join("\n") : null;
  }, [runId, runs]);
  const agentIdFilter = useMemo(
    () => (agentIdsKey == null ? null : new Set(agentIdsKey.split("\n").filter(Boolean))),
    [agentIdsKey],
  );

  const handlePostMessage = useCallback<VisualizerViewHandle["postMessage"]>((message) => {
    viewRef.current?.postMessage(message);
  }, []);

  // ─── Toolbar controls (OTTO toolbar above the tab) ─────────────────────────
  // Chats switcher → remote-control the page's selection. Panel/audio/HUD
  // toggles flip the device-local settings that the config effect above already
  // pushes to the page, so the page stays the single config-driven follower.
  const handleSelectSession = useCallback((sessionId: string) => {
    // Manually picking a chat pins the Visualizer to it — otherwise the next
    // focus change would immediately yank it back to the active chat.
    setFollowActive(false);
    viewRef.current?.postMessage({ type: "select-session", sessionId });
  }, []);
  const handleToggleFollow = useCallback(() => {
    // Flipping follow back on re-syncs to the focused chat via the effect below.
    setFollowActive((previous) => !previous);
  }, []);
  const handleToggleTimeline = useCallback(() => {
    void updateAppSettings({ visualizerPanelTimeline: !settings.visualizerPanelTimeline });
  }, [settings.visualizerPanelTimeline, updateAppSettings]);
  const handleToggleFiles = useCallback(() => {
    // Files/Cost are a mutually exclusive pair in the page — enabling one
    // disables the other so the toolbar's active states stay truthful.
    void updateAppSettings({
      visualizerPanelFileAttention: !settings.visualizerPanelFileAttention,
      visualizerPanelCostOverlay: false,
    });
  }, [settings.visualizerPanelFileAttention, updateAppSettings]);
  const handleToggleCost = useCallback(() => {
    void updateAppSettings({
      visualizerPanelCostOverlay: !settings.visualizerPanelCostOverlay,
      visualizerPanelFileAttention: false,
    });
  }, [settings.visualizerPanelCostOverlay, updateAppSettings]);
  const handleToggleAudio = useCallback(() => {
    void updateAppSettings({ visualizerSoundMuted: !settings.visualizerSoundMuted });
  }, [settings.visualizerSoundMuted, updateAppSettings]);
  const handleToggleHud = useCallback(() => {
    void updateAppSettings({ visualizerHudHidden: !settings.visualizerHudHidden });
  }, [settings.visualizerHudHidden, updateAppSettings]);
  // Stats is a config-driven follower like the other panel toggles: flip the
  // device-local setting → the config effect below pushes config.panels → the
  // page follows.
  const handleToggleStats = useCallback(() => {
    void updateAppSettings({ visualizerPanelStats: !settings.visualizerPanelStats });
  }, [settings.visualizerPanelStats, updateAppSettings]);
  // Zoom to Fit + Restart are stateless one-shot viewport actions — the page
  // owns the simulation, so these just remote-control it (no device-local
  // setting to persist), mirroring how the chats dropdown drives selection.
  const handleZoomToFit = useCallback(() => {
    viewRef.current?.postMessage({ type: "viewport-command", action: "zoom-to-fit" });
  }, []);
  const handleRestart = useCallback(() => {
    viewRef.current?.postMessage({ type: "viewport-command", action: "restart" });
  }, []);

  const handleMessage = useCallback(
    (message: VisualizerHostMessage) => {
      if (message.type === "ready" && !connectedRef.current) {
        connectedRef.current = true;
        viewRef.current?.postMessage({
          type: "connection-status",
          status: "connected",
          source: "otto",
        });
        // The panels/render config is sent by the settings effect below, which
        // fires on this ready flip and again live on every settings change.
        setReady(true);
        setLoadFailure(null);
        return;
      }
      if (message.type === "load-failed") {
        setLoadFailure({ reason: message.reason ?? null });
        return;
      }
      if (message.type === "sound-muted") {
        // The in-page speaker button was toggled — persist it so the choice
        // survives reopening the tab and restarting the app. The settings
        // change flows back out as config.soundVolume via the effect above.
        void updateAppSettings({ visualizerSoundMuted: message.muted });
        return;
      }
      if (message.type === "panel-toggle") {
        // A page keyboard shortcut asked to toggle a panel. Host settings are
        // the source of truth for panel visibility, so flip the same
        // device-local setting the matching toolbar button does — the change
        // flows back to the page via the config.panels push, keeping the
        // toolbar's selected state and the page in sync.
        // While the HUD is hidden the panels are force-hidden and their toolbar
        // toggles are disabled, so ignore the shortcut too — otherwise it would
        // silently flip the stored setting and surprise the user on re-show.
        if (settings.visualizerHudHidden) {
          return;
        }
        if (message.panel === "timeline") {
          handleToggleTimeline();
        } else if (message.panel === "files") {
          handleToggleFiles();
        } else if (message.panel === "cost") {
          handleToggleCost();
        } else {
          handleToggleStats();
        }
        return;
      }
      if (message.type === "session-state") {
        // The page mirrored its live session list/selection so the toolbar's
        // chats dropdown can render + drive them (OTTO PATCH).
        setSessionState({
          sessions: message.sessions,
          selectedId: message.selectedId,
          activityIds: message.activityIds,
        });
        return;
      }
      if (message.type === "open-file") {
        // Paths come from tool-call telemetry (visualizer-event-adapter's
        // inputData.file_path) — could be absolute or workspace-relative;
        // normalizeWorkspaceFileLocation tolerates both.
        const location = normalizeWorkspaceFileLocation({
          path: message.filePath,
          lineStart: message.line,
          lineEnd: message.line,
        });
        if (location) {
          // The Visualizer is a canvas that doesn't share its pane well — a file
          // opened on top of it would cover the graph the user is watching. Open
          // beside it instead (focus an adjacent pane, else split one out), the
          // same "side" disposition chat file links use.
          openFileInWorkspace({ location, disposition: "side" });
        }
      }
    },
    [
      openFileInWorkspace,
      updateAppSettings,
      handleToggleTimeline,
      handleToggleFiles,
      handleToggleCost,
      handleToggleStats,
      settings.visualizerHudHidden,
    ],
  );

  // Device-local prefs (Settings -> Visualizer): panel visibility seeds
  // (vendor `config.panels` patch) and render-layer toggles (`config.render`
  // patch) — sent when the page becomes ready and re-sent live whenever a
  // setting changes. Both are partial configs, so they never disturb
  // mode/showMockData (safe during the dev demo scenario).
  // Software rendering (no GPU acceleration) force-disables bloom regardless
  // of the setting: it's three full-canvas blur passes per frame — the single
  // most expensive draw stage — which a CPU rasterizer can't afford. The
  // Settings toggle shows the same forced-off state (visualizer-section.tsx).
  const isSoftwareRendering = useIsSoftwareRendering();
  // Hiding the HUD hides the informational panels too (Timeline / Files / Cost
  // / Stats), not just the vendor's top+bottom bars: the HUD-eye is meant to
  // give a clean canvas view, so a stale slide-in panel left open would defeat
  // it. Force config.panels off while hudden — but read from the stored panel
  // settings, never write them, so re-showing the HUD restores exactly the
  // panels that were open before (same preserve-the-preference pattern as
  // software-rendering forcing bloom off). The toolbar's panel toggles are
  // disabled + unselected to match (visualizer-toolbar.tsx).
  const hudHidden = settings.visualizerHudHidden;
  useEffect(() => {
    if (!ready) {
      return;
    }
    viewRef.current?.postMessage({
      type: "config",
      config: {
        panels: {
          timeline: !hudHidden && settings.visualizerPanelTimeline,
          fileAttention: !hudHidden && settings.visualizerPanelFileAttention,
          costOverlay: !hudHidden && settings.visualizerPanelCostOverlay,
          stats: !hudHidden && settings.visualizerPanelStats,
        },
        render: {
          bloom: isSoftwareRendering ? false : settings.visualizerRenderBloom,
          nodeGlow: settings.visualizerRenderNodeGlow,
          stars: settings.visualizerRenderStars,
          backdrop: settings.visualizerRenderBackdrop,
          nodeShape: settings.visualizerNodeShape,
          showFps: settings.visualizerShowFps,
        },
        // Effective master volume (0..1) for the page's audio engine: the mute
        // toggle gates the slider level, so muting sends 0 and unmuting restores
        // exactly the current slider value. Stored as a 0-100 percent.
        soundVolume: settings.visualizerSoundMuted ? 0 : settings.visualizerSoundVolume / 100,
        // Whole-HUD visibility — one device-local setting shared by every
        // Visualizer tab, toggled by the toolbar HUD-eye.
        hudHidden,
      },
    });
  }, [
    ready,
    isSoftwareRendering,
    hudHidden,
    settings.visualizerPanelTimeline,
    settings.visualizerPanelFileAttention,
    settings.visualizerPanelCostOverlay,
    settings.visualizerPanelStats,
    settings.visualizerRenderBloom,
    settings.visualizerRenderNodeGlow,
    settings.visualizerRenderStars,
    settings.visualizerRenderBackdrop,
    settings.visualizerNodeShape,
    settings.visualizerShowFps,
    settings.visualizerSoundVolume,
    settings.visualizerSoundMuted,
  ]);

  // Fonts + type scale: the guest page renders in Otto's interface/code fonts
  // at the chat prose size instead of the vendor's own mono-everywhere look
  // (docs/visualizer.md "Fonts & type scale"). Consumed by the Otto shell
  // script (emit-bundle.mjs), not the vendor bridge — sent on ready and
  // re-sent live when the appearance settings (or the compact bump) change.
  const isCompact = useIsCompactFormFactor();
  useEffect(() => {
    if (!ready) {
      return;
    }
    viewRef.current?.postMessage({
      type: "otto-appearance",
      ...resolveVisualizerAppearance({
        uiFontFamily: settings.uiFontFamily,
        monoFontFamily: settings.monoFontFamily,
        uiFontSize: settings.uiFontSize,
        isCompact,
      }),
    });
  }, [ready, settings.uiFontFamily, settings.monoFontFamily, settings.uiFontSize, isCompact]);

  // Every transition to active (ready + this pane actually visible) does a
  // full reset + replay — including recovery from a hidden-webview rAF stall
  // (visualizer.md Risks: "Hidden panes stop the world").
  useVisualizerEventAdapter({
    serverId,
    workspaceId,
    active: ready && isVisible,
    agentIdFilter,
    draftSessions,
    postMessage: handlePostMessage,
  });

  // Speak short personality voice cues (join / thinking / done) for the main
  // agent — gated by the setting + host capabilities inside the hook.
  useVisualizerVoiceCues({
    serverId,
    workspaceId,
    active: ready && isVisible,
    agentIdFilter,
  });

  // Follow the focused chat: whenever follow is on, drive the page's selection
  // to the workspace's focused chat. Guards keep it inert unless there's real
  // work to do — the target must be a session the page actually knows about
  // (run-scoped tabs filter the set) and must differ from the current
  // selection. The page echoes the new selection back via `session-state`,
  // which satisfies the `=== selectedId` guard and stops any feedback loop.
  useEffect(() => {
    if (!ready || !followActive || followTargetSessionId === null) {
      return;
    }
    const sessionId = followTargetSessionId;
    if (sessionId === sessionState.selectedId) {
      return;
    }
    if (!sessionState.sessions.some((session) => session.id === sessionId)) {
      return;
    }
    viewRef.current?.postMessage({ type: "select-session", sessionId });
  }, [ready, followActive, followTargetSessionId, sessionState.selectedId, sessionState.sessions]);

  const loadCoverStyle = useMemo(
    () => [
      styles.loadCover,
      { backgroundColor: visualizerTheme.background, opacity: loadCoverOpacity },
    ],
    [visualizerTheme.background, loadCoverOpacity],
  );

  return (
    <View style={styles.container}>
      {/* Native Otto toolbar at the top of the tab — chats switcher + panel/
          audio/HUD toggles pulled out of the in-webview HUD. Always visible;
          the HUD-eye here hides only the in-webview HUD. */}
      <VisualizerToolbar
        sessions={sessionState.sessions}
        selectedSessionId={sessionState.selectedId}
        onSelectSession={handleSelectSession}
        followActive={followActive}
        onToggleFollow={handleToggleFollow}
        timelineOpen={settings.visualizerPanelTimeline}
        filesOpen={settings.visualizerPanelFileAttention}
        costOpen={settings.visualizerPanelCostOverlay}
        statsOpen={settings.visualizerPanelStats}
        soundMuted={settings.visualizerSoundMuted}
        hudHidden={settings.visualizerHudHidden}
        onToggleTimeline={handleToggleTimeline}
        onToggleFiles={handleToggleFiles}
        onToggleCost={handleToggleCost}
        onToggleStats={handleToggleStats}
        onZoomToFit={handleZoomToFit}
        onRestart={handleRestart}
        onToggleAudio={handleToggleAudio}
        onToggleHud={handleToggleHud}
      />
      <View style={styles.canvasWrap}>
        <VisualizerView
          ref={viewRef}
          onMessage={handleMessage}
          renderScale={renderScale}
          themeJson={visualizerTheme.json}
          themeBackground={visualizerTheme.background}
        />
        <Animated.View pointerEvents="none" style={loadCoverStyle} />
        {/* Above the (still-opaque) load cover: without this, a guest that never
            loads presents as a silent solid-color tab with no evidence anywhere
            (docs/visualizer.md "Risks / gotchas" — software-rendering machines). */}
        {loadFailure !== null && !ready ? (
          <View pointerEvents="none" style={styles.loadFailure}>
            <Text style={styles.loadFailureTitle}>{t("workspace.visualizer.loadFailedTitle")}</Text>
            <Text style={styles.loadFailureBody}>{t("workspace.visualizer.loadFailedBody")}</Text>
            {loadFailure.reason ? (
              <Text style={styles.loadFailureReason}>{loadFailure.reason}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // Holds the webview + its absolute load/failure overlays below the toolbar,
  // so the overlays cover only the canvas area, never the toolbar.
  canvasWrap: {
    flex: 1,
    position: "relative",
  },
  // Opaque boot cover over the guest, painted the stage background — hides
  // the default-HUD flash between the page's first paint and the settings
  // config landing (see LOAD_COVER_SETTLE_MS above). Faded out post-settle;
  // pointerEvents:none so it never eats input even mid-fade.
  loadCover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Centered on top of the opaque load cover; pointerEvents:none so the
  // dev-bar buttons beneath stay clickable (reopening the tab is the retry).
  loadFailure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
  },
  loadFailureTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  loadFailureBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 480,
  },
  loadFailureReason: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    textAlign: "center",
  },
}));
