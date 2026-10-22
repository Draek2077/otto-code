import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import {
  useSettings,
  type PluginClientContext,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { providerSettings, type ConnectionSettings } from "./shared/settings.js";

function ConnectionScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(providerSettings);
  const [draft, setDraft] = useState<{ values: ConnectionSettings; revision: string } | null>(null);
  const [generation, setGeneration] = useState(0);
  const edit = useCallback(
    (field: "baseUrl" | "model" | "apiKeyEnv", value: string) => {
      if (settings.status !== "ready") return;
      setDraft((previous) => ({
        revision: previous?.revision ?? settings.revision,
        values: { ...(previous?.values ?? settings.values), [field]: value },
      }));
    },
    [settings],
  );
  const discard = useCallback(() => {
    setDraft(null);
    setGeneration((value) => value + 1);
  }, []);
  const reload = useCallback(() => void settings.reload(), [settings]);
  const editUrl = useCallback((value: string) => edit("baseUrl", value), [edit]);
  const editModel = useCallback((value: string) => edit("model", value), [edit]);
  const editKey = useCallback((value: string) => edit("apiKeyEnv", value), [edit]);
  const save = useCallback(async () => {
    if (draft && (await settings.save(draft.values, draft.revision))) discard();
  }, [draft, settings, discard]);
  const textStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  if (settings.status !== "ready")
    return (
      <SettingsSection title="Otto OpenAI-compatible">
        <SettingsCard>
          <SettingsRow
            label={settings.status === "loading" ? "Loading host settings…" : settings.error}
          />
          <SettingsAction label="Read host settings again" actionLabel="Reload" onPress={reload} />
        </SettingsCard>
      </SettingsSection>
    );
  const values = draft?.values ?? settings.values;
  return (
    <SettingsSection
      title="Connection"
      key={`${generation}:${draft?.revision ?? settings.revision}`}
    >
      <Text style={textStyle}>
        Configure one endpoint on this host. New sessions use these settings. Existing Otto provider
        data is preserved; importing older sessions is a later step.
      </Text>
      <SettingsCard>
        <SettingsInput
          label="API base URL"
          hint="Include the API prefix, for example http://localhost:1234/v1. Localhost refers to the agent host."
          initialValue={values.baseUrl}
          onChangeText={editUrl}
          disabled={settings.saving}
        />
        <SettingsInput
          label="Model ID"
          hint="Leave empty to discover models from the endpoint."
          initialValue={values.model}
          onChangeText={editModel}
          disabled={settings.saving}
        />
        <SettingsInput
          label="API key environment variable"
          hint="Name of a variable set on the daemon host, not the API key itself. Restart only that host after changing its environment."
          initialValue={values.apiKeyEnv}
          onChangeText={editKey}
          disabled={settings.saving}
        />
        <SettingsAction
          label="Connection settings"
          hint="Tools ask for approval. This first slice supports text, file read/write, shell commands and Streamable HTTP MCP."
          error={settings.saveError ?? undefined}
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={!draft || settings.saving}
          onPress={save}
        />
        <SettingsAction
          label="Discard unsaved edits"
          actionLabel="Discard"
          disabled={!draft || settings.saving}
          onPress={discard}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "connection",
    title: "Otto OpenAI-compatible",
    icon: "Cable",
    Component: ConnectionScreen,
  });
}
