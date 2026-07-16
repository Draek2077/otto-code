import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Text, useColorScheme, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { Waypoints } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isDev } from "@/constants/platform";
import { collectRunAgentIds, useRuns } from "@/hooks/use-runs";
import { useAppSettings, useSettings } from "@/hooks/use-settings";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useVisualizerEventAdapter } from "@/visualizer/use-visualizer-event-adapter";
import { resolveVisualizerAppearance } from "@/visualizer/visualizer-appearance";
import { resolveVisualizerTheme } from "@/visualizer/visualizer-theme";
import { VisualizerView } from "@/visualizer/visualizer-view";
import type {
  VisualizerHostMessage,
  VisualizerHostToPageMessage,
  VisualizerViewHandle,
} from "@/visualizer/visualizer-view-types";
import { normalizeWorkspaceFileLocation } from "@/workspace/file-open";

function useVisualizerPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("workspace.visualizer.tabLabel"),
    subtitle: t("workspace.visualizer.subtitle"),
    titleState: "ready",
    icon: Waypoints,
    statusBucket: null,
  };
}

// Dev-only affordance to exercise the vendored bundle's built-in demo
// scenario (see docs/visualizer.md "Risks / gotchas"). Demo mode SUSPENDS the
// real event adapter — its live stream (and the reset it sends on every
// activation) would immediately clobber the mock scenario otherwise.
const DEMO_SCENARIO_MESSAGE: VisualizerHostToPageMessage = {
  type: "config",
  config: { mode: "replay", autoPlay: true, showMockData: true },
};
const DEMO_EXIT_MESSAGE: VisualizerHostToPageMessage = {
  type: "config",
  config: { mode: "live", autoPlay: false, showMockData: false },
};

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

function VisualizerPanel() {
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
  const [demoMode, setDemoMode] = useState(false);
  // Set when the guest reported a load failure (`load-failed`, Electron) or
  // the ready handshake timed out. `reason` is only ever shown as a small
  // diagnostic line; null reason = timeout.
  const [loadFailure, setLoadFailure] = useState<{ reason: string | null } | null>(null);

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
        useNativeDriver: true,
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
      if (message.type === "hud-hidden") {
        // The in-page HUD toggle was flipped — persist it so it applies to
        // every Visualizer tab (all read the same device-local setting) and
        // survives restarts. Flows back out as config.hudHidden via the effect.
        void updateAppSettings({ visualizerHudHidden: message.hidden });
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
          openFileInWorkspace({ location, disposition: "main" });
        }
      }
    },
    [openFileInWorkspace, updateAppSettings],
  );

  const handlePostMessage = useCallback<VisualizerViewHandle["postMessage"]>((message) => {
    viewRef.current?.postMessage(message);
  }, []);

  // Device-local prefs (Settings -> Visualizer): panel visibility seeds
  // (vendor `config.panels` patch) and render-layer toggles (`config.render`
  // patch) — sent when the page becomes ready and re-sent live whenever a
  // setting changes. Both are partial configs, so they never disturb
  // mode/showMockData (safe during the dev demo scenario).
  useEffect(() => {
    if (!ready) {
      return;
    }
    viewRef.current?.postMessage({
      type: "config",
      config: {
        panels: {
          timeline: settings.visualizerPanelTimeline,
          fileAttention: settings.visualizerPanelFileAttention,
          transcript: settings.visualizerPanelTranscript,
          messageFeed: settings.visualizerPanelMessageFeed,
          costOverlay: settings.visualizerPanelCostOverlay,
          hexGrid: settings.visualizerPanelHexGrid,
        },
        render: {
          bloom: settings.visualizerRenderBloom,
          stars: settings.visualizerRenderStars,
          backdrop: settings.visualizerRenderBackdrop,
        },
        // Effective master volume (0..1) for the page's audio engine: the mute
        // toggle gates the slider level, so muting sends 0 and unmuting restores
        // exactly the current slider value. Stored as a 0-100 percent.
        soundVolume: settings.visualizerSoundMuted ? 0 : settings.visualizerSoundVolume / 100,
        // Whole-HUD visibility — one device-local setting shared by every
        // Visualizer tab, toggled by the in-page HUD button.
        hudHidden: settings.visualizerHudHidden,
      },
    });
  }, [
    ready,
    settings.visualizerPanelTimeline,
    settings.visualizerPanelFileAttention,
    settings.visualizerPanelTranscript,
    settings.visualizerPanelMessageFeed,
    settings.visualizerPanelCostOverlay,
    settings.visualizerPanelHexGrid,
    settings.visualizerRenderBloom,
    settings.visualizerRenderStars,
    settings.visualizerRenderBackdrop,
    settings.visualizerSoundVolume,
    settings.visualizerSoundMuted,
    settings.visualizerHudHidden,
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
  // (visualizer.md Risks: "Hidden panes stop the world"). Suspended while the
  // dev demo scenario runs; toggling demo off re-activates it, and that
  // activation's own reset+replay restores the real sessions.
  useVisualizerEventAdapter({
    serverId,
    workspaceId,
    active: ready && isVisible && !demoMode,
    agentIdFilter,
    postMessage: handlePostMessage,
  });

  const handleToggleDemoScenario = useCallback(() => {
    const next = !demoMode;
    if (next) {
      // Clear the adapter's sessions so the mock scenario starts on a clean
      // stage; the state flip below suspends the adapter until demo exit.
      viewRef.current?.postMessage({ type: "reset" });
      viewRef.current?.postMessage(DEMO_SCENARIO_MESSAGE);
    } else {
      // The adapter re-activates on this flip and its reset+replay restores
      // the real sessions after these clear the mock state.
      viewRef.current?.postMessage(DEMO_EXIT_MESSAGE);
      viewRef.current?.postMessage({ type: "reset" });
    }
    setDemoMode(next);
  }, [demoMode]);

  // Debug affordance — pops the guest webview's own DevTools (Electron only;
  // no-op elsewhere).
  const handleOpenDevTools = useCallback(() => {
    viewRef.current?.openDevTools?.();
  }, []);

  const loadCoverStyle = useMemo(
    () => [
      styles.loadCover,
      { backgroundColor: visualizerTheme.background, opacity: loadCoverOpacity },
    ],
    [visualizerTheme.background, loadCoverOpacity],
  );

  return (
    <View style={styles.container}>
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
      {/* The demo scenario is a user-facing feature; only the DevTools debug
          affordance is dev-gated. */}
      <View style={styles.devBar}>
        <Button size="sm" variant="ghost" onPress={handleToggleDemoScenario}>
          {demoMode ? t("workspace.visualizer.demoExit") : t("workspace.visualizer.demoLoad")}
        </Button>
        {isDev ? (
          <Button size="sm" variant="ghost" onPress={handleOpenDevTools}>
            Open guest DevTools
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export const visualizerPanelRegistration: PanelRegistration<"visualizer"> = {
  kind: "visualizer",
  component: VisualizerPanel,
  useDescriptor: useVisualizerPanelDescriptor,
  confirmClose() {
    return Promise.resolve(true);
  },
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
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
  devBar: {
    position: "absolute",
    // Bottom-right: the page pins its own HUD to the top edge (status bar) and
    // bottom-center (LIVE timeline); this corner stays clear — the transcript
    // panel's lowest edge sits 64px up.
    bottom: theme.spacing[2],
    right: theme.spacing[2],
    flexDirection: "row",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.sm,
  },
}));
