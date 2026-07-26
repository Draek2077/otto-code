/**
 * Deletes the range a mechanically-fixable finding flagged — the "Fix all"
 * button in the Issues tab (charter §7.5). Same one-span-rewrite shape as
 * `edge-convert.ts`, batched: findings are grouped by file so a file with
 * several flagged spans gets one read and one write, not one per finding.
 *
 * Deletion is line-aware rather than a bare splice. A dead import is usually
 * a whole bullet on its own line (`- @docs/foo.md`); leaving behind an empty
 * `-` would trade one piece of clutter for another. When the token is the
 * only non-whitespace thing on its line, the whole line goes with it. A
 * duplicate block (which spans full lines already) always takes this path.
 * Otherwise only the token itself is removed, and the seam it leaves in the
 * surrounding prose is collapsed back to a single space.
 */

import fs from "node:fs/promises";
import type { ContextRange } from "./types.js";

export interface FixableFinding {
  /** Absolute path of the file the finding was flagged in. */
  filePath: string;
  range: ContextRange;
  /** Exact text expected at `range` when the file was scanned. */
  snippet: string;
}

export interface FindingFixResult {
  fixedCount: number;
  failedCount: number;
  errors: string[];
}

/** A bare list marker with nothing else on the line — safe to drop entirely. */
const BARE_LINE_MARKER = /^[-*+]$|^\d+[.)]$/;

function lineBounds(
  text: string,
  start: number,
  end: number,
): { lineStart: number; lineEnd: number; hasTrailingNewline: boolean } {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextNewline = text.indexOf("\n", end);
  const hasTrailingNewline = nextNewline !== -1;
  return { lineStart, lineEnd: hasTrailingNewline ? nextNewline : text.length, hasTrailingNewline };
}

function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

/** Removes one range from `text`, tidying the line (or dropping it) around it. */
export function deleteRange(text: string, range: ContextRange): string {
  const { start, end } = range;
  const { lineStart, lineEnd, hasTrailingNewline } = lineBounds(text, start, end);
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd);
  const rebuilt = `${before}${after}`.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "");
  const isBareLine = rebuilt.trim().length === 0 || BARE_LINE_MARKER.test(rebuilt.trim());

  if (isBareLine) {
    const deleteEnd = hasTrailingNewline ? lineEnd + 1 : lineEnd;
    return collapseBlankRuns(text.slice(0, lineStart) + text.slice(deleteEnd));
  }
  return collapseBlankRuns(text.slice(0, lineStart) + rebuilt + text.slice(lineEnd));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies every fixable finding it can. Findings in the same file are deleted
 * in one read/write, back-to-front by range so an earlier deletion never
 * shifts the offsets a later one still needs. A file that no longer contains
 * the expected snippet at its range — edited since the scan — is skipped
 * rather than risking a corrupt write; everything else in that same file
 * still goes through.
 */
export async function fixFindings(findings: readonly FixableFinding[]): Promise<FindingFixResult> {
  const byFile = new Map<string, FixableFinding[]>();
  for (const finding of findings) {
    const list = byFile.get(finding.filePath);
    if (list) {
      list.push(finding);
    } else {
      byFile.set(finding.filePath, [finding]);
    }
  }

  let fixedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const [filePath, items] of byFile) {
    let contents: string;
    try {
      contents = await fs.readFile(filePath, "utf8");
    } catch (error) {
      failedCount += items.length;
      errors.push(`Could not read ${filePath}: ${describe(error)}`);
      continue;
    }

    // Descending by start: deleting the last span on the page first leaves
    // every earlier span's offsets untouched.
    const ordered = [...items].sort((a, b) => b.range.start - a.range.start);
    let next = contents;
    let changed = false;
    let staleCount = 0;
    for (const item of ordered) {
      const { start, end } = item.range;
      if (
        start < 0 ||
        end > next.length ||
        start >= end ||
        next.slice(start, end) !== item.snippet
      ) {
        staleCount += 1;
        continue;
      }
      next = deleteRange(next, item.range);
      changed = true;
    }

    if (staleCount > 0) {
      failedCount += staleCount;
      errors.push(
        `${filePath} changed since it was scanned; ${staleCount} finding${staleCount === 1 ? "" : "s"} skipped.`,
      );
    }

    if (!changed) continue;

    try {
      await fs.writeFile(filePath, next, "utf8");
      fixedCount += ordered.length - staleCount;
    } catch (error) {
      failedCount += ordered.length - staleCount;
      errors.push(`Could not write ${filePath}: ${describe(error)}`);
    }
  }

  return { fixedCount, failedCount, errors };
}
