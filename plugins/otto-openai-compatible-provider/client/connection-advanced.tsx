import { useCallback, useSyncExternalStore } from "react";
import { SettingsExpander, SettingsInput, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { ConnectionForm } from "./connection-form-model.js";

function AdvancedInput({
  form,
  field,
  label,
  hint,
}: {
  form: ConnectionForm;
  field: "label" | "model" | "apiKeyEnv" | "maxToolRounds" | "timeoutSeconds";
  label: string;
  hint: string;
}) {
  const state = useSyncExternalStore(form.subscribe, form.getState);
  const change = useCallback((value: string) => form.edit(field, value), [field, form]);
  return (
    <SettingsInput
      label={label}
      hint={hint}
      initialValue={state[field]}
      onChangeText={change}
      disabled={state.busy}
    />
  );
}

export function ConnectionAdvanced({
  form,
  canRemoveKey,
}: {
  form: ConnectionForm;
  canRemoveKey: boolean;
}) {
  const state = useSyncExternalStore(form.subscribe, form.getState);
  const editEnabled = useCallback((value: boolean) => form.edit("enabled", value), [form]);
  const editRemoveKey = useCallback((value: boolean) => form.edit("removeKey", value), [form]);
  return (
    <SettingsExpander label="Advanced options">
      {form.id !== "primary" && (
        <AdvancedInput
          form={form}
          field="label"
          label="Connection name"
          hint="Optional. The URL supplies a name automatically."
        />
      )}
      <AdvancedInput
        form={form}
        field="model"
        label="Model ID"
        hint="Optional. Leave empty to discover models."
      />
      <AdvancedInput
        form={form}
        field="apiKeyEnv"
        label="API key environment variable"
        hint="Optional alternative to a saved key. Localhost and variables refer to this host."
      />
      {form.id !== "primary" && (
        <SettingsSwitch
          label="Available for new chats"
          value={state.enabled}
          onValueChange={editEnabled}
          disabled={state.busy}
        />
      )}
      <AdvancedInput
        form={form}
        field="maxToolRounds"
        label="Tool round limit"
        hint="Host default for all connections."
      />
      <AdvancedInput
        form={form}
        field="timeoutSeconds"
        label="Request timeout (seconds)"
        hint="Host default for all connections."
      />
      {canRemoveKey && (
        <SettingsSwitch
          label="Remove the saved API key"
          value={state.removeKey}
          onValueChange={editRemoveKey}
          disabled={state.busy}
        />
      )}
    </SettingsExpander>
  );
}
