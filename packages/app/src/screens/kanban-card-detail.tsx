import React, { useCallback, useEffect, useState, type ReactElement } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import type {
  KanbanCard,
  KanbanCardFieldValue,
  KanbanField,
  KanbanFieldKind,
  KanbanFieldOption,
  KanbanFieldValueInput,
} from "@otto-code/protocol/kanban";
import { normalizeKanbanFieldKind } from "@otto-code/protocol/kanban";
import { confirmDialog } from "@/utils/confirm-dialog";

export function KanbanCardDetail({
  card,
  fields,
  values,
  canDelete,
  onClose,
  onUpdate,
  onDelete,
}: {
  card: KanbanCard;
  fields: KanbanField[];
  values: KanbanCardFieldValue[];
  canDelete: boolean;
  onClose: () => void;
  onUpdate: (fieldId: string, value: KanbanFieldValueInput) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valueMap = new Map(values.map((entry) => [entry.fieldId, entry]));

  const update = useCallback(
    async (fieldId: string, value: KanbanFieldValueInput): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await onUpdate(fieldId, value);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onUpdate],
  );

  const remove = useCallback(async (): Promise<void> => {
    const confirmed = await confirmDialog({
      title: "Remove card from board?",
      message: "A linked issue stays in its repository. A draft card is deleted.",
      confirmLabel: "Remove card",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [onDelete, onClose]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="kanban-card-detail">
          <View style={styles.heading}>
            <Text style={styles.title}>{card.title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" testID="kanban-detail-close">
              <Text style={styles.action}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.subtle}>{card.status}</Text>
            {fields.length === 0 ? (
              <Text style={styles.subtle}>This board has no card fields Otto can edit.</Text>
            ) : (
              fields.map((field) => (
                <KanbanFieldEditor
                  key={field.id}
                  field={field}
                  current={valueMap.get(field.id)}
                  disabled={busy}
                  onSave={update}
                />
              ))
            )}
            {error ? (
              <Text style={styles.error} testID="kanban-detail-error">
                {error}
              </Text>
            ) : null}
            {canDelete ? (
              <Pressable disabled={busy} onPress={remove} testID="kanban-detail-delete">
                <Text style={styles.delete}>Remove from board</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const SELECT_KINDS: ReadonlySet<KanbanFieldKind> = new Set([
  "singleSelect",
  "multiSelect",
  "users",
  "labels",
]);
const TEXT_KINDS: ReadonlySet<KanbanFieldKind> = new Set(["text", "richText", "number", "date"]);
const EMPTY_IDS: string[] = [];

function KanbanFieldEditor({
  field,
  current,
  disabled,
  onSave,
}: {
  field: KanbanField;
  current?: KanbanCardFieldValue;
  disabled: boolean;
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<void>;
}): ReactElement {
  return (
    <View style={styles.field} testID={`kanban-field-${field.id}`}>
      <Text style={styles.label}>{field.name}</Text>
      <KanbanFieldInput field={field} current={current} disabled={disabled} onSave={onSave} />
    </View>
  );
}

function KanbanFieldInput({
  field,
  current,
  disabled,
  onSave,
}: {
  field: KanbanField;
  current?: KanbanCardFieldValue;
  disabled: boolean;
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<void>;
}): ReactElement {
  const kind = normalizeKanbanFieldKind(field.kind);
  if (!kind || !(current?.editable ?? field.editable)) {
    return <ReadonlyField field={field} current={current} />;
  }
  if (TEXT_KINDS.has(kind) || (kind === "labels" && field.allowCustomOptions)) {
    return (
      <TextFieldEditor
        field={field}
        kind={kind}
        current={current}
        disabled={disabled}
        onSave={onSave}
      />
    );
  }
  const options = current?.options ?? field.options ?? [];
  if (SELECT_KINDS.has(kind) && options.length) {
    return (
      <SelectFieldEditor
        field={field}
        options={options}
        current={current}
        disabled={disabled}
        onSave={onSave}
      />
    );
  }
  return <Text style={styles.subtle}>{current?.display || "No choices available"}</Text>;
}

function ReadonlyField({
  field,
  current,
}: {
  field: KanbanField;
  current?: KanbanCardFieldValue;
}): ReactElement {
  const reason = current?.readOnlyReason ?? field.readOnlyReason;
  return (
    <Text style={styles.subtle}>
      {current?.display || "Empty"}
      {reason ? ` · ${reason}` : ""}
    </Text>
  );
}

function SaveFieldButton({
  fieldId,
  disabled,
  onPress,
}: {
  fieldId: string;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      testID={`kanban-field-save-${fieldId}`}
    >
      <Text style={styles.action}>{disabled ? "Saving…" : "Save"}</Text>
    </Pressable>
  );
}

function textValue(kind: KanbanFieldKind, draft: string): KanbanFieldValueInput | null {
  if (!draft.trim()) return { kind: "clear" };
  if (kind === "labels")
    return {
      kind: "options",
      optionIds: draft
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    };
  if (kind === "number") {
    const number = Number(draft);
    return Number.isFinite(number) ? { kind: "number", number } : null;
  }
  if (kind === "date")
    return /^\d{4}-\d{2}-\d{2}$/.test(draft.trim()) ? { kind: "date", date: draft.trim() } : null;
  return { kind: "text", text: draft };
}

function TextFieldEditor({
  field,
  kind,
  current,
  disabled,
  onSave,
}: {
  field: KanbanField;
  kind: KanbanFieldKind;
  current?: KanbanCardFieldValue;
  disabled: boolean;
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(current?.display ?? "");
  useEffect(() => setDraft(current?.display ?? ""), [current?.display]);
  const submit = useCallback(() => {
    const value = textValue(kind, draft);
    if (value) void onSave(field.id, value);
  }, [kind, draft, field.id, onSave]);
  return (
    <>
      <EditingTextInput
        initialValue={current?.display ?? ""}
        key={`${field.id}:${current?.display ?? ""}`}
        onChangeText={setDraft}
        editable={!disabled}
        multiline={kind === "richText"}
        placeholder={kind === "date" ? "YYYY-MM-DD" : field.name}
        style={styles.input}
        testID={`kanban-field-input-${field.id}`}
      />
      <SaveFieldButton fieldId={field.id} disabled={disabled} onPress={submit} />
    </>
  );
}

function SelectFieldEditor({
  field,
  options,
  current,
  disabled,
  onSave,
}: {
  field: KanbanField;
  options: KanbanFieldOption[];
  current?: KanbanCardFieldValue;
  disabled: boolean;
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<void>;
}): ReactElement {
  const initial = current?.value?.kind === "options" ? current.value.optionIds : EMPTY_IDS;
  const [selected, setSelected] = useState<string[]>(initial);
  useEffect(() => setSelected(initial), [initial]);
  const toggle = useCallback(
    (id: string) =>
      setSelected((previous) => {
        if (previous.includes(id)) return previous.filter((entry) => entry !== id);
        if (field.kind === "singleSelect" || field.kind === "users") return [id];
        return [...previous, id];
      }),
    [field.kind],
  );
  const submit = useCallback(() => {
    void onSave(
      field.id,
      selected.length ? { kind: "options", optionIds: selected } : { kind: "clear" },
    );
  }, [field.id, selected, onSave]);
  return (
    <>
      <View style={styles.options}>
        {options.map((option) => (
          <SelectChoice
            key={option.id}
            option={option}
            selected={selected.includes(option.id)}
            disabled={disabled}
            onToggle={toggle}
          />
        ))}
      </View>
      <SaveFieldButton fieldId={field.id} disabled={disabled} onPress={submit} />
    </>
  );
}

function SelectChoice({
  option,
  selected,
  disabled,
  onToggle,
}: {
  option: KanbanFieldOption;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(option.id), [onToggle, option.id]);
  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={[styles.option, selected ? styles.selected : null]}
    >
      <Text style={styles.text}>{option.name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0008",
    padding: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  title: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  content: { gap: 16, padding: 16 },
  field: { gap: 8 },
  label: { color: theme.colors.foreground, fontWeight: theme.fontWeight.semibold },
  subtle: { color: theme.colors.foregroundMuted },
  action: { color: theme.colors.accent, fontWeight: theme.fontWeight.semibold },
  delete: { color: theme.colors.destructive },
  error: { color: theme.colors.destructive },
  text: { color: theme.colors.foreground },
  input: {
    minHeight: 36,
    paddingHorizontal: 10,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.base,
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: {
    padding: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.base,
  },
  selected: { borderColor: theme.colors.borderAccent, backgroundColor: theme.colors.surface2 },
}));
