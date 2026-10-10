import type { Run } from "@otto-code/protocol/workflow";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { formatMicroUsd } from "@/components/usage-format";
import type { Agent } from "@/stores/session-store";
import {
  addChatContributor,
  createChatTotalsTally,
  finalizeChatTotals,
  type ChatTotals,
} from "@/subagents/chat-totals";
import { collectWorkflowWorkerAgentIds } from "@/workflows/workflow-workers";
import { artifactBelongsToWorkspace } from "@/artifacts/artifact-derivation";

export type BadgeVariant = "success" | "warning" | "error";

export function runStatusVariant(status: string): BadgeVariant {
  if (status === "done") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  // pending, running, paused, canceled, and unknown legacy states are not errors.
  return "warning";
}

/** Label for the run-level status pill. Per-phase badges keep the raw status. */
export function runStatusLabel(run: Pick<Run, "kind" | "status" | "startConfirmation">): string {
  if (run.startConfirmation) {
    return "Awaiting confirmation";
  }
  if (run.kind === "ai" && run.status === "pending") {
    return "Planning";
  }
  if (run.status === "done") {
    return "Completed";
  }
  if (run.status === "canceled") {
    return "Canceled";
  }
  return run.status;
}

export function phaseStatusVariant(status: string): BadgeVariant {
  if (status === "done") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  // pending, running, blocked, skipped, canceled. A canceled phase is the
  // user's decision (run cancel or gate rejection), never an error.
  return "warning";
}

/** A one-line reason a terminal run did not complete. */
export function describeRunTerminalReason(run: Run): string | null {
  if (run.status === "failed") {
    const failedPhase = run.phases.find((phase) => phase.status === "failed");
    return run.error ?? failedPhase?.notes ?? "The run failed.";
  }
  if (run.status === "canceled") {
    return run.error ?? "The run was canceled.";
  }
  return null;
}

export type RunTerminalTone = "error" | "warning";

export function describeRunTerminalPresentation(
  run: Run,
): { reason: string; tone: RunTerminalTone } | null {
  const reason = describeRunTerminalReason(run);
  if (!reason) {
    return null;
  }
  return { reason, tone: run.status === "canceled" ? "warning" : "error" };
}

export type RunStatusFilter = "all" | "draft" | "active" | "failed" | "canceled" | "completed";

export function matchesStatusFilter(run: Pick<Run, "status">, filter: RunStatusFilter): boolean {
  if (filter === "draft") {
    return run.status === "draft";
  }
  if (filter === "active") {
    return run.status === "running" || run.status === "pending" || run.status === "paused";
  }
  if (filter === "failed") {
    return run.status === "failed";
  }
  if (filter === "canceled") {
    return run.status === "canceled";
  }
  if (filter === "completed") {
    return run.status === "done";
  }
  return true;
}

export function applyRunFilters<T extends Pick<Run, "status" | "cwd">>(
  runs: readonly T[],
  filter: { status: RunStatusFilter; cwd: string | undefined },
): T[] {
  return runs.filter(
    (run) =>
      matchesStatusFilter(run, filter.status) &&
      (filter.cwd === undefined ||
        (run.cwd !== undefined && artifactBelongsToWorkspace(run.cwd, filter.cwd))),
  );
}

/**
 * What the run spent: the lifetime total of every worker chat (candidates and
 * the judges that graded them, each of which exists only for this run). The
 * conductor never counts: it is the chat that declared the run, not part of it,
 * so a run that has not spawned a worker has spent nothing. Null when nothing
 * has been booked yet, so the card never claims a cost it can't back up.
 */
export function selectRunTotals(
  run: Run,
  agentsById: ReadonlyMap<string, Agent> | undefined,
): ChatTotals | null {
  const tally = createChatTotalsTally();
  for (const agentId of collectWorkflowWorkerAgentIds(run)) {
    const agent = agentsById?.get(agentId);
    if (agent) {
      addChatContributor(tally, agent);
    }
  }
  const totals = finalizeChatTotals(tally);
  return totals.tokens > 0 ? totals : null;
}

/**
 * The card's spend readout. Cost leads because it is what the run actually
 * cost; the token total follows with its cache-read share, since re-reading a
 * cached prompt on every model call is most of a Claude run's tokens and is
 * billed at a fraction of fresh input.
 */
export function formatRunSpend(totals: ChatTotals): string {
  const parts: string[] = [];
  if (totals.costUsd !== null && totals.costUsd > 0) {
    const usd = formatMicroUsd(Math.round(totals.costUsd * 1_000_000));
    parts.push(totals.costCoverage === "partial" ? `≥ ${usd}` : usd);
  }
  const cachedShare = totals.hasSplit ? totals.cachedInputTokens / totals.tokens : 0;
  const cached = cachedShare >= 0.01 ? ` (${Math.round(cachedShare * 100)}% cached)` : "";
  parts.push(`${formatTokenCount(totals.tokens)} tok${cached}`);
  return parts.join(" · ");
}
