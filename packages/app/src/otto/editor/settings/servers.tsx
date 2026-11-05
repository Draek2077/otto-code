import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import {
  EditorServers,
  stopEditorServer,
  type EditorPreferences,
} from "@getpaseo/plugin/otto/editor";
import { SettingsRow, SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { openExternalUrl } from "@/utils/open-external-url";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  getLastWorkspaceSelection,
  navigateToWorkspace,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import type { EditorClient } from "../client";
import type { EditorSettingsForm } from "./form";

type Server = z.infer<typeof EditorServers>["available"][number];
type Running = z.infer<typeof EditorServers>["running"][number];
interface ServerProps {
  row: Server;
  preferences: EditorPreferences;
  model: EditorSettingsForm;
  client: EditorClient;
}

async function runInstall(client: EditorClient, label: string, install: Server["install"]) {
  if (!install) return;
  const selection = getLastWorkspaceSelection();
  if (selection?.serverId !== client.hostId)
    throw new Error("Open a workspace on this host before running a server installation.");
  const workspace = useSessionStore
    .getState()
    .sessions[client.hostId]?.workspaces.get(selection.workspaceId);
  if (!workspace?.workspaceDirectory)
    throw new Error("The selected workspace is no longer available.");
  const confirmed = await confirmDialog({
    title: `Install ${label} on this host?`,
    message: `This runs on the selected host and may install a global tool:\n\n${install.display}`,
    confirmLabel: "Run in Terminal",
  });
  if (!confirmed) return;
  const created = await client.daemon.createTerminal(
    workspace.workspaceDirectory,
    `Install ${label}`,
    undefined,
    {
      workspaceId: selection.workspaceId,
      command: install.command,
      args: install.args,
    },
  );
  if (!created.terminal)
    throw new Error(created.error ?? "The installation terminal could not be opened.");
  navigateToWorkspace({
    ...selection,
    target: { kind: "terminal", terminalId: created.terminal.id },
  });
}
function InstallCommand({
  label,
  install,
  client,
}: {
  label: string;
  install: Server["install"];
  client: EditorClient;
}) {
  const last = useLastWorkspaceSelection();
  const copy = useMutation({ mutationFn: () => copyToClipboard(install?.display ?? "") });
  const run = useMutation({ mutationFn: () => runInstall(client, label, install) });
  const copyCommand = useCallback(() => copy.mutate(), [copy]);
  const runCommand = useCallback(() => run.mutate(), [run]);
  if (!install) return null;
  return (
    <>
      <SettingsRow
        label={install.display}
        hint={
          last?.serverId === client.hostId
            ? undefined
            : "Open a workspace on this host to run the command."
        }
      >
        <Button size="sm" variant="outline" onPress={copyCommand} loading={copy.isPending}>
          {copy.isSuccess ? "Copied" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={runCommand}
          loading={run.isPending}
          disabled={last?.serverId !== client.hostId}
        >
          Run in Terminal
        </Button>
      </SettingsRow>
      {copy.error || run.error ? (
        <Alert variant="error">{(copy.error ?? run.error)?.message}</Alert>
      ) : null}
    </>
  );
}
function InstallActions({ row, client }: { row: Server; client: EditorClient }) {
  const docs = useMutation({
    mutationFn: () =>
      openExternalUrl(
        row.prerequisite?.documentation ?? "https://learn.microsoft.com/dotnet/core/install/",
      ),
  });
  const openDocs = useCallback(() => docs.mutate(), [docs]);
  return (
    <>
      {row.prerequisite ? (
        <>
          <SettingsRow label=".NET SDK" hint={row.prerequisite.label}>
            <Button variant="outline" size="sm" onPress={openDocs} loading={docs.isPending}>
              Installation instructions
            </Button>
          </SettingsRow>
          {docs.error ? <Alert variant="error">{docs.error.message}</Alert> : null}
          <InstallCommand label=".NET SDK" install={row.prerequisite.install} client={client} />
        </>
      ) : null}
      <InstallCommand label={row.label} install={row.install} client={client} />
    </>
  );
}
export function ServerRow({ row, preferences, model, client }: ServerProps) {
  const enabled = preferences.languages[row.id] ?? row.enabled;
  const change = useCallback(
    (value: boolean) =>
      model.edit({ languages: { ...model.getSnapshot().draft?.languages, [row.id]: value } }),
    [model, row.id],
  );
  let status = "Not installed";
  if (row.workspaceOnly) status = "Comes from the project";
  else if (row.command) status = `${row.source}: ${row.command}`;
  return (
    <>
      <SettingsSwitch
        label={row.label}
        hint={`${status}\n${row.cost}`}
        value={enabled}
        onValueChange={change}
      />
      {!row.command && row.install ? <InstallActions row={row} client={client} /> : null}
    </>
  );
}
export function RunningServerRow({
  row,
  client,
  onStopped,
}: {
  row: Running;
  client: EditorClient;
  onStopped(): void;
}) {
  const stop = useMutation({
    mutationFn: () =>
      client.call(stopEditorServer, {
        hostId: client.hostId,
        root: row.root,
        serverId: row.serverId,
      }),
    onSuccess: onStopped,
  });
  const stopServer = useCallback(() => stop.mutate(), [stop]);
  return (
    <>
      <SettingsRow
        label={row.serverId}
        hint={`${row.root}\nStarted ${new Date(row.startedAt).toLocaleString()}`}
      >
        <Button size="sm" variant="outline" onPress={stopServer} loading={stop.isPending}>
          Stop
        </Button>
      </SettingsRow>
      {stop.error ? <Alert variant="error">{stop.error.message}</Alert> : null}
    </>
  );
}
