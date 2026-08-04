// Selection for the materialized-image sweep. Kept pure and separate from the
// IO in provider-image-output.ts for the same reason `history-retention.ts` is
// separate from the chat-delete handler: every name this returns gets unlinked
// with no undo, and a boundary mistake there is silent - the transcript keeps
// its markdown and quietly renders alt text instead of the picture.
//
// See docs/attachment-lifecycle.md for the policy these numbers encode.

/** The subset of a directory entry the sweep needs. */
export interface MaterializedImageCandidate {
  name: string;
  sizeBytes: number;
  /** Epoch ms. Last write, which for a content-hashed file is when it was last materialized. */
  modifiedAtMs: number;
}

export interface SelectStaleMaterializedImagesInput {
  files: readonly MaterializedImageCandidate[];
  /** Epoch ms "now", injected so the boundaries are testable. */
  now: number;
  /** Files last written more than this long ago are stale. 0 disables the age rule. */
  maxAgeMs: number;
  /** Ceiling for what survives the age rule. 0 disables the cap. */
  maxTotalBytes: number;
}

/**
 * Names to delete, oldest first.
 *
 * Two rules, applied in order:
 *
 * 1. **Age.** A file nobody has re-materialized in `maxAgeMs` is stale. Re-use
 *    is a write - `materializeProviderImage` rewrites the same content-hashed
 *    path - so an image that keeps appearing in a live transcript keeps its
 *    stamp fresh, and only genuinely cold bytes age out.
 * 2. **Cap.** If what survived rule 1 still exceeds `maxTotalBytes`, keep
 *    deleting oldest-first until it fits. The cap is the backstop for a burst
 *    the age rule has not caught up with yet, not the primary lever.
 *
 * A file stamped in the future (clock skew, a copied directory) is never stale
 * by age - we cannot prove it is old, and the safe answer to "how old is this?"
 * is to keep it - but it is still eligible for the cap, sorting last so it goes
 * only when nothing older is left.
 */
export function selectStaleMaterializedImages(input: SelectStaleMaterializedImagesInput): string[] {
  const maxAgeMs = Number.isFinite(input.maxAgeMs) ? Math.max(0, input.maxAgeMs) : 0;
  const maxTotalBytes = Number.isFinite(input.maxTotalBytes) ? Math.max(0, input.maxTotalBytes) : 0;

  const oldestFirst = [...input.files].sort((a, b) => a.modifiedAtMs - b.modifiedAtMs);

  const doomed: string[] = [];
  const survivors: MaterializedImageCandidate[] = [];

  const ageCutoff = input.now - maxAgeMs;
  for (const file of oldestFirst) {
    if (maxAgeMs > 0 && file.modifiedAtMs < ageCutoff) {
      doomed.push(file.name);
      continue;
    }
    survivors.push(file);
  }

  if (maxTotalBytes <= 0) {
    return doomed;
  }

  let survivingBytes = survivors.reduce((total, file) => total + file.sizeBytes, 0);
  for (const file of survivors) {
    if (survivingBytes <= maxTotalBytes) {
      break;
    }
    doomed.push(file.name);
    survivingBytes -= file.sizeBytes;
  }

  return doomed;
}

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface SelectMaterializedImagesToClearInput {
  files: readonly MaterializedImageCandidate[];
  now: number;
  /** 0 clears everything. N clears images untouched for at least N days. */
  olderThanDays: number;
}

/**
 * Names for the **user-triggered** clear, oldest first.
 *
 * Deliberately a different function from `selectStaleMaterializedImages`, not a
 * parameterization of it, because `olderThanDays: 0` means opposite things in
 * the two policies. To the background sweep, an age of zero disables the age
 * rule; to a person who pressed "Clear everything", zero means everything. One
 * function serving both readings is how that becomes a data-loss bug.
 *
 * Matches `selectArchivedForDeletion`'s vocabulary otherwise: the cutoff is
 * inclusive, and a future timestamp is not older than any positive cutoff, so an
 * age-limited clear skips it while a full clear takes it.
 */
export function selectMaterializedImagesToClear(
  input: SelectMaterializedImagesToClearInput,
): string[] {
  const olderThanDays = Number.isFinite(input.olderThanDays)
    ? Math.max(0, Math.floor(input.olderThanDays))
    : 0;
  const oldestFirst = [...input.files].sort((a, b) => a.modifiedAtMs - b.modifiedAtMs);

  if (olderThanDays === 0) {
    return oldestFirst.map((file) => file.name);
  }

  const cutoff = input.now - olderThanDays * MS_PER_DAY;
  return oldestFirst.filter((file) => file.modifiedAtMs <= cutoff).map((file) => file.name);
}
