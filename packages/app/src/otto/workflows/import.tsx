import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import type { WorkflowScope, WorkflowEntry } from "@getpaseo/plugin/otto/workflows";
import { SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { WorkflowImportForm } from "./import-model";
import { useWorkflowApi } from "./api";
import { readWorkflowImport } from "./read-import";
import { TextField } from "./fields";
import { styles } from "./styles";
const locations = [
  { value: "repository", label: "Repository" },
  { value: "host", label: "Owning host" },
];
export function WorkflowImport({
  scope,
  active,
  imported,
}: {
  scope: WorkflowScope;
  active: boolean;
  imported(entry: WorkflowEntry): void;
}) {
  const [model] = useState(() => new WorkflowImportForm(scope)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    api = useWorkflowApi(),
    [fileError, setFileError] = useState("");
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const edit = useCallback((value: string) => model.text(value), [model]),
    receipt = useCallback((value: string) => model.receipt(value), [model]),
    id = useCallback((value: string) => model.id(value), [model]),
    destination = useCallback((value: string) => model.destination(value), [model]);
  const file = useCallback(async () => {
    try {
      const text = await readWorkflowImport();
      if (text !== null) model.text(text);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "File could not be read.");
    }
  }, [model]);
  const review = useCallback(() => model.review(api), [model, api]),
    commit = useCallback(async () => {
      const entry = await model.commit(api);
      if (entry) imported(entry);
    }, [model, api, imported]);
  const inspect = useCallback(() => model.inspect(api), [model, api]),
    reconcile = useCallback(async () => {
      if (
        await confirmDialog({
          title: "Reconcile import receipt?",
          message:
            "Mark this receipt committed only if the exact destination bytes still match? This never replays an import.",
          confirmLabel: "Reconcile",
          cancelLabel: "Keep",
        })
      )
        await model.reconcile(api);
    }, [model, api]);
  return (
    <View style={styles.content}>
      <Text style={styles.title}>Import Workflow package</Text>
      <Button onPress={file} variant="outline" disabled={state.busy || state.blocked || !active}>
        Choose JSON package
      </Button>
      <TextField
        label="Package JSON"
        value={state.text}
        onChange={edit}
        multiline
        disabled={state.busy || state.blocked}
      />
      <TextField
        label="New ID (optional, avoids a collision)"
        value={state.newId}
        onChange={id}
        disabled={state.busy || state.blocked}
      />
      <SettingsSelect
        label="Destination"
        value={state.destination}
        options={locations}
        onValueChange={destination}
        disabled={state.busy || state.blocked}
      />
      {state.review ? (
        <View style={styles.card}>
          <Text
            style={styles.title}
          >{`${state.review.document.kind} · ${state.review.destination.id} · ${state.review.destination.location}`}</Text>
          <Text
            selectable
            style={styles.code}
          >{`Source integrity ${state.review.sourceHash}\nDestination integrity ${state.review.destinationHash}`}</Text>
          {state.review.warnings.map((warning) => (
            <Text key={warning} style={styles.muted}>
              {warning}
            </Text>
          ))}
          <Text selectable style={styles.code}>
            {JSON.stringify(state.review.document, null, 2)}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          onPress={review}
          variant="outline"
          disabled={!active || state.busy || state.blocked}
        >
          Review package
        </Button>
        <Button onPress={commit} disabled={!active || state.busy || state.blocked || !state.review}>
          Import reviewed copy
        </Button>
        <Button onPress={inspect} variant="ghost" disabled={!active || state.busy}>
          Inspect operation receipt
        </Button>
        <Button
          onPress={reconcile}
          variant="ghost"
          disabled={!active || state.busy || !state.inspection?.matches}
        >
          Reconcile matching copy
        </Button>
      </View>
      <ImportOutcome state={state} fileError={fileError} />
      <TextField
        label="Inspect previous import operation ID"
        value={state.operationId}
        onChange={receipt}
        disabled={state.busy}
      />

      <Text
        style={styles.muted}
      >{`Operation ${state.operationId}. Integrity hashes are self-attested, not proof of a trusted author. Import grants no execution permission.`}</Text>
    </View>
  );
}

function ImportOutcome({
  state,
  fileError,
}: {
  state: ReturnType<WorkflowImportForm["getSnapshot"]>;
  fileError: string;
}) {
  return (
    <View>
      {state.inspection ? (
        <Text selectable style={styles.code}>
          {JSON.stringify(state.inspection, null, 2)}
        </Text>
      ) : null}
      {state.error || fileError ? (
        <Alert variant="error" description={state.error || fileError} />
      ) : null}
      {state.message ? <Alert description={state.message} /> : null}
    </View>
  );
}
