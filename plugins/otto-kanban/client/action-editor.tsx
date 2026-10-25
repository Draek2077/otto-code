import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import {
  SettingsButton,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import {
  newBoardOperationId,
  type BoardActionModel,
  type ActionMode,
  type ActionOrigin,
  type openBoardAction,
} from "./action-form.js";
import type { BoardActionDrafts } from "./action-drafts.js";
import { ActionValue } from "./action-value.js";

const scrollStyle = { flex: 1, minHeight: 0 } as const;
// PageLayout's 720px frame includes two 16px gutters, already owned by this
// feature's page boundary. Do not add a second gutter inside the form.
const panelStyle = {
  width: "100%",
  maxWidth: 688,
  alignSelf: "center",
  gap: 12,
  paddingBottom: 24,
} as const;
const buttonsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
function defaultColumnLabel(mode: ActionMode, provider: string) {
  if (mode === "move") return "Choose a column";
  return provider === "jira" ? "Jira default column" : "Unassigned";
}
function ReadOnlyFields({ model }: { model: BoardActionModel }) {
  const rows = model.origin.snapshot.cardFields[model.origin.cardId ?? ""] ?? [];
  return (
    <>
      {rows.map((field) => (
        <SettingsRow
          key={field.fieldId}
          label={
            model.origin.snapshot.fields.find((definition) => definition.id === field.fieldId)
              ?.name ?? field.fieldId
          }
          hint={field.display}
        />
      ))}
    </>
  );
}
export function OpenCardEditor({
  origin,
  drafts,
  submit,
  onClose,
  onApplied,
}: {
  origin: ActionOrigin;
  drafts: BoardActionDrafts;
  submit: Parameters<typeof openBoardAction>[0]["submit"];
  onClose(): void;
  onApplied(): void;
}) {
  const [model] = useState(() =>
    drafts.open({ origin, mode: "edit", operationId: newBoardOperationId, submit }),
  );
  const close = useCallback(() => {
    if (drafts.discard(model)) onClose();
  }, [drafts, model, onClose]);
  const applied = useCallback(() => {
    if (drafts.discard(model)) onApplied();
  }, [drafts, model, onApplied]);
  return <ActionEditor model={model} onClose={close} onApplied={applied} />;
}
export function ActionEditor({
  model,
  onClose,
  onApplied,
}: {
  model: BoardActionModel;
  onClose(): void;
  onApplied(): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const lifecycle = useRef({ active: true });
  useEffect(() => {
    const authority = { active: true };
    lifecycle.current = authority;
    return () => {
      authority.active = false;
    };
  }, []);
  const submit = useCallback(async () => {
    const authority = lifecycle.current;
    const result = await model.submit();
    if (authority.active && result?.status === "applied") onApplied();
  }, [model, onApplied]);
  const close = useCallback(() => {
    if (!model.getSnapshot().saved && (model.getSnapshot().dirty || model.getSnapshot().blocked))
      setConfirmDiscard(true);
    else onClose();
  }, [model, onClose]);
  const keep = useCallback(() => setConfirmDiscard(false), []);
  const modes = useMemo(() => {
    const names: { value: ActionMode; label: string }[] = model.origin.cardId
      ? [
          { value: "edit", label: "Edit field" },
          { value: "move", label: "Move card" },
          { value: "remove", label: "Remove from board" },
        ]
      : [
          { value: "create", label: "Create card" },
          {
            value: "link",
            label:
              model.origin.snapshot.board.provider === "jira"
                ? "Link backlog issue"
                : "Link issue or pull request",
          },
        ];
    return names.filter((mode) => model.origin.snapshot.board.capabilities[mode.value]);
  }, [model]);
  const columns = useMemo(() => {
    const available = model.origin.cardId
      ? (model.origin.snapshot.allowedMoves[model.origin.cardId] ?? [])
      : model.origin.snapshot.board.columns
          .filter((column) => column.id !== "otto:unassigned")
          .map((column) => column.id);
    return [
      { value: "", label: defaultColumnLabel(state.mode, model.origin.snapshot.board.provider) },
      ...model.origin.snapshot.board.columns
        .filter((column) => available.includes(column.id))
        .map((column) => ({ value: column.id, label: column.title })),
    ];
  }, [model, state.mode]);
  const fields = useMemo(() => {
    const editable = new Set(
      (model.origin.snapshot.cardFields[model.origin.cardId ?? ""] ?? [])
        .filter((row) => row.editable)
        .map((row) => row.fieldId),
    );
    return [
      { value: "", label: "Choose a field" },
      ...model.origin.snapshot.fields
        .filter((field) => editable.has(field.id))
        .map((field) => ({ value: field.id, label: field.name })),
    ];
  }, [model]);
  const definition = model.origin.snapshot.fields.find((field) => field.id === state.fieldId);
  const card = model.origin.snapshot.board.cards.find((row) => row.id === model.origin.cardId);
  return (
    <ScrollView style={scrollStyle} contentContainerStyle={panelStyle} testID="kanban-action-form">
      <SettingsRow label={card?.title ?? "Board action"} />
      {card?.description ? <SettingsRow label="Description" hint={card.description} /> : null}
      <SettingsCard>
        {modes.length ? (
          <SettingsSelect
            label="Action"
            value={state.mode}
            options={modes}
            onValueChange={model.setMode}
            disabled={state.busy || state.blocked}
          />
        ) : (
          <SettingsRow label="Read-only card" />
        )}
        {modes.length ? <ActionInputs model={model} columns={columns} fields={fields} /> : null}
        {!modes.length ? <ReadOnlyFields model={model} /> : null}
        {state.mode === "edit" && definition ? (
          <ActionValue key={definition.id} model={model} state={state} field={definition} />
        ) : null}
        {state.error ? <SettingsRow label="Action failed" error={state.error} /> : null}
        {state.saved ? <SettingsRow label="Board action applied" /> : null}
        {state.blocked && !state.saved ? (
          <SettingsRow label="Check the provider before starting another action. Close this form and refresh to reconcile the board." />
        ) : null}
      </SettingsCard>
      <View style={buttonsStyle}>
        {modes.length ? (
          <SettingsButton
            onPress={submit}
            disabled={!model.canSubmit()}
            variant={state.mode === "remove" ? "destructive" : "default"}
          >
            {state.busy ? "Applying..." : "Apply action"}
          </SettingsButton>
        ) : null}
        <SettingsButton onPress={close} disabled={state.busy} variant="outline">
          Close
        </SettingsButton>
      </View>
      {confirmDiscard ? (
        <SettingsCard>
          <SettingsRow label="Discard these local edits?" />
          <SettingsButton onPress={keep}>Keep editing</SettingsButton>
          <SettingsButton onPress={onClose} variant="destructive">
            Discard and close
          </SettingsButton>
        </SettingsCard>
      ) : null}
    </ScrollView>
  );
}
function ActionInputs({
  model,
  columns,
  fields,
}: {
  model: BoardActionModel;
  columns: { value: string; label: string }[];
  fields: { value: string; label: string }[];
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const disabled = state.busy || state.blocked;
  return (
    <>
      {state.mode === "create" ? (
        <>
          <SettingsInput
            label="Title"
            initialValue={state.title}
            onChangeText={model.setTitle}
            disabled={disabled}
          />
          <SettingsInput
            label="Description"
            initialValue={state.description}
            onChangeText={model.setDescription}
            disabled={disabled}
          />
        </>
      ) : null}
      {state.mode === "link" ? (
        <SettingsInput
          label={
            model.origin.snapshot.board.provider === "jira"
              ? "Backlog issue key or URL"
              : "Issue or pull request URL"
          }
          initialValue={state.reference}
          onChangeText={model.setReference}
          disabled={disabled}
        />
      ) : null}
      {state.mode === "link" && model.origin.snapshot.board.provider === "jira" ? (
        <SettingsRow
          label="Choose an issue already in this board's backlog."
          hint="Otto moves it onto this board through Jira's workflow; it never changes the board filter."
        />
      ) : null}
      {state.mode === "create" || state.mode === "link" || state.mode === "move" ? (
        <SettingsSelect
          label="Column"
          value={state.columnId}
          options={columns}
          onValueChange={model.setColumn}
          disabled={disabled}
        />
      ) : null}
      {state.mode === "edit" ? (
        <SettingsSelect
          label="Field"
          value={state.fieldId}
          options={fields}
          onValueChange={model.setField}
          disabled={disabled}
        />
      ) : null}
      {state.mode === "remove" ? (
        <>
          <SettingsRow
            label="Remove this card from the board?"
            hint="The linked issue or pull request is kept."
          />
          <SettingsButton
            variant="destructive"
            onPress={model.confirmRemove}
            disabled={disabled || state.confirmRemove}
          >
            {state.confirmRemove ? "Removal confirmed" : "Confirm removal"}
          </SettingsButton>
        </>
      ) : null}
    </>
  );
}
