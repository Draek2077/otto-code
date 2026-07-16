import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { formatDuration } from "@/utils/time";
import type { SubagentRow } from "./select";

export interface SubagentRowPresentationData {
  key: string;
  kind: "agent";
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

export function buildSubagentRowPresentationData(row: SubagentRow): SubagentRowPresentationData {
  const label = resolveRowLabel(row.title);
  return {
    key: `subagent_${row.id}`,
    kind: "agent",
    label: label ?? "",
    subtitle: "",
    titleState: label ? "ready" : "loading",
    statusBucket: deriveSidebarStateBucket({
      status: row.status,
      requiresAttention: false,
    }),
  };
}

/**
 * A row is tidy-eligible (auto-collapses into the "Completed" group) once it is
 * terminal AND not flagged for attention. Attention rows — notably a failed
 * subagent (usage exhaustion) — stay in the active list so the failure signal
 * is never buried. `idle` counts as terminal only for observed rows: a Claude
 * Task ends its run as `idle` (completed → "idle" in the provider mapping), but
 * a native `create_agent` subagent idles *between turns* and may still be
 * mid-conversation with its orchestrator — tidying it (and exposing it to
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
 * `pinnedIds` stay active even when tidy-eligible — the track pins a row the
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

/** Sum of the cumulative token totals across all rows (incl. completed). */
export function sumSubagentTokens(rows: readonly SubagentRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (typeof row.cumulativeTokens === "number" && Number.isFinite(row.cumulativeTokens)) {
      total += row.cumulativeTokens;
    }
  }
  return total;
}

export function formatHeaderLabel(rows: readonly SubagentRow[]): string {
  let runningCount = 0;
  for (const row of rows) {
    if (row.status === "running") {
      runningCount += 1;
    }
  }

  const parts = [`${rows.length} ${rows.length === 1 ? "subagent" : "subagents"}`];
  if (runningCount > 0) {
    parts.push(`${runningCount} running`);
  }
  // Honest fan-out cost, summed across every row (completed included) so the
  // number survives the auto-tidy. See subagents-cleanup.md (Items 3 + 6).
  const tokens = formatCompactTokenCount(sumSubagentTokens(rows));
  if (tokens) {
    parts.push(`${tokens} tokens`);
  }
  return parts.join(" · ");
}

/**
 * True while the subagent is still doing work — the row live-ticks its elapsed
 * time. Mirrors the running set used by {@link resolveSubagentRowAction}.
 */
export function isSubagentRowRunning(status: SubagentRow["status"]): boolean {
  return status === "initializing" || status === "running";
}

/**
 * Frozen run duration (createdAt → updatedAt) for a terminal row, e.g. "3m 12s".
 * Returns null while the row is still running — the track renders a live ticker
 * for those instead. See projects/subagent-liveness/subagent-liveness.md (liveness signals).
 */
export function formatSubagentElapsed(row: SubagentRow): string | null {
  if (isSubagentRowRunning(row.status)) {
    return null;
  }
  const ms = row.updatedAt.getTime() - row.createdAt.getTime();
  return formatDuration(Math.max(0, ms));
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
