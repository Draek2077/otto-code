import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { providerSettings, type EndpointSettings } from "../shared/settings.js";
import { CredentialCard } from "./credentials.js";
import { LegacyProviderStatus } from "./legacy-status.js";
import { useConnectionDraft, type ReadySettings } from "./connection-state.js";

interface ConnectionFieldsProps {
  profile: EndpointSettings;
  state: ReturnType<typeof useConnectionDraft>;
  disabled: boolean;
}

function ConnectionFields({ profile, state, disabled }: ConnectionFieldsProps) {
  return (
    <SettingsCard>
      {profile.id !== "primary" && (
        <>
          <SettingsInput
            label="Endpoint name"
            initialValue={profile.label}
            onChangeText={state.editLabel}
            disabled={disabled}
          />
          <SettingsSwitch
            label="Available for new chats"
            hint="Disabling keeps this endpoint's settings and existing chats."
            value={profile.enabled !== false}
            onValueChange={state.editEnabled}
            disabled={disabled}
          />
        </>
      )}
      <SettingsInput
        label="API base URL"
        hint="Include the API prefix, for example http://localhost:1234/v1. Localhost refers to the agent host."
        initialValue={profile.baseUrl}
        onChangeText={state.editUrl}
        disabled={disabled}
      />
      <SettingsInput
        label="Model ID"
        hint="Leave empty to discover models from this endpoint."
        initialValue={profile.model}
        onChangeText={state.editModel}
        disabled={disabled}
      />
      <SettingsInput
        label="API key environment variable"
        hint="Optional alternative to a saved host key. Enter the variable name, not the key."
        initialValue={profile.apiKeyEnv}
        onChangeText={state.editKey}
        disabled={disabled}
      />
    </SettingsCard>
  );
}

function ReadyConnection({
  settings,
  theme,
  hostId,
}: {
  settings: ReadySettings;
  theme: PluginSurfaceProps["theme"];
  hostId: string;
}) {
  const state = useConnectionDraft(settings);
  const textStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const profile = useMemo(
    () =>
      state.profileId === "primary"
        ? {
            id: "primary",
            label: "Primary endpoint",
            baseUrl: state.values.baseUrl,
            model: state.values.model,
            apiKeyEnv: state.values.apiKeyEnv,
          }
        : state.values.endpoints?.find((item) => item.id === state.profileId),
    [state.profileId, state.values],
  );
  const options = useMemo(() => {
    const result = [
      { value: "primary", label: "Primary endpoint" },
      ...(state.values.endpoints ?? []).map((item) => ({
        value: item.id,
        label: item.enabled === false ? `${item.label} (disabled)` : item.label,
      })),
    ];
    if (!profile) result.push({ value: state.profileId, label: "Missing endpoint" });
    return result;
  }, [state.values.endpoints, state.profileId, profile]);
  return (
    <>
      <SettingsSection
        title="Connection"
        key={`${state.generation}:${state.draft?.revision ?? settings.revision}:${state.profileId}`}
      >
        <Text style={textStyle}>
          Configure endpoints on this host. Additional endpoints appear by name in the model picker
          for new chats. Existing chats stay on their original endpoint.
        </Text>
        <SettingsCard>
          <SettingsSelect
            label="Endpoint"
            value={state.profileId}
            options={options}
            onValueChange={state.setProfileId}
            disabled={settings.saving}
          />
        </SettingsCard>
        {profile ? (
          <ConnectionFields profile={profile} state={state} disabled={settings.saving} />
        ) : (
          <SettingsRow label="This endpoint no longer exists. Select another endpoint or restore its saved configuration." />
        )}
        <SettingsCard>
          <SettingsAction
            label="Connection settings"
            hint="The default mode asks before tools. Supports text, images, host file/shell tools and standard MCP transports."
            error={settings.saveError}
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={!state.draft || settings.saving}
            onPress={state.save}
          />
          <SettingsAction
            label="Discard unsaved connection edits"
            actionLabel="Discard"
            disabled={!state.draft || settings.saving}
            onPress={state.discard}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Add endpoint" key={`add:${state.generation}`}>
        <SettingsCard>
          <SettingsInput
            label="New endpoint name"
            onChangeText={state.setNewLabel}
            disabled={settings.saving}
          />
          <SettingsAction
            label="Create an endpoint draft"
            hint="Enter its connection details, then save. API keys are managed separately."
            actionLabel="Add endpoint"
            disabled={!state.newLabel.trim() || settings.saving}
            onPress={state.add}
          />
        </SettingsCard>
      </SettingsSection>
      <CredentialCard
        key={state.profileId}
        hostId={hostId}
        profileId={state.profileId}
        baseUrl={profile?.baseUrl ?? ""}
        settingsRevision={settings.revision}
        disabled={Boolean(state.draft) || settings.saving || !profile || profile.enabled === false}
      />
    </>
  );
}

export function ConnectionScreen({ theme, host }: PluginSurfaceProps) {
  const settings = useSettings(providerSettings);
  const reload = useCallback(() => void settings.reload(), [settings]);
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
  return (
    <>
      <ReadyConnection settings={settings} theme={theme} hostId={host.id} />
      <LegacyProviderStatus hostId={host.id} />
    </>
  );
}
