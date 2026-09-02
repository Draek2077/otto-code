import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Run, RunPhase } from "@otto-code/protocol/workflow";
import { isTerminalRunStatus } from "@otto-code/protocol/workflow";
import { judgeVerdictPassed } from "@otto-code/protocol/judge-verdict";
import {
  MoreVertical,
  Network,
  Pencil,
  Plus,
  Trash2,
  Waypoints,
  X,
} from "@/components/icons/material-icons";
import { MenuHeader } from "@/components/headers/menu-header";
import {
  NewOrchestrationSheet,
  type NewOrchestrationPrefill,
} from "@/components/workflows/new-workflow-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";
import { LiveElapsed } from "@/components/live-elapsed";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExecutorRow, ProjectNameLine } from "@/components/project-row";
import { ProjectFilter, type ProjectFilterOption } from "@/components/project-filter";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
  describeScheduleCwd,
} from "@/schedules/schedule-project-targets";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { formatDuration } from "@/utils/time";
import { useProjects } from "@/hooks/use-projects";
import {
  resolveInitialAggregateProjectScope,
  usePreferredWorkspaceProjectScope,
} from "@/hooks/use-preferred-workspace-project-scope";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  collectRunAgentIds,
  useCancelRun,
  useDeleteRun,
  useRespondToRunGate,
  useRuns,
  type RunWithHost,
} from "@/hooks/use-runs";
import { openVisualizerTab } from "@/visualizer/open-visualizer-tab";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useRespondToWorkflowStartConfirmation } from "@/hooks/use-workflow-graphs";
import {
  describeWorkflowStorageRemediation,
  describeWorkflowStorageSource,
} from "@/workflows/storage-presentation";
import {
  applyRunFilters,
  describeRunTerminalPresentation,
  phaseStatusVariant,
  runStatusLabel,
  runStatusVariant,
  type RunStatusFilter,
} from "./runs-screen-presentation";

// ── Pure presentation helpers ───────────────────────────────────────────────

/** The gate phase a paused run is currently waiting on, if any. */
export function findBlockedGatePhase(run: Run): RunPhase | null {
  if (run.status !== "paused") {
    return null;
  }
  return run.phases.find((phase) => phase.type === "gate" && phase.status === "blocked") ?? null;
}

/** "2/4 passed" for a judged phase, or null when nothing was judged. */
export function summarizeVerdicts(phase: RunPhase): string | null {
  const candidates = phase.candidates ?? [];
  const judged = candidates.filter((candidate) => candidate.verdict);
  if (judged.length === 0) {
    return null;
  }
  const passed = judged.filter(
    (candidate) => candidate.verdict && judgeVerdictPassed(candidate.verdict),
  );
  return `${passed.length}/${judged.length} passed`;
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * The footer's shape pill, sitting beside the status pill: which engine drives
 * this orchestration. Graph runs say so by name - their node count isn't the
 * phase count a plan run reports - everything else counts phases.
 */
export function describeRunShape(run: Run): string {
  if (run.kind === "graph") {
    return "Graph";
  }
  if (run.kind === "ai") {
    return "AI Workflow";
  }
  return plural(run.phases.length, "phase");
}

/**
 * Short complexity chips derived from the run's shape (agents, fan-out…).
 * Phase count is deliberately absent - it's the footer's shape pill.
 */
export function describeRunComplexity(run: Run): string[] {
  const phases = run.phases;
  const chips: string[] = [];
  const agents =
    run.agentCount ?? phases.reduce((total, p) => total + (p.candidates?.length ?? 0), 0);
  if (agents > 0) {
    chips.push(plural(agents, "agent"));
  }
  const fanouts = phases.filter((p) => (p.fanOut ?? 1) > 1).length;
  if (fanouts > 0) {
    chips.push(`${fanouts} fan-out${fanouts === 1 ? "" : "s"}`);
  }
  const judged = phases.filter((p) => (p.candidates ?? []).some((c) => c.verdict)).length;
  if (judged > 0) {
    chips.push(`${judged} judged`);
  }
  const gates = phases.filter((p) => p.type === "gate").length;
  if (gates > 0) {
    chips.push(plural(gates, "gate"));
  }
  return chips;
}

/** Factual launch posture only: no provider rate-card estimate is invented. */
export function formatRunStartConfirmation(
  confirmation: NonNullable<Run["startConfirmation"]>,
): string {
  const agentLabel = confirmation.plannedAgentCount === 1 ? "agent" : "agents";
  const fanOut =
    confirmation.fanOutPhaseCount > 0
      ? ` ${confirmation.fanOutPhaseCount} fan-out phase${confirmation.fanOutPhaseCount === 1 ? " is" : "s are"} included.`
      : "";
  return confirmation.reason === "model-plan-declared"
    ? `The AI Workflow declared a plan that will start ${confirmation.plannedAgentCount} ${agentLabel}.${fanOut} The daemon cap is ${confirmation.agentCap}.`
    : `This Workflow will start ${confirmation.plannedAgentCount} ${agentLabel}.${fanOut} The daemon cap is ${confirmation.agentCap}.`;
}

/**
 * The card's location line: "Project · Workspace", falling back to the project
 * name alone when the workspace adds nothing (an unnamed main workspace) and to
 * the cwd-derived name when the client doesn't know the run's workspace at all.
 * A bare folder path is the last resort, never the first answer.
 */
export function describeRunLocation(input: {
  serverId: string;
  cwd: string | undefined;
  workspaceId: string | undefined;
  workspaces: ReadonlyMap<string, WorkspaceDescriptor> | undefined;
  projectNameByCwd: ReadonlyMap<string, string>;
}): string | null {
  const workspace = input.workspaceId ? input.workspaces?.get(input.workspaceId) : undefined;
  if (workspace) {
    const projectName = workspace.projectCustomName ?? workspace.projectDisplayName;
    const workspaceName = workspace.title ?? workspace.name;
    return workspaceName && workspaceName !== projectName
      ? `${projectName} · ${workspaceName}`
      : projectName;
  }
  if (!input.cwd) {
    return null;
  }
  return describeScheduleCwd({
    serverId: input.serverId,
    cwd: input.cwd,
    projectNameByCwd: input.projectNameByCwd,
  });
}

/** "Jan 15, 2026, 3:45 PM" for the footer meta line, or null when the date is unknown. */
export function formatRunDate(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Frozen run duration (createdAt → updatedAt) for a terminal run, e.g. "3m 12s".
 * Returns null while the run is still in flight - the card renders a live
 * ticker for those instead (mirrors subagents/track-presentation.ts).
 */
export function formatRunElapsed(run: Run): string | null {
  if (!isTerminalRunStatus(run.status) || !run.createdAt || !run.updatedAt) {
    return null;
  }
  const created = Date.parse(run.createdAt);
  const updated = Date.parse(run.updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) {
    return null;
  }
  return formatDuration(Math.max(0, updated - created));
}

/**
 * Sum of `cumulativeTokens` across the run's conductor + every spawned
 * candidate agent, resolved against the client's live agent directory (the
 * same honest per-agent counter the subagents track uses - see
 * AgentSnapshotPayload.cumulativeTokens). Null when none of those agents are
 * currently known, so the card never claims a cost it can't back up.
 */
export function sumRunTokens(
  run: Run,
  agentsById: ReadonlyMap<string, Agent> | undefined,
): number | null {
  if (!agentsById) {
    return null;
  }
  const agentIds = collectRunAgentIds(run);
  let total = 0;
  let found = false;
  for (const id of agentIds) {
    const tokens = agentsById.get(id)?.cumulativeTokens;
    if (typeof tokens === "number" && Number.isFinite(tokens)) {
      total += tokens;
      found = true;
    }
  }
  return found ? total : null;
}

// ── Filtering ────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: SegmentedControlOption<RunStatusFilter>[] = [
  { value: "all", label: "All", testID: "runs-filter-all" },
  { value: "draft", label: "Draft", testID: "runs-filter-draft" },
  { value: "active", label: "Active", testID: "runs-filter-active" },
  { value: "failed", label: "Failed", testID: "runs-filter-failed" },
  { value: "canceled", label: "Canceled", testID: "runs-filter-canceled" },
  { value: "completed", label: "Completed", testID: "runs-filter-completed" },
];

// ── Screen ──────────────────────────────────────────────────────────────────

export function RunsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <RunsScreenContent />;
}

const EMPTY_HOST_RUNS: Run[] = [];

/**
 * Fetches one host's runs via the sanctioned useRuns/useReplicaQuery path and
 * reports them to the parent. A pure data component (renders nothing) so the
 * parent can aggregate across a dynamic host list without calling hooks in a
 * loop or reaching for a raw multi-query hook.
 */
function HostRunsCollector({
  serverId,
  onRuns,
}: {
  serverId: string;
  onRuns: (serverId: string, runs: Run[], isLoading: boolean) => void;
}): null {
  const query = useRuns(serverId);
  const data = query.data;
  const isLoading = query.isLoading;
  useEffect(() => {
    onRuns(serverId, data ?? EMPTY_HOST_RUNS, isLoading);
  }, [serverId, data, isLoading, onRuns]);
  return null;
}

function RunsScreenContent(): ReactElement {
  const hosts = useHosts();
  const { projects } = useProjects();
  const sessions = useSessionStore((state) => state.sessions);
  const preferredWorkspaceScope = usePreferredWorkspaceProjectScope();

  const [newOrchestrationOpen, setNewOrchestrationOpen] = useState(false);
  const [editPrefill, setEditPrefill] = useState<NewOrchestrationPrefill | null>(null);
  const [status, setStatus] = useState<RunStatusFilter>("all");
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
  const hasExplicitScopeSelection = useRef(false);
  const [runsByHost, setRunsByHost] = useState<Record<string, Run[]>>({});
  const [loadingByHost, setLoadingByHost] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const handleHostRuns = useCallback((serverId: string, hostRuns: Run[], hostLoading: boolean) => {
    setRunsByHost((prev) =>
      prev[serverId] === hostRuns ? prev : { ...prev, [serverId]: hostRuns },
    );
    setLoadingByHost((prev) =>
      prev[serverId] === hostLoading ? prev : { ...prev, [serverId]: hostLoading },
    );
  }, []);

  const runs = useMemo<RunWithHost[]>(() => {
    const result: RunWithHost[] = [];
    for (const [serverId, hostRuns] of Object.entries(runsByHost)) {
      for (const run of hostRuns) {
        result.push({ ...run, serverId });
      }
    }
    return result;
  }, [runsByHost]);
  const isLoading = runs.length === 0 && Object.values(loadingByHost).some(Boolean);

  const scheduleProjectTargets = useMemo(() => buildScheduleProjectTargets(projects), [projects]);
  const projectNameByCwd = useMemo(
    () => buildProjectNameByCwd(scheduleProjectTargets),
    [scheduleProjectTargets],
  );
  // Every known project, whether or not it currently has runs - mirrors the
  // Artifacts/Schedules project filter so all three surfaces stay consistent.
  const projectOptions = useMemo<ProjectFilterOption[]>(() => {
    const byId = new Map<string, ProjectFilterOption>();
    for (const target of scheduleProjectTargets) {
      if (!byId.has(target.cwd)) {
        byId.set(target.cwd, { id: target.cwd, label: target.projectName });
      }
    }
    return Array.from(byId.values());
  }, [scheduleProjectTargets]);

  useEffect(() => {
    const initialScope = resolveInitialAggregateProjectScope({
      hasExplicitSelection: hasExplicitScopeSelection.current,
      preferredScope: preferredWorkspaceScope,
      availableHostIds: hosts.map((host) => host.serverId),
      projectTargets: scheduleProjectTargets,
    });
    if (!initialScope) return;
    setSelectedHost(initialScope.serverId);
    setProjectFilter(initialScope.cwd);
  }, [hosts, preferredWorkspaceScope, scheduleProjectTargets]);

  const handleSelectHost = useCallback((serverId: string) => {
    hasExplicitScopeSelection.current = true;
    setSelectedHost(serverId);
  }, []);
  const handleProjectFilterChange = useCallback((cwd: string | undefined) => {
    hasExplicitScopeSelection.current = true;
    setProjectFilter(cwd);
  }, []);

  const filter = useMemo(() => ({ status, cwd: projectFilter }), [status, projectFilter]);
  const filtered = useMemo(
    () =>
      applyRunFilters(
        selectedHost === ALL_HOSTS_OPTION_ID
          ? runs
          : runs.filter((run) => run.serverId === selectedHost),
        filter,
      ),
    [runs, filter, selectedHost],
  );

  // The user-initiated front door is gated on any connected host advertising
  // the capability; the dialog itself picks the host.
  // COMPAT(orchestrationGraphs): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  const canCreateOrchestration = useMemo(
    () =>
      hosts.some(
        (host) =>
          sessions[host.serverId]?.serverInfo?.features?.orchestrationGraphs === true &&
          sessions[host.serverId]?.serverInfo?.features?.workflowStartConfirmation === true,
      ),
    [hosts, sessions],
  );
  const openNewOrchestration = useCallback(() => {
    setEditPrefill(null);
    setNewOrchestrationOpen(true);
  }, []);
  const closeNewOrchestration = useCallback(() => {
    setNewOrchestrationOpen(false);
    setEditPrefill(null);
  }, []);
  // Editing a draft reopens the same dialog on that record (see
  // NewOrchestrationPrefill.draft) - a draft with nothing to reopen onto (no
  // graph, no project) can't be edited, which the card's gate already covers.
  const editOrchestration = useCallback((prefill: NewOrchestrationPrefill) => {
    setNewOrchestrationOpen(false);
    setEditPrefill(prefill);
  }, []);

  return (
    <View style={styles.container}>
      <MenuHeader title="Workflows" />
      <NewOrchestrationSheet
        visible={newOrchestrationOpen || editPrefill !== null}
        onClose={closeNewOrchestration}
        {...(editPrefill ? { prefill: editPrefill } : {})}
      />
      {hosts.map((host) => (
        <HostRunsCollector key={host.serverId} serverId={host.serverId} onRuns={handleHostRuns} />
      ))}
      <RunsScreenBody
        runs={filtered}
        hasAny={runs.length > 0}
        isLoading={isLoading}
        status={status}
        onStatusChange={setStatus}
        hosts={hosts}
        selectedHost={selectedHost}
        onSelectHost={handleSelectHost}
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        onProjectFilterChange={handleProjectFilterChange}
        projectNameByCwd={projectNameByCwd}
        canCreate={canCreateOrchestration}
        onCreate={openNewOrchestration}
        onEdit={editOrchestration}
      />
    </View>
  );
}

interface RunsScreenBodyProps {
  runs: RunWithHost[];
  hasAny: boolean;
  isLoading: boolean;
  status: RunStatusFilter;
  onStatusChange: (status: RunStatusFilter) => void;
  hosts: ReturnType<typeof useHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  projectOptions: ProjectFilterOption[];
  projectFilter: string | undefined;
  onProjectFilterChange: (projectId: string | undefined) => void;
  projectNameByCwd: ReadonlyMap<string, string>;
  canCreate: boolean;
  onCreate: () => void;
  onEdit: (prefill: NewOrchestrationPrefill) => void;
}

function resolveEmptyFilterText(status: RunStatusFilter): string {
  if (status === "draft") {
    return "No draft workflows";
  }
  if (status === "active") {
    return "No active workflows";
  }
  if (status === "failed") {
    return "No failed workflows";
  }
  if (status === "canceled") {
    return "No canceled workflows";
  }
  if (status === "completed") {
    return "No completed workflows";
  }
  return "No workflows match the current filters";
}

function RunsScreenBody({
  runs,
  hasAny,
  isLoading,
  status,
  onStatusChange,
  hosts,
  selectedHost,
  onSelectHost,
  projectOptions,
  projectFilter,
  onProjectFilterChange,
  projectNameByCwd,
  canCreate,
  onCreate,
  onEdit,
}: RunsScreenBodyProps): ReactElement {
  if (isLoading && !hasAny) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }

  if (!hasAny) {
    return (
      <View style={styles.centered} testID="runs-empty">
        <Text style={styles.message}>No workflows yet</Text>
        {canCreate ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={Plus}
            onPress={onCreate}
            testID="runs-empty-new"
          >
            Create a workflow
          </Button>
        ) : (
          <Text style={styles.messageSub}>Teams will orchestrate work on their own.</Text>
        )}
      </View>
    );
  }

  const emptyFilterText = resolveEmptyFilterText(status);

  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.filterControls}>
          {hosts.length > 1 ? (
            <HostFilter hosts={hosts} selectedHost={selectedHost} onSelectHost={onSelectHost} />
          ) : null}
          <View style={styles.projectFilterSlot}>
            <ProjectFilter
              options={projectOptions}
              value={projectFilter}
              onChange={onProjectFilterChange}
            />
          </View>
          <SegmentedControl
            size="sm"
            value={status}
            onValueChange={onStatusChange}
            options={STATUS_FILTER_OPTIONS}
            testID="runs-status-filter"
          />
        </View>
        {canCreate ? (
          <Button
            leftIcon={Plus}
            onPress={onCreate}
            size="sm"
            style={styles.newButton}
            testID="runs-new-workflow"
          >
            New Workflow
          </Button>
        ) : null}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="runs-list"
      >
        {runs.length > 0 ? (
          runs.map((run) => (
            <RunCard
              key={`${run.serverId}:${run.id}`}
              run={run}
              projectNameByCwd={projectNameByCwd}
              onEdit={onEdit}
            />
          ))
        ) : (
          <View style={styles.filterEmpty} testID="runs-filter-empty">
            <Text style={styles.filterEmptyText}>{emptyFilterText}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function RunSummary({ run }: { run: Run }): ReactElement | null {
  if (run.summaryStatus === "ready" && run.summary) {
    return (
      <View style={styles.summaryBlock}>
        <Text style={styles.summaryLabel}>Summary</Text>
        <Text style={styles.summaryText}>{run.summary}</Text>
      </View>
    );
  }
  if (run.summaryStatus === "pending") {
    return <Text style={styles.summaryPending}>Writing summary…</Text>;
  }
  return null;
}

/** Left slot of the footer row: always the state pill, so every card across
 * Artifacts/Schedules/Orchestrations reads the same way at a glance. */
function RunFooterMeta({
  run,
  totalTokens,
}: {
  run: RunWithHost;
  totalTokens: number | null;
}): ReactElement {
  const date = formatRunDate(run.createdAt);
  const frozenElapsed = formatRunElapsed(run);
  const isActive = !isTerminalRunStatus(run.status);
  return (
    <View style={styles.footerMeta}>
      {date ? (
        <Text style={styles.metaText} numberOfLines={1}>
          {date}
        </Text>
      ) : null}
      {run.createdAt && isActive ? (
        <>
          {date ? <Text style={styles.metaDot}>·</Text> : null}
          <LiveElapsed
            startedAt={new Date(run.createdAt)}
            active
            style={styles.metaText}
            testID={`run-elapsed-${run.id}`}
          />
        </>
      ) : null}
      {frozenElapsed ? (
        <>
          {date ? <Text style={styles.metaDot}>·</Text> : null}
          <Text style={styles.metaText}>{frozenElapsed}</Text>
        </>
      ) : null}
      {totalTokens !== null ? (
        <>
          {date || frozenElapsed || (run.createdAt && isActive) ? (
            <Text style={styles.metaDot}>·</Text>
          ) : null}
          <Text style={styles.metaText}>{formatTokenCount(totalTokens)} tok</Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * A draft is an orchestration the user configured but hasn't run - the one run
 * state that is still editable, so it's the only one that offers "Edit
 * Orchestration". Reopening the dialog needs the graph the draft executes and
 * the project it belongs to; a draft missing either can't be seeded back.
 */
function useDraftEditAction(input: {
  run: RunWithHost;
  enabled: boolean;
  onEdit: (prefill: NewOrchestrationPrefill) => void;
}): { canEdit: boolean; editDraft: () => void } {
  const { run, enabled, onEdit } = input;
  const graphId = run.graphId;
  const cwd = run.cwd;
  const canEdit = enabled && run.status === "draft" && Boolean(graphId) && Boolean(cwd);
  const editDraft = useCallback(() => {
    if (!graphId || !cwd) {
      return;
    }
    onEdit({
      serverId: run.serverId,
      projectCwd: cwd,
      graphId,
      runId: run.id,
      draft: {
        title: run.title,
        ...(run.description ? { description: run.description } : {}),
        ...(run.graphInputs ? { graphInputs: run.graphInputs } : {}),
      },
    });
  }, [onEdit, graphId, cwd, run.serverId, run.id, run.title, run.description, run.graphInputs]);
  return { canEdit, editDraft };
}

/**
 * One orchestration run, rendered as a card matching ArtifactCard/ScheduleCard:
 * glyph + title + kebab in the header, the executor and project lines as the
 * details rows, run-specific detail (chips, summary, phases) below them, a
 * spacer, and a footer of status pill + meta text. The only thing that stays
 * out of the kebab is the approval gate - it's a time-sensitive prompt, not an
 * action the user goes looking for.
 *
 * Hover lives on the outer plain View (docs/hover.md): the inner Pressable owns
 * press, the nested kebab Pressable never fights it, and the card background
 * highlights without reflow.
 */
function RunCard({
  run,
  projectNameByCwd,
  onEdit,
}: {
  run: RunWithHost;
  projectNameByCwd: ReadonlyMap<string, string>;
  onEdit: (prefill: NewOrchestrationPrefill) => void;
}): ReactElement {
  const serverId = run.serverId;
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const gateMutation = useRespondToRunGate(serverId);
  const startConfirmationMutation = useRespondToWorkflowStartConfirmation(serverId);
  const cancelMutation = useCancelRun(serverId);
  const deleteMutation = useDeleteRun(serverId);
  const agentsById = useSessionStore((state) => state.sessions[serverId]?.agents);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  // COMPAT(runsDelete): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  const hostCanDelete = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.runsDelete === true,
  );
  // COMPAT(runsDraftEdit): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  const hostCanEditDraft = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.runsDraftEdit === true,
  );
  const gatePhase = findBlockedGatePhase(run);
  const isActive = !isTerminalRunStatus(run.status);
  const gatePhaseId = gatePhase?.id;
  const startConfirmation = run.startConfirmation;

  const approveGate = useCallback(() => {
    if (gatePhaseId) {
      gateMutation.mutate({ runId: run.id, phaseId: gatePhaseId, approved: true });
    }
  }, [gateMutation, run.id, gatePhaseId]);
  const rejectGate = useCallback(() => {
    if (gatePhaseId) {
      gateMutation.mutate({ runId: run.id, phaseId: gatePhaseId, approved: false });
    }
  }, [gateMutation, run.id, gatePhaseId]);
  const respondToStartConfirmation = useCallback(
    (approved: boolean) => {
      startConfirmationMutation.mutate({ runId: run.id, approved });
    },
    [startConfirmationMutation, run.id],
  );
  const rejectStartConfirmation = useCallback(
    () => respondToStartConfirmation(false),
    [respondToStartConfirmation],
  );
  const approveStartConfirmation = useCallback(
    () => respondToStartConfirmation(true),
    [respondToStartConfirmation],
  );

  const runTitle = run.title;
  const cancelRun = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: "Cancel workflow",
        message: `Cancel "${runTitle}"? Its agents stop where they are.`,
        confirmLabel: "Cancel workflow",
        destructive: true,
      });
      if (confirmed) {
        cancelMutation.mutate(run.id);
      }
    })();
  }, [cancelMutation, run.id, runTitle]);

  const deleteRun = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: "Delete workflow",
        message: `Delete "${runTitle}"? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (confirmed) {
        deleteMutation.mutate(run.id);
      }
    })();
  }, [deleteMutation, run.id, runTitle]);

  const workspaceId = run.workspaceId;
  const runId = run.id;

  const { canEdit, editDraft } = useDraftEditAction({ run, enabled: hostCanEditDraft, onEdit });
  const visualizerEnabled = useFeatureEnabled("visualizer");
  const canVisualize = Boolean(workspaceId) && visualizerEnabled;
  const handleVisualize = useCallback(() => {
    if (workspaceId) {
      // Workflows is an app-wide screen, so the run's workspace is not the one
      // on screen. Opening the tab without carrying the user there leaves the
      // action looking like it did nothing.
      openVisualizerTab({ serverId, workspaceId, runId, navigate: true });
    }
  }, [serverId, workspaceId, runId]);

  const complexity = describeRunComplexity(run);
  const terminalPresentation = describeRunTerminalPresentation(run);
  const conductor = run.conductorAgentId ? agentsById?.get(run.conductorAgentId) : undefined;
  const location = describeRunLocation({
    serverId,
    cwd: run.cwd,
    workspaceId,
    workspaces,
    projectNameByCwd,
  });
  const totalTokens = sumRunTokens(run, agentsById);
  const terminalCardStyle = terminalPresentation
    ? cardStyleForTerminalTone(terminalPresentation.tone)
    : null;

  const cardStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.card,
      terminalCardStyle,
      isHovered && !isCompact && styles.cardHovered,
      pressed && canVisualize && styles.cardPressed,
    ],
    [terminalCardStyle, isHovered, isCompact, canVisualize],
  );

  return (
    <View
      style={styles.cardContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={cardStyle}
        onPress={canVisualize ? handleVisualize : undefined}
        accessibilityRole={canVisualize ? "button" : undefined}
        accessibilityLabel={
          canVisualize ? `Visualize ${run.title}, ${runStatusLabel(run)}` : undefined
        }
        testID={`run-card-${run.id}`}
      >
        <View style={styles.headerRow}>
          <Network size="md" color={styles.icon.color} />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {run.title}
          </Text>
          <RunKebabMenu
            run={run}
            canEdit={canEdit}
            onEdit={editDraft}
            canVisualize={canVisualize}
            canCancel={isActive}
            cancelPending={cancelMutation.isPending}
            // The daemon refuses to delete a live run, so the item only shows
            // once the run is finished - cancel first, then delete.
            canDelete={hostCanDelete && !isActive}
            deletePending={deleteMutation.isPending}
            onVisualize={handleVisualize}
            onCancel={cancelRun}
            onDelete={deleteRun}
          />
        </View>

        <ExecutorRow
          serverId={serverId}
          personalityName={conductor?.personalityName ?? null}
          provider={conductor?.provider ?? null}
          model={conductor?.model ?? null}
        />
        <ProjectNameLine projectName={location} />
        <WorkflowStorageRemediation provenance={run.workflowStorage} connectedHostId={serverId} />

        {/* Empty detail blocks are omitted, not rendered empty - an empty View
            still consumes one of the card's row gaps, which is what pushed the
            footer away from the details. */}
        {complexity.length > 0 ? (
          <View style={styles.chips}>
            {complexity.map((chip) => (
              <Text key={chip} style={styles.chip}>
                {chip}
              </Text>
            ))}
          </View>
        ) : null}

        {terminalPresentation ? (
          <View style={bannerStyleForTerminalTone(terminalPresentation.tone)}>
            <Text style={bannerTextStyleForTerminalTone(terminalPresentation.tone)}>
              {terminalPresentation.reason}
            </Text>
          </View>
        ) : null}

        <RunSummary run={run} />

        {run.phases.length > 0 ? (
          <View style={styles.phases}>
            {run.phases.map((phase) => {
              const verdicts = summarizeVerdicts(phase);
              const showNotes =
                phase.notes &&
                (phase.status === "failed" ||
                  phase.status === "skipped" ||
                  phase.status === "canceled" ||
                  phase.status === "blocked");
              return (
                <View key={phase.id} style={styles.phaseBlock}>
                  <View style={styles.phaseRow}>
                    <View style={styles.phaseMain}>
                      <Text style={styles.phaseType}>{phase.type}</Text>
                      <Text style={styles.phaseTitle} numberOfLines={1}>
                        {phase.title}
                      </Text>
                    </View>
                    <View style={styles.phaseRight}>
                      {verdicts ? <Text style={styles.verdictText}>{verdicts}</Text> : null}
                      <StatusBadge
                        label={phase.status}
                        variant={phaseStatusVariant(phase.status)}
                      />
                    </View>
                  </View>
                  {showNotes ? <Text style={styles.phaseNotes}>{phase.notes}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* The one action that stays on the card: a blocked gate is a prompt the
            user has to answer, not something to hunt for in a menu. */}
        {gatePhase ? (
          <View style={styles.gateRow}>
            <Text style={styles.gateLabel} numberOfLines={1}>
              Awaiting approval: {gatePhase.title}
            </Text>
            <View style={styles.gateButtons}>
              <Button
                variant="outline"
                size="sm"
                disabled={gateMutation.isPending}
                onPress={rejectGate}
                onPressIn={stopPressInPropagation}
              >
                Reject
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={gateMutation.isPending}
                onPress={approveGate}
                onPressIn={stopPressInPropagation}
              >
                Approve
              </Button>
            </View>
          </View>
        ) : null}

        <RunStartConfirmation
          runId={run.id}
          confirmation={startConfirmation}
          pending={startConfirmationMutation.isPending}
          onReject={rejectStartConfirmation}
          onApprove={approveStartConfirmation}
        />

        <View style={styles.footerRow}>
          <View style={styles.footerBadges}>
            <StatusBadge label={runStatusLabel(run)} variant={runStatusVariant(run.status)} />
            <StatusBadge label={describeRunShape(run)} />
            <StatusBadge label={describeWorkflowStorageSource(run.workflowStorage)} />
          </View>
          <RunFooterMeta run={run} totalTokens={totalTokens} />
        </View>
      </Pressable>
    </View>
  );
}

function WorkflowStorageRemediation({
  provenance,
  connectedHostId,
}: {
  provenance: Run["workflowStorage"];
  connectedHostId: string;
}): ReactElement | null {
  const remediation = describeWorkflowStorageRemediation({ provenance, connectedHostId });
  return remediation ? <Text style={styles.phaseNotes}>{remediation}</Text> : null;
}

function RunStartConfirmation({
  runId,
  confirmation,
  pending,
  onReject,
  onApprove,
}: {
  runId: string;
  confirmation: Run["startConfirmation"];
  pending: boolean;
  onReject: () => void;
  onApprove: () => void;
}): ReactElement | null {
  if (!confirmation) {
    return null;
  }
  return (
    <View style={styles.gateRow} testID={`run-start-confirmation-${runId}`}>
      <Text style={styles.gateLabel}>{formatRunStartConfirmation(confirmation)}</Text>
      <View style={styles.gateButtons}>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onPress={onReject}
          onPressIn={stopPressInPropagation}
        >
          Reject
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={pending}
          onPress={onApprove}
          onPressIn={stopPressInPropagation}
        >
          Start workflow
        </Button>
      </View>
    </View>
  );
}

// Inner controls (kebab, gate buttons) sit inside the card's Pressable. Stopping
// the press-in here keeps a tap on them from also firing the card's visualize
// action.
function stopPressInPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

// Themed icon wrappers so menu icons can live as module-scope constants (avoids
// the react-perf jsx-as-prop rule) without calling useUnistyles in render - see
// docs/unistyles.md and the artifact-card precedent.
const ThemedWaypoints = withUnistyles(Waypoints);
const ThemedPencil = withUnistyles(Pencil);
const ThemedX = withUnistyles(X);
const ThemedTrash2 = withUnistyles(Trash2);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const MENU_ICON_SIZE = 14;

const editLeading = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const visualizeLeading = <ThemedWaypoints size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const cancelLeading = <ThemedX size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;
const deleteLeading = <ThemedTrash2 size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;

function RunKebabMenu({
  run,
  canEdit,
  onEdit,
  canVisualize,
  canCancel,
  cancelPending,
  canDelete,
  deletePending,
  onVisualize,
  onCancel,
  onDelete,
}: {
  run: RunWithHost;
  canEdit: boolean;
  onEdit: () => void;
  canVisualize: boolean;
  canCancel: boolean;
  cancelPending: boolean;
  canDelete: boolean;
  deletePending: boolean;
  onVisualize: () => void;
  onCancel: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        onPressIn={stopPressInPropagation}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel="Workflow actions"
        testID={`run-kebab-${run.id}`}
      >
        <MoreVertical size="mdPlus" color={styles.icon.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {/* Drafts only: reopens the New Orchestration dialog on this record so
            its name, project, graph and inputs can be changed before it runs. */}
        {canEdit ? (
          <DropdownMenuItem
            leading={editLeading}
            onSelect={onEdit}
            testID={`run-menu-edit-${run.id}`}
          >
            Edit Workflow
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          leading={visualizeLeading}
          disabled={!canVisualize}
          onSelect={canVisualize ? onVisualize : undefined}
          testID={`run-menu-visualize-${run.id}`}
        >
          Visualize
        </DropdownMenuItem>
        {canCancel || canDelete ? <DropdownMenuSeparator /> : null}
        {canCancel ? (
          <DropdownMenuItem
            leading={cancelLeading}
            destructive
            disabled={cancelPending}
            onSelect={cancelPending ? undefined : onCancel}
            testID={`run-menu-cancel-${run.id}`}
          >
            Cancel workflow
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <DropdownMenuItem
            leading={deleteLeading}
            destructive
            disabled={deletePending}
            onSelect={deletePending ? undefined : onDelete}
            testID={`run-menu-delete-${run.id}`}
          >
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Chrome for the header's kebab. The hovered card is already surface2, so the
// control's own hover/press states step up to surfaceHover/surface4 - anything
// lower is invisible against the card.
function kebabTriggerStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.headerAction,
    hovered && styles.headerActionHovered,
    pressed && styles.headerActionPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  filterControls: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  projectFilterSlot: {
    flexShrink: 1,
  },
  // Tames the compactUp button doubling so the button, the project filter
  // beside it, and the status filter below all share the compact 32px control
  // height at every width - matching Artifacts and Schedules.
  newButton: {
    minHeight: 32,
    paddingHorizontal: theme.spacing[4],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  filterEmpty: {
    paddingVertical: theme.spacing[6],
    alignItems: "center",
  },
  filterEmptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    textAlign: "center",
  },
  messageSub: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  // Runs render as a single-column list (not the Artifacts/Schedules grid), so
  // the card sizes to its content - no flex:1 stretch inside the scroll view.
  cardContainer: {
    position: "relative",
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  cardError: {
    borderColor: theme.colors.palette.red[500],
  },
  cardCanceled: {
    borderColor: theme.colors.statusWarning,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerAction: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  headerActionHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  headerActionPressed: {
    backgroundColor: theme.colors.surface4,
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  chip: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    overflow: "hidden",
  },
  failureBanner: {
    backgroundColor: theme.colors.palette.red[900],
    borderWidth: 1,
    borderColor: theme.colors.palette.red[800],
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  failureText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  canceledBanner: {
    backgroundColor: theme.colors.statusWarningSurface,
    borderWidth: 1,
    borderColor: theme.colors.statusWarning,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  canceledText: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  summaryBlock: {
    gap: theme.spacing[1],
  },
  summaryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  summaryPending: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
  phases: {
    gap: theme.spacing[1.5],
  },
  phaseBlock: {
    gap: theme.spacing[1],
  },
  phaseNotes: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingLeft: theme.spacing[2],
  },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  phaseMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  phaseType: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
    minWidth: 64,
  },
  phaseTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  phaseRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  verdictText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  // No bottom spacer here (unlike the Artifacts/Schedules grid cards): this card
  // sizes to its content in a single-column list, so there is no sibling to
  // align the footer with - the spacer only ever added dead space under the
  // details. The card's own row gap is the whole separation.
  footerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  footerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 1,
    minWidth: 0,
  },
  footerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  metaDot: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  gateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  gateLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  gateButtons: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));

// Functions rather than module-scope maps: reading a style proxy at module
// scope bakes in the pre-theme value (docs/unistyles.md).
type TerminalTone = "error" | "warning";
const cardStyleForTerminalTone = (tone: TerminalTone) =>
  tone === "error" ? styles.cardError : styles.cardCanceled;
const bannerStyleForTerminalTone = (tone: TerminalTone) =>
  tone === "error" ? styles.failureBanner : styles.canceledBanner;
const bannerTextStyleForTerminalTone = (tone: TerminalTone) =>
  tone === "error" ? styles.failureText : styles.canceledText;
