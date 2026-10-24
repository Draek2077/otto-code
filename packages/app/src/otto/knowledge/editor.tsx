import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  KnowledgeDeliverySchema,
  KnowledgeDispositionSchema,
  KnowledgeKindSchema,
  KnowledgeReviewSchema,
  mutateKnowledge,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { KnowledgeEditorModel, type EditorFields, type EditorSeed } from "./editor-model";
import { styles } from "./styles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";

type TextField =
  | "id"
  | "title"
  | "body"
  | "tags"
  | "reason"
  | "completed"
  | "total"
  | "unit"
  | "sourceUrl";
const display = (value: string) => value.replaceAll("_", " ");
const kindOptions = KnowledgeKindSchema.options.map((value) => ({ value, label: display(value) }));
const reviewOptions = [
  { value: "proposed", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "superseded", label: "History" },
];
const deliveryOptions = KnowledgeDeliverySchema.options.map((value) => ({
  value,
  label: display(value),
}));
const referenceOptions = KnowledgeDispositionSchema.options.map((value) => ({
  value,
  label: display(value),
}));
// FormTextInput splits a plain style into input/chrome styles; keep layout
// values plain rather than passing a web Unistyles class through that split.
const bodyStyle = { minHeight: 220, textAlignVertical: "top" } as const;
const reasonStyle = { minHeight: 80, textAlignVertical: "top" } as const;
function textStyle(field: TextField, multiline: boolean) {
  if (!multiline) return undefined;
  return field === "body" ? bodyStyle : reasonStyle;
}

function TextField({
  model,
  field,
  label,
  multiline = false,
}: {
  model: KnowledgeEditorModel;
  field: TextField;
  label: string;
  multiline?: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const compact = useIsCompactFormFactor();
  const change = useCallback((value: string) => model.set(field, value), [model, field]);
  return (
    <Field label={label}>
      <FormTextInput
        initialValue={state.fields[field]}
        onChangeText={change}
        accessibilityLabel={label}
        multiline={multiline}
        style={textStyle(field, multiline)}
        editable={!state.busy}
        size={compact ? "md" : "sm"}
      />
    </Field>
  );
}

function SelectFields({
  model,
  fields,
  busy,
}: {
  model: KnowledgeEditorModel;
  fields: EditorFields;
  busy: boolean;
}) {
  const kind = useCallback(
    (value: string) => model.set("kind", KnowledgeKindSchema.parse(value)),
    [model],
  );
  const review = useCallback(
    (value: string) => model.set("status", KnowledgeReviewSchema.parse(value)),
    [model],
  );
  const delivery = useCallback(
    (value: string) => model.set("deliveryStatus", KnowledgeDeliverySchema.parse(value)),
    [model],
  );
  const reference = useCallback(
    (value: string) => model.set("disposition", KnowledgeDispositionSchema.parse(value)),
    [model],
  );
  return (
    <>
      {fields.action === "create" ? (
        <SettingsSelect
          label="Kind"
          value={fields.kind}
          options={kindOptions}
          onValueChange={kind}
          disabled={busy}
        />
      ) : null}
      {fields.action === "review" ? (
        <SettingsSelect
          label="Review status"
          value={fields.status}
          options={reviewOptions}
          onValueChange={review}
          disabled={busy}
        />
      ) : null}
      {fields.action === "delivery" ? (
        <SettingsSelect
          label="Delivery"
          value={fields.deliveryStatus}
          options={deliveryOptions}
          onValueChange={delivery}
          disabled={busy}
        />
      ) : null}
      {fields.action === "reference" ? (
        <SettingsSelect
          label="Evaluation"
          value={fields.disposition}
          options={referenceOptions}
          onValueChange={reference}
          disabled={busy}
        />
      ) : null}
    </>
  );
}

function EditorFields({ model }: { model: KnowledgeEditorModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const action = state.fields.action;
  const named = action === "create" || action === "describe";
  const body = new Set(["create", "truth", "root", "evidence"]).has(action);
  return (
    <>
      <SettingsCard>
        <SelectFields model={model} fields={state.fields} busy={state.busy} />
      </SettingsCard>
      {action === "create" ? <TextField model={model} field="id" label="Page ID" /> : null}
      {named ? (
        <>
          <TextField model={model} field="title" label="Title" />
          <TextField model={model} field="tags" label="Tags, separated by commas" />
        </>
      ) : null}
      {body ? (
        <TextField
          model={model}
          field="body"
          label={action === "evidence" ? "Evidence" : "Markdown"}
          multiline
        />
      ) : null}
      {action === "delivery" ? (
        <>
          <TextField model={model} field="completed" label="Completed" />
          <TextField model={model} field="total" label="Total" />
          <TextField model={model} field="unit" label="Progress unit" />
        </>
      ) : null}
      {action === "reference" || action === "evidence" ? (
        <TextField model={model} field="sourceUrl" label="Source" />
      ) : null}
      {action !== "create" && action !== "root" && action !== "evidence" ? (
        <TextField model={model} field="reason" label="Reason" multiline />
      ) : null}
    </>
  );
}

export function KnowledgeEditor({
  scope,
  seed,
  onSaved,
  onCancel,
}: {
  scope: KnowledgeScope;
  seed: EditorSeed;
  onSaved(): void;
  onCancel(): void;
}) {
  const mutate = useRpc(mutateKnowledge);
  const [model] = useState(
    () =>
      new KnowledgeEditorModel(seed, async (command) => {
        const result = await mutate({ scope, command });
        return result.ok ? { ok: true } : { ok: false, message: result.error.message };
      }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.activate();
    return () => model.close();
  }, [model]);
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  useEffect(() => model.setActive(retained && visible), [model, retained, visible]);
  const save = useCallback(async () => {
    const authority = model.getAuthority();
    if (state.fields.action === "purge") {
      if (
        !(await confirmDialog({
          title: "Permanently delete this page?",
          message:
            "This removes the canonical page and its entire history, and repairs links in current pages and roots. Historical references in other pages and recovery copies from earlier storage or format changes remain unchanged.",
          confirmLabel: "Delete permanently",
          destructive: true,
        }))
      )
        return;
    }
    if (state.fields.action === "review" && state.fields.status !== "proposed") {
      if (
        !(await confirmDialog({
          title: "Change review status?",
          message:
            "This is an explicit human review action. The reason is retained in the page history.",
          confirmLabel: "Confirm review",
        }))
      )
        return;
    }
    if (await model.save(authority)) onSaved();
  }, [model, onSaved, state.fields.action, state.fields.status]);
  const cancel = useCallback(async () => {
    if (state.busy) return;
    const authority = model.getAuthority();
    if (
      await confirmDialog({
        title: "Discard this draft?",
        message: "Saved Knowledge will remain unchanged.",
        confirmLabel: "Discard",
        destructive: true,
      })
    )
      if (model.getAuthority() === authority) onCancel();
  }, [state.busy, onCancel, model]);
  const destructive = state.fields.action === "purge";
  const saveLabel = destructive ? "Delete permanently" : "Save";
  return (
    <SettingsSection
      title={seed.page?.title ?? (seed.root ? `Edit ${seed.root.slug}` : "New entry")}
      testID="knowledge-editor"
    >
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      <EditorFields model={model} />
      <View style={styles.actions}>
        <Button onPress={cancel} disabled={state.busy} variant="outline">
          Cancel
        </Button>
        <Button
          onPress={save}
          disabled={state.busy || state.blocked}
          variant={destructive ? "destructive" : "secondary"}
        >
          {state.busy ? "Saving..." : saveLabel}
        </Button>
      </View>
    </SettingsSection>
  );
}
