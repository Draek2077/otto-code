import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  isTerminalRunStatus,
  type WorkflowEntry,
  type WorkflowRef,
  type RunPhase,
  type RunPhaseCandidate,
} from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useFetchQuery } from "@/data/query";
import { useWorkflowApi } from "./api";
import { useWorkflowAction } from "./use-action";
import { workflowQueryRoot } from "./data";
import { Recovery } from "./recovery";
import { TextField } from "./fields";
import { styles } from "./styles";
import { WorkflowRunGraph } from "./run-graph";
type Navigation = PluginSurfaceProps["navigation"];
function OpenChat({
  id,
  navigation,
  hostId,
  label = "Open chat",
}: {
  id: string;
  navigation: Navigation;
  hostId: string;
  label?: string;
}) {
  const open = useCallback(
    () => navigation?.openAgent({ agentId: id, serverId: hostId }),
    [navigation, id, hostId],
  );
  return navigation ? (
    <Button variant="outline" size="sm" onPress={open}>
      {label}
    </Button>
  ) : null;
}
function Candidate({
  candidate,
  reference,
  navigation,
  active,
}: {
  candidate: RunPhaseCandidate;
  reference: WorkflowRef;
  navigation: Navigation;
  active: boolean;
}) {
  const api = useWorkflowApi(),
    { model, state } = useWorkflowAction(active),
    [full, setFull] = useState("");
  const read = useCallback(async () => {
    if (!candidate.outputRevision) return;
    const value = await model.run(
      () =>
        api.output({
          ref: reference,
          agentId: candidate.agentId,
          revision: candidate.outputRevision!,
        }),
      false,
    );
    if (value) setFull(JSON.stringify(value, null, 2));
  }, [api, candidate.outputRevision, candidate.agentId, reference, model]);
  return (
    <View style={styles.card}>
      <Text
        style={styles.title}
      >{`${candidate.agentId} · ${candidate.stage ?? "settled"} · ${candidate.attempts ?? 1} attempt(s)`}</Text>
      <OpenChat id={candidate.agentId} navigation={navigation} hostId={reference.scope.hostId} />
      {candidate.judgeAgentIds?.map((id) => (
        <OpenChat
          key={id}
          id={id}
          navigation={navigation}
          hostId={reference.scope.hostId}
          label="Open judge chat"
        />
      ))}
      {candidate.error ? <Alert variant="error" description={candidate.error} /> : null}
      <Text selectable style={styles.text}>
        {candidate.summary ?? "No final summary recorded."}
      </Text>
      {candidate.verdict ? (
        <Text selectable style={styles.code}>
          {JSON.stringify(candidate.verdict, null, 2)}
        </Text>
      ) : null}
      {candidate.outputRevision ? (
        <Button onPress={read} disabled={!active || state.busy} variant="outline">
          Read full immutable result
        </Button>
      ) : null}
      {full ? (
        <Text selectable style={styles.code}>
          {full}
        </Text>
      ) : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
    </View>
  );
}
function Phase({
  phase,
  reference,
  navigation,
  active,
  decision,
}: {
  phase: RunPhase;
  reference: WorkflowRef;
  navigation: Navigation;
  active: boolean;
  decision(action: "approve" | "reject", phaseId: string): void;
}) {
  const approve = useCallback(() => decision("approve", phase.id), [decision, phase.id]),
    reject = useCallback(() => decision("reject", phase.id), [decision, phase.id]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{`${phase.title} · ${phase.status}`}</Text>
      <Text style={styles.text}>{phase.task}</Text>
      {phase.dependsOn?.length ? (
        <Text style={styles.muted}>{`Depends on ${phase.dependsOn.join(", ")}`}</Text>
      ) : null}
      {phase.notes ? <Text style={styles.muted}>{phase.notes}</Text> : null}
      {phase.type === "gate" && phase.status === "blocked" ? (
        <View style={styles.actions}>
          <Button variant="outline" disabled={!active} onPress={approve}>
            Approve gate
          </Button>
          <Button variant="outline" disabled={!active} onPress={reject}>
            Reject gate
          </Button>
        </View>
      ) : null}
      {phase.candidates?.map((candidate) => (
        <Candidate
          key={candidate.agentId}
          candidate={candidate}
          reference={reference}
          navigation={navigation}
          active={active}
        />
      ))}
    </View>
  );
}
export function WorkflowRun({
  reference,
  active,
  navigation,
  changed,
}: {
  reference: WorkflowRef;
  active: boolean;
  navigation: Navigation;
  changed(entry: WorkflowEntry): void;
}) {
  const api = useWorkflowApi(),
    { model, state } = useWorkflowAction(active),
    [note, setNote] = useState("");
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: [...workflowQueryRoot(reference.scope), "run", reference],
    enabled: active,
    retry: false,
    queryFn: () => api.read(reference),
  });
  const entry = query.data,
    run = entry?.document.kind === "run" ? entry.document.value : null;
  const decision = useCallback(
    async (action: "cancel" | "approve" | "reject", phaseId?: string) => {
      if (
        !entry ||
        !(await confirmDialog({
          title: "Workflow decision",
          message:
            action === "approve"
              ? "Approve this exact pending plan or gate? This does not approve later gates."
              : "Stop this Workflow decision? Completed edits remain. Rejected gates are canceled, not failed.",
          confirmLabel: action === "approve" ? "Approve" : "Stop",
          cancelLabel: "Keep",
        }))
      )
        return;
      const value = await model.run(() =>
        api.control({
          ref: reference,
          expectedRevision: entry.revision,
          action,
          phaseId,
          note: note || undefined,
          confirmed: true,
        }),
      );
      if (value) {
        changed(value);
        void query.refetch();
      }
    },
    [api, entry, reference, note, model, changed, query],
  );
  const cancel = useCallback(() => decision("cancel"), [decision]),
    approve = useCallback(() => decision("approve"), [decision]),
    reject = useCallback(() => decision("reject"), [decision]);
  const refresh = useCallback(async () => {
    const value = await query.refetch();
    if (value.data) model.inspected();
  }, [query, model]);
  if (!run)
    return (
      <View style={styles.content}>
        {query.error ? (
          <Alert variant="error" description={query.error.message} />
        ) : (
          <Text style={styles.muted}>Loading Workflow...</Text>
        )}
        <Recovery reference={reference} active={active} changed={changed} />
      </View>
    );
  return (
    <View style={styles.content}>
      <Text style={styles.title}>{`${run.title} · ${run.status}`}</Text>
      <Text style={styles.muted}>
        {run.graphSnapshot
          ? "Graph Workflow: actual declared node outcomes"
          : "AI Workflow: actual declared phases and sessions"}
      </Text>
      <View style={styles.actions}>
        <OpenChat
          id={run.conductorAgentId ?? ""}
          navigation={navigation}
          hostId={reference.scope.hostId}
          label="Open conductor chat"
        />
        <Button variant="ghost" onPress={refresh} disabled={state.busy}>
          Refresh run
        </Button>
        {!isTerminalRunStatus(run.status) ? (
          <Button
            variant="outline"
            onPress={cancel}
            disabled={!active || state.busy || state.blocked}
          >
            Cancel Workflow
          </Button>
        ) : null}
      </View>
      {run.status === "planning" ? (
        <Alert description="Planning continues in the conductor chat. Clarifying turns do not end the Workflow. No execution timeout or workers are running until a plan is declared and admitted." />
      ) : null}
      {run.declaredPlan && run.awaitingStartConfirmation === true ? (
        <View style={styles.card}>
          <Text style={styles.title}>Declared plan awaiting confirmation</Text>
          <Text selectable style={styles.code}>
            {JSON.stringify(run.declaredPlan, null, 2)}
          </Text>
          <View style={styles.actions}>
            <Button
              variant="outline"
              onPress={approve}
              disabled={!active || state.busy || state.blocked}
            >
              Start declared plan
            </Button>
            <Button
              variant="outline"
              onPress={reject}
              disabled={!active || state.busy || state.blocked}
            >
              Reject plan
            </Button>
          </View>
        </View>
      ) : null}
      <TextField label="Decision note (optional)" value={note} onChange={setNote} />
      <RunErrors run={run} />

      {state.error ? <Alert variant="error" description={state.error} /> : null}
      <Text selectable style={styles.text}>
        {run.summary ?? ""}
      </Text>
      <RunTopology entry={entry!} />
      {run.phases.map((phase) => (
        <Phase
          key={phase.id}
          phase={phase}
          reference={reference}
          navigation={navigation}
          active={active && !state.busy && !state.blocked}
          decision={decision}
        />
      ))}
      <Recovery reference={reference} active={active} changed={changed} />
    </View>
  );
}
function RunTopology({ entry }: { entry: WorkflowEntry }) {
  if (entry.document.kind !== "run") return null;
  const run = entry.document.value,
    graph = run.graphSnapshot;
  if (!graph) return null;
  return <WorkflowRunGraph graph={graph} run={run} />;
}

function RunErrors({ run }: { run: import("@getpaseo/plugin/otto/workflows").WorkflowRunRecord }) {
  return (
    <View>
      {run.error ? <Alert variant="error" description={run.error} /> : null}
      {run.completionDeliveryError ? (
        <Alert variant="warning" description={run.completionDeliveryError} />
      ) : null}
    </View>
  );
}
