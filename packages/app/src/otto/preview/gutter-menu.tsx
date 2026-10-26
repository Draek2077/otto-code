import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { z } from "zod";
import {
  readPreviewConfig,
  startPreviewServer,
  stopPreviewServer,
  openPreviewBrowser,
  type PreviewServer,
} from "@getpaseo/plugin/otto/preview";
import type { PreviewCommand } from "./cards";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuHint,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useFetchQuery } from "@/data/query";
import { confirmDialog } from "@/utils/confirm-dialog";
import { PreviewActions } from "./action-model";
import { PreviewWorkspaceMenuItem } from "./workspace-menu-item";
const Icon = withUnistyles(Play);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
type PreviewConfig = Extract<z.output<typeof readPreviewConfig.output>, { ok: true }>["value"];

/** One play trigger. Reading the menu does not launch a process or create a tab. */
export function PreviewGutterMenu(props: { serverId: string; workspaceId: string }) {
  const available = useHostFeature(props.serverId, "ottoPreview");
  return available ? (
    <AvailablePreviewGutterMenu key={`${props.serverId}/${props.workspaceId}`} {...props} />
  ) : null;
}
function AvailablePreviewGutterMenu({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const connected = useHostRuntimeIsConnected(serverId),
    visible = useAppVisible(),
    retained = useRetainedPanelActive();
  const active = connected && visible && retained;
  const [menuOpen, setMenuOpen] = useState(false);
  const [actions] = useState(() => new PreviewActions());
  const action = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot);
  useEffect(() => (active ? actions.activate() : undefined), [actions, active]);
  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);
  const scope = useMemo(() => ({ hostId: serverId, workspaceId }), [serverId, workspaceId]);
  const invoke = useCallback(
    async (method: string, input: unknown) => {
      if (!client) throw new Error("The Preview host is disconnected.");
      return client.invokePluginRpc("otto-browser", method, input);
    },
    [client],
  );
  const config = useFetchQuery({
    queryKey: ["ottoPreviewConfig", serverId, workspaceId],
    dataShape: "value",
    staleTimeMs: 1000,
    enabled: active && menuOpen,
    retry: false,
    refetchInterval: active && menuOpen ? 3000 : false,
    queryFn: async () => {
      const result = readPreviewConfig.output.parse(await invoke(readPreviewConfig.name, scope));
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch } = config;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);
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
          const result = startPreviewServer.output.parse(
            await invoke(startPreviewServer.name, {
              ...scope,
              name: command.name,
              commandRevision: command.commandRevision,
              userApprovedStart: true,
            }),
          );
          if (!result.ok) throw new Error(result.error.message);
          return (
            result.value.browserError ?? "The server and its designated browser are available."
          );
        },
        refresh,
      );
    },
    [actions, config.data?.cwd, invoke, refresh, scope],
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
          const result = stopPreviewServer.output.parse(
            await invoke(stopPreviewServer.name, {
              ...scope,
              serverId: server.id,
              userApprovedStop: true,
            }),
          );
          if (!result.ok) throw new Error(result.error.message);
          return "The owned process tree stopped.";
        },
        refresh,
      );
    },
    [actions, invoke, refresh, scope],
  );
  const open = useCallback(
    (server: PreviewServer) => {
      void actions.run(
        async () => true,
        async () => {
          const result = openPreviewBrowser.output.parse(
            await invoke(openPreviewBrowser.name, { ...scope, serverId: server.id }),
          );
          if (!result.ok) throw new Error(result.error.message);
          return "The designated browser tab is open.";
        },
        refresh,
      );
    },
    [actions, invoke, refresh, scope],
  );
  const busy = !active || action.busy;
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ToolbarButton
        kind="menu"
        label="Preview servers"
        tooltip={action.error || action.notice || "Preview servers"}
        testID="workspace-preview-menu"
        disabled={!active}
      >
        <Icon size={14} uniProps={iconColor} />
      </ToolbarButton>
      <DropdownMenuContent
        side="bottom"
        align="end"
        offset={4}
        width={300}
        sheetTitle="Preview servers"
        testID="workspace-preview-menu-content"
      >
        {action.error ? <DropdownMenuHint>{action.error}</DropdownMenuHint> : null}
        {action.notice ? <DropdownMenuHint>{action.notice}</DropdownMenuHint> : null}
        <ConfigMessages
          data={config.data}
          failed={Boolean(config.error)}
          loading={config.isLoading}
        />
        {config.data?.servers
          .filter((server) => server.status !== "stopped")
          .map((server) => (
            <ServerMenu key={server.id} server={server} busy={busy} open={open} stop={end} />
          ))}
        {config.data?.commands.map((command) => (
          <StartItem key={command.name} command={command} busy={busy} start={begin} />
        ))}
        <DropdownMenuSeparator />
        <PreviewWorkspaceMenuItem
          serverId={serverId}
          workspaceId={workspaceId}
          surface="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function ConfigMessages({
  data,
  failed,
  loading,
}: {
  data: PreviewConfig | undefined;
  failed: boolean;
  loading: boolean;
}) {
  return (
    <>
      {failed ? (
        <DropdownMenuHint>
          Preview servers could not be read. Reopen this menu to refresh.
        </DropdownMenuHint>
      ) : null}
      {loading ? <DropdownMenuHint>Reading Preview servers...</DropdownMenuHint> : null}
      {data?.configError ? <DropdownMenuHint>{data.configError}</DropdownMenuHint> : null}
      {data && !data.commands.length && !data.servers.length ? (
        <DropdownMenuHint>
          No Preview servers configured. Manage servers for setup and logs.
        </DropdownMenuHint>
      ) : null}
    </>
  );
}
function StartItem({
  command,
  busy,
  start,
}: {
  command: PreviewCommand;
  busy: boolean;
  start(command: PreviewCommand): void;
}) {
  const choose = useCallback(() => start(command), [command, start]);
  return (
    <DropdownMenuItem onSelect={choose} disabled={busy} closeOnSelect={false}>
      Start or reuse {command.name}
    </DropdownMenuItem>
  );
}
function ServerMenu({
  server,
  busy,
  open,
  stop,
}: {
  server: PreviewServer;
  busy: boolean;
  open(server: PreviewServer): void;
  stop(server: PreviewServer): void;
}) {
  const openBrowser = useCallback(() => open(server), [open, server]);
  const stopServer = useCallback(() => stop(server), [stop, server]);
  return (
    <>
      <DropdownMenuLabel>
        {server.name} · {server.status} · {server.port}
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={openBrowser} disabled={busy}>
        Open {server.name} browser
      </DropdownMenuItem>
      {server.managed ? (
        <DropdownMenuItem onSelect={stopServer} disabled={busy} closeOnSelect={false}>
          Stop {server.name}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
