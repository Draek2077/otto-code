import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  readBitbucketConnections,
  writeBitbucketConnections,
  type BitbucketConnections,
} from "@getpaseo/plugin/otto/bitbucket-connections";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsInput,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openBitbucketConnectionForm, type BitbucketConnectionForm } from "./connection-form";
import { BitbucketRepositories } from "./repositories";

function AccountRow({
  account,
  model,
}: {
  account: BitbucketConnections["connections"][number];
  model: BitbucketConnectionForm;
}) {
  const edit = useCallback(() => model.begin(account.id), [model, account.id]);
  const remove = useCallback(() => model.confirmRemove(account.id), [model, account.id]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  return (
    <SettingsRow label={account.label} hint={account.email ?? account.account}>
      <Button variant="outline" size="sm" disabled={state.busy || state.blocked} onPress={edit}>
        Edit
      </Button>
      <Button variant="outline" size="sm" disabled={state.busy || state.blocked} onPress={remove}>
        Remove
      </Button>
    </SettingsRow>
  );
}
function Editor({ model }: { model: BitbucketConnectionForm }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const label = useCallback((value: string) => model.edit({ label: value }), [model]);
  const email = useCallback((value: string) => model.edit({ email: value }), [model]);
  const replacement = useCallback((value: string) => model.edit({ replacement: value }), [model]);
  const replace = useCallback((value: boolean) => model.edit({ replace: value }), [model]);
  const select = useCallback((value: boolean) => model.edit({ select: value }), [model]);
  return (
    <SettingsCard>
      <SettingsInput
        label="Connection name"
        initialValue={state.draft.label}
        onChangeText={label}
        disabled={state.busy}
      />
      <SettingsInput
        label="Atlassian email"
        initialValue={state.draft.email}
        onChangeText={email}
        disabled={state.busy}
      />
      {state.draft.id ? (
        <SettingsSwitch
          label="Replace API token"
          value={state.draft.replace}
          onValueChange={replace}
          disabled={state.busy}
        />
      ) : null}
      {state.draft.replace ? (
        <SettingsInput
          label="API token"
          initialValue=""
          onChangeText={replacement}
          secureTextEntry
          disabled={state.busy}
        />
      ) : null}
      <SettingsSwitch
        label={state.origin.projectId ? "Use for this project" : "Use as host default"}
        value={state.draft.select}
        onValueChange={select}
        disabled={state.busy}
      />
      <SettingsRow label="Connection">
        <Button variant="outline" onPress={model.cancel} disabled={state.busy}>
          Cancel
        </Button>
        <Button onPress={model.save} disabled={state.busy || state.blocked}>
          {state.busy ? "Saving…" : "Save connection"}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
function ConnectionForm({
  hostId,
  initial,
  active,
}: {
  hostId: string;
  initial: BitbucketConnections;
  active: boolean;
}) {
  const read = useRpc(readBitbucketConnections),
    write = useRpc(writeBitbucketConnections);
  const [model] = useState(() =>
    openBitbucketConnectionForm(hostId, initial, write, async () => {
      const result = await read({
        hostId,
        ...(initial.projectId ? { projectId: initial.projectId } : {}),
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.setActive(active);
  }, [model, active]);
  useEffect(() => () => model.close(), [model]);
  const add = useCallback(() => model.begin(), [model]);
  const choose = useCallback((value: string) => model.choose(value), [model]);
  const reload = useCallback(
    () =>
      model.reload(() =>
        confirmDialog({
          title: "Reload Git connections?",
          message: "Discard local connection edits and load the host's saved settings?",
          confirmLabel: "Discard and reload",
        }),
      ),
    [model],
  );
  const options = useMemo(() => {
    const values = [
      { value: "", label: initial.projectId ? "Use host default" : "Use shared Atlassian account" },
      ...state.origin.connections.map((connection) => ({
        value: connection.id,
        label: connection.label,
      })),
    ];
    if (state.selection && !values.some((value) => value.value === state.selection))
      values.push({ value: state.selection, label: "Unavailable saved connection" });
    return values;
  }, [initial.projectId, state.origin.connections, state.selection]);
  return (
    <>
      <SettingsSection
        title="Bitbucket connections"
        info="API accounts stay on this host. Git continues to use its own SSH keys and credential helper."
      >
        {state.error ? <Alert variant="error" description={state.error} /> : null}
        {state.message ? <Alert variant="info" description={state.message} /> : null}
        <SettingsCard>
          <SettingsSelect
            label={initial.projectId ? "Project connection" : "Default connection"}
            value={state.selection}
            options={options}
            onValueChange={choose}
            disabled={state.busy || state.blocked}
          />
          <SettingsRow label="Selection">
            <Button
              variant="outline"
              onPress={model.saveSelection}
              disabled={state.busy || state.blocked}
            >
              Save selection
            </Button>
          </SettingsRow>
          {state.origin.connections.map((account) => (
            <AccountRow key={account.id} account={account} model={model} />
          ))}
          <SettingsRow label="Accounts">
            <Button variant="outline" onPress={add} disabled={state.busy || state.blocked}>
              Add connection
            </Button>
            <Button variant="outline" onPress={reload} disabled={state.busy}>
              Reload
            </Button>
          </SettingsRow>
        </SettingsCard>
        {state.editing ? <Editor key={state.generation} model={model} /> : null}
        {state.removeId ? (
          <SettingsCard>
            <SettingsRow
              label="Remove this connection?"
              hint="Projects using it remain disconnected until you explicitly choose an account."
            >
              <Button variant="outline" onPress={model.cancel} disabled={state.busy}>
                Keep connection
              </Button>
              <Button
                variant="destructive"
                onPress={model.remove}
                disabled={state.busy || state.blocked}
              >
                Remove connection
              </Button>
            </SettingsRow>
          </SettingsCard>
        ) : null}
      </SettingsSection>
      <BitbucketRepositories
        hostId={hostId}
        projectId={initial.projectId ?? undefined}
        revision={state.origin.revision}
        active={active}
      />
    </>
  );
}
export function BitbucketConnectionSettings({
  hostId,
  projectId,
  active,
}: {
  hostId: string;
  projectId?: string;
  active: boolean;
}) {
  const read = useRpc(readBitbucketConnections);
  const [loaded, setLoaded] = useState<BitbucketConnections | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!active || loaded) return;
    let current = true;
    void read({ hostId, ...(projectId ? { projectId } : {}) })
      .then((result) => {
        if (current) {
          if (result.ok) setLoaded(result.value);
          else setError(result.error.message);
        }
        return null;
      })
      .catch(() => {
        if (current) setError("The host could not read Bitbucket connections.");
      });
    return () => {
      current = false;
    };
  }, [hostId, projectId, read, loaded, active, attempt]);
  if (loaded) return <ConnectionForm hostId={hostId} initial={loaded} active={active} />;
  return (
    <SettingsCard>
      <SettingsRow label={error || "Loading Bitbucket connections…"} error={error || null} />
      {error ? (
        <Button variant="outline" onPress={retry}>
          Retry
        </Button>
      ) : null}
    </SettingsCard>
  );
}
export function BitbucketHostSettings(props: PluginSurfaceProps) {
  return (
    <View>
      <BitbucketConnectionSettings
        key={props.host.id}
        hostId={props.host.id}
        active={props.active !== false}
      />
    </View>
  );
}
