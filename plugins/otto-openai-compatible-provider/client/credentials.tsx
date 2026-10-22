import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import { credentialSave, credentialStatus } from "../shared/credentials.js";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";

type CredentialTarget = RpcInput<typeof credentialStatus>;
interface KeyDraft {
  key: string;
  target: CredentialTarget;
}
const sourceLabels = {
  none: "No saved API key. Unkeyed local endpoints can work without one.",
  managed: "Using the key stored privately on this host.",
  environment: "Using the configured daemon environment variable.",
  legacy: "Using the key from preserved Otto settings.",
};
function statusLabel(
  data: RpcOutput<typeof credentialStatus> | undefined,
  disabled: boolean,
): string {
  if (disabled)
    return "Save the connection settings and enable this endpoint before managing its key.";
  if (data?.endpointChanged)
    return "The saved key belongs to the previous endpoint. Replace or remove it to continue.";
  return sourceLabels[data?.source ?? "none"];
}
function targetChanged(draft: KeyDraft | null, target: CredentialTarget): boolean {
  if (!draft) return false;
  return (
    draft.target.profileId !== target.profileId ||
    draft.target.baseUrl !== target.baseUrl ||
    draft.target.settingsRevision !== target.settingsRevision
  );
}
function hasStoredKey(data: RpcOutput<typeof credentialStatus> | undefined): boolean {
  return Boolean(data?.configured || data?.endpointChanged);
}

interface CredentialCardProps {
  hostId: string;
  profileId: string;
  baseUrl: string;
  settingsRevision: string;
  disabled: boolean;
}

export function CredentialCard({
  hostId,
  profileId,
  baseUrl,
  settingsRevision,
  disabled,
}: CredentialCardProps) {
  const readStatus = useRpc(credentialStatus);
  const saveCredential = useRpc(credentialSave);
  const queryClient = useQueryClient();
  const input = useRef<SettingsInputHandle>(null);
  const target = { profileId, baseUrl, settingsRevision };
  const queryKey = ["otto-provider-credentials", hostId, profileId, baseUrl, settingsRevision];
  const status = useQuery({
    queryKey,
    queryFn: () => readStatus(target),
    enabled: !disabled && Boolean(baseUrl),
    retry: false,
  });
  const [draft, setDraft] = useState<KeyDraft | null>(null);
  const changed = targetChanged(draft, target);
  const changeKey = useCallback(
    (key: string) => {
      setDraft((previous) =>
        key ? { key, target: previous?.target ?? { profileId, baseUrl, settingsRevision } } : null,
      );
    },
    [profileId, baseUrl, settingsRevision],
  );
  const discard = useCallback(() => {
    setDraft(null);
    input.current?.replaceText("");
  }, []);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (key: string | null) => {
      if (!status.data || changed)
        throw new Error("Reload the key status and review the current endpoint before saving.");
      return saveCredential({ ...target, revision: status.data.revision, key });
    },
    onSuccess: (value, key) => {
      queryClient.setQueryData(queryKey, value);
      if (key !== null) discard();
    },
  });
  const save = useCallback(() => mutation.mutate(draft?.key ?? ""), [mutation, draft]);
  const remove = useCallback(() => mutation.mutate(null), [mutation]);
  const reload = useCallback(() => {
    mutation.reset();
    void status.refetch();
  }, [mutation, status]);
  const source = statusLabel(status.data, disabled);
  const busy = disabled || mutation.isPending;
  return (
    <SettingsSection title="API key">
      <SettingsCard>
        <SettingsRow
          label={status.isFetching ? "Reading host key status…" : source}
          error={status.error instanceof Error ? status.error.message : undefined}
        />
        <SettingsInput
          ref={input}
          label="API key"
          secureTextEntry
          hint="Stored on the owning daemon, separate from plugin settings. The saved key is never returned to clients."
          onChangeText={changeKey}
          disabled={busy}
        />
        <SettingsAction
          label="Save API key"
          actionLabel={mutation.isPending ? "Saving…" : "Save key"}
          hint={mutation.isSuccess ? "Host credentials updated." : undefined}
          error={
            changed
              ? "Connection changed while editing. Discard this key draft and review the endpoint."
              : mutation.error?.message
          }
          disabled={busy || changed || !draft?.key.trim() || !status.data}
          onPress={save}
        />
        <SettingsAction
          label="Remove the saved host key"
          actionLabel="Remove key"
          disabled={busy || changed || !hasStoredKey(status.data)}
          onPress={remove}
        />
        <SettingsAction
          label="Reload key status"
          actionLabel="Reload"
          disabled={busy || status.isFetching}
          onPress={reload}
        />
        <SettingsAction
          label="Discard unsaved key"
          actionLabel="Discard key"
          disabled={!draft || mutation.isPending}
          onPress={discard}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
