import React, { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { Button } from "@/components/ui/button";
import { TabbedModalSheet } from "@/components/ui/tabbed-modal-sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SegmentedControlOption } from "@/components/ui/segmented-control";
import { StyleSheet } from "react-native-unistyles";
import type {
  KanbanCard,
  KanbanCardFieldValue,
  KanbanColumn,
  KanbanField,
  KanbanFieldKind,
  KanbanFieldOption,
  KanbanFieldValueInput,
} from "@otto-code/protocol/kanban";
import { normalizeKanbanFieldKind } from "@otto-code/protocol/kanban";
import { confirmDialog } from "@/utils/confirm-dialog";

type CardDetailTab = "overview" | "description" | "people" | "fields";

const DETAIL_TABS: SegmentedControlOption<CardDetailTab>[] = [
  { value: "overview", label: "Overview" },
  { value: "description", label: "Description" },
  { value: "people", label: "People" },
  { value: "fields", label: "More fields" },
];

export function KanbanCardDetail({
  card,
  columns,
  currentColumnId,
  fields,
  values,
  canDelete,
  onClose,
  onUpdate,
  onMove,
  onDelete,
}: {
  card: KanbanCard;
  columns: KanbanColumn[];
  currentColumnId: string;
  fields: KanbanField[];
  values: KanbanCardFieldValue[];
  canDelete: boolean;
  onClose: () => void;
  onUpdate: (fieldId: string, value: KanbanFieldValueInput) => Promise<void>;
  onMove: (targetColumnId: string) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CardDetailTab>("overview");
  const valueMap = new Map(values.map((entry) => [entry.fieldId, entry]));
  const overviewFields = fields.filter((field) =>
    /^(title|priority|due date|due|target date)$/i.test(field.name),
  );
  const descriptionFields = fields.filter((field) =>
    ["description", "body"].includes(field.name.toLowerCase()),
  );
  const peopleFields = fields.filter(
    (field) => ["users", "labels"].includes(field.kind) || field.name.toLowerCase() === "assignees",
  );
  const otherFields = fields.filter(
    (field) =>
      !overviewFields.includes(field) &&
      !descriptionFields.includes(field) &&
      !peopleFields.includes(field) &&
      !/^(status|state)$/i.test(field.name),
  );
  const tabs = DETAIL_TABS.filter(
    (tab) =>
      tab.value === "overview" ||
      tab.value === "description" ||
      (tab.value === "people" && peopleFields.length > 0) ||
      (tab.value === "fields" && otherFields.length > 0),
  );

  const update = useCallback(
    async (fieldId: string, value: KanbanFieldValueInput): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await onUpdate(fieldId, value);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
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

  const changeStatus = useCallback(
    async (targetColumnId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await onMove(targetColumnId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onMove],
  );

  const openLink = useCallback(() => {
    if (card.url) void Linking.openURL(card.url).catch(() => undefined);
  }, [card.url]);
  const removePress = useCallback(() => void remove(), [remove]);
  const header = useMemo(() => ({ title: card.title }), [card.title]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {canDelete ? (
          <Button
            variant="outline"
            size="sm"
            onPress={removePress}
            disabled={busy}
            testID="kanban-detail-delete"
          >
            Remove from board
          </Button>
        ) : null}
        <View style={styles.footerSpacer} />
        <Button variant="secondary" size="sm" onPress={onClose} testID="kanban-detail-close">
          Close
        </Button>
      </View>
    ),
    [busy, canDelete, onClose, removePress],
  );
  let visibleFields = overviewFields;
  if (activeTab === "description") visibleFields = descriptionFields;
  if (activeTab === "people") visibleFields = peopleFields;
  if (activeTab === "fields") visibleFields = otherFields;
  let emptyMessage: string | null = null;
  if (visibleFields.length === 0 && activeTab !== "overview" && activeTab !== "description")
    emptyMessage = "No fields in this section";

  return (
    <TabbedModalSheet
      header={header}
      visible
      onClose={onClose}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      desktopMaxWidth={640}
      testID="kanban-card-detail"
      tabsTestID="kanban-detail-tabs"
      footer={footer}
    >
      {activeTab === "overview" ? (
        <View style={styles.summary}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            <StatusBadge label={card.status || "Unassigned"} />
            {columns.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  style={styles.statusTrigger}
                  disabled={busy}
                  testID="kanban-detail-change-status"
                  accessibilityLabel="Change card status"
                >
                  <Text style={styles.action}>Change status</Text>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {columns
                    .filter((column) => column.id !== currentColumnId)
                    .map((column) => (
                      <StatusMoveItem key={column.id} column={column} onMove={changeStatus} />
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </View>
          {card.url ? (
            <Button variant="ghost" size="sm" onPress={openLink}>
              Open source
            </Button>
          ) : null}
        </View>
      ) : null}
      {activeTab === "description" && descriptionFields.length === 0 ? (
        <Text style={card.body ? styles.summaryBody : styles.subtle}>
          {card.body || "No description"}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="kanban-detail-error">
          {error}
        </Text>
      ) : null}
      {visibleFields.map((field) => (
        <KanbanFieldEditor
          key={field.id}
          field={field}
          current={valueMap.get(field.id)}
          disabled={busy}
          onSave={update}
        />
      ))}
      {emptyMessage ? <Text style={styles.subtle}>{emptyMessage}</Text> : null}
    </TabbedModalSheet>
  );
}

function StatusMoveItem({
  column,
  onMove,
}: {
  column: KanbanColumn;
  onMove: (targetColumnId: string) => Promise<void>;
}): ReactElement {
  const handleSelect = useCallback(() => void onMove(column.id), [column.id, onMove]);
  return (
    <DropdownMenuItem testID={`kanban-detail-status-${column.id}`} onSelect={handleSelect}>
      {column.name}
    </DropdownMenuItem>
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
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<boolean>;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const editable = current?.editable ?? field.editable;
  const kind = normalizeKanbanFieldKind(field.kind);
  const save = useCallback(
    async (fieldId: string, value: KanbanFieldValueInput): Promise<boolean> => {
      const saved = await onSave(fieldId, value);
      if (saved) setEditing(false);
      return saved;
    },
    [onSave],
  );
  const toggleEditing = useCallback(() => setEditing((value) => !value), []);
  let fieldContent: ReactElement;
  if (editing) {
    fieldContent = (
      <KanbanFieldInput field={field} current={current} disabled={disabled} onSave={save} />
    );
  } else if (editable && kind && SELECT_KINDS.has(kind) && current?.display) {
    fieldContent = (
      <View style={styles.fieldValueBadge}>
        <StatusBadge label={current.display} />
      </View>
    );
  } else {
    fieldContent = <ReadonlyField field={field} current={current} />;
  }
  return (
    <View style={styles.field} testID={`kanban-field-${field.id}`}>
      <View style={styles.fieldHeader}>
        <Text style={styles.label}>{field.name}</Text>
        {editable && kind ? (
          <Button
            variant="ghost"
            size="xs"
            onPress={toggleEditing}
            disabled={disabled}
            testID={`kanban-field-edit-${field.id}`}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
        ) : null}
      </View>
      {fieldContent}
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
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<boolean>;
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
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onPress={onPress}
      testID={`kanban-field-save-${fieldId}`}
    >
      {disabled ? "Saving…" : "Save"}
    </Button>
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
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<boolean>;
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
        style={[styles.input, kind === "richText" ? styles.multilineInput : null]}
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
  onSave: (fieldId: string, value: KanbanFieldValueInput) => Promise<boolean>;
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
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  footerSpacer: { flex: 1 },
  summary: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusTrigger: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
  },
  summaryBody: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  field: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fieldHeader: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  fieldValueBadge: { alignItems: "flex-start" },
  label: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  subtle: { color: theme.colors.foregroundMuted },
  action: { color: theme.colors.accent, fontWeight: theme.fontWeight.semibold },
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
  multilineInput: {
    minHeight: 180,
    textAlignVertical: "top",
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
