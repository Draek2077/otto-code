import { useCallback, useEffect, useMemo, useRef } from "react";
import { Text } from "react-native";
import type { SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { SettingsInput, SettingsRow, SettingsSelect, SettingsSwitch } from "@/components/settings";
import { SelectField } from "@/components/ui/select-field";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { BrainSettingsChoice } from "./contracts";
import type { ConnectionDraft, OwnerDraft } from "./drafts";
import { useBrainSettings, useSettingsDisabled } from "./context";
import { styles } from "./styles";

export function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <SettingsRow label={label}>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </SettingsRow>
  );
}

/** Sync only untouched editing surfaces; an in-progress IME edit belongs to the input. */
export function SettingsText({
  scope,
  label,
  value,
  onChange,
  error,
  disabled,
  secure = false,
  hint,
}: {
  scope: "connection" | "owner";
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled: boolean;
  secure?: boolean;
  hint?: string;
}) {
  const { registerInput, state } = useBrainSettings();
  const input = useRef<SettingsInputHandle>(null);
  const committed = useRef(value);
  const version = state.inputVersions[scope];
  const previousVersion = useRef(version);
  const flush = useCallback(() => {
    const text = input.current?.getText();
    if (text !== undefined && text !== committed.current) onChange(text);
  }, [onChange]);
  useEffect(() => registerInput(scope, flush), [flush, registerInput, scope]);
  useEffect(() => {
    const text = input.current?.getText();
    const force = previousVersion.current !== version;
    if ((force || text === committed.current) && text !== value) input.current?.replaceText(value);
    committed.current = value;
    previousVersion.current = version;
  }, [value, version]);
  return (
    <SettingsInput
      ref={input}
      label={label}
      initialValue={value}
      onChangeText={onChange}
      disabled={disabled}
      secureTextEntry={secure}
      error={error}
      hint={hint}
    />
  );
}

export type OwnerTextKey =
  | "runtimePath"
  | "modelsDirectory"
  | "cacheTypeK"
  | "cacheTypeV"
  | "reasoningBudget"
  | "parallelSlots"
  | "contextCap"
  | "maxLoadedModels"
  | "listenHost"
  | "listenPort"
  | "certFile"
  | "keyFile"
  | "hostname"
  | "certDirectory"
  | "renewBeforeDays"
  | "checkIntervalMs"
  | "tailscaleExecutable";

export function OwnerText({
  field,
  label,
  disabled = false,
}: {
  field: OwnerTextKey;
  label: string;
  disabled?: boolean;
}) {
  const { state, model } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback(
    (value: string) => {
      if (field === "runtimePath") model.setRuntimePath(value);
      else model.editOwner(field, value);
    },
    [field, model],
  );
  if (!state.owner) return null;
  return (
    <SettingsText
      scope="owner"
      label={label}
      value={state.owner.draft[field]}
      onChange={change}
      error={state.ownerErrors[field]}
      disabled={disabled || busy}
    />
  );
}

export function ConnectionText({
  field,
  label,
  secure = false,
}: {
  field: "remoteHost" | "remotePort" | "remoteFingerprint";
  label: string;
  secure?: boolean;
}) {
  const { state, model, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("connection");
  const change = useCallback((value: string) => model.editConnection(field, value), [field, model]);
  if (!state.connection) return null;
  return (
    <SettingsText
      scope="connection"
      label={label}
      value={state.connection.draft[field]}
      onChange={change}
      error={state.connectionErrors[field]}
      secure={secure}
      disabled={
        busy || !snapshot.capabilities.editConnection || !snapshot.capabilities.remoteConnection
      }
    />
  );
}

type OwnerToggleKey = "flashAttention" | "lockModel" | "allowRemoteConfig" | "allowInsecureBind";
export function OwnerToggle({
  field,
  label,
  disabled = false,
}: {
  field: OwnerToggleKey;
  label: string;
  disabled?: boolean;
}) {
  const { state, model } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback((value: boolean) => model.editOwner(field, value), [field, model]);
  if (!state.owner) return null;
  return (
    <SettingsSwitch
      label={label}
      value={state.owner.draft[field]}
      onValueChange={change}
      disabled={disabled || busy}
    />
  );
}

export function ConnectionToggle({
  field,
  label,
  hint,
}: {
  field: "enabled" | "autoStart" | "remoteSecure";
  label: string;
  hint?: string;
}) {
  const { state, model, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("connection");
  const change = useCallback(
    (value: boolean) => model.editConnection(field, value),
    [field, model],
  );
  if (!state.connection) return null;
  return (
    <SettingsSwitch
      label={label}
      value={state.connection.draft[field]}
      onValueChange={change}
      hint={hint}
      disabled={
        busy ||
        !snapshot.capabilities.editConnection ||
        (field === "remoteSecure" && !snapshot.capabilities.remoteConnection)
      }
    />
  );
}

type OwnerEnumKey = "runtimeSource" | "tlsMode" | "authMode";
export function OwnerSelect<Key extends OwnerEnumKey>({
  field,
  label,
  options,
  disabled = false,
}: {
  field: Key;
  label: string;
  options: readonly { value: OwnerDraft[Key]; label: string }[];
  disabled?: boolean;
}) {
  const { state, model } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback(
    (value: OwnerDraft[Key]) => model.editOwner(field, value),
    [field, model],
  );
  if (!state.owner) return null;
  return (
    <SettingsSelect
      label={label}
      value={state.owner.draft[field]}
      options={options}
      onValueChange={change}
      disabled={disabled || busy}
    />
  );
}

export function ConnectionSelect({
  label,
  options,
}: {
  label: string;
  options: readonly { value: ConnectionDraft["mode"]; label: string }[];
}) {
  const { state, model, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("connection");
  const change = useCallback(
    (value: ConnectionDraft["mode"]) => model.editConnection("mode", value),
    [model],
  );
  if (!state.connection) return null;
  return (
    <SettingsSelect
      label={label}
      value={state.connection.draft.mode}
      options={options}
      onValueChange={change}
      disabled={busy || !snapshot.capabilities.editConnection}
    />
  );
}

interface IdentityValue {
  choice: BrainSettingsChoice | null;
}
const identityKey = (value: IdentityValue): string =>
  value.choice ? `choice:${value.choice.id}` : "none";

export function IdentityPicker({
  label,
  selected,
  choices,
  onChange,
  disabled = false,
  noneLabel = "None (load on request)",
  nullDisplay,
  unlistedSelection = false,
}: {
  label: string;
  selected: BrainSettingsChoice | null;
  choices: readonly BrainSettingsChoice[];
  onChange: (choice: BrainSettingsChoice | null) => void;
  disabled?: boolean;
  noneLabel?: string;
  nullDisplay?: string;
  unlistedSelection?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const options = useMemo<SelectFieldOption<IdentityValue>[]>(
    () => [
      { id: "none", value: { choice: null }, label: noneLabel },
      ...choices.map((choice) => ({
        id: `choice:${choice.id}`,
        value: { choice },
        label: choice.label,
      })),
    ],
    [choices, noneLabel],
  );
  const display = useMemo(
    () => ({ label: selected?.label ?? nullDisplay ?? noneLabel }),
    [selected, nullDisplay, noneLabel],
  );
  const value = useMemo(
    () => (unlistedSelection && selected === null ? null : { choice: selected }),
    [selected, unlistedSelection],
  );
  const change = useCallback(
    (next: IdentityValue) => {
      onChange(next.choice);
    },
    [onChange],
  );
  return (
    <SettingsRow label={label}>
      <SelectField<IdentityValue>
        field={false}
        size={compact ? "md" : "sm"}
        label={label}
        value={value}
        selectedDisplay={display}
        options={options}
        getValueKey={identityKey}
        onChange={change}
        placeholder="Select"
        emptyText="No choices available"
        disabled={disabled}
        searchable
      />
    </SettingsRow>
  );
}
