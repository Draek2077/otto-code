import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The engine behind an auditable edit job: plan → run exactly that plan → report per item →
 * undo.
 *
 * Deliberately knows nothing about renames or language servers. A symbol rename is one
 * *planner* that feeds it; a file rename would be another. What it owns is the part that is
 * the same either way and the part that is dangerous: writing, recording what was written,
 * and being able to take it back.
 *
 * Three properties are the whole design:
 *
 * **The plan is executed, not re-derived.** The plan lives here, keyed by id; a caller applies
 * by id and never by supplying edits. That keeps the client from being able to post arbitrary
 * text at arbitrary paths - which is what the earlier "recompute and compare" version was
 * really protecting - while giving the user the thing they actually asked for: the edits they
 * audited are the edits that run. Recomputing instead would refuse the whole job whenever
 * anything moved, and in a product whose agents write files continuously, that refusal is the
 * common case rather than the exceptional one.
 *
 * **Each edit is verified individually, and a failure is reported rather than fatal.** An edit
 * carries the text it expects to replace. A file that changed under us loses only the edits
 * whose ground truth moved; the rest still land, and the ones that did not are named.
 *
 * **Undo is verified the same way.** The before-image is restored only if the file still holds
 * exactly what this job wrote. Anything else means someone edited it since, and a blind
 * restore would destroy their work - so that file is reported as changed-since instead.
 */

/** One replacement, 1-based and end-exclusive, carrying the text it expects to find. */
export interface PlannedEdit {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  newText: string;
  /**
   * What must currently be at that range for the edit to be safe to apply. Captured when the
   * plan is made - it is the entire basis for detecting that a file moved under us.
   */
  oldText: string;
}

export interface PlannedFile {
  path: string;
  edits: PlannedEdit[];
}

export interface EditJobPlan {
  planId: string;
  files: PlannedFile[];
  fileCount: number;
  editCount: number;
}

export type FileOutcomeKind =
  /** Every edit in this file applied. */
  | "applied"
  /** Some applied, some did not - `skippedEdits` says how many. */
  | "partial"
  /** Nothing applied here. */
  | "failed";

export interface FileOutcome {
  path: string;
  kind: FileOutcomeKind;
  appliedEdits: number;
  skippedEdits: number;
  /** Why, when anything was skipped or the file failed outright. */
  reason: string | null;
}

export interface RunOutcome {
  /** Identity of this run, for undo. */
  runId: string;
  files: FileOutcome[];
  appliedFiles: number;
  appliedEdits: number;
  skippedEdits: number;
  /** True when every planned edit landed. */
  complete: boolean;
}

export type UndoOutcomeKind =
  /** Restored to what it was before the run. */
  | "restored"
  /** Someone edited the file after the run; restoring would have destroyed that work. */
  | "changedSince"
  /** Could not be read or written back. */
  | "failed";

export interface UndoFileOutcome {
  path: string;
  kind: UndoOutcomeKind;
  reason: string | null;
}

export interface UndoOutcome {
  files: UndoFileOutcome[];
  restoredFiles: number;
  complete: boolean;
}

/** What one file looked like before and after a run, so the run can be reversed. */
interface JournalEntry {
  path: string;
  before: string;
  after: string;
}

interface StoredRun {
  runId: string;
  entries: JournalEntry[];
  undone: boolean;
}

export interface EditJobStoreOptions {
  /**
   * How many plans and runs to keep. Small on purpose: these hold whole file contents, and a
   * job the user walked away from an hour ago is not one they are coming back to. Eviction
   * makes an apply fail with "the plan expired", which is a clear, recoverable message -
   * unlike an unbounded map, which is a leak nobody sees until the daemon is fat.
   */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 24;

export class EditJobStore {
  private readonly plans = new Map<string, EditJobPlan>();
  private readonly runs = new Map<string, StoredRun>();
  private readonly maxEntries: number;

  constructor(options: EditJobStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Record a plan and hand back its id.
   *
   * The id is derived from the content, so re-planning an unchanged job returns the same id
   * and the panel does not have to care whether it is looking at a fresh plan or the same one
   * again.
   */
  putPlan(files: PlannedFile[], salt: string): EditJobPlan {
    const planId = fingerprint(salt, files);
    const plan: EditJobPlan = {
      planId,
      files,
      fileCount: files.length,
      editCount: files.reduce((total, file) => total + file.edits.length, 0),
    };
    this.plans.set(planId, plan);
    evictOldest(this.plans, this.maxEntries);
    return plan;
  }

  getPlan(planId: string): EditJobPlan | null {
    return this.plans.get(planId) ?? null;
  }

  /**
   * Apply a stored plan. Files are written independently: one that has moved under us costs
   * only its own edits.
   */
  async run(plan: EditJobPlan): Promise<RunOutcome> {
    const outcomes: FileOutcome[] = [];
    const entries: JournalEntry[] = [];

    for (const file of plan.files) {
      const result = await applyFile(file);
      outcomes.push(result.outcome);
      if (result.journal !== null) {
        entries.push(result.journal);
      }
    }

    const runId = fingerprint(`${plan.planId}:run`, plan.files);
    this.runs.set(runId, { runId, entries, undone: false });
    evictOldest(this.runs, this.maxEntries);

    const appliedEdits = outcomes.reduce((total, file) => total + file.appliedEdits, 0);
    const skippedEdits = outcomes.reduce((total, file) => total + file.skippedEdits, 0);

    return {
      runId,
      files: outcomes,
      appliedFiles: outcomes.filter((file) => file.kind !== "failed").length,
      appliedEdits,
      skippedEdits,
      complete: skippedEdits === 0 && appliedEdits === plan.editCount,
    };
  }

  hasRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  /**
   * Put every file back the way it was, for the files this run actually changed and that
   * nobody has touched since.
   */
  async undo(runId: string): Promise<UndoOutcome | null> {
    const stored = this.runs.get(runId);
    if (stored === undefined) {
      return null;
    }

    const files: UndoFileOutcome[] = [];
    for (const entry of stored.entries) {
      files.push(await undoFile(entry));
    }

    stored.undone = true;
    const restoredFiles = files.filter((file) => file.kind === "restored").length;
    return { files, restoredFiles, complete: restoredFiles === files.length };
  }
}

/**
 * Apply one file's edits, verifying each against the text it expected to replace.
 *
 * Descending order is the whole trick: every edit's coordinates were computed against the
 * original text, so editing from the end backwards means no applied edit can shift the
 * offsets of one not yet applied. Ascending would corrupt every edit after the first whose
 * replacement differs in length from what it replaced.
 */
async function applyFile(
  file: PlannedFile,
): Promise<{ outcome: FileOutcome; journal: JournalEntry | null }> {
  let before: string;
  try {
    before = await readFile(file.path, "utf8");
  } catch (error) {
    return {
      outcome: {
        path: file.path,
        kind: "failed",
        appliedEdits: 0,
        skippedEdits: file.edits.length,
        reason: `Could not read the file: ${messageOf(error)}`,
      },
      journal: null,
    };
  }

  const lineStarts = buildLineStarts(before);
  const descending = [...file.edits].sort((a, b) => b.line - a.line || b.column - a.column);

  let next = before;
  let applied = 0;
  let skipped = 0;

  for (const edit of descending) {
    const from = offsetOf(lineStarts, before.length, edit.line, edit.column);
    const to = offsetOf(lineStarts, before.length, edit.endLine, edit.endColumn);
    if (next.slice(from, to) !== edit.oldText) {
      skipped += 1;
      continue;
    }
    next = next.slice(0, from) + edit.newText + next.slice(to);
    applied += 1;
  }

  if (applied === 0) {
    return {
      outcome: {
        path: file.path,
        kind: "failed",
        appliedEdits: 0,
        skippedEdits: skipped,
        reason: "The file changed after the plan was made, so none of its edits still fit.",
      },
      journal: null,
    };
  }

  try {
    await writeFile(file.path, next, "utf8");
  } catch (error) {
    return {
      outcome: {
        path: file.path,
        kind: "failed",
        appliedEdits: 0,
        skippedEdits: file.edits.length,
        reason: `Could not write the file: ${messageOf(error)}`,
      },
      journal: null,
    };
  }

  return {
    outcome: {
      path: file.path,
      kind: skipped === 0 ? "applied" : "partial",
      appliedEdits: applied,
      skippedEdits: skipped,
      reason:
        skipped === 0
          ? null
          : `${skipped} ${skipped === 1 ? "edit" : "edits"} no longer matched the file and were left alone.`,
    },
    journal: { path: file.path, before, after: next },
  };
}

/**
 * Restore one file - but only if it still holds exactly what the run wrote.
 *
 * The check is the point. An undo that writes the before-image unconditionally would silently
 * destroy anything saved since the run, which is a far worse outcome than not undoing.
 */
async function undoFile(entry: JournalEntry): Promise<UndoFileOutcome> {
  let current: string;
  try {
    current = await readFile(entry.path, "utf8");
  } catch (error) {
    return { path: entry.path, kind: "failed", reason: `Could not read: ${messageOf(error)}` };
  }

  if (current !== entry.after) {
    return {
      path: entry.path,
      kind: "changedSince",
      reason: "The file was edited after the rename, so it was left as it is.",
    };
  }

  try {
    await writeFile(entry.path, entry.before, "utf8");
  } catch (error) {
    return { path: entry.path, kind: "failed", reason: `Could not write: ${messageOf(error)}` };
  }
  return { path: entry.path, kind: "restored", reason: null };
}

/**
 * Whether a path a planner produced actually lives under the workspace root.
 *
 * `path.relative` rather than a string prefix: a prefix test says `/repo-evil` is inside
 * `/repo`, and normalizing first is what makes `..` segments visible instead of clever.
 */
export function isInsideWorkspace(rootPath: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Content-derived identity: any difference at all produces a different id. */
function fingerprint(salt: string, files: readonly PlannedFile[]): string {
  const canonical = files
    .map(
      (file) =>
        `${file.path} ${file.edits
          .map((e) => `${e.line}:${e.column}:${e.endLine}:${e.endColumn}:${e.oldText}:${e.newText}`)
          .join(",")}`,
    )
    .join("");
  return createHash("sha1").update(`${salt}${canonical}`).digest("hex");
}

/** Map insertion order is age order, so the oldest key is simply the first. */
function evictOldest(map: Map<string, unknown>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      return;
    }
    map.delete(oldest.value);
  }
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

/** 1-based line/column to an offset, clamped to the document. */
function offsetOf(
  lineStarts: readonly number[],
  length: number,
  line: number,
  column: number,
): number {
  const start = lineStarts[Math.min(Math.max(line, 1), lineStarts.length) - 1];
  return Math.min(start + Math.max(0, column - 1), length);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
