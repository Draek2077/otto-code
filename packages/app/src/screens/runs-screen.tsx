import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet } from "react-native-unistyles";
import type { Run, RunPhase } from "@otto-code/protocol/orchestration";
import { isTerminalRunStatus } from "@otto-code/protocol/orchestration";
import { judgeVerdictPassed } from "@otto-code/protocol/judge-verdict";
import { Network, Trash2, Waypoints } from "@/components/icons/material-icons";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { LiveElapsed } from "@/components/live-elapsed";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectRow } from "@/components/project-row";
import { ProjectFilter, type ProjectFilterOption } from "@/components/project-filter";
import { artifactBelongsToWorkspace } from "@/artifacts/artifact-derivation";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
  describeScheduleCwd,
} from "@/schedules/schedule-project-targets";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { formatDuration } from "@/utils/time";
import { useProjects } from "@/hooks/use-projects";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  collectRunAgentIds,
  useCancelRun,
  useClearFinishedRuns,
  useRespondToRunGate,
  useRuns,
  type RunWithHost,
} from "@/hooks/use-runs";
import { openVisualizerTab } from "@/visualizer/open-visualizer-tab";
import { useFeatureEnabled } from "@/features/use-feature-enabled";

// ── Pure presentation helpers ───────────────────────────────────────────────

type BadgeVariant = "success" | "warning" | "error";

export function runStatusVariant(status: string): BadgeVariant {
  if (status === "done") {
    return "success";
  }
  if (status === "failed" || status === "canceled") {
    return "error";
  }
  // pending, running, paused — still in flight or waiting on a human.
  return "warning";
}

/** Label for the run-level status pill — "Completed"/"Failed" read clearer
 * there than the raw status; per-phase badges keep the raw "Done" etc. */
export function runStatusLabel(status: string): string {
  if (status === "done") {
    return "Completed";
  }
  if (status === "canceled") {
    return "Failed";
  }
  return status;
}

export function phaseStatusVariant(status: string): BadgeVariant {
  if (status === "done") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  // pending, running, blocked, skipped.
  return "warning";
}

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

/** Short complexity chips derived from the run's shape (phases, agents, fan-out…). */
export function describeRunComplexity(run: Run): string[] {
  const phases = run.phases;
  const chips: string[] = [plural(phases.length, "phase")];
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

/** A one-line reason a run/phase didn't succeed, for the failure banner. */
export function describeRunFailure(run: Run): string | null {
  if (run.status === "failed") {
    const failedPhase = run.phases.find((p) => p.status === "failed");
    return run.error ?? failedPhase?.notes ?? "The run failed.";
  }
  if (run.status === "canceled") {
    return run.error ?? "The run was canceled.";
  }
  return null;
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
 * Returns null while the run is still in flight — the card renders a live
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
 * same honest per-agent counter the subagents track uses — see
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

export type RunStatusFilter = "all" | "succeeded" | "failed";

const STATUS_FILTER_OPTIONS: SegmentedControlOption<RunStatusFilter>[] = [
  { value: "all", label: "All", testID: "runs-filter-all" },
  { value: "succeeded", label: "Completed", testID: "runs-filter-succeeded" },
  { value: "failed", label: "Failed", testID: "runs-filter-failed" },
];

export function matchesStatusFilter(run: Run, filter: RunStatusFilter): boolean {
  if (filter === "succeeded") {
    return run.status === "done";
  }
  if (filter === "failed") {
    return run.status === "failed" || run.status === "canceled";
  }
  return true;
}

export function applyRunFilters(
  runs: readonly RunWithHost[],
  filter: { status: RunStatusFilter; cwd: string | undefined },
): RunWithHost[] {
  return runs.filter(
    (run) =>
      matchesStatusFilter(run, filter.status) &&
      (filter.cwd === undefined ||
        (run.cwd !== undefined && artifactBelongsToWorkspace(run.cwd, filter.cwd))),
  );
}

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
  const { clearAll, isPending: isClearing } = useClearFinishedRuns();

  const [status, setStatus] = useState<RunStatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
  const [runsByHost, setRunsByHost] = useState<Record<string, Run[]>>({});
  const [loadingByHost, setLoadingByHost] = useState<Record<string, boolean>>({});

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
  // Every known project, whether or not it currently has runs — mirrors the
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

  const filter = useMemo(() => ({ status, cwd: projectFilter }), [status, projectFilter]);
  const filtered = useMemo(() => applyRunFilters(runs, filter), [runs, filter]);

  const clearableServerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of runs) {
      if (
        isTerminalRunStatus(run.status) &&
        sessions[run.serverId]?.serverInfo?.features?.runsClear === true
      ) {
        ids.add(run.serverId);
      }
    }
    return [...ids];
  }, [runs, sessions]);

  const handleClearAll = useCallback(() => {
    clearAll(clearableServerIds);
  }, [clearAll, clearableServerIds]);

  return (
    <View style={styles.container}>
      <MenuHeader title="Orchestrations" />
      {hosts.map((host) => (
        <HostRunsCollector key={host.serverId} serverId={host.serverId} onRuns={handleHostRuns} />
      ))}
      <RunsScreenBody
        runs={filtered}
        hasAny={runs.length > 0}
        isLoading={isLoading}
        status={status}
        onStatusChange={setStatus}
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
        projectNameByCwd={projectNameByCwd}
        onClearAll={handleClearAll}
        canClearAll={clearableServerIds.length > 0}
        isClearing={isClearing}
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
  projectOptions: ProjectFilterOption[];
  projectFilter: string | undefined;
  onProjectFilterChange: (projectId: string | undefined) => void;
  projectNameByCwd: ReadonlyMap<string, string>;
  onClearAll: () => void;
  canClearAll: boolean;
  isClearing: boolean;
}

function RunsScreenBody({
  runs,
  hasAny,
  isLoading,
  status,
  onStatusChange,
  projectOptions,
  projectFilter,
  onProjectFilterChange,
  projectNameByCwd,
  onClearAll,
  canClearAll,
  isClearing,
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
        <Text style={styles.message}>No orchestrations yet</Text>
        <Text style={styles.messageSub}>Teams will orchestrate work on their own.</Text>
      </View>
    );
  }

  let emptyFilterText = "No orchestrations match the current filters";
  if (status === "succeeded") {
    emptyFilterText = "No completed orchestrations";
  } else if (status === "failed") {
    emptyFilterText = "No failed orchestrations";
  }

  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.projectFilterSlot}>
          <ProjectFilter
            options={projectOptions}
            value={projectFilter}
            onChange={onProjectFilterChange}
          />
        </View>
        <Button
          leftIcon={Trash2}
          onPress={onClearAll}
          disabled={!canClearAll || isClearing}
          size="sm"
          style={styles.clearButton}
          testID="runs-clear-all"
        >
          Clear all
        </Button>
      </View>
      <View style={styles.statusRow}>
        <SegmentedControl
          size="sm"
          value={status}
          onValueChange={onStatusChange}
          options={STATUS_FILTER_OPTIONS}
          testID="runs-status-filter"
        />
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

function RunCard({
  run,
  projectNameByCwd,
}: {
  run: RunWithHost;
  projectNameByCwd: ReadonlyMap<string, string>;
}): ReactElement {
  const serverId = run.serverId;
  const gateMutation = useRespondToRunGate(serverId);
  const cancelMutation = useCancelRun(serverId);
  const agentsById = useSessionStore((state) => state.sessions[serverId]?.agents);
  const gatePhase = findBlockedGatePhase(run);
  const isActive = !isTerminalRunStatus(run.status);
  const gatePhaseId = gatePhase?.id;

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
  const cancelRun = useCallback(() => {
    cancelMutation.mutate(run.id);
  }, [cancelMutation, run.id]);
  const workspaceId = run.workspaceId;
  const runId = run.id;
  const visualizerEnabled = useFeatureEnabled("visualizer");
  const handleVisualize = useCallback(() => {
    if (workspaceId) {
      openVisualizerTab({ serverId, workspaceId, runId });
    }
  }, [serverId, workspaceId, runId]);

  const complexity = describeRunComplexity(run);
  const failure = describeRunFailure(run);
  const provider = run.conductorAgentId
    ? (agentsById?.get(run.conductorAgentId)?.provider ?? null)
    : null;
  const projectName = run.cwd
    ? describeScheduleCwd({ serverId, cwd: run.cwd, projectNameByCwd })
    : null;
  const totalTokens = sumRunTokens(run, agentsById);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Network size={16} color={styles.icon.color} />
        <Text style={styles.cardTitle} numberOfLines={2}>
          {run.title}
        </Text>
      </View>

      <ProjectRow provider={provider} projectName={projectName} />

      <View style={styles.chips}>
        {complexity.map((chip) => (
          <Text key={chip} style={styles.chip}>
            {chip}
          </Text>
        ))}
      </View>

      {failure ? (
        <View style={styles.failureBanner}>
          <Text style={styles.failureText}>{failure}</Text>
        </View>
      ) : null}

      <RunSummary run={run} />

      <View style={styles.phases}>
        {run.phases.map((phase) => {
          const verdicts = summarizeVerdicts(phase);
          const showNotes =
            phase.notes &&
            (phase.status === "failed" || phase.status === "skipped" || phase.status === "blocked");
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
                  <StatusBadge label={phase.status} variant={phaseStatusVariant(phase.status)} />
                </View>
              </View>
              {showNotes ? <Text style={styles.phaseNotes}>{phase.notes}</Text> : null}
            </View>
          );
        })}
      </View>

      {/* Spacer pins the footer to the bottom of the card regardless of how
          much detail sits above it, so cards in a row align. */}
      <View style={styles.spacer} />

      <View style={styles.footerRow}>
        <StatusBadge label={runStatusLabel(run.status)} variant={runStatusVariant(run.status)} />
        <RunFooterMeta run={run} totalTokens={totalTokens} />
      </View>

      {workspaceId && visualizerEnabled ? (
        <View style={styles.gateRow}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Waypoints}
            onPress={handleVisualize}
            testID="run-visualize-button"
          >
            Visualize
          </Button>
        </View>
      ) : null}

      {gatePhase ? (
        <View style={styles.gateRow}>
          <Text style={styles.gateLabel}>Awaiting approval: {gatePhase.title}</Text>
          <View style={styles.gateButtons}>
            <Button
              variant="outline"
              size="sm"
              disabled={gateMutation.isPending}
              onPress={rejectGate}
            >
              Reject
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={gateMutation.isPending}
              onPress={approveGate}
            >
              Approve
            </Button>
          </View>
        </View>
      ) : null}

      {!gatePhase && isActive ? (
        <View style={styles.gateRow}>
          <Button variant="ghost" size="sm" disabled={cancelMutation.isPending} onPress={cancelRun}>
            Cancel orchestration
          </Button>
        </View>
      ) : null}
    </View>
  );
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
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  projectFilterSlot: {
    flexShrink: 1,
  },
  // Tames the compactUp button doubling so the button and the project filter
  // beside it share the same field height at every width.
  clearButton: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[4],
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: { xs: "center", md: "flex-start" },
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
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
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
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
  spacer: {
    flex: 1,
    minHeight: theme.spacing[2],
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
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
