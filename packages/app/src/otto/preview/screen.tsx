import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  readPreviewConfig,
  startPreviewServer,
  stopPreviewServer,
  openPreviewBrowser,
  readPreviewLogs,
  type PreviewServer,
} from "@getpaseo/plugin/otto/preview";
import { SettingsRow, SettingsSection, SettingsCard, SettingsSelect } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { PreviewActions } from "./action-model";
import {
  CommandCard,
  ServerCard,
  ServerDetail,
  PreviewLogText,
  type PreviewCommand,
} from "./cards";
import { styles } from "./styles";
import { useRevealBrowser } from "@/otto/browser/host/reveal";
const levels = [
  { value: "all", label: "All output" },
  { value: "error", label: "Errors" },
];
const setupPrompt =
  "Detect this workspace's development servers and their real commands. Reuse an existing .claude/launch.json; if missing, create it using the format from preview_start. Do not change ports to avoid a running server. Ask me which servers to start, then use preview_start for the ones I choose. Verify against the returned browserId with browser tools.";
function PreviewLogs({
  scope,
  serverId,
  active,
}: {
  scope: { hostId: string; workspaceId: string };
  serverId: string;
  active: boolean;
}) {
  const read = useRpc(readPreviewLogs);
  const [level, setLevel] = useState("all");
  const logs = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 1000,
    queryKey: ["ottoPreviewLogs", scope.hostId, scope.workspaceId, serverId, level],
    enabled: active,
    retry: false,
    queryFn: async () => {
      const result = await read({
        ...scope,
        serverId,
        lines: 200,
        level: level === "error" ? "error" : "all",
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch: refetchLogs } = logs;
  const refresh = useCallback(async () => {
    await refetchLogs();
  }, [refetchLogs]);
  return (
    <SettingsSection
      title="Output"
      info="The host retains 2,000 bounded lines. This view reads up to 200 lines and 128 KiB per request; it does not stream hidden logs."
    >
      <SettingsSelect label="Show" value={level} options={levels} onValueChange={setLevel} />
      <Button variant="outline" size="sm" onPress={refresh} disabled={!active || logs.isFetching}>
        Refresh output
      </Button>
      {logs.error ? (
        <Alert variant="error" description="Output could not be read from this host." />
      ) : null}
      <PreviewLogText lines={logs.data ?? []} />
    </SettingsSection>
  );
}
export function PreviewWorkspace(props: PluginWorkspacePanelProps) {
  const revealBrowser = useRevealBrowser(props.host.id, props.workspaceId);
  const read = useRpc(readPreviewConfig),
    start = useRpc(startPreviewServer),
    stop = useRpc(stopPreviewServer),
    open = useRpc(openPreviewBrowser);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible(),
    connected = useHostRuntimeIsConnected(props.host.id);
  const active = retained && visible && connected;
  const compact = useIsCompactFormFactor();
  const scope = useMemo(
    () => ({ hostId: props.host.id, workspaceId: props.workspaceId }),
    [props.host.id, props.workspaceId],
  );
  const [selectedId, setSelectedId] = useState("");
  const [actions] = useState(() => new PreviewActions());
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot);
  useEffect(() => (active ? actions.activate() : undefined), [active, actions]);
  const config = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoPreviewConfig", scope.hostId, scope.workspaceId],
    enabled: active,
    retry: false,
    refetchInterval: active ? 3000 : false,
    queryFn: async () => {
      const result = await read(scope);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch: refetchConfig } = config;
  const refresh = useCallback(async () => {
    await refetchConfig();
  }, [refetchConfig]);
  const begin = useCallback(
    (command: PreviewCommand) => {
      void actions.run(
        () =>
          confirmDialog({
            title: "Start Preview server?",
            message: `${command.name}\n${config.data?.cwd ?? ""}\n${command.command}\n${command.url}\n\nReuse the existing server if it is already running.`,
            confirmLabel: "Start or reuse",
          }),
        async () => {
          const result = await start({
            ...scope,
            name: command.name,
            commandRevision: command.commandRevision,
            userApprovedStart: true,
          });
          if (!result.ok) throw new Error(result.error.message);
          return (
            result.value.browserError ??
            "The server is tracked. Its designated browser is available."
          );
        },
        refresh,
      );
    },
    [actions, config.data?.cwd, refresh, scope, start],
  );
  const end = useCallback(
    (server: PreviewServer) => {
      void actions.run(
        () =>
          confirmDialog({
            title: "Stop Preview server?",
            message: `Stop the Otto-owned ${server.name} process tree? Its browser tab stays open.`,
            confirmLabel: "Stop",
            destructive: true,
          }),
        async () => {
          const result = await stop({ ...scope, serverId: server.id, userApprovedStop: true });
          if (!result.ok) throw new Error(result.error.message);
          return "The owned process tree stopped.";
        },
        refresh,
      );
    },
    [actions, refresh, scope, stop],
  );
  const openBrowser = useCallback(
    (server: PreviewServer) => {
      void actions.run(
        async () => true,
        async () => {
          const result = await open({ ...scope, serverId: server.id });
          if (!result.ok) throw new Error(result.error.message);
          await revealBrowser(result.value.browserId);
          return "The designated browser tab is open.";
        },
        refresh,
      );
    },
    [actions, open, refresh, scope, revealBrowser],
  );
  const copySetup = useCallback(() => {
    void actions.run(
      async () => true,
      async () => {
        await copyToClipboard(setupPrompt);
        return "Detection prompt copied. Paste it into a chat for this workspace.";
      },
      async () => {},
    );
  }, [actions]);
  const busy = !active || state.busy;
  const selected = config.data?.servers.find((server) => server.id === selectedId);
  const list = (
    <View style={styles.stack}>
      <SettingsSection
        title="Launch configuration"
        info="Preview reads this workspace's .claude/launch.json. Reading or opening this page never starts a server."
      >
        {config.data?.configError ? (
          <Alert variant="error" description={config.data.configError} />
        ) : null}
        {!config.data?.configured ? (
          <SettingsCard>
            <SettingsRow
              label="No readable launch configuration"
              hint="Use a chat to detect this project's real commands, then choose which ones to start."
            >
              <Button variant="outline" size="sm" onPress={copySetup} disabled={busy}>
                Copy detection prompt
              </Button>
            </SettingsRow>
          </SettingsCard>
        ) : null}
        {config.data?.commands.map((command) => (
          <CommandCard key={command.name} command={command} busy={busy} start={begin} />
        ))}
      </SettingsSection>
      <SettingsSection title="Tracked servers">
        {config.data?.servers.length ? (
          config.data.servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              selected={server.id === selectedId}
              busy={busy}
              select={setSelectedId}
            />
          ))
        ) : (
          <SettingsRow label="No servers tracked in this workspace." />
        )}
      </SettingsSection>
    </View>
  );
  const detail = selected ? (
    <ServerDetail server={selected} busy={busy} stop={end} open={openBrowser}>
      <PreviewLogs scope={scope} serverId={selected.id} active={active} />
    </ServerDetail>
  ) : (
    <SettingsRow label="Select a server to inspect output and lifecycle actions." />
  );
  const header = (
    <PreviewHeader
      connected={connected}
      failed={Boolean(config.error)}
      error={state.error}
      notice={state.notice}
      busy={busy}
      fetching={config.isFetching}
      refresh={refresh}
    />
  );
  if (compact)
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        testID="otto-preview-servers"
      >
        {header}
        {list}
        {detail}
      </ScrollView>
    );
  return (
    <View style={[styles.content, styles.desktop]} testID="otto-preview-servers">
      {header}
      <View style={styles.split}>
        <ScrollView style={styles.sidebar} contentContainerStyle={styles.stack}>
          {list}
        </ScrollView>
        <ScrollView style={styles.detail} contentContainerStyle={styles.stack}>
          {detail}
        </ScrollView>
      </View>
    </View>
  );
}

function PreviewHeader(props: {
  connected: boolean;
  failed: boolean;
  error: string;
  notice: string;
  busy: boolean;
  fetching: boolean;
  refresh(): Promise<void>;
}) {
  return (
    <View style={styles.stack}>
      {!props.connected ? (
        <Alert
          variant="warning"
          description="Reconnect to this workspace's host to manage Preview servers."
        />
      ) : null}
      {props.failed ? (
        <Alert
          variant="error"
          description="Preview servers could not be read. Refresh before another lifecycle action."
        />
      ) : null}
      {props.error ? <Alert variant="error" description={props.error} /> : null}
      {props.notice ? <Alert description={props.notice} /> : null}
      <Button
        variant="outline"
        size="sm"
        onPress={props.refresh}
        disabled={props.busy || props.fetching}
      >
        {props.fetching ? "Refreshing..." : "Refresh servers"}
      </Button>
    </View>
  );
}
