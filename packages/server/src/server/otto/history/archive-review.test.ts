import { expect, it, vi } from "vitest";
import {
  ArchiveReview,
  ARCHIVE_REVIEW_TTL_MS,
  type ArchiveScan,
  type ReviewedArchiveRecord,
} from "./archive-review.js";

const record = (agentId: string, bytes: number): ReviewedArchiveRecord => ({
  agentId,
  revision: `revision:${agentId}`,
  bytes,
});

async function previewId(review: ArchiveReview): Promise<string> {
  const result = await review.preview();
  if (result.status !== "reviewed" || !result.reviewId)
    throw new Error("Expected an archive review");
  return result.reviewId;
}

it("reviews exact bytes separately from unavailable records without deleting", async () => {
  const removeReviewed = vi.fn();
  const review = new ArchiveReview({
    scan: async () => ({ records: [record("a", 40), record("b", 11)], unavailable: 2 }),
    removeReviewed,
  });
  expect(await review.preview()).toEqual({
    status: "reviewed",
    reviewId: expect.any(String),
    summary: { count: 2, bytes: 51, unavailable: 2 },
  });
  expect(removeReviewed).not.toHaveBeenCalled();
});

it("applies only the reviewed identities and counts only acknowledged removal bytes", async () => {
  const a = record("a", 50);
  const b = record("b", 60);
  const c = record("c", 70);
  const records = [a, b, c];
  const removeReviewed = vi.fn(async (candidate: ReviewedArchiveRecord) => {
    if (candidate.agentId === "a") return { status: "deleted" as const, bytes: 50 };
    if (candidate.agentId === "b") return { status: "changed" as const };
    throw new Error("filesystem unavailable");
  });
  const review = new ArchiveReview({
    scan: async () => ({ records, unavailable: 0 }),
    removeReviewed,
  });
  const id = await previewId(review);
  records.push(record("archived-after-preview", 999));
  a.revision = "changed outside the review";
  expect(await review.apply(id)).toEqual({
    status: "applied",
    reviewed: 3,
    deleted: 1,
    changed: 1,
    failed: 1,
    reclaimedBytes: 50,
    retainedTimelines: 0,
  });
  expect(removeReviewed.mock.calls.map(([entry]) => entry)).toEqual([record("a", 50), b, c]);
  expect(await review.apply(id)).toEqual({ status: "review_required" });
});

it("expires a review, refuses another session's review, and replaces a previous preview", async () => {
  let now = 0;
  const removeReviewed = vi.fn();
  const port = {
    scan: async () => ({ records: [record("a", 10)], unavailable: 0 }),
    removeReviewed,
  };
  const review = new ArchiveReview(port, () => now);
  const first = await previewId(review);
  const second = await previewId(review);
  expect(await review.apply(first)).toEqual({ status: "review_required" });
  expect(await new ArchiveReview(port, () => now).apply(second)).toEqual({
    status: "review_required",
  });
  now = ARCHIVE_REVIEW_TTL_MS;
  expect(await review.apply(second)).toEqual({ status: "review_required" });
  expect(removeReviewed).not.toHaveBeenCalled();
});

it("does not mint a destructive handle for an empty or unavailable archive", async () => {
  const review = new ArchiveReview({
    scan: async () => ({ records: [], unavailable: 1 }),
    removeReviewed: vi.fn(),
  });
  expect(await review.preview()).toEqual({
    status: "reviewed",
    reviewId: null,
    summary: { count: 0, bytes: 0, unavailable: 1 },
  });
});

it("allows only one preview or apply to run at a time", async () => {
  const gate = Promise.withResolvers<ArchiveScan>();
  const review = new ArchiveReview({ scan: () => gate.promise, removeReviewed: vi.fn() });
  const first = review.preview();
  expect(await review.preview()).toEqual({ status: "busy" });
  expect(await review.apply("another request")).toEqual({ status: "busy" });
  gate.resolve({ records: [], unavailable: 0 });
  expect(await first).toMatchObject({ status: "reviewed" });
});
