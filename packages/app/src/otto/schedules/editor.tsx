import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, View, Text } from "react-native";
import type { ScheduleDocument } from "@getpaseo/plugin/otto/schedules";
import { CadenceEditor } from "@/components/schedules/cadence-editor";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ScheduleEditorModel, scheduleEditorCanSave } from "./editor-model";
import { ScheduleText, ScheduleToggle } from "./fields";
import { ScheduleTargetFields } from "./target-fields";
import type { ScheduleProjectChoice } from "./native-fields";
import type { ScheduleApi } from "./api";
import type { ScheduleSources } from "./sources";
import { styles } from "./styles";
import { useScheduleActivity } from "./activity";

function CadenceFields({ model }: { model: ScheduleEditorModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const compact = useIsCompactFormFactor();
  const change = useCallback(
    () => model.cadence({ type: "cron", expression: "0 9 * * *", timezone: "UTC" }),
    [model],
  );
  if (state.fields.cadence.type === "every")
    return (
      <View style={styles.contentGap}>
        <Text style={styles.text}>{`Every ${state.fields.cadence.everyMs / 1000} seconds`}</Text>
        <Button variant="outline" size="sm" onPress={change} disabled={state.busy || state.blocked}>
          Change cadence
        </Button>
      </View>
    );
  return (
    <View pointerEvents={state.busy || state.blocked ? "none" : "auto"}>
      <CadenceEditor
        value={state.fields.cadence}
        onChange={model.cadence}
        size={compact ? "md" : "sm"}
      />
    </View>
  );
}
function EditorFields({ model }: { model: ScheduleEditorModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const disabled = state.busy || state.blocked;
  const name = useCallback((value: string) => model.field("name", value || null), [model]);
  const prompt = useCallback((value: string) => model.field("prompt", value), [model]);
  const maxRuns = useCallback(
    (value: string) => model.field("maxRuns", value.trim() ? Number(value) : null),
    [model],
  );
  const expiry = useCallback(
    (value: string) => model.field("expiresAt", value.trim() || null),
    [model],
  );
  const runNow = useCallback((value: boolean) => model.field("runOnCreate", value), [model]);
  return (
    <View style={styles.contentGap}>
      <ScheduleText
        label="Name"
        value={state.fields.name ?? ""}
        change={name}
        disabled={disabled}
        testID="schedule-name-input"
      />
      <ScheduleText
        label={
          state.candidate?.type === "agent" || state.candidate?.type === "new-agent"
            ? "Prompt"
            : "Run description"
        }
        value={state.fields.prompt}
        change={prompt}
        disabled={disabled}
        multiline
        testID="schedule-prompt-input"
      />
      <CadenceFields model={model} />
      <ScheduleText
        label="Max runs"
        value={state.fields.maxRuns === null ? "" : String(state.fields.maxRuns)}
        change={maxRuns}
        disabled={disabled}
      />
      <ScheduleText
        label="Expires at (ISO date and time, optional)"
        value={state.fields.expiresAt ?? ""}
        change={expiry}
        disabled={disabled}
      />
      {!state.document ? (
        <ScheduleToggle
          label="Run once after saving"
          value={state.fields.runOnCreate}
          change={runNow}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}
function EditorReview({ model }: { model: ScheduleEditorModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const preview = useCallback(() => {
    void model.preview();
  }, [model]);
  const review = useCallback(() => {
    void model.review();
  }, [model]);
  const approve = useCallback((value: boolean) => model.approve(value), [model]);
  const inspect = useCallback(() => {
    void model.inspect();
  }, [model]);
  const reload = useCallback(async () => {
    await model.reloadInspected(() =>
      confirmDialog({
        title: "Reload saved Schedule?",
        message: "Replace this local draft with the inspected saved record?",
        confirmLabel: "Reload",
      }),
    );
  }, [model]);
  return (
    <View style={styles.contentGap}>
      <View style={styles.actions}>
        <Button variant="outline" onPress={preview} disabled={state.busy || state.blocked}>
          Preview next runs
        </Button>
        <Button
          variant="outline"
          onPress={review}
          disabled={state.busy || state.blocked || !state.candidate}
        >
          Review target
        </Button>
      </View>
      {state.preview ? (
        <View style={styles.card}>
          <Text style={styles.title}>{`Next runs · ${state.preview.timezone}`}</Text>
          {state.preview.next.map((time) => (
            <Text key={time} style={styles.text}>
              {new Date(time).toLocaleString(undefined, { timeZone: state.preview?.timezone })}
            </Text>
          ))}
        </View>
      ) : null}
      {state.review ? (
        <View style={styles.card}>
          <Text style={styles.text}>{state.review.summary}</Text>
          {state.review.autopilot ? (
            <Alert description="This saved Workflow has autopilot enabled. Review its exact authority before scheduling." />
          ) : null}
          <Text style={styles.muted}>
            Workflow human approval gates still wait for you. Failed attempts wait for the next
            scheduled time; uncertain outcomes pause for inspection.
          </Text>
          <ScheduleToggle
            label="I approve this target and its unattended permissions"
            value={state.approved}
            change={approve}
            disabled={state.busy || state.blocked}
            testID="schedule-approve-target"
          />
        </View>
      ) : null}
      {state.blocked ? (
        <View style={styles.actions}>
          <Button variant="outline" onPress={inspect} disabled={state.busy}>
            Inspect saved Schedule
          </Button>
          {state.inspected ? (
            <Button variant="outline" onPress={reload} disabled={state.busy}>
              Reload inspected record
            </Button>
          ) : null}
        </View>
      ) : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
    </View>
  );
}
export function ScheduleEditor({
  api,
  sources,
  project,
  document,
  agents,
  saved,
  close,
}: {
  api: ScheduleApi;
  sources: ScheduleSources;
  project: ScheduleProjectChoice;
  document: ScheduleDocument | null;
  agents: { value: string; label: string }[];
  saved(document: ScheduleDocument): void;
  close(): void;
}) {
  const active = useScheduleActivity();
  const [model] = useState(
    () =>
      new ScheduleEditorModel(
        api,
        { hostId: project.target.serverId, projectId: project.projectId },
        `create-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
        document,
      ),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const submit = useCallback(async () => {
    const result = await model.save();
    if (result) saved(result);
  }, [model, saved]);
  const requestClose = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Close Schedule draft?",
        message:
          "Discard this local draft? Saved records and any accepted work remain on the owning host.",
        confirmLabel: "Close draft",
      })
    )
      close();
  }, [close]);
  return (
    <ScrollView
      testID="schedule-editor"
      style={styles.pane}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{document ? "Edit Schedule" : "New Schedule"}</Text>
      <Text style={styles.muted}>{`${project.target.serverName} · ${project.label}`}</Text>
      <EditorFields key={state.generation} model={model} />
      <ScheduleTargetFields
        key={`target-${state.generation}`}
        editor={model}
        project={project}
        sources={sources}
        agents={agents}
      />
      <EditorReview model={model} />
      <View style={styles.actions}>
        <Button
          onPress={submit}
          disabled={!active || !scheduleEditorCanSave(state)}
          loading={state.busy}
          testID="schedule-form-submit"
        >
          {state.document ? "Save changes" : "Create schedule"}
        </Button>
        <Button variant="ghost" onPress={requestClose} disabled={state.busy}>
          Close draft
        </Button>
      </View>
    </ScrollView>
  );
}
