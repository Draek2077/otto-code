import type { KnowledgeReviewSignals } from "@getpaseo/plugin/otto/project-knowledge";
import type { KnowledgePage } from "./markdown-page.js";

const day = 24 * 60 * 60 * 1000;
export class KnowledgeReviewUnavailableError extends Error {
  constructor() {
    super(
      "This store exceeds the bounded review-signal inspection limit. Existing data remains unchanged; inspect the article directly.",
    );
  }
}
interface ReviewInput {
  source: KnowledgePage;
  pages: readonly KnowledgePage[];
  now: Date;
}
/** Read-only hints, never persisted findings or inferred confirmation. Only
 * current confirmed atomic truth participates in overlap; history does not. */
export function inspectReviewSignals(input: ReviewInput): KnowledgeReviewSignals {
  const { source, now } = input;
  const eligible = source.metadata.status === "confirmed";
  const age = Math.max(0, now.getTime() - Date.parse(source.metadata.updated_at));
  const result: KnowledgeReviewSignals = {
    sourceRevision: source.revision,
    checkedAt: now.toISOString(),
    eligible,
    comparedRecords: 0,
    identicalTagSets: 0,
    partialTagOverlap: 0,
    overlappingTruth: 0,
    stale: eligible && age > 180 * day,
    ageDays: Math.floor(age / day),
  };
  if (!eligible || !comparable(source)) return result;
  const peers = input.pages.filter(
    (page) =>
      page.metadata.status === "confirmed" &&
      comparable(page) &&
      (page.metadata.id !== source.metadata.id || page.metadata.kind !== source.metadata.kind),
  );
  if (
    peers.length > 2000 ||
    [source, ...peers].some((page) => Buffer.byteLength(page.statement, "utf8") > 524288) ||
    peers.reduce((sum, page) => sum + Buffer.byteLength(page.statement, "utf8"), 0) >
      16 * 1024 * 1024
  )
    throw new KnowledgeReviewUnavailableError();
  const tags = new Set(source.metadata.tags.map((tag) => tag.trim()).filter(Boolean));
  const words = truthWords(source.statement);
  for (const peer of peers) {
    result.comparedRecords++;
    const otherTags = new Set(peer.metadata.tags.map((tag) => tag.trim()).filter(Boolean));
    const sharedTags = [...tags].filter((tag) => otherTags.has(tag)).length;
    if (sharedTags) {
      if (sharedTags === tags.size && sharedTags === otherTags.size) result.identicalTagSets++;
      else result.partialTagOverlap++;
    }
    if (sharedTruth({ left: words, right: truthWords(peer.statement) })) result.overlappingTruth++;
  }
  return result;
}
function comparable(page: KnowledgePage) {
  return page.metadata.kind !== "project" && page.metadata.kind !== "reference";
}
function truthWords(statement: string) {
  return new Set(statement.toLowerCase().match(/[a-z0-9_-]{5,}/g) ?? []);
}
function sharedTruth({ left, right }: { left: ReadonlySet<string>; right: ReadonlySet<string> }) {
  let shared = 0;
  const [small, large] = left.size < right.size ? [left, right] : [right, left];
  for (const word of small) if (large.has(word) && ++shared >= 3) return true;
  return false;
}
