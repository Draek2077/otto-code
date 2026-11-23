import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import type {
  WorkflowEntry,
  WorkflowAuthoredDocument,
  WorkflowRef,
  PromptTemplate,
} from "@getpaseo/plugin/otto/workflows";
import {
  WorkflowAuthoredDocument as AuthoredSchema,
  validateOrchestrationGraph,
  reviewOrchestrationGraph,
} from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { WorkflowDraft, type WorkflowDraftState } from "./draft";
import { DraftField, DraftToggle, DraftJson } from "./draft-fields";
import { GraphEditor } from "./graph-editor";
import { useWorkflowApi } from "./api";
import { exportWorkflow } from "./export";
import { styles } from "./styles";
import { Recovery } from "./recovery";
import { DraftSeat } from "./seat-picker";
import { TemplatePreview } from "./template-preview";
function AiEditor({ model }: { model: WorkflowDraft }) {
  return (
    <View style={styles.content}>
      <DraftField model={model} path="value.title" label="Workflow name" />
      <DraftField model={model} path="value.description" label="Description" multiline />
      <DraftField model={model} path="value.prompt" label="Task for the conductor" multiline />
      <DraftToggle
        model={model}
        path="value.autopilot"
        label="Autopilot: skip plan confirmation and auto-approve AI plan gates"
      />
    </View>
  );
}
function TemplateEditor({ model }: { model: WorkflowDraft }) {
  return (
    <View style={styles.content}>
      <DraftField model={model} path="value.name" label="Template name" />
      <DraftField model={model} path="value.description" label="Description" />
      <DraftToggle model={model} path="value.snippet" label="Reusable include snippet" />
      <DraftField model={model} path="value.content" label="Prompt template" multiline />
      <DraftJson
        model={model}
        path="value.variables"
        label="Variables: key, label, defaultValue, required"
      />
      <DraftJson model={model} path="value.includes" label="Explicit include IDs" />
    </View>
  );
}
export function WorkflowEditor({
  model,
  active,
  templates,
  saved,
  run,
  copy,
}: {
  model: WorkflowDraft;
  active: boolean;
  templates: PromptTemplate[];
  saved(entry: WorkflowEntry): void;
  run(entry: WorkflowEntry): void;
  copy(document: WorkflowAuthoredDocument): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    api = useWorkflowApi(),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const save = useCallback(async () => {
    const result = await model.save(api);
    if (result) saved(result);
  }, [model, api, saved]);
  const reload = useCallback(
    () =>
      model.reload(api, () =>
        confirmDialog({
          title: "Reload saved Workflow?",
          message: "Discard this local draft and reload the exact owning record?",
          confirmLabel: "Reload",
          cancelLabel: "Keep draft",
        }),
      ),
    [model, api],
  );
  const start = useCallback(() => {
    const current = model.getSnapshot();
    if (current.origin && !current.dirty) run(current.origin);
  }, [model, run]);
  const duplicate = useCallback(() => {
    const current = structuredClone(model.getSnapshot().document);
    current.value.id = `${current.kind}-${Date.now().toString(36)}`;
    delete current.value.builtIn;
    delete current.value.workflowStorage;
    copy(current);
  }, [model, copy]);
  const validate = useCallback(async () => {
    const doc = model.getSnapshot().document;
    try {
      AuthoredSchema.parse(doc);
      if (doc.kind === "graph") {
        const result = await api.validate({ scope: model.scope, graph: doc.value });
        setMessage(
          [
            ...result.issues.map((issue) => issue.message),
            ...reviewOrchestrationGraph(doc.value),
          ].join("\n") ||
            "Graph structure is valid. Provider, template and execution authority are checked again during launch review.",
        );
      } else setMessage("Document is valid.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Validation failed.");
    }
  }, [api, model]);
  const download = useCallback(async () => {
    const origin = model.getSnapshot().origin;
    if (!origin) return;
    try {
      const value = await api.export(origin.ref);
      await exportWorkflow(JSON.stringify(value, null, 2), origin.ref.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    }
  }, [api, model]);
  const remove = useCallback(async () => {
    const origin = model.getSnapshot().origin;
    if (
      !origin ||
      !(await confirmDialog({
        title: "Delete Workflow?",
        message: "Retire this exact saved document? Run history and chats are retained.",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
      }))
    )
      return;
    try {
      await api.remove({ ref: origin.ref, expectedRevision: origin.revision, confirmed: true });
      setMessage("Document retired. Close this draft and refresh the library.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete was not acknowledged.");
    }
  }, [api, model]);
  const graphProblems =
    state.document.kind === "graph" ? validateOrchestrationGraph(state.document.value) : [];
  return (
    <View style={styles.content}>
      <EditorToolbar
        state={state}
        active={active}
        save={save}
        validate={validate}
        start={start}
        duplicate={duplicate}
        reload={reload}
        download={download}
        remove={remove}
      />
      {state.origin ? (
        <Text
          style={styles.muted}
        >{`${state.origin.ref.location} · ${state.origin.ref.storeKey ?? "project store"} · ${state.origin.revision.slice(0, 12)}`}</Text>
      ) : (
        <Text style={styles.muted}>
          Unsaved document. Saving uses the selected project Workflow store.
        </Text>
      )}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {message ? <Alert description={message} /> : null}
      {graphProblems.length ? (
        <Alert variant="warning" description={graphProblems.join("\n")} />
      ) : null}
      <DraftField model={model} path="value.id" label="Document ID" />
      {state.document.kind === "ai" ? (
        <View>
          <AiEditor model={model} />
          {(["conductor", "worker", "judge"] as const).map((role) => (
            <DraftSeat key={role} role={role} model={model} active={active} />
          ))}
          <DraftField model={model} path="value.limits.maxAgents" label="Maximum agents" number />
          <DraftField
            model={model}
            path="value.limits.maxConcurrency"
            label="Concurrent Workflow turns"
            number
          />
          <DraftField
            model={model}
            path="value.limits.maxLoopAttempts"
            label="Quality-loop attempts"
            number
          />
          <DraftField
            model={model}
            path="value.limits.timeoutMinutes"
            label="Execution timeout in minutes"
            number
          />
        </View>
      ) : null}
      {state.document.kind === "template" ? (
        <View>
          <TemplateEditor model={model} />
          <TemplatePreview draft={model} active={active} />
        </View>
      ) : null}
      {state.document.kind === "graph" ? (
        <GraphDocument model={model} active={active} templates={templates} />
      ) : null}
      {state.origin ? (
        <Recovery reference={state.origin.ref} active={active} changed={saved} />
      ) : null}
    </View>
  );
}
function GraphDocument({
  model,
  active,
  templates,
}: {
  model: WorkflowDraft;
  active: boolean;
  templates: PromptTemplate[];
}) {
  return (
    <View>
      <DraftField model={model} path="value.name" label="Graph name" />
      <DraftField model={model} path="value.description" label="Description" multiline />
      <GraphEditor model={model} active={active} templates={templates} />
    </View>
  );
}
export function sameReference(a: WorkflowRef, b: WorkflowRef) {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.location === b.location &&
    a.storeKey === b.storeKey &&
    a.scope.hostId === b.scope.hostId &&
    a.scope.projectId === b.scope.projectId
  );
}

function EditorToolbar({
  state,
  active,
  save,
  validate,
  start,
  duplicate,
  reload,
  download,
  remove,
}: {
  state: WorkflowDraftState;
  active: boolean;
  save(): void;
  validate(): void;
  start(): void;
  duplicate(): void;
  reload(): void;
  download(): void;
  remove(): void;
}) {
  return (
    <View style={styles.actions}>
      <Button onPress={save} disabled={!active || state.busy || state.blocked || !state.dirty}>
        Save
      </Button>
      <Button variant="outline" onPress={validate} disabled={!active || state.busy}>
        Validate
      </Button>
      <Button
        variant="outline"
        onPress={start}
        disabled={
          !active ||
          state.busy ||
          state.dirty ||
          !state.origin ||
          state.document.kind === "template"
        }
      >
        Run
      </Button>
      <Button variant="outline" onPress={duplicate} disabled={state.busy}>
        Copy
      </Button>
      <Button variant="ghost" onPress={reload} disabled={!active || state.busy || !state.origin}>
        Reload saved
      </Button>
      <Button variant="ghost" onPress={download} disabled={!active || !state.origin}>
        Export
      </Button>
      <Button variant="ghost" onPress={remove} disabled={!active || !state.origin || state.busy}>
        Delete
      </Button>
    </View>
  );
}
