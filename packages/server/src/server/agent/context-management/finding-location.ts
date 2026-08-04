/**
 * Where a finding came from.
 *
 * Findings are produced against a file's bytes but consumed in a flat list that
 * has long since forgotten which file that was. Both facts a "take me there"
 * affordance needs - the owning node and a line number - are only cheap at the
 * moment the finding is created, while the text is still in hand. So they are
 * stamped there rather than reconstructed by the client.
 */

import type { ContextFinding, ContextFindingKind } from "./types.js";

/** 1-based line containing `offset`, counted the way an editor counts. */
export function lineAtOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let index = 0; index < clamped; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Kinds a mechanical delete of `range` resolves outright: a dead link is just
 * removed, a duplicate block is only a copy of content that survives
 * elsewhere. `import_cycle` (which edge to cut), `oversized_memory_entry`
 * (where to split it), and `depth_capped` (nothing to delete at all) all need
 * judgment a plain deletion cannot supply, so they stay off this list.
 */
const FIXABLE_KINDS: ReadonlySet<ContextFindingKind> = new Set([
  "dead_import",
  "dead_reference",
  "duplicate_across_scope",
  "duplicate_within_file",
]);

/**
 * Stamps the owning node, line, and fixability onto a finding. Returns a new
 * object: the callers push literals, and mutating a literal in place reads as
 * an accident.
 */
export function locateFinding(params: {
  finding: ContextFinding;
  nodeId: string;
  text?: string;
}): ContextFinding {
  const { finding, nodeId, text } = params;
  const range = finding.range;
  if (text == null || !range) return { ...finding, nodeId };
  const line = lineAtOffset(text, range.start);
  // The end line matters as much as the start: a duplicated block is a span,
  // and selecting the whole span is what makes "delete this" a single keypress.
  const lineEnd = Math.max(line, lineAtOffset(text, Math.max(range.start, range.end - 1)));
  return {
    ...finding,
    nodeId,
    line,
    lineEnd,
    fixable: FIXABLE_KINDS.has(finding.kind),
    snippet: text.slice(range.start, range.end),
  };
}
