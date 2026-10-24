import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsInput,
  SettingsSwitch,
  SettingsSelect,
  SettingsButton,
  SettingsExpander,
} from "@getpaseo/plugin/client/ui";
import {
  readAtlassianAccount,
  saveAtlassianAccount,
  type AtlassianAccountSnapshot,
} from "@getpaseo/plugin/otto/atlassian-settings";
import { openAtlassianForm } from "./form.js";

const actions = { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 } as const;
const intents = [
  { value: "keep", label: "Keep saved token" },
  { value: "replace", label: "Replace token" },
  { value: "remove", label: "Remove token" },
] as const;
function AccountForm({ hostId, initial }: { hostId: string; initial: AtlassianAccountSnapshot }) {
  const write = useRpc(saveAtlassianAccount);
  const read = useRpc(readAtlassianAccount);
  const [model] = useState(() => openAtlassianForm(hostId, initial, write));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => () => model.close(), [model]);
  const email = useCallback((value: string) => model.edit({ email: value }), [model]);
  const site = useCallback((value: string) => model.edit({ siteUrl: value }), [model]);
  const scoped = useCallback((value: boolean) => model.edit({ scoped: value }), [model]);
  const cloud = useCallback((value: string) => model.edit({ cloudId: value }), [model]);
  const replacement = useCallback((value: string) => model.edit({ replacement: value }), [model]);
  const intent = useCallback(
    (value: "keep" | "replace" | "remove") => model.edit({ intent: value }),
    [model],
  );
  const save = useCallback(() => model.save(), [model]);
  const requestReload = useCallback(() => setConfirmReload(true), []);
  const keep = useCallback(() => setConfirmReload(false), []);
  const reload = useCallback(async () => {
    setConfirmReload(false);
    await model.reload(() => read({ hostId }));
  }, [model, read, hostId]);
  return (
    <SettingsSection
      title="Atlassian account"
      info="This host shares one account between Jira and Bitbucket. Credentials stay in its operating system keyring."
    >
      <SettingsCard>
        <SettingsRow
          label={
            state.origin.credential.stored ? "API token configured" : "No API token configured"
          }
          hint="Existing tokens are never returned to the app."
        />
        <SettingsInput
          key={`email/${state.generation}`}
          label="Account email"
          initialValue={state.draft.email}
          onChangeText={email}
          disabled={state.blocked}
        />
        <SettingsInput
          key={`site/${state.generation}`}
          label="Jira site"
          initialValue={state.draft.siteUrl}
          onChangeText={site}
          placeholder="example.atlassian.net"
          disabled={state.blocked}
        />
        <SettingsSelect
          label="API token"
          value={state.draft.intent}
          options={intents}
          onValueChange={intent}
          disabled={state.blocked}
        />
        {state.draft.intent === "replace" ? (
          <SettingsInput
            key={`token/${state.generation}`}
            label="New API token"
            initialValue={state.draft.replacement}
            onChangeText={replacement}
            secureTextEntry
            disabled={state.blocked}
          />
        ) : null}
        {state.draft.intent === "remove" ? (
          <SettingsRow label="Saving disconnects the shared account for Jira and Bitbucket on this host." />
        ) : null}
        <SettingsExpander label="Advanced">
          <SettingsSwitch
            label="Scoped API token"
            value={state.draft.scoped}
            onValueChange={scoped}
            disabled={state.blocked}
            hint="Scoped tokens use Atlassian's API gateway and require this site's cloud ID."
          />
          {state.draft.scoped ? (
            <SettingsInput
              key={`cloud/${state.generation}`}
              label="Cloud ID"
              initialValue={state.draft.cloudId}
              onChangeText={cloud}
              disabled={state.blocked}
            />
          ) : null}
        </SettingsExpander>
        {state.error ? (
          <SettingsRow label="Account settings were not confirmed" error={state.error} />
        ) : null}
        {state.saved ? <SettingsRow label="Atlassian account saved" /> : null}
      </SettingsCard>
      <View style={actions}>
        <SettingsButton onPress={save} disabled={state.busy || state.blocked || !state.dirty}>
          {state.busy ? "Saving..." : "Save account"}
        </SettingsButton>
        <SettingsButton onPress={requestReload} variant="outline" disabled={state.busy}>
          Reload saved account
        </SettingsButton>
      </View>
      {confirmReload ? (
        <SettingsCard>
          <SettingsRow label="Discard local account edits and reload?" />
          <SettingsButton onPress={keep}>Keep editing</SettingsButton>
          <SettingsButton onPress={reload} variant="outline">
            Discard and reload account
          </SettingsButton>
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
export function AtlassianSettings(props: PluginSurfaceProps) {
  const read = useRpc(readAtlassianAccount);
  const [state, setState] = useState<{ value: AtlassianAccountSnapshot | null; error: string }>({
    value: null,
    error: "",
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setState({ value: null, error: "" });
    void read({ hostId: props.host.id })
      .then((result) => {
        if (active)
          setState(
            result.ok
              ? { value: result.value, error: "" }
              : { value: null, error: result.error.message },
          );
        return null;
      })
      .catch(() => {
        if (active)
          setState({
            value: null,
            error: "Shared integration settings could not be read from this host.",
          });
      });
    return () => {
      active = false;
    };
  }, [read, props.host.id, attempt]);
  if (state.value)
    return <AccountForm key={props.host.id} hostId={props.host.id} initial={state.value} />;
  return (
    <SettingsCard>
      <SettingsRow
        label={
          state.error ? "Atlassian account unavailable" : "Loading shared Atlassian account..."
        }
        error={state.error || null}
      />
      {state.error ? <SettingsButton onPress={retry}>Retry</SettingsButton> : null}
    </SettingsCard>
  );
}
