/**
 * Domain types for Personality Memory - the lessons a named personality accrues
 * across sessions and carries into every later spawn.
 *
 * See `docs/agent-personalities.md` § Memory. The two ideas that
 * everything else follows from:
 *
 * 1. **These are just stored memories.** A flat list of text entries keyed to a
 *    personality id. No graph, no embeddings, no per-personality storage tier.
 * 2. **Recording is fire-and-forget.** The agent states what it learned; the
 *    daemon owns ids, placement and dedup. Nothing in this file is ever handed
 *    to a recording agent to keep track of.
 */

/**
 * Where a lesson applies.
 * - `project`: only injected for agents working in that project root. The
 *   default, because most lessons are about a repo's mechanisms.
 * - `global`: injected everywhere on the host. For observations about the
 *   personality's own craft or its crew, which travel.
 */
export type ProfileMemoryScope = "project" | "global";

/**
 * How the entry got here. Purely provenance - it never gates injection, and the
 * agent that records a lesson does not choose it.
 */
export type ProfileMemorySource = "agent" | "user" | "review" | "transfer";

export interface ProfileMemoryEntry {
  /** Machine-generated. Never surfaced to a recording agent (fire-and-forget). */
  id: string;
  /** The lesson itself - one short paragraph. */
  text: string;
  scope: ProfileMemoryScope;
  /** Absolute project root. Set when (and only when) `scope === "project"`. */
  projectRoot?: string;
  createdAt: string;
  updatedAt: string;
  source: ProfileMemorySource;
  /**
   * How many times the lesson has been restated. A near-duplicate recording
   * bumps this instead of adding a row, which is what makes dedup the system's
   * job rather than a discipline in the prompt. Also the primary ordering key
   * for the injection budget: a lesson relearned three times outranks a
   * one-off.
   */
  reinforcedCount?: number;
  /** Name of the personality this was transferred from, when it was. */
  transferredFrom?: string;
}

/** The whole persisted file for one personality. */
export interface PersonalityMemoryFile {
  personalityId: string;
  entries: ProfileMemoryEntry[];
}

/** What `remember_lesson` did, so the tool can answer honestly. */
export type RecordLessonOutcome = "added" | "reinforced";

export interface RecordLessonResult {
  outcome: RecordLessonOutcome;
  /** Entry count after the write, so a caller can report accrual. */
  total: number;
}
