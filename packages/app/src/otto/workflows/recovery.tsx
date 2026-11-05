import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import type { WorkflowRef, WorkflowEntry } from "@getpaseo/plugin/otto/workflows";
import { WorkflowTransfers } from "./transfers";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useWorkflowApi, type WorkflowApi } from "./api";
import { useWorkflowAction } from "./use-action";
import { styles } from "./styles";
type Inspection = Awaited<ReturnType<WorkflowApi["inspect"]>>;
export function Recovery({
  reference,
  active,
  changed,
}: {
  reference: WorkflowRef;
  active: boolean;
  changed(entry: WorkflowEntry): void;
}) {
  const api = useWorkflowApi(),
    { model, state } = useWorkflowAction(active),
    [inspection, setInspection] = useState<Inspection | null>(null);

  const inspect = useCallback(async () => {
    const value = await model.run(() => api.inspect(reference), false);
    if (value) {
      setInspection(value);
      model.inspected();
    }
  }, [api, reference, model]);
  const recover = useCallback(async () => {
    if (
      !inspection?.currentRevision ||
      !inspection.snapshotRevision ||
      !(await confirmDialog({
        title: "Restore last valid Workflow?",
        message:
          "Retain the current file and restore this exact inspected snapshot? This does not restart work.",
        confirmLabel: "Restore snapshot",
        cancelLabel: "Keep",
      }))
    )
      return;
    const entry = await model.run(() =>
      api.recover({
        ref: reference,
        expectedRevision: inspection.currentRevision!,
        expectedSnapshotRevision: inspection.snapshotRevision!,
        confirmed: true,
      }),
    );
    if (entry) changed(entry);
  }, [api, inspection, reference, model, changed]);
  const reconcile = useCallback(async () => {
    const current = await model.run(() => api.read(reference), false);
    if (
      !current ||
      !(await confirmDialog({
        title: "Settle interrupted Workflow?",
        message:
          "Close only this run's recorded owners and mark it canceled without replaying work? Healthy active runs cannot be reconciled.",
        confirmLabel: "Settle run",
        cancelLabel: "Keep",
      }))
    )
      return;
    const entry = await model.run(() =>
      api.reconcile({ ref: reference, expectedRevision: current.revision, confirmed: true }),
    );
    if (entry) changed(entry);
  }, [api, reference, model, changed]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Storage and recovery</Text>
      <View style={styles.actions}>
        <Button onPress={inspect} variant="outline" disabled={!active || state.busy}>
          Inspect exact origin
        </Button>
        <Button
          onPress={recover}
          variant="outline"
          disabled={!active || state.busy || state.blocked || !inspection?.snapshotValid}
        >
          Restore inspected snapshot
        </Button>
        {reference.kind === "run" ? (
          <Button
            onPress={reconcile}
            variant="outline"
            disabled={!active || state.busy || state.blocked}
          >
            Settle interrupted run
          </Button>
        ) : null}
      </View>
      <WorkflowTransfers reference={reference} active={active} />
      {inspection ? (
        <RecoveryLocks
          inspection={inspection}
          reference={reference}
          active={active}
          updated={setInspection}
        />
      ) : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.message ? <Alert description={state.message} /> : null}
    </View>
  );
}
function RecoveryLocks({
  inspection,
  reference,
  active,
  updated,
}: {
  inspection: Inspection;
  reference: WorkflowRef;
  active: boolean;
  updated(value: Inspection): void;
}) {
  return (
    <View style={styles.content}>
      <Text
        style={styles.muted}
      >{`Current ${inspection.currentRevision ?? "missing"} · Snapshot ${inspection.snapshotRevision ?? "missing"}`}</Text>
      {inspection.locks.map((lock) => (
        <Lock
          key={lock.kind}
          lock={lock}
          inspection={inspection}
          reference={reference}
          active={active}
          updated={updated}
        />
      ))}
    </View>
  );
}
function Lock({
  lock,
  inspection,
  reference,
  active,
  updated,
}: {
  lock: Inspection["locks"][number];
  inspection: Inspection;
  reference: WorkflowRef;
  active: boolean;
  updated(value: Inspection): void;
}) {
  const api = useWorkflowApi(),
    { model, state } = useWorkflowAction(active);
  const recover = useCallback(async () => {
    if (
      !(await confirmDialog({
        title: "Recover an inspected lock?",
        message:
          "Confirm that every writer on every daemon sharing this store has stopped. An empty or old lock alone does not prove that. Retain this exact lock and release its name?",
        confirmLabel: "All writers stopped; recover",
        cancelLabel: "Keep lock",
      }))
    )
      return;
    const value = await model.run(() =>
      api.recoverLock({
        ref: reference,
        kind: lock.kind,
        expectedRevision: inspection.currentRevision,
        expectedLockRevision: lock.revision,
        confirmedNoWriter: true,
      }),
    );
    if (value) updated(value);
  }, [api, reference, lock, inspection.currentRevision, model, updated]);
  return (
    <View>
      <Button
        onPress={recover}
        disabled={!active || state.busy || state.blocked || !lock.canRecover}
        variant="outline"
      >{`Recover ${lock.kind} lock`}</Button>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
    </View>
  );
}
