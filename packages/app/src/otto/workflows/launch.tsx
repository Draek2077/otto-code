import { useCallback, useEffect, useState, useSyncExternalStore, useMemo } from "react";
import { Text, View } from "react-native";
import type {
  WorkflowEntry,
  WorkflowSeats,
  WorkflowLimits,
  GraphInput,
} from "@getpaseo/plugin/otto/workflows";
import { SettingsSelect } from "@/components/settings";
import { ReviewModelPicker } from "../knowledge/review-model-picker";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { TextField, Toggle } from "./fields";
import { WorkflowLaunchForm } from "./launch-model";
import { useWorkflowApi } from "./api";
import { styles } from "./styles";
import { WorkflowSeatOptions } from "./seat-options";
function Seat({
  model,
  role,
  hostId,
  active,
}: {
  model: WorkflowLaunchForm;
  role: keyof WorkflowSeats;
  hostId: string;
  active: boolean;
}) {
  const picker = useMemo(() => model.seatPicker(role), [model, role]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const mode = useCallback(
      (value: string) => model.seatOption(role, "modeId", value),
      [model, role],
    ),
    thinking = useCallback(
      (value: string) => model.seatOption(role, "thinkingOptionId", value),
      [model, role],
    );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{role}</Text>
      <ReviewModelPicker model={picker} hostId={hostId} active={active} />
      <WorkflowSeatOptions
        seat={state.seats[role]}
        hostId={hostId}
        active={active}
        disabled={state.busy}
        onMode={mode}
        onThinking={thinking}
      />
    </View>
  );
}
function Limit({
  model,
  field,
  label,
}: {
  model: WorkflowLaunchForm;
  field: keyof WorkflowLimits;
  label: string;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback((value: string) => model.limit(field, value), [model, field]);
  return (
    <TextField
      label={label}
      value={String(state.limits[field])}
      onChange={change}
      disabled={state.busy}
    />
  );
}
function Input({ model, input }: { model: WorkflowLaunchForm; input: GraphInput }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback((value: string) => model.input(input.key, value), [model, input.key]);
  return (
    <TextField
      label={input.label}
      value={state.inputs[input.key] ?? ""}
      onChange={change}
      multiline={input.multiline}
      disabled={state.busy}
    />
  );
}
export function WorkflowLaunch({
  entry,
  workspaceId,
  workspaces,
  active,
  started,
  close,
}: {
  entry: WorkflowEntry;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  active: boolean;
  started(entry: WorkflowEntry): void;
  close(): void;
}) {
  const [model] = useState(() => new WorkflowLaunchForm(entry, workspaceId)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    api = useWorkflowApi();
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const workspace = useCallback((value: string) => model.workspace(value), [model]),
    code = useCallback((value: boolean) => model.allow("allowTemplateCode", value), [model]),
    queries = useCallback((value: boolean) => model.allow("allowQueryEffects", value), [model]);
  const review = useCallback(() => model.review(api), [api, model]);
  const start = useCallback(async () => {
    const run = await model.start(api);
    if (run) started(run);
  }, [api, model, started]);
  return (
    <View style={styles.content}>
      <Text
        style={styles.title}
      >{`Run ${entry.document.kind === "ai" ? "AI" : "Graph"} Workflow`}</Text>
      <SettingsSelect
        label="Execution workspace"
        value={state.workspaceId}
        options={workspaces}
        onValueChange={workspace}
        disabled={state.busy}
      />
      {(["conductor", "worker", "judge"] as const).map((role) => (
        <Seat
          key={role}
          model={model}
          role={role}
          hostId={entry.ref.scope.hostId}
          active={active}
        />
      ))}
      <View style={styles.card}>
        <Limit model={model} field="maxAgents" label="Maximum agents (including conductor)" />
        <Limit model={model} field="maxConcurrency" label="Concurrent Workflow turns" />
        <Limit model={model} field="maxLoopAttempts" label="Maximum quality-loop attempts" />
        <Limit
          model={model}
          field="timeoutMinutes"
          label="Execution timeout (minutes, excludes Planning)"
        />
      </View>
      {entry.document.kind === "graph" ? (
        <View style={styles.card}>
          {(entry.document.value.inputs ?? []).map((input) => (
            <Input key={input.key} model={model} input={input} />
          ))}
          <Toggle
            label="Allow reviewed EJS template code on the owning host"
            value={state.allowTemplateCode}
            onChange={code}
            disabled={state.busy}
          />
          <Toggle
            label="Allow declared command and HTTP queries"
            value={state.allowQueryEffects}
            onChange={queries}
            disabled={state.busy}
          />
          <Text style={styles.muted}>
            Template code executes with daemon filesystem authority. Command and HTTP queries can
            have effects. These choices apply only to this reviewed run.
          </Text>
        </View>
      ) : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.review ? (
        <View style={styles.card}>
          <Text
            style={styles.title}
          >{`${state.review.agentCount} initially known agents · exact reviewed seats and inputs`}</Text>
          {state.review.warnings.map((warning) => (
            <Text key={warning} style={styles.muted}>
              {warning}
            </Text>
          ))}
          <Text style={styles.muted}>{`Review expires ${state.review.expiresAt}`}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          variant="outline"
          onPress={review}
          disabled={!active || state.busy || state.blocked || !state.workspaceId}
        >
          Review launch
        </Button>
        <Button onPress={start} disabled={!active || state.busy || state.blocked || !state.review}>
          Start reviewed Workflow
        </Button>
        <Button variant="ghost" onPress={close} disabled={state.busy}>
          Close launch form
        </Button>
      </View>
      <Text style={styles.muted}>{`Launch operation ${state.operationId}`}</Text>
    </View>
  );
}
