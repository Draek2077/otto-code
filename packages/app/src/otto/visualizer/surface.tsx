import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerRendererVisible } from "./use-renderer-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { VisualizerGuest } from "./guest";
import { VisualizerToolbar } from "./toolbar";
import type { VisualizerBridge } from "./transport";
import type { VisualizerFeedState } from "./feed";
import { visualizerPlacement, type VisualizerPreferences } from "./preferences";
import { visualizerWindowOwner } from "./window-owner";
import {
  useVisualizerSelection,
  defaultVisualizerSelection,
  selectedVisualizerSession,
} from "./selection";
import { openVisualizerPanel } from "./actions";
import { visualizerStyles as styles } from "./styles";
const empty: VisualizerFeedState = {
  sessions: [],
  focusedAgentId: null,
  openChats: 0,
  connected: false,
  files: new Set(),
  truncated: false,
  reset: false,
};
export interface VisualizerSurfaceProps {
  serverId: string;
  workspaceId: string;
  placement: "tab" | "pip";
  active: boolean;
}
export function VisualizerSurface({
  serverId,
  workspaceId,
  placement,
  active,
}: VisualizerSurfaceProps) {
  const { settings, updateSettings } = useAppSettings();
  const visible = useVisualizerRendererVisible(),
    retained = useRetainedPanelActive(),
    identity = useId();
  const owner = useSyncExternalStore(
    visualizerWindowOwner.subscribe,
    visualizerWindowOwner.getSnapshot,
  );
  const allowed = active && visible && retained && visualizerPlacement(settings) === placement;
  useEffect(() => {
    if (allowed) return visualizerWindowOwner.retain(identity, placement === "pip" ? 100 : 10);
  }, [allowed, identity, placement]);
  const live = allowed && owner === identity;
  const key = `${serverId}:${workspaceId}`;
  const selection = useVisualizerSelection(
    (state) => state.targets[key] ?? defaultVisualizerSelection,
  );
  const select = useVisualizerSelection((state) => state.select);
  const [state, setState] = useState(empty),
    [demo, setDemo] = useState(false),
    [error, setError] = useState("");
  const [guestSessions, setGuestSessions] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const bridge = useRef<VisualizerBridge | null>(null);
  const expanding = useRef(false);
  const attachBridge = useCallback((next: VisualizerBridge | null) => {
    bridge.current = next;
    setGuestSessions(null);
  }, []);
  const publish = useCallback((next: VisualizerFeedState) => setState(next), []);
  const save = useCallback(
    (patch: Partial<VisualizerPreferences>) => {
      setError("");
      void updateSettings(patch).catch(() =>
        setError("The Visualizer preference could not be saved."),
      );
    },
    [updateSettings],
  );
  const selectedId = selectedVisualizerSession(selection, state.sessions, state.focusedAgentId);
  const choose = useCallback(
    (value: string) => select(key, { selectedId: value, follow: false }),
    [select, key],
  );
  const pin = useCallback(
    () => select(key, { selectedId, follow: !selection.follow }),
    [select, key, selectedId, selection.follow],
  );
  const fit = useCallback(() => {
    bridge.current?.send({ type: "viewport-command", action: "zoom-to-fit" });
  }, []);
  const toggleDemo = useCallback(() => {
    bridge.current?.send({ type: "viewport-command", action: "cold-restart" });
    setDemo((value) => !value);
  }, []);
  const close = useCallback(() => save({ visualizerPipOpen: false }), [save]);
  const expand = useCallback(async () => {
    if (expanding.current) return;
    expanding.current = true;
    setOpening(true);
    try {
      await openVisualizerPanel(serverId, workspaceId);
    } catch {
      setError("The Visualizer tab could not be opened. Try again.");
    } finally {
      expanding.current = false;
      setOpening(false);
    }
  }, [serverId, workspaceId]);
  useEffect(() => {
    if (demo && (state.openChats > 0 || state.sessions.length > 0)) {
      bridge.current?.send({ type: "viewport-command", action: "cold-restart" });
      setDemo(false);
    }
  }, [demo, state.openChats, state.sessions.length]);
  return (
    <View style={styles.root} testID={`visualizer-${placement}`}>
      <View style={placement === "pip" ? styles.pipToolbar : undefined}>
        <VisualizerToolbar
          sessions={state.sessions}
          selectedId={selectedId}
          follow={selection.follow}
          preferences={settings}
          canDemo={
            state.connected &&
            state.openChats === 0 &&
            state.sessions.length === 0 &&
            guestSessions === 0
          }
          demo={demo}
          compact={placement === "pip"}
          opening={opening}
          choose={choose}
          pin={pin}
          fit={fit}
          toggleDemo={toggleDemo}
          save={save}
          expand={placement === "pip" ? expand : undefined}
          close={placement === "pip" ? close : undefined}
        />
      </View>
      {error ? <Alert variant="error" description={error} /> : null}
      {live && !state.connected ? (
        <Text style={styles.caption}>Waiting for the host connection.</Text>
      ) : null}
      {live ? (
        <VisualizerGuest
          key={`${serverId}:${workspaceId}`}
          serverId={serverId}
          workspaceId={workspaceId}
          placement={placement}
          selectedId={selection.selectedId}
          follow={selection.follow}
          demo={demo}
          onState={publish}
          onBridge={attachBridge}
          onSessionCount={setGuestSessions}
        />
      ) : (
        <InactiveVisualizer
          placement={placement}
          pipOpen={settings.visualizerPipOpen}
          open={expand}
          opening={opening}
        />
      )}
      {state.truncated ? (
        <Text style={styles.caption}>
          Showing a bounded recent timeline. Full history remains in the chat.
        </Text>
      ) : null}
    </View>
  );
}
function InactiveVisualizer({
  placement,
  pipOpen,
  open,
  opening,
}: {
  placement: "tab" | "pip";
  pipOpen: boolean;
  open(): void;
  opening: boolean;
}) {
  return (
    <>
      <Text style={styles.caption}>
        {placement === "tab" && pipOpen
          ? "Visualizer is open in picture in picture."
          : "Visualizer is paused while this surface is inactive."}
      </Text>
      {placement === "tab" ? (
        <Button variant="outline" onPress={open} disabled={opening}>
          {opening ? "Opening Visualizer…" : "Show Visualizer here"}
        </Button>
      ) : null}
    </>
  );
}
export function VisualizerWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <VisualizerSurface
      serverId={props.host.id}
      workspaceId={props.workspaceId}
      placement="tab"
      active
    />
  );
}
