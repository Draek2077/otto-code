/**
 * File-backed storage for personality memory: one JSON file per personality
 * under `$OTTO_HOME/profile-memory/`, atomic writes, no migrations -
 * the pattern from docs/data-model.md.
 *
 * One file per personality rather than one file per fact. The harness's own
 * one-fact-per-file layout exists because an *agent* maintains that index by
 * hand; here the daemon maintains it (recording is fire-and-forget), so
 * splitting buys nothing and costs the atomicity that makes transfer-on-delete
 * a single write. Files stay small because the entry list is capped.
 *
 * Every mutation goes through a per-personality serialized read-modify-write
 * queue. Two agents spawned from the same personality can record concurrently,
 * and a lost increment there is a lost lesson.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { writeJsonFileAtomic } from "../../atomic-file.js";
import { findDuplicateLesson } from "./lesson-dedup.js";
import type {
  ProfileMemoryEntry,
  ProfileMemoryScope,
  ProfileMemorySource,
  RecordLessonResult,
} from "./types.js";

/**
 * Hard ceiling on stored entries per personality. Not a token budget (the brief
 * has its own) - a floor under pathological growth, so a personality that
 * records on every turn for a month cannot turn its file into a liability. The
 * oldest, least-reinforced entry is dropped when the cap is hit; a user who
 * wants the tail kept prunes deliberately via review_lessons.
 */
export const MAX_ENTRIES_PER_PERSONALITY = 200;

/** Lessons longer than this are truncated: a lesson is a paragraph, not a doc. */
export const MAX_LESSON_CHARS = 1200;

export interface RecordLessonInput {
  personalityId: string;
  lesson: string;
  scope: ProfileMemoryScope;
  projectRoot?: string;
  source: ProfileMemorySource;
}

export interface ReviseLessonInput {
  personalityId: string;
  entryId: string;
  text?: string;
  scope?: ProfileMemoryScope;
  projectRoot?: string;
  drop?: boolean;
}

export class ProfileMemoryStore {
  private readonly cache = new Map<string, ProfileMemoryEntry[]>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly logger?: Logger;

  constructor(
    private readonly rootDir: string,
    logger?: Logger,
  ) {
    this.logger = logger?.child({ component: "personality-memory-store" });
  }

  /** Entries for one personality, newest-first by update time. Never throws. */
  async list(personalityId: string): Promise<ProfileMemoryEntry[]> {
    return [...(await this.load(personalityId))];
  }

  /** Lesson counts for every personality with a store on disk. */
  async counts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    let files: string[];
    try {
      files = await readdir(this.rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger?.warn({ err: error }, "Failed to list personality memory files");
      }
      return counts;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const personalityId = file.slice(0, -".json".length);
      const entries = await this.load(personalityId);
      if (entries.length > 0) counts[personalityId] = entries.length;
    }
    return counts;
  }

  /**
   * Record a lesson. Dedup is the store's job: a near-duplicate reinforces the
   * existing entry rather than adding a row, which is what lets the tool take a
   * bare sentence and nothing else.
   */
  record(input: RecordLessonInput): Promise<RecordLessonResult> {
    return this.mutate<RecordLessonResult>(input.personalityId, (entries) => {
      const lesson = normalizeLesson(input.lesson);
      // Only same-scope entries are dedup candidates: "always true here" and
      // "always true everywhere" are different claims even in identical words,
      // and merging them would silently widen or narrow a lesson's reach.
      const sameScope = entries.filter(
        (entry) =>
          entry.scope === input.scope &&
          (input.scope === "global" || sameRoot(entry.projectRoot, input.projectRoot)),
      );
      const duplicate = findDuplicateLesson(lesson, sameScope);
      const now = new Date().toISOString();

      if (duplicate) {
        const next = entries.map((entry) =>
          entry.id === duplicate.id
            ? {
                ...entry,
                // The newer phrasing wins - it is the one the agent just found
                // useful - while the reinforcement history carries forward.
                text: lesson,
                updatedAt: now,
                reinforcedCount: (entry.reinforcedCount ?? 1) + 1,
              }
            : entry,
        );
        return { entries: next, result: { outcome: "reinforced", total: next.length } };
      }

      const entry: ProfileMemoryEntry = {
        id: randomUUID(),
        text: lesson,
        scope: input.scope,
        createdAt: now,
        updatedAt: now,
        source: input.source,
        reinforcedCount: 1,
      };
      if (input.scope === "project" && input.projectRoot) {
        entry.projectRoot = input.projectRoot;
      }
      const next = enforceCap([entry, ...entries]);
      return { entries: next, result: { outcome: "added", total: next.length } };
    });
  }

  /**
   * Rewrite, re-scope or drop one entry. This is both the review loop's write
   * path and the Context Management editor's - the same operation either way,
   * differing only in the `source` stamp the caller passes for a new entry.
   */
  revise(input: ReviseLessonInput): Promise<boolean> {
    return this.mutate(input.personalityId, (entries) => {
      const existing = entries.find((entry) => entry.id === input.entryId);
      if (!existing) {
        return { entries, result: false };
      }
      if (input.drop) {
        return {
          entries: entries.filter((entry) => entry.id !== input.entryId),
          result: true,
        };
      }
      const scope = input.scope ?? existing.scope;
      const next: ProfileMemoryEntry = {
        ...existing,
        ...(input.text !== undefined ? { text: normalizeLesson(input.text) } : {}),
        scope,
        updatedAt: new Date().toISOString(),
      };
      // A lesson moved to global loses its project binding; keeping a stale root
      // on a global entry would make the scope filter ambiguous.
      if (scope === "global") {
        delete next.projectRoot;
      } else {
        // The EXISTING binding wins. The Memory tab lists every project's
        // lessons, so editing another project's entry from this workspace must
        // not silently re-home it - the caller's root only fills a gap, which is
        // what a global entry moving to project scope needs.
        const projectRoot = existing.projectRoot ?? input.projectRoot;
        if (projectRoot) next.projectRoot = projectRoot;
      }
      return {
        entries: entries.map((entry) => (entry.id === input.entryId ? next : entry)),
        result: true,
      };
    });
  }

  /** Add an entry the user authored by hand in Context Management. */
  add(input: RecordLessonInput): Promise<RecordLessonResult> {
    // Same path as an agent recording, including dedup: a user retyping a lesson
    // the personality already knows should reinforce it, not double it.
    return this.record(input);
  }

  /**
   * Move every lesson from one personality to another, merging near-duplicates
   * into the destination's own entries. Returns how many landed as new rows.
   *
   * Deliberately not a file rename: the destination usually already has lessons,
   * and clobbering them to save a merge would destroy exactly the knowledge this
   * operation exists to preserve.
   */
  async transfer(params: {
    fromPersonalityId: string;
    toPersonalityId: string;
    fromPersonalityName?: string;
  }): Promise<{ transferred: number; merged: number }> {
    const source = await this.load(params.fromPersonalityId);
    if (source.length === 0) return { transferred: 0, merged: 0 };

    const result = await this.mutate(params.toPersonalityId, (entries) => {
      let transferred = 0;
      let merged = 0;
      let next = entries;
      for (const incoming of source) {
        const sameScope = next.filter(
          (entry) =>
            entry.scope === incoming.scope &&
            (incoming.scope === "global" || sameRoot(entry.projectRoot, incoming.projectRoot)),
        );
        const duplicate = findDuplicateLesson(incoming.text, sameScope);
        if (duplicate) {
          merged += 1;
          next = next.map((entry) =>
            entry.id === duplicate.id
              ? {
                  ...entry,
                  // Reinforcement adds, because two personalities having
                  // independently learned the same thing is stronger evidence
                  // than either one alone.
                  reinforcedCount: (entry.reinforcedCount ?? 1) + (incoming.reinforcedCount ?? 1),
                  updatedAt: new Date().toISOString(),
                }
              : entry,
          );
          continue;
        }
        transferred += 1;
        // A fresh id: the entry is now the destination's, and reusing the source
        // id would collide the moment the same lessons are transferred twice.
        const moved: ProfileMemoryEntry = {
          ...incoming,
          id: randomUUID(),
          source: "transfer",
        };
        if (params.fromPersonalityName) moved.transferredFrom = params.fromPersonalityName;
        next = [moved, ...next];
      }
      return { entries: enforceCap(next), result: { transferred, merged } };
    });

    await this.clear(params.fromPersonalityId);
    return result;
  }

  /** Delete a personality's whole store. Used by the delete-lessons branch. */
  async clear(personalityId: string): Promise<void> {
    await this.mutate(personalityId, () => ({ entries: [], result: undefined }));
    this.cache.delete(personalityId);
    try {
      await rm(this.filePath(personalityId), { force: true });
    } catch (error) {
      this.logger?.warn({ err: error, personalityId }, "Failed to remove personality memory file");
    }
  }

  private filePath(personalityId: string): string {
    // Personality ids are machine-generated (`personality_*`), but this path is
    // built from a value that crosses the wire, so anything that could climb out
    // of the directory is stripped rather than trusted. Dots go too: real ids
    // never contain one, and keeping them would leave `..` segments in the name.
    const safe = personalityId.replace(/[^A-Za-z0-9_-]/g, "_");
    return path.join(this.rootDir, `${safe}.json`);
  }

  private async load(personalityId: string): Promise<ProfileMemoryEntry[]> {
    const cached = this.cache.get(personalityId);
    if (cached) return cached;
    let entries: ProfileMemoryEntry[] = [];
    try {
      const raw = await readFile(this.filePath(personalityId), "utf8");
      entries = sanitizeEntries(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger?.warn(
          { err: error, personalityId },
          "Failed to read personality memory; starting empty",
        );
      }
    }
    this.cache.set(personalityId, entries);
    return entries;
  }

  /**
   * Serialized read-modify-write per personality. The queue is keyed by
   * personality rather than global so one busy personality can't stall another's
   * recording, and a rejected mutation cannot poison the chain.
   */
  private mutate<T>(
    personalityId: string,
    apply: (entries: ProfileMemoryEntry[]) => {
      entries: ProfileMemoryEntry[];
      result: T;
    },
  ): Promise<T> {
    const previous = this.queues.get(personalityId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.load(personalityId);
        const { entries, result } = apply(current);
        this.cache.set(personalityId, entries);
        try {
          await mkdir(this.rootDir, { recursive: true });
          await writeJsonFileAtomic(this.filePath(personalityId), {
            personalityId,
            entries,
          });
        } catch (error) {
          this.logger?.warn({ err: error, personalityId }, "Failed to persist personality memory");
        }
        return result;
      });
    this.queues.set(personalityId, run);
    return run;
  }
}

/**
 * Normalize a lesson to the shape the tool contract promises: one paragraph,
 * capped in length. Lessons are model-authored and are later interpolated into
 * a system-prompt list item, so newlines and control characters collapse to
 * spaces here - a multi-line entry could smuggle its own markdown headings into
 * the injected brief as top-level structure. The brief composer flattens again
 * at render time; this keeps the store from accumulating entries that only the
 * renderer saves you from.
 */
function normalizeLesson(text: string): string {
  // Written as a code-point test rather than a regex character class: C0
  // controls and C1/DEL become spaces, and the whitespace collapse then folds
  // them - with every newline and Unicode line separator - into single spaces.
  const flat = Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_LESSON_CHARS ? `${flat.slice(0, MAX_LESSON_CHARS)}…` : flat;
}

/**
 * Drop the weakest entries when over the cap: least-reinforced first, then
 * oldest. The same ranking the injection budget uses, so what falls out of
 * storage is what had already fallen out of the brief.
 */
function enforceCap(entries: readonly ProfileMemoryEntry[]): ProfileMemoryEntry[] {
  if (entries.length <= MAX_ENTRIES_PER_PERSONALITY) return [...entries];
  const ranked = [...entries].sort((a, b) => {
    const reinforced = (b.reinforcedCount ?? 0) - (a.reinforcedCount ?? 0);
    if (reinforced !== 0) return reinforced;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return ranked.slice(0, MAX_ENTRIES_PER_PERSONALITY);
}

function sameRoot(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return a === b;
  const norm = (value: string): string =>
    value
      .replace(/[\\/]+$/, "")
      .replace(/\\/g, "/")
      .toLowerCase();
  return norm(a) === norm(b);
}

const VALID_SCOPES = new Set<ProfileMemoryScope>(["project", "global"]);
const VALID_SOURCES = new Set<ProfileMemorySource>(["agent", "user", "review", "transfer"]);

/**
 * Hand-written rather than Zod: the store is the only reader of this file, the
 * shape is five fields, and a malformed entry must be dropped rather than fail
 * the whole load - one bad row should never cost a personality its memory.
 */
function sanitizeEntries(value: unknown): ProfileMemoryEntry[] {
  const raw =
    value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries)
      ? ((value as { entries: unknown[] }).entries as unknown[])
      : [];
  const entries: ProfileMemoryEntry[] = [];
  for (const item of raw) {
    const entry = sanitizeEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** One row, or null when it is too broken to mean anything. */
function sanitizeEntry(item: unknown): ProfileMemoryEntry | null {
  if (!item || typeof item !== "object") return null;
  const candidate = item as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : null;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  // An entry with no id or no text is not a lesson; nothing can be salvaged.
  if (!id || text.length === 0) return null;

  const scope = readEnum(candidate.scope, VALID_SCOPES, "project");
  const createdAt =
    typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString();
  const entry: ProfileMemoryEntry = {
    id,
    text,
    scope,
    createdAt,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt,
    source: readEnum(candidate.source, VALID_SOURCES, "agent"),
  };
  if (scope === "project" && typeof candidate.projectRoot === "string") {
    entry.projectRoot = candidate.projectRoot;
  }
  if (typeof candidate.reinforcedCount === "number" && candidate.reinforcedCount > 0) {
    entry.reinforcedCount = Math.floor(candidate.reinforcedCount);
  }
  if (typeof candidate.transferredFrom === "string") {
    entry.transferredFrom = candidate.transferredFrom;
  }
  return entry;
}

function readEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}
