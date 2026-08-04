/**
 * Near-duplicate detection for recorded lessons.
 *
 * This file is the load-bearing half of "recording must be fire-and-forget": an
 * agent that rediscovers the same gotcha in three different sessions will phrase
 * it three different ways, and if all three land the injected brief fills up
 * with restatements of one fact. The agent cannot be asked to check first - that
 * is bookkeeping, and bookkeeping is exactly what the decision forbids. So the
 * daemon checks.
 *
 * Deliberately lexical, not semantic. A token-overlap score needs no model, no
 * network and no embedding store, runs in microseconds, and is trivial to reason
 * about when it gets a call wrong. The failure modes are asymmetric and we tune
 * for the safe one: a missed duplicate costs a redundant line in the brief that
 * `review_lessons` will consolidate, while a false merge silently loses a
 * distinct lesson. So the threshold sits high.
 */

/**
 * Above this Jaccard overlap of significant tokens, two lessons are the same one.
 * Tuned by the asymmetry above: at 0.7 two six-word lessons differing by a single
 * discriminating token (a version, a file name, a component) scored 0.71 and
 * merged, which is precisely the information-losing direction.
 */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.75;

/**
 * Words carrying no discriminating signal. Short list on purpose: an aggressive
 * stop-list makes two unrelated short lessons look alike, which is the failure
 * direction that loses information.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "when",
  "which",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * Collapse a lesson to the set of tokens that carry meaning. Punctuation goes,
 * case goes, stop words go; identifiers and paths survive intact because
 * `useUnistyles()` and `docs/preview.md` are usually the whole point of the
 * lesson.
 */
export function significantTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_./@-]+/)
    .map((token) => token.replace(/^[-._/]+|[-._/]+$/g, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

/** Jaccard overlap of two token sets: 1 = identical vocabulary, 0 = disjoint. */
export function lessonSimilarity(a: string, b: string): number {
  const left = significantTokens(a);
  const right = significantTokens(b);
  if (left.size === 0 || right.size === 0) {
    // Two lessons made entirely of stop words are equal only if they are
    // literally equal; scoring them 1.0 on emptiness would merge everything.
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

export interface DuplicateCandidate {
  id: string;
  text: string;
}

/**
 * The existing entry a new lesson restates, or null when it is genuinely new.
 * Picks the best match rather than the first, so a store holding two similar
 * lessons reinforces the closer one instead of whichever was written first.
 */
export function findDuplicateLesson(
  lesson: string,
  candidates: readonly DuplicateCandidate[],
): DuplicateCandidate | null {
  let best: { candidate: DuplicateCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = lessonSimilarity(lesson, candidate.text);
    if (score < DUPLICATE_SIMILARITY_THRESHOLD) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate ?? null;
}
