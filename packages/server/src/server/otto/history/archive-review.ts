import { randomUUID } from "node:crypto";

export const ARCHIVE_REVIEW_TTL_MS = 2 * 60 * 1000;

export interface ReviewedArchiveRecord {
  agentId: string;
  revision: string;
  bytes: number;
}

export interface ArchiveScan {
  records: readonly ReviewedArchiveRecord[];
  unavailable: number;
}

export type ArchiveRecordRemoval =
  | { status: "deleted"; bytes: number; retainedTimeline?: boolean }
  | { status: "changed" | "failed" };

export interface ArchiveReviewPort {
  scan(): Promise<ArchiveScan>;
  removeReviewed(record: ReviewedArchiveRecord): Promise<ArchiveRecordRemoval>;
}

export interface ArchiveSummary {
  count: number;
  bytes: number;
  unavailable: number;
}

export function summarizeArchive(scan: ArchiveScan): ArchiveSummary {
  return {
    count: scan.records.length,
    bytes: scan.records.reduce((total, record) => total + record.bytes, 0),
    unavailable: scan.unavailable,
  };
}

export type ArchiveReviewResult =
  | { status: "reviewed"; reviewId: string | null; summary: ArchiveSummary }
  | { status: "busy" };

export type ArchiveApplyResult =
  | {
      status: "applied";
      reviewed: number;
      deleted: number;
      changed: number;
      failed: number;
      reclaimedBytes: number;
      retainedTimelines: number;
    }
  | { status: "review_required" | "busy" };

/** One review at a time for this requesting session. No other host or connection
 * can use it. The storage/lifecycle owner decides whether each record still matches. */
export class ArchiveReview {
  private plan: { id: string; expiresAt: number; records: ReviewedArchiveRecord[] } | null = null;
  private busy = false;

  constructor(
    private readonly port: ArchiveReviewPort,
    private readonly now: () => number = Date.now,
  ) {}

  async preview(): Promise<ArchiveReviewResult> {
    if (this.busy) return { status: "busy" };
    this.busy = true;
    this.plan = null;
    try {
      const scan = await this.port.scan();
      const summary = summarizeArchive(scan);
      if (!summary.count) return { status: "reviewed", reviewId: null, summary };
      const id = randomUUID();
      this.plan = {
        id,
        expiresAt: this.now() + ARCHIVE_REVIEW_TTL_MS,
        records: scan.records.map(({ agentId, revision, bytes }) => ({ agentId, revision, bytes })),
      };
      return { status: "reviewed", reviewId: id, summary };
    } finally {
      this.busy = false;
    }
  }

  async apply(reviewId: string): Promise<ArchiveApplyResult> {
    if (this.busy) return { status: "busy" };
    const plan = this.plan;
    if (!plan || plan.expiresAt <= this.now()) {
      this.plan = null;
      return { status: "review_required" };
    }
    if (plan.id !== reviewId) return { status: "review_required" };
    this.plan = null;
    this.busy = true;
    try {
      let deleted = 0;
      let changed = 0;
      let failed = 0;
      let reclaimedBytes = 0;
      let retainedTimelines = 0;
      for (const record of plan.records) {
        // Sequential: the daemon already owns the agent's durable mutation lane.
        const result = await this.port
          .removeReviewed(record)
          .catch(() => ({ status: "failed" as const }));
        switch (result.status) {
          case "deleted":
            deleted += 1;
            reclaimedBytes += result.bytes;
            if (result.retainedTimeline) retainedTimelines += 1;
            break;
          case "changed":
            changed += 1;
            break;
          case "failed":
            failed += 1;
            break;
        }
      }
      return {
        status: "applied",
        reviewed: plan.records.length,
        deleted,
        changed,
        failed,
        reclaimedBytes,
        retainedTimelines,
      };
    } finally {
      this.busy = false;
    }
  }
}
