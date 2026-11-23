import { useCallback, useMemo, useRef } from "react";
import {
  SettingsButton,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import type { EditableBoard } from "../shared/model.js";
import type { ActionState, BoardActionModel } from "./action-form.js";

function Choice({
  id,
  label,
  selected,
  model,
  disabled,
}: {
  id: string;
  label: string;
  selected: boolean;
  model: BoardActionModel;
  disabled: boolean;
}) {
  const change = useCallback((value: boolean) => model.toggleChoice(id, value), [model, id]);
  return (
    <SettingsSwitch label={label} value={selected} onValueChange={change} disabled={disabled} />
  );
}
export function ActionValue({
  model,
  state,
  field,
}: {
  model: BoardActionModel;
  state: ActionState;
  field: EditableBoard["fields"][number];
}) {
  const textInput = useRef<SettingsInputHandle>(null);
  const options = useMemo(
    () => [
      ...(field.required ? [] : [{ value: "", label: "Not set" }]),
      ...field.choices.map((choice) => ({ value: choice.id, label: choice.label })),
    ],
    [field.choices, field.required],
  );
  const changeText = useCallback(
    (value: string) => {
      if (field.kind === "number") model.setNumber(value);
      else model.setValue({ kind: field.kind === "date" ? "date" : "text", value });
    },
    [field.kind, model],
  );
  const changeChoice = useCallback(
    (id: string) => model.setValue(id ? { kind: "choice", id } : { kind: "clear" }),
    [model],
  );
  const clear = useCallback(() => {
    textInput.current?.replaceText("");
    model.setValue({ kind: "clear" });
  }, [model]);
  const selected = "ids" in state.value ? state.value.ids : [];
  if (field.kind === "choice")
    return (
      <SettingsSelect
        label={field.name}
        value={state.value.kind === "choice" ? state.value.id : ""}
        options={options}
        onValueChange={changeChoice}
        disabled={state.busy || state.blocked}
      />
    );
  if (field.kind === "people" || field.kind === "choices")
    return (
      <>
        {field.choices.map((choice) => (
          <Choice
            key={choice.id}
            id={choice.id}
            label={choice.label}
            selected={selected.includes(choice.id)}
            model={model}
            disabled={state.busy || state.blocked}
          />
        ))}
      </>
    );
  const value = "value" in state.value ? String(state.value.value) : "";
  return (
    <>
      <SettingsInput
        ref={textInput}
        label={field.name}
        initialValue={field.kind === "number" ? state.numberText : value}
        onChangeText={changeText}
        disabled={state.busy || state.blocked}
        placeholder={field.kind === "date" ? "YYYY-MM-DD" : undefined}
      />
      {state.value.kind === "clear" ? <SettingsRow label="This field will be cleared." /> : null}
      {!field.required ? (
        <SettingsButton variant="outline" onPress={clear} disabled={state.busy || state.blocked}>
          Clear field
        </SettingsButton>
      ) : null}
    </>
  );
}
