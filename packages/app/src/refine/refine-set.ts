// The multi-file layer over the single-document core in `hunks.ts`.
//
// A Refine session is a *set* of documents, not one document, because the
// rewrites people actually want are frequently not local to a file: compacting
// a memory index means moving detail into the entry files it points at;
// compacting an instruction file means knowing what the docs it links to
// already say. Refusing to span files would push those jobs back to an
// unreviewed agent edit, which is what Refine exists to replace.
//
// This module stays pure and keeps `hunks.ts` untouched: hunk ids remain
// per-document (`h0`, `h1`, …), and a *decision key* namespaces them by
// document id so one flat kept-set can describe the whole session.

import { allHunkIds, applyRefineDecisions, countKeptChanges, type RefineDiff } from "./hunks";

/** A file in the session's working set, before anything has been proposed. */
export interface RefineSetFile {
  /**
   * Opaque, client-minted, stable for the life of the session. The wire and the
   * model round-trip this rather than a path, so a model that invents or
   * mangles a filename cannot misroute a write.
   */
  id: string;
  /** Absolute, because a context set legitimately spans repo and home files. */
  absolutePath: string;
  /** What the model and the UI both call this file. */
  label: string;
  /**
   * Whether the model may rewrite it. `false` means read-only context: it goes
   * into the prompt so the rewrite fits its project, and comes back never.
   * The writable subset IS the session's blast radius.
   */
  writable: boolean;
}

/** A pinned file: its content as of when the session opened, with its identity. */
export interface RefinePinnedFile extends RefineSetFile {
  content: string;
  modifiedAt: string;
  hash: string | null;
}

/** One file's proposal, diffed against its own pinned base. */
export interface RefineFileProposal {
  id: string;
  label: string;
  absolutePath: string;
  /** Immutable complete snapshots for parser-safe Structural review. */
  beforeSource?: string;
  afterSource?: string;
  diff: RefineDiff;
}

export interface RefineSetStats {
  additions: number;
  removals: number;
  keptHunks: number;
  totalHunks: number;
  /** Files that would actually be written if the session were accepted now. */
  changedFiles: number;
  /** Files carrying at least one proposed change, kept or not. */
  proposedFiles: number;
}

export const EMPTY_REFINE_SET_STATS: RefineSetStats = {
  additions: 0,
  removals: 0,
  keptHunks: 0,
  totalHunks: 0,
  changedFiles: 0,
  proposedFiles: 0,
};

/**
 * `fileId::hunkId`. Both halves are generated, never user text, so the
 * separator cannot collide with either.
 */
export function refineDecisionKey(fileId: string, hunkId: string): string {
  return `${fileId}::${hunkId}`;
}

/** The hunk ids kept within one file, in the shape `applyRefineDecisions` wants. */
export function keptHunkIdsFor(
  proposal: RefineFileProposal,
  keptKeys: ReadonlySet<string>,
): Set<string> {
  const kept = new Set<string>();
  for (const hunk of proposal.diff.hunks) {
    if (keptKeys.has(refineDecisionKey(proposal.id, hunk.id))) {
      kept.add(hunk.id);
    }
  }
  return kept;
}

/** Every decision key in the proposal set - the default after each round. */
export function allRefineSetKeys(proposals: readonly RefineFileProposal[]): Set<string> {
  const keys = new Set<string>();
  for (const proposal of proposals) {
    for (const hunkId of allHunkIds(proposal.diff)) {
      keys.add(refineDecisionKey(proposal.id, hunkId));
    }
  }
  return keys;
}

export interface RefineSetResult {
  id: string;
  absolutePath: string;
  label: string;
  content: string;
  /**
   * False when every hunk in this file was dropped, so the result is byte-for-byte
   * the pinned base. Accept skips these rather than issuing a write that would
   * change nothing but the mtime - and a no-op write is exactly the kind of
   * "did something happen?" ambiguity a review surface must not create.
   */
  changed: boolean;
}

/**
 * Replay every file's diff with the session's decisions applied. This is what
 * Accept writes, and - fed back as the next round's input - what makes
 * regeneration build on what the user kept (see `use-refine-session.ts`).
 */
export function applyRefineSet(
  proposals: readonly RefineFileProposal[],
  keptKeys: ReadonlySet<string>,
): RefineSetResult[] {
  return proposals.map((proposal) => {
    const kept = keptHunkIdsFor(proposal, keptKeys);
    return {
      id: proposal.id,
      absolutePath: proposal.absolutePath,
      label: proposal.label,
      content: applyRefineDecisions(proposal.diff, kept),
      changed: kept.size > 0,
    };
  });
}

/** Totals across the whole set, for the "what am I about to accept" header. */
export function countRefineSetChanges(
  proposals: readonly RefineFileProposal[],
  keptKeys: ReadonlySet<string>,
): RefineSetStats {
  let additions = 0;
  let removals = 0;
  let keptHunks = 0;
  let totalHunks = 0;
  let changedFiles = 0;
  let proposedFiles = 0;

  for (const proposal of proposals) {
    if (proposal.diff.hunks.length === 0) {
      continue;
    }
    proposedFiles += 1;
    totalHunks += proposal.diff.hunks.length;
    const kept = keptHunkIdsFor(proposal, keptKeys);
    if (kept.size === 0) {
      continue;
    }
    changedFiles += 1;
    keptHunks += kept.size;
    const counts = countKeptChanges(proposal.diff, kept);
    additions += counts.additions;
    removals += counts.removals;
  }

  return { additions, removals, keptHunks, totalHunks, changedFiles, proposedFiles };
}

/**
 * `dir` + `base` for a file RPC. The daemon's single-file read/write is not
 * bounded to a workspace root (Context Management already relies on this to
 * open `~/.claude/CLAUDE.md`), so a session that spans repo and home files
 * addresses each one against its own directory.
 */
export function splitAbsolutePath(absolutePath: string): { dir: string; base: string } {
  const normalized = absolutePath.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut === -1
    ? { dir: "", base: normalized }
    : { dir: normalized.slice(0, cut), base: normalized.slice(cut + 1) };
}
