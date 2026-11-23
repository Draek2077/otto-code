import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

export type ArchiveClient = Pick<
  DaemonClient,
  "getArchiveSummary" | "reviewArchiveClear" | "clearReviewedArchive"
>;

export interface ArchiveTarget {
  id: string;
  label: string;
  client: ArchiveClient;
  isCurrent(): boolean;
}

interface ReviewedHost {
  target: ArchiveTarget;
  reviewId: string;
  count: number;
  bytes: number;
}

export function formatArchiveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

async function reviewTarget(target: ArchiveTarget) {
  try {
    const { result } = await target.client.reviewArchiveClear();
    if (result.status !== "reviewed") return { target, skipped: true } as const;
    const { count, bytes, unavailable } = result.summary;
    const plan = result.reviewId ? { target, reviewId: result.reviewId, count, bytes } : null;
    return { target, skipped: false, plan, unavailable } as const;
  } catch {
    return { target, skipped: true } as const;
  }
}

function confirmation(
  plans: readonly ReviewedHost[],
  unavailable: number,
  skipped: readonly string[],
): ConfirmDialogInput {
  const count = plans.reduce((total, plan) => total + plan.count, 0);
  const scope = plans
    .map(
      ({ target, count: records, bytes }) =>
        `${target.label}: ${records} (${formatArchiveBytes(bytes)})`,
    )
    .join("\n");
  const skippedCopy = skipped.length ? `\nHosts skipped: ${skipped.join(", ")}.` : "";
  const unavailableCopy = unavailable
    ? `\n${unavailable} archived records could not be reviewed and will stay.`
    : "";
  return {
    title: count === 1 ? "Clear 1 archived chat?" : `Clear ${count} archived chats?`,
    message: [
      `Otto will remove the reviewed archive records across all projects on these hosts:\n${scope}${skippedCopy}${unavailableCopy}`,
      "Active chats and provider transcripts stay on their hosts. This cannot be undone.",
    ].join("\n\n"),
    confirmLabel: "Clear archived",
    destructive: true,
  };
}

export type ArchiveCleanupOutcome =
  | { status: "cancelled" }
  | { status: "empty"; unavailable: number; skipped: string[] }
  | {
      status: "finished";
      deleted: number;
      reclaimedBytes: number;
      changed: number;
      failed: number;
      retainedTimelines: number;
      unavailable: number;
      skipped: string[];
      uncertain: string[];
      attemptedHostIds: string[];
    };

type FinishedOutcome = Extract<ArchiveCleanupOutcome, { status: "finished" }>;

async function applyPlan(
  plan: ReviewedHost,
  signal: AbortSignal,
  outcome: FinishedOutcome,
): Promise<void> {
  const { target, reviewId, count } = plan;
  if (signal.aborted || !target.isCurrent()) {
    outcome.changed += count;
    return;
  }
  outcome.attemptedHostIds.push(target.id);
  try {
    const { result } = await target.client.clearReviewedArchive(reviewId);
    if (result.status !== "applied") {
      outcome.changed += count;
      return;
    }
    outcome.deleted += result.deleted;
    outcome.reclaimedBytes += result.reclaimedBytes;
    outcome.changed += result.changed;
    outcome.failed += result.failed;
    outcome.retainedTimelines += result.retainedTimelines;
  } catch {
    // A missing reply cannot tell us whether this host removed anything.
    outcome.uncertain.push(target.label);
  }
}

export async function clearArchivedHistory(input: {
  targets: readonly ArchiveTarget[];
  excludedHostLabels: readonly string[];
  signal: AbortSignal;
  confirm(dialog: ConfirmDialogInput): Promise<boolean>;
}): Promise<ArchiveCleanupOutcome> {
  const { targets, excludedHostLabels, signal, confirm } = input;
  const reviews = await Promise.all(targets.map(reviewTarget));
  if (signal.aborted) return { status: "cancelled" };
  const skipped = [...excludedHostLabels];
  const plans: ReviewedHost[] = [];
  let unavailable = 0;
  for (const review of reviews) {
    if (review.skipped || !review.target.isCurrent()) {
      skipped.push(review.target.label);
      continue;
    }
    unavailable += review.unavailable;
    if (review.plan) plans.push(review.plan);
  }
  if (!plans.length) return { status: "empty", unavailable, skipped };
  if (!(await confirm(confirmation(plans, unavailable, skipped))) || signal.aborted) {
    return { status: "cancelled" };
  }

  const outcome: FinishedOutcome = {
    status: "finished",
    deleted: 0,
    reclaimedBytes: 0,
    changed: 0,
    failed: 0,
    retainedTimelines: 0,
    unavailable,
    skipped,
    uncertain: [],
    attemptedHostIds: [],
  };
  for (const plan of plans) await applyPlan(plan, signal, outcome);
  return outcome;
}
