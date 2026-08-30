import type { Run } from "@otto-code/protocol/orchestration";
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
