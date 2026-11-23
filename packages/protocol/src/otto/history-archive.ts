import { z } from "zod";

const count = z.number().int().nonnegative();
const summary = z.object({ count, bytes: count, unavailable: count });
const reviewId = z.uuid();

export const historyArchiveRequests = [
  z.object({ type: z.literal("history.archives.get_summary.request"), requestId: z.string() }),
  z.object({ type: z.literal("history.archives.review_clear.request"), requestId: z.string() }),
  z.object({
    type: z.literal("history.archives.clear_reviewed.request"),
    requestId: z.string(),
    reviewId,
  }),
] as const;

export const historyArchiveResponses = [
  z.object({
    type: z.literal("history.archives.get_summary.response"),
    payload: z.object({ requestId: z.string(), summary }),
  }),
  z.object({
    type: z.literal("history.archives.review_clear.response"),
    payload: z.object({
      requestId: z.string(),
      result: z.discriminatedUnion("status", [
        z.object({ status: z.literal("reviewed"), reviewId: reviewId.nullable(), summary }),
        z.object({ status: z.literal("busy") }),
      ]),
    }),
  }),
  z.object({
    type: z.literal("history.archives.clear_reviewed.response"),
    payload: z.object({
      requestId: z.string(),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal("applied"),
          reviewed: count,
          deleted: count,
          changed: count,
          failed: count,
          reclaimedBytes: count,
          retainedTimelines: count,
        }),
        z.object({ status: z.literal("review_required") }),
        z.object({ status: z.literal("busy") }),
      ]),
    }),
  }),
] as const;
