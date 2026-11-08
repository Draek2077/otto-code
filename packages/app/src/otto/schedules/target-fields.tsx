import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import type { WorkflowLimits, WorkflowSeats } from "@getpaseo/plugin/otto/workflows";
import { ReviewModelPicker } from "../knowledge/review-model-picker";
import { WorkflowSeatOptions } from "../workflows/seat-options";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ScheduleChoice, ScheduleText, ScheduleToggle } from "./fields";
import { ScheduleTargetLibrary } from "./target-library";
import type { ScheduleSources } from "./sources";
import { ScheduleTargetModel } from "./target-model";
import type { ScheduleEditorModel } from "./editor-model";
import { ScheduleNativeFields, type ScheduleProjectChoice } from "./native-fields";
import { styles } from "./styles";
import { useScheduleActivity } from "./activity";

const KINDS = [
  { value: "new-agent", label: "New agent" },
  { value: "agent", label: "Existing agent" },
  { value: "workflow", label: "Saved Workflow" },
  { value: "artifact-update", label: "Artifact update" },
];
const ROLES = ["conductor", "worker", "judge"] as const;
const LIMITS: { key: keyof WorkflowLimits; label: string }[] = [
  { key: "maxAgents", label: "Maximum agents" },
  { key: "maxConcurrency", label: "Concurrent Workflow turns" },
  { key: "maxLoopAttempts", label: "Maximum quality-loop attempts" },
  { key: "timeoutMinutes", label: "Execution timeout (minutes)" },
];
function WorkflowSeat({
  model,
  role,
  hostId,
  disabled,
}: {
  model: ScheduleTargetModel;
  role: keyof WorkflowSeats;
  hostId: string;
  disabled: boolean;
}) {
  const active = useScheduleActivity();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const picker = useMemo(() => model.picker(role), [model, role]);
  const mode = useCallback(
    (value: string) => model.seatOption(role, "modeId", value),
    [model, role],
  );
  const thinking = useCallback(
    (value: string) => model.seatOption(role, "thinkingOptionId", value),
    [model, role],
  );
  if (!state.workflow) return null;
  return (
    <View style={styles.card} testID={`schedule-seat-${role}`}>
      <Text style={styles.title}>{role}</Text>
      <ReviewModelPicker model={picker} hostId={hostId} active={active && !disabled} />
      <WorkflowSeatOptions
        seat={state.workflow.seats[role]}
        hostId={hostId}
        active={active && !disabled}
        disabled={disabled}
        onMode={mode}
        onThinking={thinking}
      />
    </View>
  );
}
function WorkflowLimit({
  model,
  field,
  disabled,
}: {
  model: ScheduleTargetModel;
  field: (typeof LIMITS)[number];
  disabled: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback(
    (value: string) => model.limit(field.key, Number(value)),
    [model, field.key],
  );
  return (
    <ScheduleText
      label={field.label}
      value={String(state.workflow?.limits[field.key] ?? "")}
      change={change}
      disabled={disabled}
    />
  );
}
function WorkflowInput({
  model,
  name,
  disabled,
}: {
  model: ScheduleTargetModel;
  name: string;
  disabled: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const change = useCallback((value: string) => model.input(name, value), [model, name]);
  return (
    <ScheduleText
      label={state.inputLabels[name] ?? name}
      value={state.workflow?.inputs[name] ?? ""}
      change={change}
      disabled={disabled}
    />
  );
}
function WorkflowConfiguration({
  model,
  editor,
  project,
  disabled,
}: {
  model: ScheduleTargetModel;
  editor: ScheduleEditorModel;
  project: ScheduleProjectChoice;
  disabled: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const workspace = useCallback((value: string) => model.workspace(value), [model]);
  const code = useCallback((value: boolean) => model.allow("allowTemplateCode", value), [model]);
  const queries = useCallback((value: boolean) => model.allow("allowQueryEffects", value), [model]);
  if (!state.workflow) return null;
  return (
    <View style={styles.contentGap}>
      <ScheduleChoice
        label="Execution workspace"
        value={state.workflow.workspaceId || null}
        options={project.workspaces}
        change={workspace}
        disabled={disabled}
      />
      {ROLES.map((role) => (
        <WorkflowSeat
          key={role}
          model={model}
          role={role}
          hostId={editor.scope.hostId}
          disabled={disabled}
        />
      ))}
      {LIMITS.map((field) => (
        <WorkflowLimit key={field.key} model={model} field={field} disabled={disabled} />
      ))}
      {Object.keys(state.workflow.inputs).map((name) => (
        <WorkflowInput key={name} model={model} name={name} disabled={disabled} />
      ))}
      <ScheduleToggle
        label="Allow reviewed EJS template code on the owning host"
        value={state.workflow.approval.allowTemplateCode}
        change={code}
        disabled={disabled}
      />
      <ScheduleToggle
        label="Allow declared command and HTTP queries"
        value={state.workflow.approval.allowQueryEffects}
        change={queries}
        disabled={disabled}
      />
    </View>
  );
}
function SavedTargetPicker({
  model,
  editor,
  sources,
  kind,
  workspaceId,
}: {
  model: ScheduleTargetModel;
  editor: ScheduleEditorModel;
  sources: ScheduleSources;
  kind: "workflow" | "artifact";
  workspaceId: string | null;
}) {
  const active = useScheduleActivity();
  const [library] = useState(
    () => new ScheduleTargetLibrary(sources, editor.scope, kind, model, workspaceId),
  );
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const editorState = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  useEffect(() => {
    if (active) return library.activate();
  }, [library, active]);
  const choose = useCallback(
    (key: string) => {
      void library.select(key);
    },
    [library],
  );
  const refresh = useCallback(() => {
    void library.load(state.offset);
  }, [library, state.offset]);
  const next = useCallback(() => {
    if (state.next !== null) void library.load(state.next);
  }, [library, state.next]);
  const previous = useCallback(() => {
    void library.load(0);
  }, [library]);
  const options = useMemo(
    () => state.choices.map((row) => ({ value: row.key, label: row.label })),
    [state.choices],
  );
  return (
    <View style={styles.contentGap}>
      <ScheduleChoice
        label={kind === "workflow" ? "Saved Workflow" : "Artifact"}
        value={null}
        display={editorState.targetLabel || undefined}
        options={options}
        change={choose}
        disabled={state.busy || editorState.busy || editorState.blocked}
        testID="schedule-saved-target"
      />
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={refresh} disabled={state.busy}>
          Refresh library
        </Button>
        {state.offset > 0 ? (
          <Button variant="ghost" size="sm" onPress={previous} disabled={state.busy}>
            First page
          </Button>
        ) : null}
        {state.next !== null ? (
          <Button variant="ghost" size="sm" onPress={next} disabled={state.busy}>
            More targets
          </Button>
        ) : null}
      </View>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.diagnostics.map((message) => (
        <Alert key={message} description={message} />
      ))}
    </View>
  );
}
function ArtifactConfiguration({
  model,
  editor,
  disabled,
}: {
  model: ScheduleTargetModel;
  editor: ScheduleEditorModel;
  disabled: boolean;
}) {
  const active = useScheduleActivity();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const mode = useCallback(
    (value: string) => {
      if (value === "data" || value === "instruction") model.artifactMode(value);
    },
    [model],
  );
  const text = useCallback((value: string) => model.artifactText(value), [model]);
  const picker = useMemo(() => model.picker("artifact"), [model]);
  const options = useMemo(
    () => [
      { value: "data", label: "Literal JSON data" },
      { value: "instruction", label: "Instruction using an explicit model" },
    ],
    [],
  );
  return (
    <View style={styles.contentGap}>
      <ScheduleChoice
        label="Update"
        value={state.artifactMode}
        options={options}
        change={mode}
        disabled={disabled}
      />
      <ScheduleText
        key={state.artifactMode}
        label={state.artifactMode === "data" ? "JSON data" : "Update instruction"}
        value={state.artifactText}
        change={text}
        multiline
        disabled={disabled}
      />
      {state.artifactMode === "instruction" ? (
        <ReviewModelPicker
          model={picker}
          hostId={editor.scope.hostId}
          active={active && !disabled}
        />
      ) : null}
      <Text style={styles.muted}>
        {"Only data is updated. The Artifact's HTML design stays unchanged."}
      </Text>
    </View>
  );
}
export function ScheduleTargetFields({
  editor,
  project,
  sources,
  agents,
}: {
  editor: ScheduleEditorModel;
  project: ScheduleProjectChoice;
  sources: ScheduleSources;
  agents: { value: string; label: string }[];
}) {
  const [model] = useState(
    () =>
      new ScheduleTargetModel(
        (candidate, label) => editor.target(candidate, label),
        () => {
          const state = editor.getSnapshot();
          return !state.busy && !state.blocked;
        },
        editor.getSnapshot().candidate,
        editor.getSnapshot().targetLabel,
      ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const editorState = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const disabled = editorState.busy || editorState.blocked;
  const [workspaceId, setWorkspaceId] = useState(() => {
    const candidate = editor.getSnapshot().candidate;
    return candidate?.type === "artifact-update" &&
      candidate.source.scope.target.kind === "workspace"
      ? candidate.source.scope.target.id
      : "";
  });
  const collection = useCallback(
    (value: string) => {
      model.clearArtifact();
      setWorkspaceId(value);
    },
    [model],
  );
  const artifactScopes = useMemo(
    () => [{ value: "", label: "Project Artifacts" }, ...project.workspaces],
    [project.workspaces],
  );
  const kind = useCallback(
    (value: string) => {
      if (
        value === "agent" ||
        value === "new-agent" ||
        value === "workflow" ||
        value === "artifact-update"
      )
        model.kind(value);
    },
    [model],
  );
  const agent = useCallback(
    (value: string) =>
      model.native(
        { type: "agent", agentId: value },
        agents.find((row) => row.value === value)?.label ?? value,
      ),
    [model, agents],
  );
  return (
    <View style={styles.contentGap}>
      <ScheduleChoice
        label="Target"
        value={state.kind}
        options={KINDS}
        change={kind}
        disabled={disabled}
        testID="schedule-target-kind"
      />
      {state.kind === "new-agent" ? (
        <View pointerEvents={disabled ? "none" : "auto"}>
          <ScheduleNativeFields editor={editor} target={model} project={project} />
        </View>
      ) : null}
      {state.kind === "agent" ? (
        <ScheduleChoice
          label="Existing agent"
          value={editorState.candidate?.type === "agent" ? editorState.candidate.agentId : null}
          display={editorState.targetLabel || undefined}
          options={agents}
          change={agent}
          disabled={disabled}
        />
      ) : null}
      {state.kind === "workflow" ? (
        <>
          <SavedTargetPicker
            model={model}
            editor={editor}
            sources={sources}
            kind="workflow"
            workspaceId={null}
          />
          <WorkflowConfiguration
            model={model}
            editor={editor}
            project={project}
            disabled={disabled}
          />
        </>
      ) : null}
      {state.kind === "artifact-update" ? (
        <>
          <ScheduleChoice
            label="Artifact collection"
            value={workspaceId}
            display={
              workspaceId
                ? (project.workspaces.find((row) => row.value === workspaceId)?.label ??
                  workspaceId)
                : "Project Artifacts"
            }
            options={artifactScopes}
            change={collection}
            disabled={disabled}
          />
          <SavedTargetPicker
            key={workspaceId}
            model={model}
            editor={editor}
            sources={sources}
            kind="artifact"
            workspaceId={workspaceId || null}
          />
          <ArtifactConfiguration model={model} editor={editor} disabled={disabled} />
        </>
      ) : null}
    </View>
  );
}
