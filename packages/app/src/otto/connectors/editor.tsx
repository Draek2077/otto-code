import { useCallback, useSyncExternalStore } from "react";
import { Linking, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CONNECTOR_CATALOG } from "@getpaseo/plugin/otto/connectors";
import {
  SettingsCard,
  SettingsRow,
  SettingsInput,
  SettingsSelect,
  SettingsSwitch,
  SettingsCollapsibleRow,
} from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import type { ConnectorForm, ConnectorDraft } from "./form-model";

type TextField =
  | "label"
  | "credential"
  | "roots"
  | "url"
  | "command"
  | "args"
  | "environment"
  | "headers"
  | "scope"
  | "clientId"
  | "clientSecret";
function DraftInput({
  model,
  field,
  label,
  secret = false,
  multiline = false,
  hint,
}: {
  model: ConnectorForm;
  field: TextField;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  hint?: string;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback((value: string) => model.edit({ [field]: value }), [model, field]);
  if (!state.draft) return null;
  if (multiline)
    return (
      <SettingsRow label={label} hint={hint}>
        <FormTextInput
          initialValue={state.draft[field]}
          onChangeText={change}
          multiline
          editable={!state.busy}
          accessibilityLabel={label}
          style={styles.multiline}
        />
      </SettingsRow>
    );
  return (
    <SettingsInput
      label={label}
      hint={hint}
      initialValue={state.draft[field]}
      onChangeText={change}
      secureTextEntry={secret}
      disabled={state.busy}
    />
  );
}
const transportOptions = [
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
  { value: "stdio", label: "Local command" },
];
function CustomFields({ model }: { model: ConnectorForm }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const transport = useCallback((type: ConnectorDraft["type"]) => model.edit({ type }), [model]);
  const oauth = useCallback((value: boolean) => model.edit({ oauth: value }), [model]);
  if (!state.draft) return null;
  return (
    <>
      <SettingsSelect
        label="Connection type"
        value={state.draft.type}
        options={transportOptions}
        onValueChange={transport}
        disabled={state.busy}
      />
      {state.draft.type === "stdio" ? (
        <>
          <DraftInput
            model={model}
            field="command"
            label="Command"
            hint="Runs on the selected host with the chat's working directory."
          />
          <DraftInput
            model={model}
            field="args"
            label="Arguments"
            hint={'JSON list, for example ["-y", "@vendor/mcp-server"].'}
            multiline
          />
          <DraftInput
            model={model}
            field="environment"
            label="Environment variables"
            hint="Write-only JSON object. Replace the full configuration to change saved values."
            secret
          />
        </>
      ) : (
        <>
          <DraftInput model={model} field="url" label="Server URL" />
          <SettingsSwitch
            label="Browser sign-in"
            value={state.draft.oauth}
            onValueChange={oauth}
            disabled={state.busy}
          />
          <SettingsCollapsibleRow label="Advanced connection options">
            <DraftInput
              model={model}
              field="headers"
              label="Headers"
              hint="Write-only JSON object. Authorization headers cannot be combined with browser sign-in."
              secret
            />
            <DraftInput model={model} field="scope" label="Requested scopes" />
            <DraftInput
              model={model}
              field="clientId"
              label="OAuth client ID"
              hint="Leave blank for the server's supported registration flow."
            />
            <DraftInput model={model} field="clientSecret" label="OAuth client secret" secret />
          </SettingsCollapsibleRow>
        </>
      )}
    </>
  );
}
function CatalogFields({ model, catalogId }: { model: ConnectorForm; catalogId: string }) {
  const entry = CONNECTOR_CATALOG.find((row) => row.id === catalogId);
  const open = useCallback(() => {
    if (entry?.setup.kind === "token") void Linking.openURL(entry.setup.credential.issueUrl);
    else if (entry?.setup.kind === "oauth" && entry.setup.registration)
      void Linking.openURL(entry.setup.registration.instructionsUrl);
  }, [entry]);
  if (!entry) return <SettingsRow label="Choose a current catalog connection." />;
  return (
    <>
      <SettingsRow label={entry.label} hint={entry.description} />
      {entry.setup.kind === "token" ? (
        <>
          <DraftInput
            model={model}
            field="credential"
            label={entry.setup.credential.label}
            secret
          />
          <SettingsRow label="Get a credential">
            <Button variant="outline" size="sm" onPress={open}>
              Open provider instructions
            </Button>
          </SettingsRow>
        </>
      ) : null}
      {entry.setup.kind === "oauth" && entry.setup.registration ? (
        <>
          <SettingsRow
            label="Register an MCP app"
            hint={`This provider requires your own app registration. Add this redirect URL in its developer console: ${entry.setup.registration.redirectUri}`}
          >
            <Button variant="outline" size="sm" onPress={open}>
              Open provider instructions
            </Button>
          </SettingsRow>
          <DraftInput model={model} field="clientId" label="OAuth client ID" />
          <DraftInput model={model} field="clientSecret" label="OAuth client secret" secret />
        </>
      ) : null}
      {entry.id === "filesystem" ? (
        <DraftInput
          model={model}
          field="roots"
          label="Allowed host folders"
          hint="One absolute folder on the selected host per line."
          multiline
        />
      ) : null}
    </>
  );
}
export function ConnectorEditor({ model }: { model: ConnectorForm }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const replace = useCallback((value: boolean) => model.edit({ replace: value }), [model]);
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const discard = useCallback(() => {
    void model.discard();
  }, [model]);
  if (!state.draft) return null;
  return (
    <SettingsCard>
      <DraftInput model={model} field="label" label="Connection name" />
      {state.draft.id ? (
        <SettingsSwitch
          label="Replace connection configuration"
          hint="Saved headers, environment values and credentials are never displayed. A replacement disconnects the previous sign-in."
          value={state.draft.replace}
          onValueChange={replace}
          disabled={state.busy}
        />
      ) : null}
      {state.draft.replace ? (
        <View>
          {state.draft.catalogId ? (
            <CatalogFields model={model} catalogId={state.draft.catalogId} />
          ) : (
            <CustomFields model={model} />
          )}
        </View>
      ) : null}
      <SettingsRow
        label="Save connection"
        hint="Adding a local-command connector authorizes the host to start it and discover its tools. Only add servers you trust."
      >
        <Button variant="outline" size="sm" onPress={discard} disabled={state.busy}>
          Discard
        </Button>
        <Button size="sm" onPress={save} disabled={state.busy || state.blocked}>
          {state.busy ? "Saving…" : "Save connection"}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
const styles = StyleSheet.create(() => ({
  multiline: { minWidth: 180, maxWidth: "100%", minHeight: 80 },
}));
