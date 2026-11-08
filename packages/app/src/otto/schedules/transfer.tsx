import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, View, Text } from "react-native";
import type { ScheduleDocument, ScheduleTransferLookup } from "@getpaseo/plugin/otto/schedules";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ScheduleText, ScheduleChoice, ScheduleToggle } from "./fields";
import { ScheduleTransferModel } from "./transfer-model";
import type { ScheduleApi } from "./api";
import { styles } from "./styles";
import { useScheduleActivity } from "./activity";
const OPERATIONS = [
  { value: "copy", label: "Copy settings" },
  { value: "move", label: "Move with history" },
];
const LOCATIONS = [
  { value: "repository", label: "Repository" },
  { value: "host", label: "Owning host" },
];
type Lock = ScheduleTransferLookup["locks"][number];
function TransferLock({
  model,
  lock,
  disabled,
}: {
  model: ScheduleTransferModel;
  lock: Lock;
  disabled: boolean;
}) {
  const recover = useCallback(
    () =>
      model.recover(lock.kind, () =>
        confirmDialog({
          title: "Recover inspected transfer lock?",
          message:
            "Confirm every writer for this transfer is stopped. Recover only this exact inspected lock; no target will execute.",
          confirmLabel: "Recover lock",
        }),
      ),
    [model, lock.kind],
  );
  return (
    <View style={styles.card}>
      <Text selectable style={styles.code}>{`${lock.kind} · ${lock.revision}`}</Text>
      <Button variant="outline" onPress={recover} disabled={disabled || !lock.canRecover}>
        Recover inspected lock
      </Button>
    </View>
  );
}
export function ScheduleTransfer({
  api,
  document,
  projectId,
}: {
  api: ScheduleApi;
  document: ScheduleDocument;
  projectId: string;
}) {
  const active = useScheduleActivity();
  const [model] = useState(
    () =>
      new ScheduleTransferModel(
        api,
        { hostId: document.ref.scope.hostId, projectId },
        document,
        `transfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
      ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    lane = useSyncExternalStore(model.lane.subscribe, model.lane.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const operation = useCallback(
    (value: string) => {
      if (value === "copy" || value === "move") model.operation(value);
    },
    [model],
  );
  const destination = useCallback(
    (value: string) => {
      if (value === "repository" || value === "host") model.destination(value);
    },
    [model],
  );
  const identity = useCallback((value: string) => model.operationId(value), [model]);
  const stopped = useCallback((value: boolean) => model.writersStopped(value), [model]);
  const inspect = useCallback(() => model.inspect(), [model]);
  const start = useCallback(
    () =>
      model.start(() =>
        confirmDialog({
          title:
            state.operation === "copy" ? "Copy Schedule settings?" : "Move Schedule with history?",
          message: `Owning host ${document.ref.scope.hostId}, project ${projectId}. The destination is paused. Copy starts empty history and retains the source. Move fences the source and retains a recoverable original. No work is run by this transfer.`,
          confirmLabel: "Transfer",
        }),
      ),
    [model, state.operation, document.ref.scope.hostId, projectId],
  );
  const complete = useCallback(
    () =>
      model.reconcile("complete", () =>
        confirmDialog({
          title: "Complete inspected transfer?",
          message:
            "Validate this exact receipt and source/destination digests, then complete only the admitted transfer. No target is started.",
          confirmLabel: "Complete transfer",
        }),
      ),
    [model],
  );
  const abort = useCallback(
    () =>
      model.reconcile("abort", () =>
        confirmDialog({
          title: "Abort inspected transfer?",
          message:
            "Abort only if the host verifies that no destination was published and the retained source still matches. Nothing is deleted by guessing.",
          confirmLabel: "Abort transfer",
        }),
      ),
    [model],
  );
  const receipt = state.receipt;
  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Schedule storage transfer</Text>
      <Text
        selectable
        style={styles.muted}
      >{`${document.ref.scope.hostId} · ${projectId} · ${document.ref.location} · ${document.ref.id}`}</Text>
      <ScheduleChoice
        label="Operation"
        value={state.operation}
        options={OPERATIONS}
        change={operation}
        disabled={!model.canStart()}
      />
      <ScheduleChoice
        label="Destination"
        value={state.destination}
        options={LOCATIONS}
        change={destination}
        disabled={!model.canStart()}
      />
      <ScheduleText
        label="Transfer operation ID"
        value={state.operationId}
        change={identity}
        disabled={!model.canStart()}
      />
      <Text style={styles.muted}>
        Keep the operation ID to inspect an interrupted transfer after reopening. Inspection never
        replays a transfer.
      </Text>
      <View style={styles.actions}>
        <Button onPress={start} disabled={!model.canStart()}>
          Transfer once
        </Button>
        <Button variant="outline" onPress={inspect} disabled={lane.busy}>
          Inspect transfer
        </Button>
      </View>
      {receipt ? (
        <View style={styles.contentGap}>
          <Text selectable style={styles.code}>
            {JSON.stringify(receipt, null, 2)}
          </Text>
          {receipt.found && receipt.needsReconciliation ? (
            <View style={styles.actions}>
              <Button
                variant="outline"
                onPress={complete}
                disabled={lane.busy || !state.receiptInspected}
              >
                Complete inspected transfer
              </Button>
              <Button
                variant="outline"
                onPress={abort}
                disabled={lane.busy || !state.receiptInspected}
              >
                Abort inspected transfer
              </Button>
            </View>
          ) : null}
          {receipt.locks.length ? (
            <>
              <ScheduleToggle
                label="I verified all transfer writers are stopped"
                value={state.writersStopped}
                change={stopped}
                disabled={lane.busy}
              />
              {receipt.locks.map((lock) => (
                <TransferLock
                  key={lock.kind}
                  model={model}
                  lock={lock}
                  disabled={lane.busy || !state.receiptInspected || !state.writersStopped}
                />
              ))}
            </>
          ) : null}
        </View>
      ) : null}
      {lane.error ? <Alert variant="error" description={lane.error} /> : null}
      {lane.message ? <Alert description={lane.message} /> : null}
    </ScrollView>
  );
}
