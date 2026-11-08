import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, View, Text } from "react-native";
import { Buffer } from "buffer";
import type {
  ScheduleDocument,
  ScheduleRef,
  ScheduleRunSummary,
} from "@getpaseo/plugin/otto/schedules";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { formatCadence } from "@/utils/schedule-format";
import type { ScheduleApi } from "./api";
import { ScheduleDetailModel } from "./detail-model";
import { ScheduleResultLink } from "./result-link";
import { styles } from "./styles";
import { useScheduleActivity } from "./activity";
import { ScheduleChoice } from "./fields";

const HISTORY_PAGE_SIZES = [5, 10, 25, 50].map((size) => ({
  value: String(size),
  label: String(size),
}));

function confirmation(title: string, message: string, destructive = false) {
  return () => confirmDialog({ title, message, destructive, confirmLabel: "Continue" });
}
function RunRow({
  model,
  run,
  disabled,
}: {
  model: ScheduleDetailModel;
  run: ScheduleRunSummary;
  disabled: boolean;
}) {
  const inspect = useCallback(() => {
    void model.run(run.id);
  }, [model, run.id]);
  const cancel = useCallback(
    () =>
      model.control(
        { type: "cancel", runId: run.id },
        confirmation(
          "Cancel Schedule run?",
          "Request cancellation of this exact run. An unconfirmed target outcome pauses the Schedule for inspection.",
        ),
      ),
    [model, run.id],
  );
  const result = useMemo(
    () =>
      run.otto?.result ?? (run.agentId ? { kind: "chat" as const, agentId: run.agentId } : null),
    [run.otto?.result, run.agentId],
  );
  return (
    <View style={styles.card}>
      <View style={styles.actions}>
        <StatusBadge label={run.status} />
        <Text style={styles.muted}>{run.startedAt}</Text>
      </View>
      <Text style={styles.text}>
        {run.otto?.resolved?.title ?? run.requestedTarget?.type ?? "Legacy native run"}
      </Text>
      {run.otto?.resolved?.revision ? (
        <Text selectable style={styles.code}>
          {run.otto.resolved.revision}
        </Text>
      ) : null}
      {run.error ? (
        <Alert
          variant="error"
          description={`${run.error}${run.errorTruncated ? " (preview; inspect full run)" : ""}`}
        />
      ) : null}
      {run.output ? (
        <Text
          selectable
          style={styles.text}
        >{`${run.output}${run.outputTruncated ? " (preview; inspect full run)" : ""}`}</Text>
      ) : null}
      <Text style={styles.muted}>
        {[run.otto?.executor, run.otto?.disposition, run.otto?.failureCode]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={inspect} disabled={disabled}>
          Inspect full run
        </Button>
        {result ? <ScheduleResultLink hostId={model.ref.scope.hostId} result={result} /> : null}
        {run.status === "running" ? (
          <Button variant="outline" size="sm" onPress={cancel} disabled={disabled}>
            Cancel run
          </Button>
        ) : null}
      </View>
    </View>
  );
}
function RunContent({ model }: { model: ScheduleDetailModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const lane = useSyncExternalStore(model.lane.subscribe, model.lane.getSnapshot);
  const preview = useMemo(
    () => (state.part ? Buffer.from(state.part.data, "base64").toString("utf8") : ""),
    [state.part],
  );
  const first = useCallback(() => model.part(0), [model]);
  const next = useCallback(() => {
    if (state.part) void model.part(state.part.part + 1);
  }, [model, state.part]);
  const previous = useCallback(() => {
    if (state.part) void model.part(state.part.part - 1);
  }, [model, state.part]);
  const copy = useCallback(() => copyToClipboard(state.part?.data ?? ""), [state.part]);
  const run = state.selectedRun;
  if (!run) return null;
  if (run.kind === "inline")
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Full run record</Text>
        <Text selectable style={styles.code}>
          {JSON.stringify(run.run, null, 2)}
        </Text>
      </View>
    );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Retained run record</Text>
      <Text
        selectable
        style={styles.code}
      >{`${run.content.bytes} bytes · ${run.content.parts} parts · ${run.content.revision}`}</Text>
      <Button variant="outline" size="sm" onPress={first} disabled={lane.busy}>
        Read first part
      </Button>
      {state.part ? (
        <>
          <Text
            style={styles.muted}
          >{`UTF-8 preview · part ${state.part.part + 1} of ${state.part.parts}. Part boundaries may split characters; Base64 copy preserves every byte.`}</Text>
          <Text selectable numberOfLines={15} style={styles.code}>
            {preview}
          </Text>
          <View style={styles.actions}>
            <Button
              variant="outline"
              size="sm"
              onPress={previous}
              disabled={lane.busy || state.part.part === 0}
            >
              Previous part
            </Button>
            <Button
              variant="outline"
              size="sm"
              onPress={next}
              disabled={lane.busy || state.part.part + 1 >= state.part.parts}
            >
              Next part
            </Button>
            <Button variant="outline" size="sm" onPress={copy}>
              Copy lossless Base64 part
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
}
function DetailActions({
  model,
  edit,
  transferred,
}: {
  model: ScheduleDetailModel;
  edit(document: ScheduleDocument): void;
  transferred(document: ScheduleDocument): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    lane = useSyncExternalStore(model.lane.subscribe, model.lane.getSnapshot);
  const refresh = useCallback(
    () =>
      model.refresh(
        lane.blocked
          ? confirmation(
              "Reload inspected Schedule?",
              "Inspect this Schedule and its current history before allowing another action. Uncertain outcomes must not be replayed.",
            )
          : undefined,
      ),
    [model, lane.blocked],
  );
  const pause = useCallback(
    () =>
      model.control(
        { type: "pause" },
        confirmation(
          "Pause Schedule?",
          "Prevent future automatic fires. Any active run keeps its own cancellation controls.",
        ),
      ),
    [model],
  );
  const resume = useCallback(
    () =>
      model.control(
        { type: "resume", userConfirmedInspection: true },
        confirmation(
          "Resume Schedule?",
          "Confirm you inspected the retained outcome, current target and authority before resuming future fires.",
        ),
      ),
    [model],
  );
  const run = useCallback(
    () =>
      model.control(
        { type: "run-once", userConfirmedInspection: true },
        confirmation(
          "Run Schedule once?",
          "Start this exact target once using the saved authority. Workflow approval gates still wait for you. Confirm you inspected any earlier uncertain outcome.",
        ),
      ),
    [model],
  );
  const remove = useCallback(
    () =>
      model.control(
        { type: "delete" },
        confirmation(
          "Delete Schedule?",
          "Remove future scheduling. Retained recovery records remain on the owning host.",
          true,
        ),
      ),
    [model],
  );
  const editing = useCallback(() => {
    if (state.document) edit(state.document);
  }, [state.document, edit]);
  const transfer = useCallback(() => {
    if (state.document) transferred(state.document);
  }, [state.document, transferred]);
  const disabled = lane.busy || lane.blocked || state.deleted;
  return (
    <View style={styles.contentGap}>
      <View style={styles.actions}>
        <Button variant="outline" onPress={refresh} disabled={lane.busy}>
          Refresh Schedule and history
        </Button>
        <Button variant="outline" onPress={editing} disabled={disabled}>
          Edit or repair target
        </Button>
        {state.document?.schedule.status === "active" ? (
          <Button variant="outline" onPress={pause} disabled={disabled}>
            Pause
          </Button>
        ) : (
          <Button variant="outline" onPress={resume} disabled={disabled}>
            Resume
          </Button>
        )}
        <Button variant="outline" onPress={run} disabled={disabled}>
          Run once
        </Button>
        <Button variant="outline" onPress={transfer} disabled={disabled}>
          Copy or move
        </Button>
        <Button variant="destructive" onPress={remove} disabled={disabled}>
          Delete
        </Button>
      </View>
      {lane.error ? <Alert variant="error" description={lane.error} /> : null}
      {lane.message ? <Alert description={lane.message} /> : null}
      {state.deleted ? (
        <Alert description="Schedule deleted. Refresh the list to choose another record." />
      ) : null}
      {state.acceptedRunId ? (
        <Text selectable style={styles.code}>{`Accepted run ${state.acceptedRunId}`}</Text>
      ) : null}
    </View>
  );
}
export function ScheduleDetail({
  api,
  reference,
  edit,
  transferred,
  refreshSignal,
}: {
  api: ScheduleApi;
  reference: ScheduleRef;
  edit(document: ScheduleDocument): void;
  transferred(document: ScheduleDocument): void;
  refreshSignal: number;
}) {
  const active = useScheduleActivity();
  const [model] = useState(() => new ScheduleDetailModel(api, reference));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    lane = useSyncExternalStore(model.lane.subscribe, model.lane.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const observed = useRef(refreshSignal);
  useEffect(() => {
    if (!active || lane.busy || observed.current === refreshSignal) return;
    observed.current = refreshSignal;
    // A read cannot acknowledge an uncertain write or authorize replay.
    void model.refresh();
  }, [model, active, lane.busy, refreshSignal]);
  const previous = useCallback(
    () => model.page(Math.max(0, state.offset - state.pageSize)),
    [model, state.offset, state.pageSize],
  );
  const next = useCallback(
    () => model.page(state.offset + state.pageSize),
    [model, state.offset, state.pageSize],
  );
  const pageSize = useCallback((value: string) => model.pageSize(Number(value)), [model]);
  const document = state.document;
  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{document?.schedule.name ?? reference.id}</Text>
      <Text
        selectable
        style={styles.muted}
      >{`${reference.scope.hostId} · ${reference.scope.projectId ?? "Unassigned legacy"} · ${reference.location}`}</Text>
      <DetailActions model={model} edit={edit} transferred={transferred} />
      {document ? (
        <View style={styles.card}>
          <StatusBadge label={document.schedule.status} />
          <Text style={styles.text}>{formatCadence(document.schedule.cadence)}</Text>
          <Text style={styles.text}>{document.schedule.prompt}</Text>
          <Text
            style={styles.muted}
          >{`Next ${document.schedule.nextRunAt ?? "not scheduled"} · Last ${document.schedule.lastRunAt ?? "never"}`}</Text>
          <Text selectable style={styles.code}>
            {JSON.stringify(document.schedule.target, null, 2)}
          </Text>
          {document.schedule.otto?.repairReason ? (
            <Alert variant="error" description={document.schedule.otto.repairReason} />
          ) : null}
        </View>
      ) : null}
      <Text style={styles.title}>{`Run history · ${state.total}`}</Text>
      <ScheduleChoice
        label="Runs per page"
        value={String(state.pageSize)}
        options={HISTORY_PAGE_SIZES}
        change={pageSize}
        disabled={lane.busy}
      />
      {state.history.map((run) => (
        <RunRow key={run.id} model={model} run={run} disabled={lane.busy || lane.blocked} />
      ))}
      <View style={styles.actions}>
        <Button
          variant="outline"
          size="sm"
          onPress={previous}
          disabled={lane.busy || state.offset === 0}
        >
          Previous runs
        </Button>
        <Button
          variant="outline"
          size="sm"
          onPress={next}
          disabled={lane.busy || state.offset + state.pageSize >= state.total}
        >
          More runs
        </Button>
      </View>
      <RunContent model={model} />
    </ScrollView>
  );
}
