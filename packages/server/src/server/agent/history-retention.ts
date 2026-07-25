// Selection for the bulk "clear archived chats" sweep
// (`history.agents.clear_archived`). Kept pure and separate from the session
// handler because it is the only part of a destructive batch where a boundary
// mistake is silent: every id this returns has its record unlinked from disk
// with no undo. The handler does IO; this decides *what*.
//
// See docs/chat-lifecycle.md — Delete.

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** The subset of a stored agent record the sweep needs. */
export interface ArchivedRecordCandidate {
  id: string;
  archivedAt?: string | null;
}

export interface SelectArchivedForDeletionInput {
  records: readonly ArchivedRecordCandidate[];
  /** 0 selects every archived chat; N selects those archived at least N days ago. */
  olderThanDays: number;
  /** Epoch ms "now", injected so the boundaries are testable. */
  now: number;
}

interface Selected {
  id: string;
  /** Sort key: epoch ms, or null when `archivedAt` could not be parsed. */
  archivedAtMs: number | null;
}

/**
 * Ids of archived chat records the sweep should delete, oldest first.
 *
 * The rules, in the order they matter:
 *
 * 1. **A chat with no `archivedAt` is never selected.** Delete is reachable only
 *    through archive — archive first, then delete — so an active chat can never
 *    be swept, whatever the cutoff. This is the load-bearing boundary.
 * 2. **An unparseable `archivedAt` counts as archived but ageless.** With
 *    `olderThanDays: 0` ("clear everything archived") it is selected; with any
 *    age cutoff it is skipped, because we cannot prove it is old enough and the
 *    safe answer to "how old is this?" is to keep it.
 * 3. **The cutoff is inclusive.** A chat archived exactly `olderThanDays` ago is
 *    that many days old, so it is selected.
 * 4. **A future `archivedAt`** (clock skew, an edited record) is not older than
 *    any positive cutoff, so an age-limited sweep skips it. `olderThanDays: 0`
 *    still takes it — it is archived, and no age filter applies.
 * 5. **Oldest first**, so a sweep that fails partway through has deleted the
 *    chats the user cared least about. Ageless records sort last for the same
 *    reason.
 *
 * Duplicate ids collapse to one entry: the sweep must never try to delete the
 * same record twice and report it as two deletions.
 */
export function selectArchivedForDeletion(input: SelectArchivedForDeletionInput): string[] {
  const olderThanDays = Number.isFinite(input.olderThanDays)
    ? Math.max(0, Math.floor(input.olderThanDays))
    : 0;
  const hasAgeFilter = olderThanDays > 0;
  const cutoff = input.now - olderThanDays * MS_PER_DAY;

  const selected: Selected[] = [];
  const seen = new Set<string>();

  for (const record of input.records) {
    const id = record.id?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    // Rule 1: no archive stamp, no deletion. Not even with olderThanDays: 0.
    if (record.archivedAt == null || record.archivedAt === "") {
      continue;
    }

    const parsed = Date.parse(record.archivedAt);
    const archivedAtMs = Number.isNaN(parsed) ? null : parsed;

    if (hasAgeFilter) {
      // Rules 2 and 4: an ageless or future stamp is not provably old enough.
      if (archivedAtMs === null || archivedAtMs > cutoff) {
        continue;
      }
    }

    seen.add(id);
    selected.push({ id, archivedAtMs });
  }

  // Rule 5. `null` (ageless) sorts after every real timestamp.
  selected.sort((a, b) => {
    if (a.archivedAtMs === b.archivedAtMs) {
      return 0;
    }
    if (a.archivedAtMs === null) {
      return 1;
    }
    if (b.archivedAtMs === null) {
      return -1;
    }
    return a.archivedAtMs - b.archivedAtMs;
  });

  return selected.map((entry) => entry.id);
}
