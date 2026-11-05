import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useFetchQuery } from "@/data/query";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  readEditorSettings,
  saveEditorSettings,
  listEditorServers,
  type EditorPreferences,
} from "@getpaseo/plugin/otto/editor";
import { useEditorConnection, type EditorClient } from "../client";
import { EditorSettingsForm, type EditorSettingsPort } from "./form";
import { ServerRow, RunningServerRow } from "./servers";

const scopes = [
  { value: "solution", label: "Root solution" },
  { value: "allProjects", label: "All projects" },
] as const;
interface NumericRowProps {
  field:
    | "maxRunningServers"
    | "idleMinutes"
    | "backgroundIdleMinutes"
    | "solutionMaxProbes"
    | "solutionIdleMinutes"
    | "dotnetMaxProcesses";
  label: string;
  value: number;
  choices: readonly number[];
  model: EditorSettingsForm;
}
const caps = [1, 2, 3, 4, 6, 8, 12, 16];
const durations = [1, 2, 5, 10, 15, 30, 60, 120];
function NumericRow({ field, label, value, choices, model }: NumericRowProps) {
  const options = useMemo(
    () =>
      [...new Set([...choices, value])]
        .sort((a, b) => a - b)
        .map((item) => ({ value: String(item), label: String(item) })),
    [choices, value],
  );
  const change = useCallback(
    (next: string) => model.edit({ [field]: Number(next) }),
    [field, model],
  );
  return (
    <SettingsSelect label={label} value={String(value)} options={options} onValueChange={change} />
  );
}
function CodeForm({ client }: { client: EditorClient }) {
  const [model] = useState(() => {
    const port: EditorSettingsPort = {
      read: () => client.call(readEditorSettings, { hostId: client.hostId }),
      save: (expectedRevision, patch) =>
        client.call(saveEditorSettings, { hostId: client.hostId, expectedRevision, patch }),
    };
    return new EditorSettingsForm(port);
  });
  useEffect(() => model.activate(), [model]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const servers = useFetchQuery({
    dataShape: "value",
    queryKey: ["otto-editor-servers", client.hostId],
    queryFn: () => client.call(listEditorServers, { hostId: client.hostId, root: null }),
    staleTimeMs: 5000,
    retry: false,
  });
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const reload = useCallback(async () => {
    if (
      state.dirty &&
      !(await confirmDialog({
        title: "Reload Code settings?",
        message: "Unsaved changes will be discarded.",
        confirmLabel: "Reload",
      }))
    )
      return;
    await model.reload();
  }, [state.dirty, model]);
  const toggle = useCallback((enabled: boolean) => model.edit({ enabled }), [model]);
  const solution = useCallback(
    (solutionEnabled: boolean) => model.edit({ solutionEnabled }),
    [model],
  );
  const scope = useCallback(
    (csharpProjectScope: EditorPreferences["csharpProjectScope"]) =>
      model.edit({ csharpProjectScope }),
    [model],
  );
  const refresh = useCallback(() => {
    void servers.refetch();
  }, [servers]);
  const draft = state.draft;
  if (!draft)
    return (
      <SettingsRow label={state.error ?? "Loading Code settings..."}>
        <Button onPress={reload} size="sm" variant="outline">
          Reload
        </Button>
      </SettingsRow>
    );
  return (
    <>
      <SettingsSection title="Code intelligence">
        {state.error ? <Alert variant="error">{state.error}</Alert> : null}
        <SettingsCard>
          <SettingsSwitch
            label="Enable code intelligence"
            value={draft.enabled}
            onValueChange={toggle}
          />
          <SettingsSelect
            label="C# project scope"
            value={draft.csharpProjectScope}
            options={scopes}
            onValueChange={scope}
          />
          <NumericRow
            field="maxRunningServers"
            label="Maximum language servers"
            value={draft.maxRunningServers}
            choices={caps}
            model={model}
          />
          <NumericRow
            field="idleMinutes"
            label="Active workspace idle timeout (minutes)"
            value={draft.idleMinutes}
            choices={durations}
            model={model}
          />
          <NumericRow
            field="backgroundIdleMinutes"
            label="Background workspace idle timeout (minutes)"
            value={draft.backgroundIdleMinutes}
            choices={durations}
            model={model}
          />
          <SettingsSwitch
            label="Microsoft .NET Solution Management"
            value={draft.solutionEnabled}
            onValueChange={solution}
          />
          <NumericRow
            field="solutionMaxProbes"
            label="Maximum solution processes"
            value={draft.solutionMaxProbes}
            choices={[1, 2, 3, 4, 6, 8]}
            model={model}
          />
          <NumericRow
            field="solutionIdleMinutes"
            label="Solution idle timeout (minutes)"
            value={draft.solutionIdleMinutes}
            choices={durations}
            model={model}
          />
          <NumericRow
            field="dotnetMaxProcesses"
            label="Shared .NET process limit"
            value={draft.dotnetMaxProcesses}
            choices={caps}
            model={model}
          />
          <SettingsRow label={state.dirty ? "Unsaved changes" : "Settings saved"}>
            <Button
              size="sm"
              variant="outline"
              onPress={reload}
              disabled={state.phase === "saving"}
            >
              Reload
            </Button>
            <Button
              size="sm"
              onPress={save}
              loading={state.phase === "saving"}
              disabled={state.phase !== "ready" || !state.dirty}
            >
              Save
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Language servers">
        {servers.error ? <Alert variant="error">{servers.error.message}</Alert> : null}
        <SettingsCard>
          <SettingsRow label="Available on this host">
            <Button size="sm" variant="outline" onPress={refresh} loading={servers.isFetching}>
              Refresh
            </Button>
          </SettingsRow>
          {servers.data?.available.map((row) => (
            <ServerRow key={row.id} row={row} model={model} preferences={draft} client={client} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Running language servers">
        <SettingsCard>
          {servers.data?.running.length ? (
            servers.data.running.map((row) => (
              <RunningServerRow
                key={`${row.root}:${row.serverId}`}
                row={row}
                client={client}
                onStopped={refresh}
              />
            ))
          ) : (
            <SettingsRow label="No language servers running" />
          )}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
export function OttoCodeSettings({ serverId }: { serverId: string }) {
  const connection = useEditorConnection(serverId);
  if (!connection.client)
    return (
      <SettingsRow
        label={
          connection.state === "disconnected"
            ? "Connect this host to manage Code settings"
            : "Update this host to use Otto Code intelligence"
        }
      />
    );
  return (
    <View testID="otto-code-settings">
      <CodeForm key={serverId} client={connection.client} />
    </View>
  );
}
