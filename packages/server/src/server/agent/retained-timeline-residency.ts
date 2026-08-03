// How many retained transcripts may keep their rows resident at once. A
// retained transcript is opened by a human reading one archived run, so the
// working set is one or two; ten leaves room for tab-hopping while keeping the
// worst case bounded instead of daemon-lifetime.
export const RETAINED_TRANSCRIPT_RESIDENCY_LIMIT = 10;

/**
 * LRU set of retained-transcript ids whose rows have been seeded into the
 * in-memory timeline store.
 *
 * Retained transcripts are read-only snapshots of closed internal generation
 * agents (schedule / artifact runs), loaded on demand when a viewer opens one.
 * Nothing closes them: the client just fetches, so there is no unsubscribe to
 * hang eviction off. Capping residency is the substitute — the rows are on disk
 * and reload transparently on the next fetch, so evicting one costs a re-read,
 * not the transcript. See docs/safe-unattended.md.
 */
export class RetainedTimelineResidency {
  private readonly limit: number;
  // Insertion order IS the LRU order: re-retaining deletes and re-adds, so the
  // first key is always the least recently used.
  private readonly ids = new Set<string>();

  constructor(limit: number = RETAINED_TRANSCRIPT_RESIDENCY_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  has(agentId: string): boolean {
    return this.ids.has(agentId);
  }

  get size(): number {
    return this.ids.size;
  }

  /**
   * Mark an id resident and most-recently-used. Returns the ids evicted to stay
   * under the cap — the caller owns dropping their rows.
   */
  retain(agentId: string): string[] {
    this.ids.delete(agentId);
    this.ids.add(agentId);
    const evicted: string[] = [];
    while (this.ids.size > this.limit) {
      const oldest = this.ids.values().next();
      if (oldest.done) {
        break;
      }
      this.ids.delete(oldest.value);
      evicted.push(oldest.value);
    }
    return evicted;
  }

  forget(agentId: string): void {
    this.ids.delete(agentId);
  }
}
