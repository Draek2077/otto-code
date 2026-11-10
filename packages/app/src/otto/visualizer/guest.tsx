import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAppSettings } from "@/hooks/use-settings";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceFilePaths, createWorkspaceFileTabTarget } from "@/workspace/file-open";
import type { Theme } from "@/styles/theme";
import type { VisualizerGuestMessage } from "@getpaseo/visualizer/contracts";
import { VisualizerBridge, prepareVisualizerHtml } from "./transport";
import { VisualizerFrame } from "./frame";
import { connectVisualizerFeed, type VisualizerFeedState } from "./feed";
import { buildVisualizerPalette } from "./palette";
import { visualizerRenderScale, type VisualizerPreferences } from "./preferences";
import { visualizerConfig } from "./config";
import { selectedVisualizerSession } from "./selection";
import { visualizerStyles as styles } from "./styles";

const panelKeys = {
  timeline: "visualizerPanelTimeline",
  files: "visualizerPanelFileAttention",
  cost: "visualizerPanelCostOverlay",
  failures: "visualizerPanelFailures",
  stats: "visualizerPanelStats",
} as const;
export interface VisualizerGuestProps {
  serverId: string;
  workspaceId: string;
  placement: "tab" | "pip" | "background";
  selectedId: string | null;
  follow: boolean;
  latestBubble?: boolean;
  demo?: boolean;
  onState(state: VisualizerFeedState): void;
  onBridge?(bridge: VisualizerBridge | null): void;
  onSessionCount?(count: number): void;
}
function Guest({
  serverId,
  workspaceId,
  placement,
  selectedId,
  follow,
  latestBubble = false,
  demo = false,
  onState,
  onBridge,
  onSessionCount,
  theme,
}: VisualizerGuestProps & { theme: Theme }) {
  const { settings, updateSettings } = useAppSettings();
  const [readyChannel, setReadyChannel] = useState<string | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [operationError, setOperationError] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const state = useRef<VisualizerFeedState | null>(null);
  const current = useRef({
    settings,
    updateSettings,
    onState,
    selectedId,
    follow,
    demo,
    onSessionCount,
    attempt,
  });
  current.current = {
    settings,
    updateSettings,
    onState,
    selectedId,
    follow,
    demo,
    onSessionCount,
    attempt,
  };
  const chosen = useRef<string | null>(null);
  const feed = useRef<ReturnType<typeof connectVisualizerFeed> | null>(null);
  const handle = useCallback(
    (message: VisualizerGuestMessage) => {
      const data = current.current;
      if (message.type === "session-state") {
        data.onSessionCount?.(message.sessions.length);
        return;
      }
      const save = (patch: Partial<VisualizerPreferences>) => {
        setOperationError("");
        void data
          .updateSettings(patch)
          .catch(() => setOperationError("The Visualizer preference could not be saved."));
      };
      if (message.type === "sound-muted") save({ visualizerSoundMuted: message.muted });
      if (message.type === "panel-toggle") {
        const key = panelKeys[message.panel];
        save({ [key]: !data.settings[key] });
      }
      if (message.type === "open-file" && state.current?.files.has(message.filePath)) {
        const workspace = useSessionStore
          .getState()
          .sessions[serverId]?.workspaces.get(workspaceId);
        const paths =
          workspace &&
          resolveWorkspaceFilePaths({
            path: message.filePath,
            workspaceRoot: workspace.workspaceDirectory,
          });
        if (paths)
          useWorkspaceLayoutStore.getState().openTab({
            workspaceKey: `${serverId}:${workspaceId}`,
            target: createWorkspaceFileTabTarget({
              path: paths.absolutePath,
              lineStart: message.line,
            }),
            intent: "reveal",
          });
      }
    },
    [serverId, workspaceId],
  );
  const palette = useMemo(
    () =>
      buildVisualizerPalette({
        colorScheme: theme.colorScheme,
        colors: { ...theme.colors, background: theme.colors.surface0 },
      }),
    [theme],
  );
  const guest = useMemo(() => {
    const channel = `${globalThis.crypto.randomUUID()}-${attempt}`;
    const bridge = new VisualizerBridge(channel, (message) => {
      if (message.type === "ready") {
        chosen.current = null;
        setReadyChannel(channel);
      } else handle(message);
    });
    // A changed HTML bootstrap gets its own guest and replay frontier.
    return { bridge, palette, scale: visualizerRenderScale[settings.visualizerRenderQuality] };
  }, [handle, attempt, palette, settings.visualizerRenderQuality]);
  const { bridge } = guest;
  const ready = readyChannel === bridge.channel;
  const html = useMemo(
    () =>
      raw
        ? prepareVisualizerHtml(raw, bridge.channel, guest.scale, JSON.stringify(guest.palette))
        : null,
    [raw, bridge, guest],
  );
  useEffect(() => {
    let live = true;
    const generation = attempt;
    import("./visualizer-bundle.gen")
      .then((module) => {
        if (live && generation === current.current.attempt) setRaw(module.VISUALIZER_HTML);
        return undefined;
      })
      .catch(() => {
        if (live) setError("The Visualizer bundle could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  useEffect(() => {
    onBridge?.(bridge);
    return () => {
      bridge.dispose();
      onBridge?.(null);
    };
  }, [bridge, onBridge]);
  useEffect(() => {
    if (!html || ready || error) return;
    const timeout = setTimeout(
      () => setError("The Visualizer did not become ready. Reconnect it to try again."),
      15000,
    );
    return () => clearTimeout(timeout);
  }, [html, ready, error]);
  const config = useMemo(
    () => visualizerConfig(settings, placement, latestBubble),
    [settings, placement, latestBubble],
  );
  useEffect(() => {
    if (ready) bridge.send({ type: "config", config: { ...config, showMockData: demo } });
  }, [bridge, ready, config, demo]);
  useEffect(() => {
    if (!ready || error) return;
    const release = connectVisualizerFeed(
      serverId,
      workspaceId,
      bridge,
      (next) => {
        if (next.reset) chosen.current = null;
        state.current = next;
        current.current.onState(next);
        const selection = current.current;
        const target = selectedVisualizerSession(selection, next.sessions, next.focusedAgentId);
        if (target && chosen.current !== target) {
          chosen.current = target;
          bridge.send({ type: "select-session", sessionId: target });
        }
      },
      demo,
      () => current.current,
    );
    feed.current = release;
    return () => {
      if (feed.current === release) feed.current = null;
      release();
    };
  }, [ready, error, bridge, serverId, workspaceId, demo]);
  useEffect(() => {
    feed.current?.refresh();
  }, [selectedId, follow]);
  useEffect(() => {
    if (!ready) return;
    bridge.send({
      type: "otto-appearance",
      uiFontFamily: theme.fontFamily.ui,
      codeFontFamily: theme.fontFamily.mono,
      chatFontSize: theme.fontSize.sm,
    });
  }, [ready, bridge, theme]);
  const retry = useCallback(() => {
    setError("");
    setOperationError("");
    setAttempt((value) => value + 1);
  }, []);
  const failure = useCallback((message: string) => setError(message), []);
  if (error)
    return (
      <View style={styles.error}>
        <Alert variant="error" description={error} />
        <Button variant="outline" onPress={retry}>
          Reconnect Visualizer
        </Button>
      </View>
    );
  return (
    <View style={styles.frame}>
      {operationError ? <Alert variant="error" description={operationError} /> : null}
      {html ? (
        <VisualizerFrame
          key={bridge.channel}
          html={html}
          channel={bridge.channel}
          onMessage={bridge.accept}
          onTransport={bridge.attach}
          onFailure={failure}
        />
      ) : (
        <LoadingSpinner color={theme.colors.accent} />
      )}
    </View>
  );
}
const ThemedGuest = withUnistyles(Guest);
const projection = (theme: Theme) => ({ theme });
export function VisualizerGuest(props: VisualizerGuestProps) {
  return <ThemedGuest {...props} uniProps={projection} />;
}
