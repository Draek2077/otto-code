import { createContext, useCallback, useState, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import type { WorkflowScope } from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { workflowDrafts, discardWorkflowDraft } from "./draft-store";
import type { WorkflowDraft } from "./draft";
import { styles } from "./styles";
export const WorkflowDraftSurface = createContext("library");
export function WorkflowDraftList({
  owner,
  scope,
  surface,
  open,
}: {
  owner: object;
  scope: WorkflowScope;
  surface: string;
  open(model: WorkflowDraft): void;
}) {
  const [revision, setRevision] = useState(0),
    changed = useCallback(() => setRevision((value) => value + 1), []);
  return (
    <View key={revision} style={styles.content}>
      <Text style={styles.title}>Retained local drafts</Text>
      {workflowDrafts(owner, scope, surface).map((model) => (
        <DraftRow key={model.localKey} model={model} owner={owner} open={open} changed={changed} />
      ))}
    </View>
  );
}
function DraftRow({
  model,
  owner,
  open,
  changed,
}: {
  model: WorkflowDraft;
  owner: object;
  open(model: WorkflowDraft): void;
  changed(): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    select = useCallback(() => open(model), [open, model]);
  const discard = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Discard local Workflow draft?",
        message:
          "Discard only these local edits? Saved documents, accepted runs and unknown host writes are unchanged.",
        confirmLabel: "Discard draft",
        cancelLabel: "Keep",
      })
    ) {
      if (discardWorkflowDraft(owner, model)) changed();
    }
  }, [model, owner, changed]);
  return (
    <View style={styles.card}>
      <Text
        style={styles.text}
      >{`${state.document.value.id} · ${state.dirty ? "unsaved edits" : "saved"}${state.blocked ? " · inspect before another write" : ""}`}</Text>
      <View style={styles.actions}>
        <Button onPress={select} variant="outline">
          Open draft
        </Button>
        <Button onPress={discard} disabled={state.busy} variant="ghost">
          Discard local draft
        </Button>
      </View>
    </View>
  );
}
