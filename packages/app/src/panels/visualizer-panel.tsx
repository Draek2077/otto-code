import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useColorScheme, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { Waypoints } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isDev } from "@/constants/platform";
import { collectRunAgentIds, useRuns } from "@/hooks/use-runs";
import { useSettings } from "@/hooks/use-settings";
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

function VisualizerPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "visualizer", "VisualizerPanel requires visualizer target");
  const { isInteractive } = usePaneFocus();
  const { settings } = useSettings();
  const viewRef = useRef<VisualizerViewHandle>(null);
  const connectedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

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
  // re-activates the adapter.
  const renderScale = RENDER_SCALE_BY_QUALITY[settings.visualizerRenderQuality] ?? 1;
  useEffect(() => {
    connectedRef.current = false;
    setReady(false);
  }, [renderScale, visualizerTheme.json]);

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
    [openFileInWorkspace],
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
    active: ready && isInteractive && !demoMode,
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

  return (
    <View style={styles.container}>
      <VisualizerView
        ref={viewRef}
        onMessage={handleMessage}
        renderScale={renderScale}
        themeJson={visualizerTheme.json}
        themeBackground={visualizerTheme.background}
      />
      {isDev ? (
        <View style={styles.devBar}>
          <Button size="sm" variant="ghost" onPress={handleToggleDemoScenario}>
            {demoMode ? "Exit demo" : "Load demo scenario"}
          </Button>
          <Button size="sm" variant="ghost" onPress={handleOpenDevTools}>
            Open guest DevTools
          </Button>
        </View>
      ) : null}
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
