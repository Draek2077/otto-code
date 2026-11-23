import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { settingsRpc } from "@getpaseo/plugin";
import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { credentialRetire, credentialStatus } from "../shared/credentials.js";
import { providerSettings, type ConnectionSettings } from "../shared/settings.js";
import { type ReadySettings } from "./settings-state.js";
import {
  connectionProfiles,
  withoutConnection,
  type ConnectionProfile,
} from "./connection-form-model.js";
import { ConnectionForm } from "./connection-form.js";
import { LegacyProviderStatus } from "./legacy-status.js";

const rpc = settingsRpc("connection");
const rowActionsStyle = { flexDirection: "row", gap: 8 } as const;
const confirmationActionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
function newConnectionId() {
  return `connection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
interface Editor {
  id: string;
  snapshot: { revision: string; values: ConnectionSettings };
  profile?: ConnectionProfile;
}
function ConnectionRow({
  profile,
  settings,
  onEdit,
  onRemoved,
  disabled,
}: {
  profile: ConnectionProfile;
  settings: ReadySettings;
  onEdit(profile: ConnectionProfile): void;
  onRemoved(): void;
  disabled: boolean;
}) {
  const [pending, setPending] = useState<{
    profile: ConnectionProfile;
    revision: string;
    values: ConnectionSettings;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = useRpc(credentialStatus);
  const retire = useRpc(credentialRetire);
  const write = useRpc(rpc.write);
  const read = useRpc(rpc.read);
  const edit = useCallback(() => onEdit(profile), [onEdit, profile]);
  const confirm = useCallback(() => {
    setPending({ profile, revision: settings.revision, values: settings.values });
    setError("");
  }, [profile, settings]);
  const cancel = useCallback(() => setPending(null), []);
  const remove = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError("");
    let disconnected = false;
    try {
      const target = {
        profileId: pending.profile.id,
        baseUrl: pending.profile.baseUrl,
        settingsRevision: pending.revision,
      };
      const current = await status(target);
      await retire({ ...target, revision: current.revision });
      disconnected = true;
      const result = await write({
        revision: pending.revision,
        values: withoutConnection(pending.values, pending.profile.id),
      });
      if (result.status !== "saved") throw new Error(result.error);
      onRemoved();
    } catch (failure) {
      setError(
        `${disconnected ? "Connection disconnected and key removed; list update failed. " : ""}${failure instanceof Error ? failure.message : "Could not remove this connection."}`,
      );
    } finally {
      setBusy(false);
    }
  }, [onRemoved, pending, retire, status, write]);
  const review = useCallback(async () => {
    try {
      const latest = await read({});
      if (latest.status !== "ready") throw new Error(latest.error);
      const values = providerSettings.schema.parse(latest.values);
      const current = connectionProfiles(values).find((entry) => entry.id === profile.id);
      if (!current) {
        onRemoved();
        return;
      }
      setPending({ profile: current, revision: latest.revision, values });
      setError("Latest host values loaded. Review the connection before removing it.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reload connection.");
    }
  }, [onRemoved, profile.id, read]);
  return (
    <>
      <SettingsRow
        testID={`otto-connection-${profile.id}`}
        label={profile.label}
        hint={`${profile.baseUrl}${profile.enabled ? "" : " · Disabled for new chats"}`}
      >
        <View style={rowActionsStyle}>
          <SettingsButton size="sm" variant="outline" onPress={edit} disabled={busy || disabled}>
            Edit
          </SettingsButton>
          <SettingsButton size="sm" variant="outline" onPress={confirm} disabled={busy || disabled}>
            Remove
          </SettingsButton>
        </View>
      </SettingsRow>
      {pending && (
        <SettingsRow
          label={`Remove ${pending.profile.label}?`}
          hint="Disconnect this connection and remove its saved key. Chat history will be kept."
          error={error}
        >
          <View style={confirmationActionsStyle}>
            <SettingsButton size="sm" variant="outline" onPress={cancel} disabled={busy}>
              Cancel
            </SettingsButton>
            {error && (
              <SettingsButton size="sm" variant="outline" onPress={review} disabled={busy}>
                Review latest
              </SettingsButton>
            )}
            <SettingsButton size="sm" variant="destructive" onPress={remove} disabled={busy}>
              {busy ? "Removing..." : "Remove connection"}
            </SettingsButton>
          </View>
        </SettingsRow>
      )}
    </>
  );
}
export function Connections({
  settings,
  host,
}: {
  settings: ReadySettings;
  host: PluginSurfaceProps["host"];
}) {
  const profiles = useMemo(() => connectionProfiles(settings.values), [settings.values]);
  const [editor, setEditor] = useState<Editor | null>(() =>
    profiles.length ? null : { id: newConnectionId(), snapshot: settings },
  );
  const [notice, setNotice] = useState("");
  const paseo = usePaseo();
  const refresh = useCallback(async () => {
    try {
      await settings.reload();
      await paseo.providers.refresh({ providers: ["openai-compatible"] });
    } catch {
      setNotice(
        "Connection updated. Model refresh failed; use Refresh in the provider model list to try again.",
      );
    }
  }, [paseo, settings]);
  const saved = useCallback(() => {
    setEditor(null);
    setNotice("Connection saved.");
    void refresh();
  }, [refresh]);
  const removed = useCallback(() => {
    setNotice("Connection removed. Chat history was kept.");
    void refresh();
  }, [refresh]);
  const add = useCallback(() => {
    setNotice("");
    setEditor({ id: newConnectionId(), snapshot: settings });
  }, [settings]);
  const edit = useCallback(
    (profile: ConnectionProfile) => {
      setNotice("");
      setEditor({ id: profile.id, profile, snapshot: settings });
    },
    [settings],
  );
  const cancel = useCallback(() => setEditor(null), []);
  const addButton = useMemo(
    () =>
      !editor ? (
        <SettingsButton size="sm" onPress={add}>
          Add connection
        </SettingsButton>
      ) : undefined,
    [add, editor],
  );
  return (
    <>
      {editor && (
        <ConnectionForm
          key={editor.id}
          snapshot={editor.snapshot}
          profile={editor.profile}
          newId={editor.id}
          hostId={host.id}
          onSaved={saved}
          onCancel={cancel}
        />
      )}
      {(profiles.length > 0 || !editor) && (
        <SettingsSection title="Connections" trailing={addButton}>
          {notice && (
            <SettingsCard>
              <SettingsRow label={notice} />
            </SettingsCard>
          )}
          {profiles.length ? (
            <SettingsCard>
              {profiles.map((profile) => (
                <ConnectionRow
                  key={profile.id}
                  profile={profile}
                  settings={settings}
                  onEdit={edit}
                  onRemoved={removed}
                  disabled={Boolean(editor)}
                />
              ))}
            </SettingsCard>
          ) : (
            !editor && (
              <SettingsCard>
                <SettingsRow label="No connections yet." />
              </SettingsCard>
            )
          )}
        </SettingsSection>
      )}
      <LegacyProviderStatus hostId={host.id} />
    </>
  );
}
