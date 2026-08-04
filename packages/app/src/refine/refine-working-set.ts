// Turning a tab target's paths into the session's working set.
//
// Kept separate from the session hook so it is pure and testable: labels are
// what the model is told each file is called, so getting them wrong is a
// correctness problem (an unhelpful label makes a multi-file rewrite guess),
// not just a cosmetic one.

import { shortenPath } from "@/utils/shorten-path";
import type { RefineSetFile } from "./refine-set";

/**
 * A label short enough to read in a chip row and specific enough that the model
 * can tell two files apart.
 *
 * Relative to the workspace root when the file is inside it - that is the name
 * the user and the project already use. Otherwise home-shortened, which is what
 * makes a global instruction file read as `~/.claude/CLAUDE.md` rather than as
 * a path with someone's username in it. Ambiguity is resolved by keeping enough
 * trailing segments to stay unique within the set.
 */
export function buildRefineLabel(absolutePath: string, workspaceRoot: string | null): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const root = workspaceRoot?.replace(/\\/g, "/").replace(/\/$/, "") ?? "";
  if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1);
  }
  return shortenPath(normalized);
}

/**
 * Two files in a set can render to the same label - home shortening is the one
 * place that happens, since `/home/me/notes.md` and `/Users/me/notes.md` both
 * become `~/notes.md`. Since the label is what the model uses to tell documents
 * apart, a collision falls back to the **unshortened** path: shortening again
 * is what produced the collision, so it cannot also resolve it.
 */
function disambiguate(labels: string[], paths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return labels.map((label, index) => {
    if ((counts.get(label) ?? 0) <= 1) {
      return label;
    }
    return paths[index]?.replace(/\\/g, "/") ?? label;
  });
}

export interface BuildRefineWorkingSetInput {
  /** Files the model may rewrite. The first is the session's primary. */
  paths: readonly string[];
  /** Files it may read for context but never rewrite. */
  references?: readonly string[];
  /** Used to shorten in-project labels; null when there is no workspace. */
  workspaceRoot: string | null;
}

/**
 * Build the session's working set. Ids are positional and opaque - they are
 * what travels to the daemon and back instead of a path, so a model cannot
 * misroute a write by inventing a filename.
 */
export function buildRefineWorkingSet(input: BuildRefineWorkingSetInput): RefineSetFile[] {
  const writablePaths = dedupe(input.paths);
  // A path cannot be both: being rewritable wins, since the narrower role would
  // silently drop it out of the blast radius the caller asked for.
  const referencePaths = dedupe(input.references ?? []).filter(
    (path) => !writablePaths.includes(path),
  );
  const allPaths = [...writablePaths, ...referencePaths];
  const labels = disambiguate(
    allPaths.map((path) => buildRefineLabel(path, input.workspaceRoot)),
    allPaths,
  );
  return allPaths.map((absolutePath, index) => ({
    id: `d${index}`,
    absolutePath,
    label: labels[index] ?? absolutePath,
    writable: index < writablePaths.length,
  }));
}

function dedupe(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
