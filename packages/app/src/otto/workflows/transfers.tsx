import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import type { WorkflowRef } from "@getpaseo/plugin/otto/workflows";
import { SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useWorkflowApi } from "./api";
import { WorkflowTransferForm } from "./transfer-model";
import { TextField } from "./fields";
import { styles } from "./styles";
const destinations = [
    { value: "host", label: "Owning host" },
    { value: "repository", label: "Repository" },
  ],
  operations = [
    { value: "copy", label: "Copy" },
    { value: "move", label: "Move after destination verification" },
  ],
  copyOnly = [operations[0]];
function confirm(message: string, label: string) {
  return confirmDialog({
    title: "Workflow transfer",
    message,
    confirmLabel: label,
    cancelLabel: "Keep",
  });
}
export function WorkflowTransfers({
  reference,
  active,
}: {
  reference: WorkflowRef;
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    toggle = useCallback(() => setExpanded((value) => !value), []);
  return (
    <View style={styles.card}>
      <Button variant="ghost" onPress={toggle}>
        {expanded ? "Hide transfers and receipts" : "Transfers and receipts"}
      </Button>
      <View style={expanded ? undefined : styles.hidden}>
        <TransferForm reference={reference} active={active && expanded} />
      </View>
    </View>
  );
}
function TransferForm({ reference, active }: { reference: WorkflowRef; active: boolean }) {
  const [model] = useState(() => new WorkflowTransferForm(reference)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    api = useWorkflowApi();
  useEffect(() => {
    if (active) return model.activate();
  }, [active, model]);
  const destination = useCallback((value: string) => model.destination(value), [model]),
    operation = useCallback((value: string) => model.operation(value), [model]),
    id = useCallback((value: string) => model.operationId(value), [model]);
  const start = useCallback(
    () =>
      model.transfer(api, () =>
        confirm(
          "Transfer this exact saved document? A move retires the source only after verifying its destination. Original bytes remain in recovery.",
          "Transfer",
        ),
      ),
    [model, api],
  );
  const inspect = useCallback(() => model.inspect(api), [model, api]);
  const newOperation = useCallback(
    () =>
      model.newOperation(() =>
        confirm(
          "Inspect any previous unknown operation first. Start a different transfer identity without replaying the old operation?",
          "New operation",
        ),
      ),
    [model],
  );
  const keep = useCallback(
    () =>
      model.reconcile(api, "keep_copy", () =>
        confirm(
          "Keep the verified destination as a copy and preserve the current source, including newer edits? Only the receipt is changed.",
          "Keep verified copy",
        ),
      ),
    [model, api],
  );
  const move = useCallback(
    () =>
      model.reconcile(api, "complete_move", () =>
        confirm(
          "Complete this verified move only if the exact original source is still unchanged? Source bytes are retained in recovery.",
          "Complete inspected move",
        ),
      ),
    [model, api],
  );
  const recover = useCallback(
    () =>
      model.recoverLock(api, () =>
        confirm(
          "Confirm every writer on every daemon sharing this store has stopped. Retain and recover this exact inspected lock? Age or emptiness alone is not proof.",
          "All writers stopped; recover",
        ),
      ),
    [model, api],
  );
  return (
    <View style={styles.content}>
      <SettingsSelect
        label="Destination"
        value={state.destination}
        options={destinations}
        onValueChange={destination}
        disabled={state.busy || state.attempted}
      />
      <SettingsSelect
        label="Transfer"
        value={state.operation}
        options={reference.location === "legacy" ? copyOnly : operations}
        onValueChange={operation}
        disabled={state.busy || state.attempted}
      />
      <TextField
        label="Operation receipt ID"
        value={state.operationId}
        onChange={id}
        disabled={state.busy}
      />
      <View style={styles.actions}>
        <Button
          onPress={start}
          variant="outline"
          disabled={!active || state.busy || state.attempted}
        >
          Transfer saved document
        </Button>
        <Button onPress={inspect} variant="ghost" disabled={!active || state.busy}>
          Inspect receipt
        </Button>
        <Button onPress={newOperation} variant="ghost" disabled={!active || state.busy}>
          New operation
        </Button>
      </View>
      {state.inspection ? (
        <TransferInspection
          state={state}
          active={active}
          keep={keep}
          move={move}
          recover={recover}
        />
      ) : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.message ? <Alert description={state.message} /> : null}
    </View>
  );
}
function TransferInspection({
  state,
  active,
  keep,
  move,
  recover,
}: {
  state: ReturnType<WorkflowTransferForm["getSnapshot"]>;
  active: boolean;
  keep(): void;
  move(): void;
  recover(): void;
}) {
  const inspected = state.inspection;
  if (!inspected) return null;
  return (
    <View style={styles.card}>
      <Text selectable style={styles.code}>
        {JSON.stringify(inspected, null, 2)}
      </Text>
      <View style={styles.actions}>
        <Button
          onPress={keep}
          variant="outline"
          disabled={!active || state.busy || !inspected.destinationMatches}
        >
          Keep verified copy
        </Button>
        <Button
          onPress={move}
          variant="outline"
          disabled={
            !active ||
            state.busy ||
            !inspected.destinationMatches ||
            inspected.receipt?.operation !== "move"
          }
        >
          Complete inspected move
        </Button>
        <Button
          onPress={recover}
          variant="outline"
          disabled={!active || state.busy || !inspected.lock?.canRecover}
        >
          Recover inspected receipt lock
        </Button>
      </View>
    </View>
  );
}
