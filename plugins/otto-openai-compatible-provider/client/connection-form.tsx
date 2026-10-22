import { useCallback, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { settingsRpc } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsButton,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import { credentialSave, credentialStatus } from "../shared/credentials.js";
import { providerSettings, type ConnectionSettings } from "../shared/settings.js";
import {
  connectionProfiles,
  openConnectionForm,
  type ConnectionProfile,
} from "./connection-form-model.js";
import { ConnectionAdvanced } from "./connection-advanced.js";
import { connectionError } from "./connection-error.js";

const actionStyle = {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
} as const;
function credentialHint(urlChanged: boolean, source?: string) {
  if (urlChanged)
    return "Enter a key for the new URL, or leave empty for a server without authentication.";
  if (source && source !== "none") return "A host key is configured. Leave empty to keep it.";
  return "Optional for servers that do not require a key.";
}

const rpc = settingsRpc("connection");
export function ConnectionForm({
  snapshot,
  profile,
  newId,
  hostId,
  onSaved,
  onCancel,
}: {
  snapshot: { revision: string; values: ConnectionSettings };
  profile?: ConnectionProfile;
  newId: string;
  hostId: string;
  onSaved(): void;
  onCancel(): void;
}) {
  const [form] = useState(() => openConnectionForm({ ...snapshot, profile, newId }));
  const state = useSyncExternalStore(form.subscribe, form.getState);
  const read = useRpc(rpc.read);
  const write = useRpc(rpc.write);
  const readKey = useRpc(credentialStatus);
  const writeKey = useRpc(credentialSave);
  const keyStatus = useQuery({
    queryKey: ["otto-connection-form-key", hostId, form.id, snapshot.revision],
    queryFn: () =>
      readKey({
        profileId: form.id,
        baseUrl: form.originalUrl,
        settingsRevision: snapshot.revision,
      }),
    enabled: form.existing,
    retry: false,
  });
  const focusUrl = useCallback((input: SettingsInputHandle | null) => input?.focus(), []);
  const urlChanged = form.existing && state.baseUrl.trim() !== form.originalUrl;
  const keyHint = credentialHint(urlChanged, keyStatus.data?.source);
  const save = useCallback(async () => {
    form.edit("busy", true);
    form.edit("error", "");
    let settingsSaved = false;
    try {
      const values = form.values();
      const result = await write({ revision: form.getState().settingsRevision, values });
      if (result.status !== "saved") throw new Error(result.error);
      form.committed(result.revision, providerSettings.schema.parse(result.values));
      settingsSaved = true;
      const draft = form.getState();
      if (draft.key.trim() || draft.removeKey || urlChanged) {
        const target = {
          profileId: form.id,
          baseUrl: draft.baseUrl.trim(),
          settingsRevision: result.revision,
        };
        const expected =
          draft.keyRevision ?? keyStatus.data?.revision ?? (await readKey(target)).revision;
        form.edit("keyRevision", expected);
        await writeKey({ ...target, revision: expected, key: draft.key.trim() || null });
      }
      form.edit("key", "");
      onSaved();
    } catch (error) {
      const message = connectionError(error);
      form.edit(
        "error",
        `${settingsSaved ? "Connection saved; the API key was not saved. " : ""}${message}`,
      );
    } finally {
      form.edit("busy", false);
    }
  }, [form, keyStatus.data, onSaved, readKey, urlChanged, write, writeKey]);
  const reviewLatest = useCallback(async () => {
    form.edit("busy", true);
    try {
      const latest = await read({});
      if (latest.status !== "ready") throw new Error(latest.error);
      const values = providerSettings.schema.parse(latest.values);
      const current = connectionProfiles(values).find((entry) => entry.id === form.id);
      if (form.existing && !current)
        throw new Error(
          "This connection was removed on another client. Cancel and add a new connection.",
        );
      const credential = current
        ? await readKey({
            profileId: form.id,
            baseUrl: current.baseUrl,
            settingsRevision: latest.revision,
          })
        : undefined;
      form.rebase(latest.revision, values);
      form.edit("keyRevision", credential?.revision);
      form.edit(
        "error",
        "Latest host values loaded. Your draft is retained; review it before saving again.",
      );
    } catch (error) {
      form.edit("error", error instanceof Error ? error.message : "Could not reload host values.");
    } finally {
      form.edit("busy", false);
    }
  }, [form, read, readKey]);
  const editUrl = useCallback((value: string) => form.edit("baseUrl", value), [form]);
  const editKey = useCallback((value: string) => form.edit("key", value), [form]);
  const retired = keyStatus.data?.retired === true;
  const feedback = retired
    ? "This connection was removed. Remove it from the list, then add a new connection."
    : state.error || (state.keyRevision === undefined ? keyStatus.error?.message : undefined);
  const saveDisabled =
    state.busy ||
    retired ||
    !state.baseUrl.trim() ||
    (form.existing && !keyStatus.data && state.keyRevision === undefined);
  return (
    <SettingsSection title={form.existing ? "Edit connection" : "Add connection"}>
      <SettingsCard>
        <SettingsInput
          ref={focusUrl}
          label="API URL"
          placeholder="https://openrouter.ai/api/v1"
          initialValue={state.baseUrl}
          onChangeText={editUrl}
          disabled={state.busy}
        />
        <SettingsInput
          label="API key"
          hint={keyHint}
          secureTextEntry
          onChangeText={editKey}
          disabled={state.busy}
        />
        <ConnectionAdvanced
          form={form}
          canRemoveKey={Boolean(keyStatus.data?.configured || keyStatus.data?.endpointChanged)}
        />
      </SettingsCard>
      {feedback && (
        <SettingsCard>
          <SettingsRow label="Review connection" error={feedback}>
            <SettingsButton
              size="sm"
              variant="outline"
              onPress={reviewLatest}
              disabled={state.busy}
            >
              Review latest
            </SettingsButton>
          </SettingsRow>
        </SettingsCard>
      )}
      <View style={actionStyle}>
        <SettingsButton size="sm" variant="outline" onPress={onCancel} disabled={state.busy}>
          Cancel
        </SettingsButton>
        <SettingsButton size="sm" onPress={save} disabled={saveDisabled}>
          {state.busy ? "Saving..." : "Save connection"}
        </SettingsButton>
      </View>
    </SettingsSection>
  );
}
