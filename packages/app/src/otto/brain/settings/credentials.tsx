import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { SettingsAction, SettingsRow, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import type { BrainCredentialSlot, BrainCredentialStatus } from "./contracts";
import type { CredentialDraft } from "./drafts";
import { useBrainSettings, useSettingsControlSize, useSettingsDisabled } from "./context";
import { SettingsText, ValueRow } from "./fields";
import { styles } from "./styles";
import { SettingsRows } from "./rows";

function credentialStatus(status: BrainCredentialStatus): string {
  if (status.effectiveSource === "environment") {
    return status.stored
      ? "Environment credential active; stored fallback configured"
      : "Environment credential active";
  }
  return status.stored ? "Stored credential configured" : "No stored credential";
}

export function CredentialField({
  slot,
  label,
  status,
  writable,
}: {
  slot: BrainCredentialSlot;
  label: string;
  status: BrainCredentialStatus;
  writable: boolean;
}) {
  const { model, state } = useBrainSettings();
  const scope = slot === "remote" ? "connection" : "owner";
  const busy = useSettingsDisabled(scope);
  const draft = state.credentials[slot];
  const options = useMemo<readonly { value: CredentialDraft["action"]; label: string }[]>(
    () => [
      { value: "keep", label: "Keep" },
      { value: "replace", label: "Replace" },
      ...(status.stored ? [{ value: "remove" as const, label: "Remove stored credential" }] : []),
    ],
    [status.stored],
  );
  const select = useCallback(
    (action: CredentialDraft["action"]) =>
      model.editCredential(slot, {
        action,
        value: action === "replace" ? draft.value : "",
      }),
    [draft.value, model, slot],
  );
  const change = useCallback(
    (value: string) => model.editCredential(slot, { action: "replace", value }),
    [model, slot],
  );
  if (!writable) return <ValueRow label={label} value={credentialStatus(status)} />;
  return (
    <SettingsRows>
      <SettingsSelect
        label={label}
        hint={credentialStatus(status)}
        value={draft.action}
        options={options}
        onValueChange={select}
        disabled={busy}
      />
      {draft.action === "replace" ? (
        <SettingsText
          scope={scope}
          label={`New ${label.toLowerCase()}`}
          value={draft.value}
          onChange={change}
          secure
          disabled={busy}
          error={state.credentialErrors[slot]}
        />
      ) : null}
    </SettingsRows>
  );
}

export function GenerateAccessKey() {
  const { model, state, snapshot, flushInputs } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const owner = state.owner?.origin;
  const generate = useCallback(() => {
    flushInputs();
    void model.generateAccessKey(() =>
      confirmDialog({
        title: owner?.credentials.access.stored ? "Rotate access key?" : "Generate access key?",
        message: owner?.credentials.access.stored
          ? "The new key replaces the saved key. Hosts using the previous key will need the new one."
          : `Generate and save an access key on ${owner?.owner.label ?? "the Brain owner"}?`,
        confirmLabel: owner?.credentials.access.stored ? "Rotate" : "Generate",
      }),
    );
  }, [flushInputs, model, owner]);
  if (!snapshot.capabilities.generateAccessKey) return null;
  const dirty = state.connectionDirty || state.ownerDirty;
  return (
    <SettingsAction
      label="Generate access key"
      actionLabel={state.operation === "generate-key" ? "Generating..." : "Generate"}
      hint={dirty ? "Save or reload pending changes first" : undefined}
      onPress={generate}
      disabled={busy || dirty}
    />
  );
}

/** This component only receives the freshly generated direct result. */
export function AccessKeyReveal() {
  const { state, model } = useBrainSettings();
  const size = useSettingsControlSize();
  const copy = useCallback(() => {
    void model.copyAccessKey(copyToClipboard);
  }, [model]);
  const hide = useCallback(() => model.hideAccessKey(), [model]);
  useEffect(() => () => model.hideAccessKey(), [model]);
  if (!state.revealedKey) return null;
  return (
    <SettingsRow
      label="New access key"
      hint="Copy it now. This key is shown only for this generation."
    >
      <View style={styles.secret}>
        <Text selectable style={styles.selectableValue}>
          {state.revealedKey}
        </Text>
        <View style={styles.actions}>
          <Button variant="outline" size={size} onPress={copy}>
            {state.copiedKey ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size={size} onPress={hide}>
            Hide
          </Button>
        </View>
      </View>
    </SettingsRow>
  );
}
