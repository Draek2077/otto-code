import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useShallow } from "zustand/shallow";
import type { JudgeVerdict } from "@otto-code/protocol/judge-verdict";
import { judgeVerdictPassed } from "@otto-code/protocol/judge-verdict";
import type { Run, RunPhase, RunPhaseCandidate } from "@otto-code/protocol/workflow";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Network,
} from "@/components/icons/material-icons";
import { ExecutorRow } from "@/components/project-row";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useRuns } from "@/hooks/use-runs";
import { usePaneContext } from "@/panels/pane-context";
import {
  definePanel,
  type PanelDescriptor,
  type PanelDescriptorContext,
} from "@/panels/panel-registry";
import {
  formatRunSpend,
  phaseStatusVariant,
  runStatusLabel,
  runStatusVariant,
  selectRunTotals,
} from "@/screens/runs-screen-presentation";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import {
  addChatContributor,
  createChatTotalsTally,
  finalizeChatTotals,
} from "@/subagents/chat-totals";
import { openWorkflowChatTab } from "@/workflows/open-workflow-run";

type WorkflowRunTarget = Extract<WorkspaceTabTarget, { kind: "workflowRun" }>;

function useWorkflowRun(serverId: string, runId: string): { run: Run | null; loading: boolean } {
  const runsQuery = useRuns(serverId);
  const run = useMemo(
    () => (runsQuery.data ?? []).find((candidate) => candidate.id === runId) ?? null,
    [runsQuery.data, runId],
  );
  return { run, loading: runsQuery.isLoading };
}

function useWorkflowRunPanelDescriptor(
  target: WorkflowRunTarget,
  context: PanelDescriptorContext,
): PanelDescriptor {
  const { run } = useWorkflowRun(context.serverId, target.runId);
  const title = run?.title ?? "Workflow";
  return {
    label: title,
    tooltip: title,
    subtitle: "Workflow",
    titleState: "ready",
    icon: Network,
    statusBucket: null,
  };
}

/** What a worker chat spent, with its judges folded in: the row's own cost. */
function selectWorkerSpend(
  agents: ReadonlyMap<string, Agent> | undefined,
  candidate: RunPhaseCandidate,
): string | null {
  const tally = createChatTotalsTally();
  for (const id of [candidate.agentId, ...(candidate.judgeAgentIds ?? [])]) {
    const agent = agents?.get(id);
    if (agent) {
      addChatContributor(tally, agent);
    }
  }
  const totals = finalizeChatTotals(tally);
  return totals.tokens > 0 ? formatRunSpend(totals) : null;
}

function WorkflowRunPanel(): ReactElement {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "workflowRun", "WorkflowRunPanel requires a workflowRun target");
  const { run, loading } = useWorkflowRun(serverId, target.runId);

  if (!run) {
    return (
      <View style={styles.empty} testID="workflow-run-panel-missing">
        <Text style={styles.emptyText}>
          {loading ? "Loading workflow…" : "This workflow is no longer on this host."}
        </Text>
      </View>
    );
  }
  return <WorkflowRunDetail serverId={serverId} workspaceId={workspaceId} run={run} />;
}

function WorkflowRunDetail({
  serverId,
  workspaceId,
  run,
}: {
  serverId: string;
  workspaceId: string;
  run: Run;
}): ReactElement {
  const totals = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectRunTotals(run, state.sessions[serverId]?.agents),
    equal,
  );
  const conductorId = run.conductorAgentId;
  const conductor = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      const agent = conductorId
        ? (session?.agents.get(conductorId) ?? session?.agentDetails.get(conductorId))
        : undefined;
      return {
        personalityName: agent?.personalityName ?? null,
        provider: agent?.provider ?? null,
        model: agent?.model ?? null,
      };
    }),
  );
  const openChat = useCallback(
    (agentId: string) => openWorkflowChatTab({ serverId, workspaceId, run, agentId }),
    [serverId, workspaceId, run],
  );
  const openConductor = useCallback(() => {
    if (conductorId) {
      openChat(conductorId);
    }
  }, [conductorId, openChat]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      testID="workflow-run-panel"
    >
      <View style={styles.header}>
        <Network size="md" color={styles.muted.color} />
        <Text style={styles.title} selectable>
          {run.title}
        </Text>
        <StatusBadge label={runStatusLabel(run)} variant={runStatusVariant(run.status)} />
      </View>
      {totals ? <Text style={styles.meta}>{formatRunSpend(totals)}</Text> : null}

      {conductorId ? (
        <View style={styles.conductorRow}>
          <Text style={styles.label}>Conductor</Text>
          <View style={styles.grow}>
            <ExecutorRow serverId={serverId} {...conductor} />
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={openConductor}
            testID="workflow-run-open-conductor"
          >
            Open chat
          </Button>
        </View>
      ) : null}

      {run.error ? (
        <Text style={styles.error} selectable>
          {run.error}
        </Text>
      ) : null}
      {run.summary ? (
        <Text style={styles.body} selectable>
          {run.summary}
        </Text>
      ) : null}
      {run.requirements && run.requirements.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>Requirements</Text>
          {run.requirements.map((requirement) => (
            <Text key={requirement} style={styles.body} selectable>
              {`• ${requirement}`}
            </Text>
          ))}
        </View>
      ) : null}

      {run.phases.map((phase) => (
        <PhaseSection key={phase.id} serverId={serverId} phase={phase} onOpenChat={openChat} />
      ))}
    </ScrollView>
  );
}

function PhaseSection({
  serverId,
  phase,
  onOpenChat,
}: {
  serverId: string;
  phase: RunPhase;
  onOpenChat: (agentId: string) => void;
}): ReactElement {
  const candidates = phase.candidates ?? [];
  return (
    <View style={styles.phase} testID={`workflow-run-phase-${phase.id}`}>
      <View style={styles.phaseHeader}>
        <Text style={styles.phaseType}>{phase.type}</Text>
        <Text style={styles.phaseTitle} numberOfLines={1}>
          {phase.title}
        </Text>
        <StatusBadge label={phase.status} variant={phaseStatusVariant(phase.status)} />
      </View>
      <ExpandableText text={phase.task} collapsedLines={3} />
      {phase.notes ? (
        <Text style={styles.meta} selectable>
          {phase.notes}
        </Text>
      ) : null}
      {candidates.length === 0 ? (
        <Text style={styles.meta}>No chats yet.</Text>
      ) : (
        candidates.map((candidate) => (
          <WorkerRow
            key={candidate.agentId}
            serverId={serverId}
            candidate={candidate}
            onOpenChat={onOpenChat}
          />
        ))
      )}
    </View>
  );
}

function WorkerRow({
  serverId,
  candidate,
  onOpenChat,
}: {
  serverId: string;
  candidate: RunPhaseCandidate;
  onOpenChat: (agentId: string) => void;
}): ReactElement {
  const agentId = candidate.agentId;
  const worker = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      return {
        title: agent?.title ?? null,
        personalityName: agent?.personalityName ?? null,
        provider: agent?.provider ?? null,
        model: agent?.model ?? null,
      };
    }),
  );
  const spend = useSessionStore((state) =>
    selectWorkerSpend(state.sessions[serverId]?.agents, candidate),
  );
  const openWorker = useCallback(() => onOpenChat(agentId), [onOpenChat, agentId]);
  const attempts = candidate.attempts ?? 1;
  const judgeIds = candidate.judgeAgentIds ?? [];

  return (
    <View style={styles.worker} testID={`workflow-run-worker-${agentId}`}>
      <View style={styles.workerHeader}>
        <View style={styles.grow}>
          <Text style={styles.workerTitle} numberOfLines={1}>
            {worker.title ?? agentId}
          </Text>
          <ExecutorRow
            serverId={serverId}
            personalityName={worker.personalityName}
            provider={worker.provider}
            model={worker.model}
          />
        </View>
        {candidate.verdict ? <VerdictBadge verdict={candidate.verdict} /> : null}
        <Button
          variant="outline"
          size="sm"
          onPress={openWorker}
          testID={`workflow-run-open-${agentId}`}
        >
          Open chat
        </Button>
      </View>
      <Text style={styles.meta}>
        {[attempts > 1 ? `${attempts} attempts` : null, spend].filter(Boolean).join(" · ")}
      </Text>
      {candidate.error ? (
        <Text style={styles.error} selectable>
          {candidate.error}
        </Text>
      ) : null}
      {candidate.verdict ? <VerdictDetail verdict={candidate.verdict} /> : null}
      {judgeIds.length > 0 ? (
        <View style={styles.judges}>
          {judgeIds.map((judgeId, index) => (
            <JudgeButton
              key={judgeId}
              label={judgeIds.length > 1 ? `Judge, attempt ${index + 1}` : "Judge chat"}
              agentId={judgeId}
              onOpenChat={onOpenChat}
            />
          ))}
        </View>
      ) : null}
      {candidate.summary ? (
        <View style={styles.section}>
          <Text style={styles.label}>Final message</Text>
          <ExpandableText text={candidate.summary} collapsedLines={6} />
        </View>
      ) : null}
    </View>
  );
}

function JudgeButton({
  label,
  agentId,
  onOpenChat,
}: {
  label: string;
  agentId: string;
  onOpenChat: (agentId: string) => void;
}): ReactElement {
  const open = useCallback(() => onOpenChat(agentId), [onOpenChat, agentId]);
  return (
    <Button variant="ghost" size="sm" onPress={open} testID={`workflow-run-open-${agentId}`}>
      {label}
    </Button>
  );
}

function VerdictBadge({ verdict }: { verdict: JudgeVerdict }): ReactElement {
  const passed = judgeVerdictPassed(verdict);
  const score = typeof verdict.score === "number" ? ` ${verdict.score.toFixed(2)}` : "";
  return (
    <StatusBadge
      label={`${passed ? "Passed" : "Failed"}${score}`}
      variant={passed ? "success" : "error"}
    />
  );
}

function VerdictDetail({ verdict }: { verdict: JudgeVerdict }): ReactElement {
  return (
    <View style={styles.section}>
      {verdict.summary ? (
        <Text style={styles.body} selectable>
          {verdict.summary}
        </Text>
      ) : null}
      {(verdict.criteria ?? []).map((criterion) => (
        <View key={criterion.name} style={styles.criterion}>
          {criterion.met ? (
            <CircleCheck size="sm" color={styles.success.color} />
          ) : (
            <CircleX size="sm" color={styles.failure.color} />
          )}
          <View style={styles.grow}>
            <Text style={styles.criterionName} selectable>
              {criterion.name}
            </Text>
            {criterion.evidence ? (
              <ExpandableText text={criterion.evidence} collapsedLines={2} />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Long run text (tasks, final messages, evidence) collapsed to a few lines. */
function ExpandableText({
  text,
  collapsedLines,
}: {
  text: string;
  collapsedLines: number;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const long = text.length > collapsedLines * 90 || text.split("\n").length > collapsedLines;
  return (
    <View>
      <Text style={styles.body} selectable numberOfLines={expanded ? undefined : collapsedLines}>
        {text}
      </Text>
      {long ? (
        <Pressable onPress={toggle} style={styles.toggle} accessibilityRole="button">
          {expanded ? (
            <ChevronDown size="sm" color={styles.muted.color} />
          ) : (
            <ChevronRight size="sm" color={styles.muted.color} />
          )}
          <Text style={styles.toggleText}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const workflowRunPanelRegistration = definePanel("workflowRun", {
  component: WorkflowRunPanel,
  useDescriptor: useWorkflowRunPanelDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    maxWidth: 960,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  conductorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  grow: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  section: {
    gap: theme.spacing[1],
  },
  phase: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  phaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  phaseType: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
  },
  phaseTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  worker: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
  },
  workerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  workerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  judges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  criterion: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  criterionName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
  },
  toggleText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  muted: {
    color: theme.colors.foregroundMuted,
  },
  success: {
    color: theme.colors.statusSuccess,
  },
  failure: {
    color: theme.colors.statusDanger,
  },
}));
