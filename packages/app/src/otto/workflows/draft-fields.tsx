import { useCallback, useSyncExternalStore } from "react";
import { SettingsSelect } from "@/components/settings";
import { TextField, Toggle, JsonField } from "./fields";
import type { WorkflowDraft } from "./draft";
function read(object: unknown, path: readonly string[]): unknown {
  let value = object;
  for (const key of path) {
    if (!value || typeof value !== "object") return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}
export function DraftField({
  model,
  path,
  label,
  multiline = false,
  number = false,
}: {
  model: WorkflowDraft;
  path: string;
  label: string;
  multiline?: boolean;
  number?: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    value = read(state.document, path.split("."));
  const change = useCallback(
    (text: string) => {
      if (!number) {
        model.patch(path.split("."), text);
        return;
      }
      model.patch(path.split("."), text.trim() ? Number(text) : undefined);
    },
    [model, path, number],
  );
  return (
    <TextField
      label={label}
      value={value === undefined ? "" : String(value)}
      onChange={change}
      multiline={multiline}
      disabled={state.busy}
      epoch={state.epoch}
    />
  );
}
export function DraftToggle({
  model,
  path,
  label,
}: {
  model: WorkflowDraft;
  path: string;
  label: string;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback(
    (value: boolean) => model.patch(path.split("."), value),
    [model, path],
  );
  return (
    <Toggle
      label={label}
      value={read(state.document, path.split(".")) === true}
      onChange={change}
      disabled={state.busy}
    />
  );
}
export function DraftSelect({
  model,
  path,
  label,
  options,
}: {
  model: WorkflowDraft;
  path: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    value = read(state.document, path.split("."));
  const change = useCallback(
    (selected: string) => model.patch(path.split("."), selected || undefined),
    [model, path],
  );
  return (
    <SettingsSelect
      label={label}
      value={String(value ?? "")}
      options={options}
      onValueChange={change}
      disabled={state.busy}
    />
  );
}
export function DraftJson({
  model,
  path,
  label,
}: {
  model: WorkflowDraft;
  path: string;
  label: string;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback(
    (value: unknown) => model.patch(path.split("."), value === null ? undefined : value),
    [model, path],
  );
  const error = useCallback((message: string) => model.error(message, path), [model, path]);
  return (
    <JsonField
      label={label}
      value={read(state.document, path.split(".")) ?? null}
      onChange={change}
      error={error}
      disabled={state.busy}
    />
  );
}
