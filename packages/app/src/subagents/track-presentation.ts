import type { TFunction } from "i18next";
import type { ComposerTrackPillSegment } from "@/composer/tracks";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket, STATUS_BUCKET_ORDER } from "@/utils/sidebar-agent-state";
import { formatDuration } from "@/utils/time";
import type { AgentLifecycleStatus } from "@otto-code/protocol/agent-lifecycle";
import type { SubagentRow } from "./select";

export interface SubagentRowPresentationData {
  key: string;
  kind: "agent";
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
  tooltip: string;
}

// Provider-reported subagents report terminal states Otto's agent lifecycle
// does not name. Fold them onto the nearest lifecycle status so the sidebar
// bucket logic stays single-sourced.
function toAgentLifecycleStatus(row: SubagentRow): AgentLifecycleStatus {
  if (row.kind === "otto") {
    return row.status;
  }
  switch (row.status) {
    case "failed":
      return "error";
    case "completed":
    case "canceled":
      return "closed";
    default:
      return row.status;
  }
}

export function buildSubagentRowPresentationData(row: SubagentRow): SubagentRowPresentationData {
  const description = resolveRowLabel(row.description);
  const title = resolveRowLabel(row.title);
  // A personality-spawned subagent leads with its identity: "<Name>: <Chat title>".
  // With no title yet, the name alone beats a bare loading placeholder.
  const personalityName = row.kind === "otto" ? row.personalityName?.trim() || null : null;
  let label = description ?? title;
  if (personalityName) {
    label = title ? `${personalityName}: ${title}` : personalityName;
  }
  const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
  const subtitle = providerSubtitle ?? (description ? title : null);
  return {
    // Namespaced by row kind: an Otto subagent and a provider-reported one can
    // carry the same id without being the same row.
    key: `${row.kind}_subagent_${row.id}`,
    kind: "agent",
    label: label ?? "",
    subtitle: subtitle ?? "",
    tooltip: subtitle ? `${label ?? ""} - ${subtitle}` : (label ?? ""),
    titleState: label ? "ready" : "loading",
    statusBucket: deriveSidebarStateBucket({
      status: toAgentLifecycleStatus(row),
      requiresAttention: false,
    }),
  };
}

type ActiveStatusBucket = Exclude<SidebarStateBucket, "done">;

/** The sidebar's list order, minus the state that earns no pill mark. */
const ACTIVE_STATUS_BUCKET_ORDER = STATUS_BUCKET_ORDER.filter(
  (bucket): bucket is ActiveStatusBucket => bucket !== "done",
);

interface SubagentStatusCount {
  bucket: ActiveStatusBucket;
  count: number;
}

/** Everything the compact pill draws, including its spoken equivalent. */
export interface SubagentPillPresentation {
  segments: ComposerTrackPillSegment[];
  accessibilityLabel: string;
}

/**
 * Summarize the same normalized rows used by Otto's richer panel without
 * collapsing a mixed fan-out to only its most urgent state. Each visible mark
 * therefore stays paired with the count it describes.
 */
export function buildSubagentPillPresentation(
  t: TFunction,
  rows: readonly SubagentRow[],
): SubagentPillPresentation {
  const counts = summarizeSubagentStatus(rows);
  if (counts.length === 0) {
    const label = totalLabel(t, rows.length);
    return { segments: [{ bucket: null, text: label }], accessibilityLabel: label };
  }

  const labels = counts.map(({ bucket, count }) => statusLabel(t, bucket, count));
  return {
    segments: counts.map(({ bucket }, index) => ({ bucket, text: labels[index] ?? "" })),
    accessibilityLabel: labels.join(", "),
  };
}

function statusLabel(t: TFunction, bucket: ActiveStatusBucket, count: number): string {
  switch (bucket) {
    case "running":
      return t("subagents.pillLabelWorking", { count });
    case "failed":
      return t("subagents.pillLabelFailed", { count });
    case "needs_input":
      return count === 1
        ? t("subagents.pillLabelNeedsInputOne")
        : t("subagents.pillLabelNeedsInputMany", { count });
    case "attention":
      return t("subagents.pillLabelReadyToReview", { count });
  }
}

function totalLabel(t: TFunction, total: number): string {
  return total === 1 ? t("subagents.pillLabelOne") : t("subagents.pillLabelMany", { count: total });
}

function summarizeSubagentStatus(rows: readonly SubagentRow[]): SubagentStatusCount[] {
  const buckets = rows.map((row) => buildSubagentRowPresentationData(row).statusBucket);
  return ACTIVE_STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, count }] : [];
  });
}

/**
 * A row is tidy-eligible (auto-collapses into the "Completed" group) once it is
 * terminal AND not flagged for attention. Attention rows - notably a failed
 * subagent (usage exhaustion) - stay in the active list so the failure signal
 * is never buried. `idle` counts as terminal only for observed rows: a Claude
 * Task ends its run as `idle` (completed → "idle" in the provider mapping), but
 * a native `create_chat` subagent idles *between turns* and may still be
 * mid-conversation with its orchestrator - tidying it (and exposing it to
 * "Clear all") would archive an agent still in use.
 * See docs/agent-lifecycle.md (Item 6).
 */
export function isSubagentRowTidyEligible(row: SubagentRow): boolean {
  if (row.requiresAttention) {
    return false;
  }
  if (row.status === "error" || row.status === "closed") {
    return true;
  }
  return row.status === "idle" && row.attend === "observed";
}

export interface PartitionedSubagentRows {
  active: SubagentRow[];
  completed: SubagentRow[];
}

/**
 * Split rows into the active list and the collapsed "Completed" group. Rows in
 * `pinnedIds` stay active even when tidy-eligible - the track pins a row the
 * user just stopped so it doesn't instantly vanish into the collapsed group
 * under their pointer. See docs/agent-lifecycle.md (Items 2 + 6).
 */
export function partitionSubagentRows(
  rows: readonly SubagentRow[],
  pinnedIds?: ReadonlySet<string>,
): PartitionedSubagentRows {
  const active: SubagentRow[] = [];
  const completed: SubagentRow[] = [];
  for (const row of rows) {
    if (isSubagentRowTidyEligible(row) && !pinnedIds?.has(row.id)) {
      completed.push(row);
    } else {
      active.push(row);
    }
  }
  return { active, completed };
}

// How long a completed row must stay terminal before the auto-clear driver
// archives it. A short settle so the row is visibly finished (and its final
// token/elapsed readout registers) before it tidies itself away.
export const SUBAGENT_AUTO_CLEAR_SETTLE_MS = 4000;

export interface AutoClearSelectionInput {
  settleMs: number;
  now: number;
  /** Rows already archiving or previously attempted - never re-selected. */
  excludeIds?: ReadonlySet<string>;
}

/**
 * The completed rows due to auto-clear: tidy-eligible (terminal, not attention -
 * the same set the "Completed" group shows), not excluded, and settled (terminal
 * for at least `settleMs`). Pure so the driver's timing logic is unit-testable.
 * See docs/agent-lifecycle.md (the sub-agents track) and
 * use-auto-clear-completed-subagents.ts.
 */
export function selectSubagentsToAutoClear(
  rows: readonly SubagentRow[],
  input: AutoClearSelectionInput,
): SubagentRow[] {
  const due: SubagentRow[] = [];
  for (const row of rows) {
    if (!isSubagentRowTidyEligible(row)) {
      continue;
    }
    if (input.excludeIds?.has(row.id)) {
      continue;
    }
    if (row.kind === "otto" && input.now - row.updatedAt.getTime() < input.settleMs) {
      continue;
    }
    due.push(row);
  }
  return due;
}

export type SubagentRowAction = "stop" | "archive";

/**
 * The row's primary action follows the agent's state: a live subagent gets
 * Stop (transition to terminal, keep the row); a terminal one gets Archive
 * (drop the row). Never offer Archive on something still running.
 * See docs/agent-lifecycle.md (Item 2).
 */
export function resolveSubagentRowAction(status: SubagentRow["status"]): SubagentRowAction {
  if (status === "initializing" || status === "running") {
    return "stop";
  }
  return "archive";
}

/**
 * Compact, honest token readout (e.g. "934", "12.3k", "1.2M"). Returns null for
 * absent/zero so callers render nothing rather than a bare "0".
 * See docs/agent-lifecycle.md (Item 3).
 */
export function formatCompactTokenCount(tokens: number | null | undefined): string | null {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  if (tokens < 1000) {
    return String(Math.round(tokens));
  }
  // Threshold at 999,500 (not 1M) so values that would round to "1000k" tip
  // into the M tier as "1M" instead.
  if (tokens < 999_500) {
    const k = tokens / 1000;
    return `${k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const m = tokens / 1_000_000;
  return `${m >= 100 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * How much work the sub-agent has done, e.g. "1 tool", "89 tools". Returns null
 * for absent/zero so a provider that reports no count renders nothing rather
 * than a bare "0 tools". Raw count on purpose - unlike tokens, this number stays
 * legible at any size and rounding it would hide the difference between 89 and
 * 140 tool calls. See docs/chat-lifecycle.md (the subagents track).
 */
export function formatSubagentToolUseCount(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  const whole = Math.floor(count);
  if (whole <= 0) {
    return null;
  }
  return `${whole} ${whole === 1 ? "tool" : "tools"}`;
}

/**
 * The tool the sub-agent is running right now - the signal that turns "spinning"
 * into "spinning _on a Bash_". The daemon already clears it on terminal rows, so
 * this only trims and drops blanks; it never invents a value for a provider that
 * doesn't report one. See docs/chat-lifecycle.md (the subagents track).
 */
export function formatSubagentCurrentTool(tool: string | null | undefined): string | null {
  if (typeof tool !== "string") {
    return null;
  }
  return tool.trim() || null;
}

/** Sum of the cumulative token totals across all rows (incl. completed). */
export function sumSubagentTokens(rows: readonly SubagentRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.kind !== "otto") {
      continue;
    }
    if (typeof row.cumulativeTokens === "number" && Number.isFinite(row.cumulativeTokens)) {
      total += row.cumulativeTokens;
    }
  }
  return total;
}

export function formatHeaderLabel(
  { active, completed }: PartitionedSubagentRows,
  // Tokens from rows already cleared (archived) out of the track. Added back into
  // the header total so the honest fan-out cost survives the clear - whether by
  // the manual "Clear all completed" or the auto-clear driver.
  clearedTokens = 0,
): string {
  // Mirror the list's own active/completed split (user-locked wording) so the
  // header reads as a summary of the two groups below it, not a third framing.
  const parts: string[] = [];
  if (active.length > 0) {
    parts.push(`${active.length} active ${active.length === 1 ? "sub-agent" : "sub-agents"}`);
  }
  if (completed.length > 0) {
    parts.push(
      `${completed.length} completed ${completed.length === 1 ? "sub-agent" : "sub-agents"}`,
    );
  }
  // Honest fan-out cost, summed across every row (completed included) plus any
  // already-cleared rows, so the number survives the auto-tidy AND the clear.
  // See subagents-cleanup.md (Items 3 + 6) and cleared-subagent-tokens-store.ts.
  const tokens = formatCompactTokenCount(
    sumSubagentTokens(active) + sumSubagentTokens(completed) + Math.max(0, clearedTokens),
  );
  if (tokens) {
    parts.push(`${tokens} tokens`);
  }
  return parts.join(" · ");
}

/**
 * True while the subagent is still doing work - the row live-ticks its elapsed
 * time. Mirrors the running set used by {@link resolveSubagentRowAction}.
 */
export function isSubagentRowRunning(status: SubagentRow["status"]): boolean {
  return status === "initializing" || status === "running";
}

/**
 * Frozen run duration (createdAt → updatedAt) for a terminal row, e.g. "3m 12s".
 * Returns null while the row is still running - the track renders a live ticker
 * for those instead. See docs/chat-lifecycle.md (the subagents track).
 */
export function formatSubagentElapsed(row: SubagentRow): string | null {
  if (row.kind !== "otto" || isSubagentRowRunning(row.status)) {
    return null;
  }
  const ms = row.updatedAt.getTime() - row.createdAt.getTime();
  return formatDuration(Math.max(0, ms));
}

/** Provider-reported subagents that have stopped running. */
export function countFinishedSubagents(rows: readonly SubagentRow[]): number {
  return rows.filter((row) => row.kind === "provider" && row.status !== "running").length;
}

export function resolveRowLabel(title: SubagentRow["title"]): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent" || normalized.toLowerCase() === "new chat") {
    return null;
  }
  return normalized;
}
